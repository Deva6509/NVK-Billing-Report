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

        // 2. Find latest FC28 batch, then load its rows
        const latestBatch = await db.fC28Batch.findFirst({ orderBy: { reportDate: "desc" } });
        const fc28Records = latestBatch
          ? await db.fC28Row.findMany({
              where:   { batchId: latestBatch.id, childId: { in: childIds } },
              orderBy: { childId: "asc" },
            })
          : [];

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

            // All FC28 fields except those already in FIN14 rawData
            // (Child ID = join key, Child Name, Center, Family Name, Family ID are repetitive)
            const b = (v: boolean | null | undefined) => v == null ? "" : v ? "Yes" : "No";
            const s = (v: any) => v ?? "";
            const patch = {
              "Child Status (FC28)":       s(fc28.childStatus),
              "Family Status (FC28)":      s(fc28.familyStatus),
              "Classroom (FC28)":          s(fc28.classroom),
              "Rate Sheet (FC28)":         s(fc28.rateSheet),
              "Date of Birth (FC28)":      s(fc28.dateOfBirth),
              "Enroll Date (FC28)":        s(fc28.enrollDate),
              "Start Date (FC28)":         s(fc28.startDate),
              "Withdrawal Date (FC28)":    s(fc28.withdrawalDate),
              "Withdrawal Reason (FC28)":  s(fc28.withdrawalReason),
              "Primary Guardian (FC28)":   s(fc28.primaryGuardian),
              "Mon (FC28)":                b(fc28.monDay),
              "Tue (FC28)":                b(fc28.tueDay),
              "Wed (FC28)":                b(fc28.wedDay),
              "Thu (FC28)":                b(fc28.thuDay),
              "Fri (FC28)":                b(fc28.friDay),
              "Drop Off (FC28)":           s(fc28.dropOff),
              "Pickup (FC28)":             s(fc28.pickup),
              "Early AM Care (FC28)":      s(fc28.earlyAMCare),
              "Late PM Care (FC28)":       s(fc28.latePMCare),
              "Program (FC28)":            s(fc28.program),
              "Address 1 (FC28)":          s(fc28.address1),
              "Address 2 (FC28)":          s(fc28.address2),
              "City (FC28)":               s(fc28.city),
              "State (FC28)":              s(fc28.state),
              "Zip Code (FC28)":           s(fc28.zipCode),
              "Discount Type (FC28)":      s(fc28.discountType),
              "Discount Name (FC28)":      s(fc28.discountName),
              "Main Discount (FC28)":      s(fc28.mainDiscount),
              "AM/PM Discount (FC28)":     s(fc28.amPmDiscount),
              "Total Discount (FC28)":     s(fc28.totalDiscount),
              "Billing Cycle (FC28)":      s(fc28.billingCycle),
              "Agency 1 (FC28)":           s(fc28.agency1),
              "Family Contrib 1 (FC28)":   s(fc28.familyContrib1),
              "Contract Amt 1 (FC28)":     s(fc28.contractAmt1),
              "Contract Period 1 (FC28)":  s(fc28.contractPeriod1),
              "Copay Amt 1 (FC28)":        s(fc28.copayAmt1),
              "Copay Period 1 (FC28)":     s(fc28.copayPeriod1),
              "Agency 2 (FC28)":           s(fc28.agency2),
              "Family Contrib 2 (FC28)":   s(fc28.familyContrib2),
              "Contract Amt 2 (FC28)":     s(fc28.contractAmt2),
              "Contract Period 2 (FC28)":  s(fc28.contractPeriod2),
              "Copay Amt 2 (FC28)":        s(fc28.copayAmt2),
              "Copay Period 2 (FC28)":     s(fc28.copayPeriod2),
              "Rate Card Key (FC28)":      s(fc28.rateCardKey),
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
