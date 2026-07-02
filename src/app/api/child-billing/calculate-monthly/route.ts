import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const db = prisma as any;
const enc = new TextEncoder();
function sse(d: object) { return enc.encode(`data: ${JSON.stringify(d)}\n\n`); }

function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str || str === "N/A") return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function workingDays(start: Date, end: Date): number {
  let c = 0; const d = new Date(start); d.setHours(0,0,0,0); const e = new Date(end); e.setHours(23,59,59,999);
  while (d <= e) { const w = d.getDay(); if (w >= 1 && w <= 5) c++; d.setDate(d.getDate()+1); } return c;
}
function mondaysCount(start: Date, end: Date): number {
  let c = 0; const d = new Date(start); d.setHours(0,0,0,0); const e = new Date(end); e.setHours(23,59,59,999);
  while (d <= e) { if (d.getDay()===1) c++; d.setDate(d.getDate()+1); } return c;
}
function finalStartDate(startStr: any, withdrawalStr: any, mStart: Date, mEnd: Date): Date | null {
  const sd = parseDate(startStr); if (!sd) return null;
  const s = new Date(sd); s.setHours(0,0,0,0);
  const me = new Date(mEnd); me.setHours(23,59,59,999);
  const ms = new Date(mStart); ms.setHours(0,0,0,0);
  if (s > me) return null;
  const wr = withdrawalStr ? String(withdrawalStr).trim() : "";
  if (!wr || wr === "N/A") return new Date(Math.max(s.getTime(), ms.getTime()));
  const wd = parseDate(withdrawalStr);
  if (wd) { const w = new Date(wd); w.setHours(0,0,0,0); if (w >= ms) return new Date(Math.max(s.getTime(), ms.getTime())); }
  return null;
}
function finalEndDate(fsd: Date | null, withdrawalStr: any, mStart: Date, mEnd: Date): Date | null {
  if (!fsd) return null;
  const me = new Date(mEnd); me.setHours(0,0,0,0);
  const ms = new Date(mStart); ms.setHours(0,0,0,0);
  const wr = withdrawalStr ? String(withdrawalStr).trim() : "";
  if (!wr || wr === "N/A") return me;
  const wd = parseDate(withdrawalStr);
  if (wd) { const w = new Date(wd); w.setHours(0,0,0,0); if (w >= ms) return new Date(Math.min(me.getTime(), w.getTime())); }
  return me;
}
function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0,10) : ""; }
function toNum(v: any) { if (!v && v !== 0) return 0; const n = parseFloat(String(v).replace(/[^0-9.-]/g,"")); return isNaN(n)?0:n; }
function fmt2(n: number) { return Math.round(n*100)/100; }

function calcFinalBilling(billingCycle: string, finalDays: number, finalWeeks: number, totalDays: number, totalMondays: number, gross: number) {
  const full = (billingCycle==="Monthly"&&finalDays===totalDays)||(billingCycle==="Weekly"&&finalWeeks===totalMondays);
  return full ? fmt2(gross) : totalDays===0 ? 0 : fmt2(gross*finalDays/totalDays);
}
function calcAgencyBilling(contractAmt: any, contractPeriod: any, totalDays: number, finalDays: number, finalWeeks: number) {
  const a = String(contractAmt??"").trim(), p = String(contractPeriod??"").trim();
  if (!a||a==="N/A"||!p||p==="N/A") return 0;
  const n = toNum(a);
  if (p==="Day")   return fmt2(n*21.65/totalDays*finalDays);
  if (p==="Week")  return fmt2(n*finalWeeks/4.33);
  if (p==="Month") return fmt2(n);
  return 0;
}
function calcCopayBilling(copayAmt: any, copayPeriod: any, finalBilling: number, agencyBilling: number, totalDays: number, finalDays: number, finalWeeks: number) {
  const a = String(copayAmt??"").trim(), p = String(copayPeriod??"").trim();
  if (!a||a==="N/A") return fmt2(finalBilling-agencyBilling);
  const n = toNum(a);
  if (p==="Day")   return fmt2(n*21.65/totalDays*finalDays);
  if (p==="Week")  return fmt2(n*finalWeeks/4.33);
  if (p==="Month") return fmt2(n);
  return 0;
}

// POST /api/child-billing/calculate-monthly
export async function POST(req: NextRequest) {
  const body = await req.json().catch(()=>({}));
  const { monthStartDate, monthEndDate } = body as { monthStartDate: string; monthEndDate: string };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!monthStartDate || !monthEndDate) {
          controller.enqueue(sse({ phase:"error", message:"monthStartDate and monthEndDate are required" })); controller.close(); return;
        }

        const monthStart = new Date(monthStartDate); monthStart.setHours(0,0,0,0);
        const monthEnd   = new Date(monthEndDate);   monthEnd.setHours(0,0,0,0);
        const totalDays    = workingDays(monthStart, monthEnd);
        const totalMondays = mondaysCount(monthStart, monthEnd);

        controller.enqueue(sse({ phase:"init", message:`Month: ${monthStartDate} → ${monthEndDate} | Working days: ${totalDays} | Mondays: ${totalMondays}` }));

        // Load Rate Sheet AM/PM maps
        const latestRS = await db.rateSheetBatch.findFirst({ orderBy: { uploadedAt:"desc" } });
        const earlyAMMap = new Map<string,string>(), latePMMap = new Map<string,string>();
        if (latestRS) {
          const rsRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "earlyAMRateCardKey","latePMRateCardKey","itemValue" FROM "RateSheetRow" WHERE "batchId"=$1`, latestRS.id
          );
          for (const r of rsRows) {
            if (r.earlyAMRateCardKey && r.itemValue) earlyAMMap.set(r.earlyAMRateCardKey, r.itemValue);
            if (r.latePMRateCardKey  && r.itemValue) latePMMap.set(r.latePMRateCardKey,   r.itemValue);
          }
        }

        const batch = await db.childBillingBatch.findFirst({ orderBy: { createdAt:"desc" } });
        if (!batch) { controller.enqueue(sse({ phase:"error", message:"No child billing data. Run Aggregate first." })); controller.close(); return; }

        const allRows: { id: number; rawData: Record<string,any> }[] = await prisma.$queryRawUnsafe(
          `SELECT id, "rawData" FROM "ChildBillingRow" WHERE "batchId"=$1 ORDER BY id`, batch.id
        );
        const total = allRows.length;
        controller.enqueue(sse({ phase:"init", message:`Loaded ${total.toLocaleString()} child rows — calculating…` }));

        const UPDATE_BATCH = 1000;
        let updated = 0;

        for (let start = 0; start < total; start += UPDATE_BATCH) {
          const chunk = allRows.slice(start, start + UPDATE_BATCH);
          const valueParts: string[] = [];
          const params: any[] = [];
          let pi = 1;

          for (const row of chunk) {
            const rd = row.rawData;
            const startStr      = rd["Start Date (FC28)"] ?? "";
            const withdrawalStr = rd["Withdrawal Date (FC28)"] ?? "";
            const earlyAM       = String(rd["Early AM Care (FC28)"] ?? "").trim();
            const latePM        = String(rd["Late PM Care (FC28)"]  ?? "").trim();
            const earlyAMKey    = String(rd["Early AM Rate Card Key (FC28)"] ?? "").trim();
            const latePMKey     = String(rd["Late PM Rate Card Key (FC28)"]  ?? "").trim();

            const fsd = finalStartDate(startStr, withdrawalStr, monthStart, monthEnd);
            const fed = finalEndDate(fsd, withdrawalStr, monthStart, monthEnd);

            const earlyAMFees = (earlyAM==="Yes"||earlyAM==="yes") && earlyAMKey ? (earlyAMMap.get(earlyAMKey)??"") : "";
            const latePMFees  = (latePM==="Yes"||latePM==="yes")   && latePMKey  ? (latePMMap.get(latePMKey)??"")  : "";

            // Final Days / Weeks
            const origStart = parseDate(startStr);
            const osd = origStart ? (() => { const t=new Date(origStart); t.setHours(0,0,0,0); return t; })() : null;
            const fedD = fed ? (() => { const t=new Date(fed); t.setHours(0,0,0,0); return t; })() : null;
            const fsdD = fsd ? (() => { const t=new Date(fsd); t.setHours(0,0,0,0); return t; })() : null;

            const startEqualsEnd = osd && fedD && osd.getTime()===fedD.getTime();
            const finalDaysToBill  = startEqualsEnd ? 0 : (fsd&&fed ? workingDays(fsd,fed) : 0);
            const fsdEqualsFed     = fsdD && fedD && fsdD.getTime()===fedD.getTime();
            const finalWeeksToBill = fsdEqualsFed ? 0 : (fsd&&fed ? mondaysCount(fsd,fed) : 0);

            const monthlyFees  = rd["Item Value (Rate Sheet)"] ?? "";
            const grossBilling = toNum(monthlyFees)+toNum(earlyAMFees)+toNum(latePMFees);
            const agency       = String(rd["Agency 1 (FC28)"] ?? "").trim();
            const agencyType   = agency==="" ? "Private" : "Agency";
            const billingCycle = String(rd["Billing Cycle (FC28)"] ?? "").trim();
            const finalBilling = calcFinalBilling(billingCycle, finalDaysToBill, finalWeeksToBill, totalDays, totalMondays, grossBilling);
            const agencyBilling= calcAgencyBilling(rd["Contract Amt 1 (FC28)"], rd["Contract Period 1 (FC28)"], totalDays, finalDaysToBill, finalWeeksToBill);
            const copayBilling = calcCopayBilling(rd["Copay Amt 1 (FC28)"], rd["Copay Period 1 (FC28)"], finalBilling, agencyBilling, totalDays, finalDaysToBill, finalWeeksToBill);

            const patch: Record<string,any> = {
              "Month Start Date": monthStartDate, "Month End Date": monthEndDate,
              "Total Days in Month": totalDays, "Total Mondays in Month": totalMondays,
              "Final Start Date": fmtDate(fsd), "Final End Date": fmtDate(fed),
              "Early AM Care Fees": earlyAMFees, "Late PM Care Fees": latePMFees,
              "Final Days to be Billed": finalDaysToBill, "Final Weeks to be Billed": finalWeeksToBill,
              "Gross Billing Amount": grossBilling||"", "Agency Type": agencyType,
              "Final Billing Amount": finalBilling||"", "Final Agency Billing": agencyBilling||"",
              "Estimated Copay Billing": copayBilling||"",
            };

            valueParts.push(`($${pi}::int,$${pi+1}::jsonb)`);
            params.push(row.id, JSON.stringify(patch));
            pi+=2; updated++;
          }

          if (valueParts.length>0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "ChildBillingRow" AS t SET "rawData"=t."rawData"||v.patch FROM (VALUES ${valueParts.join(",")}) AS v(id,patch) WHERE t.id=v.id`,
              ...params
            );
          }

          const done = Math.min(start+UPDATE_BATCH, total);
          controller.enqueue(sse({ phase:"processing", done, total, pct:Math.round((done/total)*100) }));
        }

        controller.enqueue(sse({ phase:"complete", done:total, total, pct:100, message:`Done — ${updated} child rows updated` }));
      } catch (err: any) {
        controller.enqueue(sse({ phase:"error", message:err.message??"Calculation failed" }));
      } finally { controller.close(); }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no" },
  });
}
