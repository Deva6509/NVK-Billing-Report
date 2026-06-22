import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const db = prisma as any;
const enc = new TextEncoder();

function sse(data: object) {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

const BATCH_SIZE = 1000; // children per SQL UPDATE

// POST /api/fin14/map-fc28  — streams SSE progress events
export async function POST(req: NextRequest) {
  const body    = await req.json().catch(() => ({}));
  const batchId: string | undefined = body.batchId;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Collect unique Child IDs from FIN14
        controller.enqueue(sse({ phase: "init", message: "Collecting Child IDs…" }));

        const childIdRows: { childId: string }[] = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT "rawData"->>'Child ID' AS "childId"
           FROM "Fin14Row"
           ${batchId ? `WHERE "batchId" = $1` : ""}`,
          ...(batchId ? [batchId] : [])
        );

        const childIds = childIdRows.map((r) => r.childId).filter(Boolean);
        const total    = childIds.length;

        if (total === 0) {
          controller.enqueue(sse({ phase: "complete", message: "No Child IDs found", mapped: 0, unmapped: 0, total: 0 }));
          controller.close();
          return;
        }

        controller.enqueue(sse({ phase: "init", message: `Found ${total} unique children — loading FC28 data…`, total }));

        // 2. Load ALL FC28 latest records in one query
        const fc28Records = await db.fC28Record.findMany({
          where:    { childId: { in: childIds } },
          orderBy:  { reportDate: "desc" },
          distinct: ["childId"],
        });

        const fc28Map = new Map<string, any>(fc28Records.map((r: any) => [String(r.childId), r]));

        controller.enqueue(sse({
          phase:   "mapping",
          message: `Loaded ${fc28Map.size} FC28 records — bulk updating…`,
          total, done: 0, mapped: 0, unmapped: 0, pct: 0,
        }));

        // 3. Process in bulk batches — one SQL UPDATE per BATCH_SIZE children
        let mapped   = 0;
        let unmapped = 0;
        let done     = 0;

        for (let i = 0; i < childIds.length; i += BATCH_SIZE) {
          const chunk = childIds.slice(i, i + BATCH_SIZE);

          // Build VALUES list for children that have FC28 data
          const params: any[]     = [];
          const valueParts: string[] = [];
          let pi = 1;

          for (const childId of chunk) {
            const fc28 = fc28Map.get(childId);
            if (!fc28) { unmapped++; continue; }

            const withdrawalDate =
              fc28.childStatus && fc28.childStatus.toLowerCase() !== "active"
                ? fc28.reportDate.toISOString().slice(0, 10)
                : "";

            const patch = {
              "Billing Cycle (FC28)":   fc28.billingCycle   ?? "",
              "Child Status (FC28)":    fc28.childStatus    ?? "",
              "Start Date (FC28)":      fc28.startDate      ?? "",
              "Withdrawal Date (FC28)": withdrawalDate,
              "Family Status (FC28)":   fc28.familyStatus   ?? "",
              "Classroom (FC28)":       fc28.classroom      ?? "",
              "Date of Birth (FC28)":   fc28.dateOfBirth    ?? "",
            };

            valueParts.push(`($${pi}::text, $${pi + 1}::jsonb)`);
            params.push(childId, JSON.stringify(patch));
            pi += 2;
            mapped++;
          }

          // Execute one bulk UPDATE for this chunk
          if (valueParts.length > 0) {
            if (batchId) {
              params.push(batchId);
              await prisma.$executeRawUnsafe(
                `UPDATE "Fin14Row" AS t
                 SET    "rawData" = t."rawData" || v.patch
                 FROM   (VALUES ${valueParts.join(",")}) AS v(child_id, patch)
                 WHERE  t."rawData"->>'Child ID' = v.child_id
                   AND  t."batchId" = $${pi}`,
                ...params
              );
            } else {
              await prisma.$executeRawUnsafe(
                `UPDATE "Fin14Row" AS t
                 SET    "rawData" = t."rawData" || v.patch
                 FROM   (VALUES ${valueParts.join(",")}) AS v(child_id, patch)
                 WHERE  t."rawData"->>'Child ID' = v.child_id`,
                ...params
              );
            }
          }

          done = Math.min(i + chunk.length, total);
          controller.enqueue(sse({
            phase:   "mapping",
            done,
            total,
            mapped,
            unmapped,
            pct: Math.round((done / total) * 100),
          }));
        }

        controller.enqueue(sse({
          phase:   "complete",
          done:    total,
          total,
          mapped,
          unmapped,
          pct:     100,
          message: `Done — ${mapped} children mapped, ${unmapped} not in FC28 DB`,
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
