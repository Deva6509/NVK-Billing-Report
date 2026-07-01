import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const db = prisma as any;
const enc = new TextEncoder();

function to24h(t: string | null): string {
  if (!t) return "";
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return t.trim();
  let h = parseInt(m[1], 10);
  const min = m[2], sec = m[3] ?? "00", ampm = m[4].toUpperCase();
  if (ampm === "AM") { if (h === 12) h = 0; }
  else               { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${min}:${sec}`;
}

function sse(data: object) {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

const BATCH_SIZE = 1000;

// POST /api/fin14/map-rate-sheet — streams SSE progress
// Matches FIN14 rows to Rate Sheet using "Rate Card Key (FC28)" in rawData.
// The FC28 key is: Center|RateSheet|DropOff|Pickup|Program|Classroom
// The Rate Sheet key is built as: centerShort|versionName|dropOff|pickUp|program|itemName
// When Classroom == itemName they match → pulls itemName + itemValue into rawData.
export async function POST(_req: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sse({ phase: "init", message: "Loading Rate Sheet data…" }));

        // 1. Load latest Rate Sheet batch
        const latestBatch = await db.rateSheetBatch.findFirst({ orderBy: { uploadedAt: "desc" } });
        if (!latestBatch) {
          controller.enqueue(sse({ phase: "complete", message: "No Rate Sheet data found. Please upload Rate Sheets first.", mapped: 0, unmapped: 0, total: 0 }));
          controller.close();
          return;
        }

        const rateRows = await db.rateSheetRow.findMany({ where: { batchId: latestBatch.id } });

        // 2. Build lookup: computed key → { itemName, itemValue }
        // Key = centerShort|versionName|dropOff|pickUp|program|itemName
        const rateMap = new Map<string, { itemName: string; itemValue: string }>();
        for (const r of rateRows) {
          const centerShort = (r.center ?? "").split(",")[0].trim();
          const key = [
            centerShort,
            r.versionName ?? "",
            to24h(r.dropOff),
            to24h(r.pickUp),
            r.program    ?? "",
            r.itemName   ?? "",
          ].join("|");
          rateMap.set(key, { itemName: r.itemName ?? "", itemValue: r.itemValue ?? "" });
        }

        controller.enqueue(sse({ phase: "init", message: `Loaded ${rateMap.size} Rate Sheet entries — collecting FIN14 children…` }));

        // 3. Collect distinct Rate Card Keys from FIN14
        const keyRows: { rateKey: string }[] = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT "rawData"->>'Rate Card Key (FC28)' AS "rateKey" FROM "Fin14Row" WHERE "rawData"->>'Rate Card Key (FC28)' IS NOT NULL AND "rawData"->>'Rate Card Key (FC28)' != ''`
        );
        const rateKeys = keyRows.map((r) => r.rateKey).filter(Boolean);
        const total = rateKeys.length;

        if (total === 0) {
          controller.enqueue(sse({ phase: "complete", message: "No Rate Card Keys found in FIN14. Run Map FC28 to FIN14 first.", mapped: 0, unmapped: 0, total: 0 }));
          controller.close();
          return;
        }

        controller.enqueue(sse({ phase: "mapping", message: `Found ${total} unique Rate Card Keys — mapping…`, total, done: 0, mapped: 0, unmapped: 0, pct: 0 }));

        let mapped = 0, unmapped = 0, done = 0;

        for (let i = 0; i < rateKeys.length; i += BATCH_SIZE) {
          const chunk = rateKeys.slice(i, i + BATCH_SIZE);

          const valueParts: string[] = [];
          const params: any[] = [];
          let pi = 1;

          for (const rateCardKey of chunk) {
            const match = rateMap.get(rateCardKey);
            if (!match) { unmapped++; continue; }

            const patch = {
              "Item Name (Rate Sheet)":  match.itemName,
              "Item Value (Rate Sheet)": match.itemValue,
            };

            valueParts.push(`($${pi}::text, $${pi + 1}::jsonb)`);
            params.push(rateCardKey, JSON.stringify(patch));
            pi += 2;
            mapped++;
          }

          if (valueParts.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Fin14Row" AS t
               SET    "rawData" = t."rawData" || v.patch
               FROM   (VALUES ${valueParts.join(",")}) AS v(rate_key, patch)
               WHERE  t."rawData"->>'Rate Card Key (FC28)' = v.rate_key`,
              ...params
            );
          }

          done = Math.min(i + chunk.length, total);
          controller.enqueue(sse({
            phase: "mapping", done, total, mapped, unmapped,
            pct: Math.round((done / total) * 100),
          }));
        }

        controller.enqueue(sse({
          phase: "complete", done: total, total, mapped, unmapped, pct: 100,
          message: `Done — ${mapped} keys matched, ${unmapped} not in Rate Sheet`,
        }));

      } catch (err: any) {
        controller.enqueue(sse({ phase: "error", message: err.message ?? "Mapping failed" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
