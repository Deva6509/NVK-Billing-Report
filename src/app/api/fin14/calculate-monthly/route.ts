import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const db = prisma as any;
const enc = new TextEncoder();

function sse(data: object) {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str || str === "N/A" || str === "") return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function workingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(23, 59, 59, 999);
  while (d <= e) { const day = d.getDay(); if (day >= 1 && day <= 5) count++; d.setDate(d.getDate() + 1); }
  return count;
}

function mondaysCount(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(23, 59, 59, 999);
  while (d <= e) { if (d.getDay() === 1) count++; d.setDate(d.getDate() + 1); }
  return count;
}

function finalStartDate(startStr: any, withdrawalStr: any, monthStart: Date, monthEnd: Date): Date | null {
  const startDate = parseDate(startStr);
  if (!startDate) return null;
  const startDay = new Date(startDate); startDay.setHours(0, 0, 0, 0);
  const mEnd     = new Date(monthEnd);  mEnd.setHours(23, 59, 59, 999);
  const mStart   = new Date(monthStart); mStart.setHours(0, 0, 0, 0);
  if (startDay > mEnd) return null;
  const withdrawalRaw = withdrawalStr ? String(withdrawalStr).trim() : "";
  const isNA = !withdrawalRaw || withdrawalRaw === "N/A";
  if (isNA) return new Date(Math.max(startDay.getTime(), mStart.getTime()));
  const withdrawalDate = parseDate(withdrawalStr);
  if (withdrawalDate) {
    const wDay = new Date(withdrawalDate); wDay.setHours(0, 0, 0, 0);
    if (wDay >= mStart) return new Date(Math.max(startDay.getTime(), mStart.getTime()));
  }
  return null;
}

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
    if (wDay >= mStart) return new Date(Math.min(mEnd.getTime(), wDay.getTime()));
  }
  return mEnd;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

// Count Mon–Fri days between two dates inclusive
function countWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(23, 59, 59, 999);
  while (d <= e) { const day = d.getDay(); if (day >= 1 && day <= 5) count++; d.setDate(d.getDate() + 1); }
  return count;
}

// Count Mondays between two dates inclusive
function countMondays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(23, 59, 59, 999);
  while (d <= e) { if (d.getDay() === 1) count++; d.setDate(d.getDate() + 1); }
  return count;
}

function toNum(v: any): number {
  if (!v && v !== 0) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
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

        // 1. Build rate maps from Rate Sheet new key columns (earlyAMRateCardKey / latePMRateCardKey)
        const latestBatch = await db.rateSheetBatch.findFirst({ orderBy: { uploadedAt: "desc" } });
        const earlyAMMap = new Map<string, string>();
        const latePMMap  = new Map<string, string>();

        if (latestBatch) {
          const rateRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "earlyAMRateCardKey", "latePMRateCardKey", "itemValue" FROM "RateSheetRow" WHERE "batchId" = $1`,
            latestBatch.id
          );
          for (const r of rateRows) {
            if (r.earlyAMRateCardKey && r.itemValue) earlyAMMap.set(r.earlyAMRateCardKey, r.itemValue);
            if (r.latePMRateCardKey  && r.itemValue) latePMMap.set(r.latePMRateCardKey,   r.itemValue);
          }
        }

        controller.enqueue(sse({ phase: "init", message: `Loaded ${earlyAMMap.size} Early AM + ${latePMMap.size} Late PM rate entries — loading all FIN14 rows…` }));

        // 2. Load ALL rows in ONE query — eliminates 76 slow OFFSET-based SELECTs
        const allRows: { id: number; rawData: Record<string, any> }[] = await prisma.$queryRawUnsafe(
          `SELECT id, "rawData" FROM "Fin14Row" ORDER BY id`
        );
        const total = allRows.length;

        controller.enqueue(sse({ phase: "init", message: `Loaded ${total.toLocaleString()} rows — calculating…` }));

        // 3. Process all in JS, UPDATE in large batches (3000 rows = ~13 UPDATEs vs 76)
        const UPDATE_BATCH = 3000;
        let updated = 0;

        for (let batchStart = 0; batchStart < total; batchStart += UPDATE_BATCH) {
          const chunk = allRows.slice(batchStart, batchStart + UPDATE_BATCH);
          const valueParts: string[] = [];
          const params: any[] = [];
          let pi = 1;

          for (const row of chunk) {
            const rd = row.rawData;

            const startStr      = rd["Start Date (FC28)"]      ?? rd["Start Date"]      ?? "";
            const withdrawalStr = rd["Withdrawal Date (FC28)"] ?? rd["Withdrawal Date"] ?? "";
            const earlyAM       = String(rd["Early AM Care (FC28)"] ?? rd["Early AM Care"] ?? "").trim();
            const latePM        = String(rd["Late PM Care (FC28)"]  ?? rd["Late PM Care"]  ?? "").trim();

            const earlyAMKey = String(rd["Early AM Rate Card Key (FC28)"] ?? "").trim();
            const latePMKey  = String(rd["Late PM Rate Card Key (FC28)"]  ?? "").trim();

            const fsd = finalStartDate(startStr, withdrawalStr, monthStart, monthEnd);
            const fed = finalEndDate(fsd, withdrawalStr, monthStart, monthEnd);

            const earlyAMFees = (earlyAM === "Yes" || earlyAM === "yes") && earlyAMKey
              ? (earlyAMMap.get(earlyAMKey) ?? "")
              : "";
            const latePMFees = (latePM === "Yes" || latePM === "yes") && latePMKey
              ? (latePMMap.get(latePMKey) ?? "")
              : "";

            // Final Days to be Billed:
            // if Date.From(Start Date) = Final End Date → 0
            // else if Final Start Date valid → count working days (Mon–Fri) between fsd and fed
            // else → 0
            const originalStart = parseDate(startStr);
            const fedDay = fed ? new Date(fed) : null; if (fedDay) fedDay.setHours(0,0,0,0);
            const origStartDay = originalStart ? new Date(originalStart) : null; if (origStartDay) origStartDay.setHours(0,0,0,0);
            const startEqualsEnd = origStartDay && fedDay && origStartDay.getTime() === fedDay.getTime();
            const finalDaysToBill = startEqualsEnd
              ? 0
              : fsd && fed ? countWorkingDays(fsd, fed) : 0;

            // Final Weeks to be Billed:
            // if Final Start Date = Final End Date → 0
            // else if Final Start Date valid → count Mondays between fsd and fed
            // else → 0
            const fsdDay = fsd ? new Date(fsd) : null; if (fsdDay) fsdDay.setHours(0,0,0,0);
            const fsdEqualsFed = fsdDay && fedDay && fsdDay.getTime() === fedDay.getTime();
            const finalWeeksToBill = fsdEqualsFed
              ? 0
              : fsd && fed ? countMondays(fsd, fed) : 0;

            // Gross Billing Amount = Monthly fees (Item Value from Rate Sheet) + Early AM Fees + Late PM Fees
            const monthlyFees = rd["Item Value (Rate Sheet)"] ?? "";
            const grossBilling = toNum(monthlyFees) + toNum(earlyAMFees) + toNum(latePMFees);

            // Agency Type: "Private" if Agency 1 is blank/null, else "Agency"
            const agency = String(rd["Agency 1 (FC28)"] ?? rd["Agency"] ?? "").trim();
            const agencyType = agency === "" ? "Private" : "Agency";

            const patch: Record<string, any> = {
              "Month Start Date":              monthStartDate,
              "Month End Date":                monthEndDate,
              "Total Days in Month":           totalDays,
              "Total Mondays in Month":        totalMondays,
              "Final Start Date":              fsd ? fmtDate(fsd) : "",
              "Final End Date":                fed ? fmtDate(fed) : "",
              "Early AM Care Fees":            earlyAMFees,
              "Late PM Care Fees":             latePMFees,
              "Final Days to be Billed":       finalDaysToBill,
              "Final Weeks to be Billed":      finalWeeksToBill,
              "Gross Billing Amount":          grossBilling === 0 ? "" : grossBilling,
              "Agency Type":                   agencyType,
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

          const done = Math.min(batchStart + UPDATE_BATCH, total);
          controller.enqueue(sse({
            phase: "processing",
            done,
            total,
            pct: Math.round((done / total) * 100),
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
