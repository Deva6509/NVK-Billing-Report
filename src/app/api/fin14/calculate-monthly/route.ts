import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const db = prisma as any;
const enc = new TextEncoder();

function sse(data: object) {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

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

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str || str === "N/A" || str === "") return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// Count Mon–Fri days between two dates inclusive
function workingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  while (d <= e) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Count Mondays between two dates inclusive
function mondaysCount(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  while (d <= e) {
    if (d.getDay() === 1) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Power Query Final Start Date logic (translated to TypeScript):
// if startDate <= monthEnd AND (withdrawalDate = "N/A" OR withdrawalDate >= monthStart)
//   → max(startDate, monthStart)
// else → null (0)
function finalStartDate(startStr: any, withdrawalStr: any, monthStart: Date, monthEnd: Date): Date | null {
  const startDate = parseDate(startStr);
  if (!startDate) return null;

  const startDay = new Date(startDate); startDay.setHours(0, 0, 0, 0);
  const mEnd     = new Date(monthEnd);  mEnd.setHours(23, 59, 59, 999);
  const mStart   = new Date(monthStart); mStart.setHours(0, 0, 0, 0);

  if (startDay > mEnd) return null;

  const withdrawalRaw = withdrawalStr ? String(withdrawalStr).trim() : "";
  const isNA = !withdrawalRaw || withdrawalRaw === "N/A";

  if (isNA) {
    return new Date(Math.max(startDay.getTime(), mStart.getTime()));
  }

  const withdrawalDate = parseDate(withdrawalStr);
  if (withdrawalDate) {
    const wDay = new Date(withdrawalDate); wDay.setHours(0, 0, 0, 0);
    if (wDay >= mStart) {
      return new Date(Math.max(startDay.getTime(), mStart.getTime()));
    }
  }
  return null;
}

// Power Query Final End Date logic:
// if fsd is valid AND withdrawalDate = "N/A" → monthEnd
// if fsd is valid AND withdrawalDate >= monthStart → min(monthEnd, withdrawalDate)
// else → monthEnd
function finalEndDate(fsd: Date | null, withdrawalStr: any, monthStart: Date, monthEnd: Date): Date | null {
  if (!fsd) return null;

  const mEnd   = new Date(monthEnd);   mEnd.setHours(0, 0, 0, 0);
  const mStart = new Date(monthStart); mStart.setHours(0, 0, 0, 0);

  const withdrawalRaw = withdrawalStr ? String(withdrawalStr).trim() : "";
  const isNA = !withdrawalRaw || withdrawalRaw === "N/A";

  if (isNA) return mEnd;

  const withdrawalDate = parseDate(withdrawalStr);
  if (withdrawalDate) {
    const wDay = new Date(withdrawalDate); wDay.setHours(0, 0, 0, 0);
    if (wDay >= mStart) {
      return new Date(Math.min(mEnd.getTime(), wDay.getTime()));
    }
  }
  return mEnd;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

// POST /api/fin14/calculate-monthly
// Body: { monthStartDate: "2026-06-01", monthEndDate: "2026-06-30" }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { monthStartDate, monthEndDate } = body as { monthStartDate: string; monthEndDate: string };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!monthStartDate || !monthEndDate) {
          controller.enqueue(sse({ phase: "error", message: "monthStartDate and monthEndDate are required" }));
          controller.close();
          return;
        }

        const monthStart = new Date(monthStartDate);
        const monthEnd   = new Date(monthEndDate);
        monthStart.setHours(0, 0, 0, 0);
        monthEnd.setHours(0, 0, 0, 0);

        const totalDays    = workingDays(monthStart, monthEnd);
        const totalMondays = mondaysCount(monthStart, monthEnd);

        controller.enqueue(sse({ phase: "init", message: `Month: ${monthStartDate} → ${monthEndDate} | Working days: ${totalDays} | Mondays: ${totalMondays}` }));

        // 1. Load Rate Sheet for Early AM / Late PM lookups
        const latestBatch = await db.rateSheetBatch.findFirst({ orderBy: { uploadedAt: "desc" } });
        const rateMap = new Map<string, string>(); // key → itemValue

        if (latestBatch) {
          const rateRows = await db.rateSheetRow.findMany({ where: { batchId: latestBatch.id } });
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
            rateMap.set(key, r.itemValue ?? "");
          }
        }

        // 2. Load classroom mappings
        const classroomRows: { fc28Classroom: string; rateSheetItem: string | null }[] =
          await db.classroomMapping.findMany();
        const classroomMap = new Map<string, string>();
        for (const c of classroomRows) {
          if (c.rateSheetItem) classroomMap.set(c.fc28Classroom, c.rateSheetItem);
        }

        controller.enqueue(sse({ phase: "init", message: `Loaded ${rateMap.size} rate entries, ${classroomMap.size} classroom mappings — processing FIN14 rows…` }));

        // 3. Process all FIN14 rows in batches
        const BATCH = 500;
        const total: number = await db.fin14Row.count();
        let processed = 0, updated = 0;

        for (let skip = 0; skip < total; skip += BATCH) {
          const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT id, "rawData" FROM "Fin14Row" ORDER BY id LIMIT ${BATCH} OFFSET ${skip}`
          );

          if (!rows.length) break;

          const valueParts: string[] = [];
          const params: any[] = [];
          let pi = 1;

          for (const row of rows) {
            const rd = (row.rawData ?? {}) as Record<string, any>;

            const startStr      = rd["Start Date (FC28)"]      ?? rd["Start Date"]      ?? "";
            const withdrawalStr = rd["Withdrawal Date (FC28)"] ?? rd["Withdrawal Date"] ?? "";
            const earlyAM       = String(rd["Early AM Care (FC28)"] ?? rd["Early AM Care"] ?? "").trim();
            const latePM        = String(rd["Late PM Care (FC28)"]  ?? rd["Late PM Care"]  ?? "").trim();
            const rateCardKey   = String(rd["Rate Card Key (FC28)"] ?? "").trim();

            const fsd = finalStartDate(startStr, withdrawalStr, monthStart, monthEnd);
            const fed = finalEndDate(fsd, withdrawalStr, monthStart, monthEnd);

            // Early AM fee lookup
            let earlyAMFees = "";
            if ((earlyAM === "Yes" || earlyAM === "yes") && rateCardKey) {
              const parts = rateCardKey.split("|");
              if (parts.length === 6) {
                const fc28Classroom   = parts[5];
                const mappedClassroom = classroomMap.get(fc28Classroom) ?? fc28Classroom;
                const lookupKey = [...parts.slice(0, 4), "Early AM Care", mappedClassroom].join("|");
                earlyAMFees = rateMap.get(lookupKey) ?? "";
              }
            }

            // Late PM fee lookup
            let latePMFees = "";
            if ((latePM === "Yes" || latePM === "yes") && rateCardKey) {
              const parts = rateCardKey.split("|");
              if (parts.length === 6) {
                const fc28Classroom   = parts[5];
                const mappedClassroom = classroomMap.get(fc28Classroom) ?? fc28Classroom;
                const lookupKey = [...parts.slice(0, 4), "Late PM Care", mappedClassroom].join("|");
                latePMFees = rateMap.get(lookupKey) ?? "";
              }
            }

            const patch: Record<string, any> = {
              "Month Start Date":       monthStartDate,
              "Month End Date":         monthEndDate,
              "Total Days in Month":    totalDays,
              "Total Mondays in Month": totalMondays,
              "Final Start Date":       fsd ? fmtDate(fsd) : "",
              "Final End Date":         fed ? fmtDate(fed) : "",
              "Early AM Care Fees":     earlyAMFees,
              "Late PM Care Fees":      latePMFees,
            };

            valueParts.push(`($${pi}::int, $${pi + 1}::jsonb)`);
            params.push(row.id, JSON.stringify(patch));
            pi += 2;
            updated++;
          }

          if (valueParts.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Fin14Row" AS t
               SET    "rawData" = t."rawData" || v.patch
               FROM   (VALUES ${valueParts.join(",")}) AS v(id, patch)
               WHERE  t.id = v.id`,
              ...params
            );
          }

          processed = Math.min(skip + BATCH, total);
          controller.enqueue(sse({
            phase: "processing",
            done: processed,
            total,
            pct: Math.round((processed / total) * 100),
          }));
        }

        controller.enqueue(sse({
          phase: "complete",
          done: total,
          total,
          pct: 100,
          message: `Done — ${updated} rows updated with monthly fields`,
        }));

      } catch (err: any) {
        controller.enqueue(sse({ phase: "error", message: err.message ?? "Calculation failed" }));
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
