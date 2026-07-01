import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

function computeEntryBy(itemText: string | null, subHead: string | null): string {
  if (subHead === "Adjustments" && itemText) {
    const t = itemText.toUpperCase();
    if (t.includes("ASA ") || t.includes("ASA_") || t.includes("ASA-")) return "ASA";
  }
  return "CENTER";
}

// Known column groups in display order
const FC28_COLS = [
  "Child Status (FC28)", "Family Status (FC28)", "Classroom (FC28)", "Rate Sheet (FC28)",
  "Date of Birth (FC28)", "Enroll Date (FC28)", "Start Date (FC28)", "Withdrawal Date (FC28)",
  "Withdrawal Reason (FC28)", "Primary Guardian (FC28)",
  "Mon (FC28)", "Tue (FC28)", "Wed (FC28)", "Thu (FC28)", "Fri (FC28)",
  "Drop Off (FC28)", "Pickup (FC28)", "Early AM Care (FC28)", "Late PM Care (FC28)", "Program (FC28)",
  "Address 1 (FC28)", "Address 2 (FC28)", "City (FC28)", "State (FC28)", "Zip Code (FC28)",
  "Discount Type (FC28)", "Discount Name (FC28)", "Main Discount (FC28)",
  "AM/PM Discount (FC28)", "Total Discount (FC28)", "Billing Cycle (FC28)",
  "Agency 1 (FC28)", "Family Contrib 1 (FC28)", "Contract Amt 1 (FC28)", "Contract Period 1 (FC28)",
  "Copay Amt 1 (FC28)", "Copay Period 1 (FC28)",
  "Agency 2 (FC28)", "Family Contrib 2 (FC28)", "Contract Amt 2 (FC28)", "Contract Period 2 (FC28)",
  "Copay Amt 2 (FC28)", "Copay Period 2 (FC28)",
  "Rate Card Key (FC28)", "Revised Classroom (FC28)",
  "Early AM Rate Card Key (FC28)", "Late PM Rate Card Key (FC28)",
];

const RATE_SHEET_COLS = [
  "Item Name (Rate Sheet)", "Item Value (Rate Sheet)",
];

const CALC_COLS = [
  "Month Start Date", "Month End Date",
  "Total Days in Month", "Total Mondays in Month",
  "Final Start Date", "Final End Date",
  "Final Days to be Billed", "Final Weeks to be Billed",
  "Early AM Care Fees", "Late PM Care Fees",
  "Gross Billing Amount", "Agency Type",
];

// GET /api/fin14/export
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const isMatched  = sp.get("isMatched");
    const majorHead  = sp.get("majorHead");
    const subHead    = sp.get("subHead");
    const itemSearch = sp.get("itemSearch");

    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;
    if (isMatched === "true")  conditions.push(`"isMatched" = true`);
    if (isMatched === "false") conditions.push(`"isMatched" = false`);
    if (majorHead)  { conditions.push(`"majorHead" = $${pi++}`);    params.push(majorHead); }
    if (subHead)    { conditions.push(`"subHead"   = $${pi++}`);    params.push(subHead); }
    if (itemSearch) { conditions.push(`"itemText" ILIKE $${pi++}`); params.push(`%${itemSearch}%`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // 1. Collect all distinct rawData keys
    const keyRows: { key: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT jsonb_object_keys("rawData") AS key FROM "Fin14Row" ${where}`,
      ...params
    );
    const allKeys = new Set(keyRows.map((r) => r.key));

    // 2. Partition into ordered groups
    const knownOrdered = new Set([...FC28_COLS, ...RATE_SHEET_COLS, ...CALC_COLS]);
    // Original FIN14 cols = anything not in the known ordered groups
    const fin14Cols = keyRows.map((r) => r.key).filter((k) => !knownOrdered.has(k));
    // For each known group, only include columns that actually exist in the data
    const fc28Present       = FC28_COLS.filter((c) => allKeys.has(c));
    const rateSheetPresent  = RATE_SHEET_COLS.filter((c) => allKeys.has(c));
    const calcPresent       = CALC_COLS.filter((c) => allKeys.has(c));

    const orderedCols = [...fin14Cols, ...fc28Present, ...rateSheetPresent, ...calcPresent];

    // 3. Fetch rows
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "rawData","majorHead","subHead","isMatched","entryBy","itemText"
         FROM "Fin14Row" ${where} ORDER BY id`,
      ...params
    );

    if (!rows.length) return NextResponse.json({ error: "No rows to export" }, { status: 404 });

    // 4. Build sheet
    const headers = [...orderedCols, "Major Head", "Sub Head", "Entry By", "Matched By", "Status"];
    const data: any[][] = [headers];
    for (const row of rows) {
      const rd = (row.rawData ?? {}) as Record<string, any>;
      data.push([
        ...orderedCols.map((c) => { const v = rd[c]; return v == null ? "" : String(v); }),
        row.majorHead ?? "",
        row.subHead   ?? "",
        row.isMatched ? computeEntryBy(row.itemText, row.subHead) : "",
        row.entryBy   ?? "",
        row.isMatched ? "Matched" : "Unmatched",
      ]);
    }

    // 5. Generate Excel
    const xlsxMod = await import("xlsx");
    const XLSX = (xlsxMod as any).default ?? xlsxMod;
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FIN14 Transactions");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="FIN14_Transactions_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "X-Row-Count":         String(rows.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Export failed" }, { status: 500 });
  }
}
