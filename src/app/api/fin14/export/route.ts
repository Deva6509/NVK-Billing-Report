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

// GET /api/fin14/export
// Uses raw SQL to avoid Prisma ORM overhead on 38k+ JSONB rows.
// Step 1: one SQL pass to collect distinct rawData keys (PostgreSQL jsonb_object_keys).
// Step 2: fetch only the 6 needed columns instead of the full model.
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const isMatched  = sp.get("isMatched");
    const majorHead  = sp.get("majorHead");
    const subHead    = sp.get("subHead");
    const itemSearch = sp.get("itemSearch");

    // Build parameterised WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;
    if (isMatched === "true")  conditions.push(`"isMatched" = true`);
    if (isMatched === "false") conditions.push(`"isMatched" = false`);
    if (majorHead)  { conditions.push(`"majorHead" = $${pi++}`);            params.push(majorHead); }
    if (subHead)    { conditions.push(`"subHead"   = $${pi++}`);            params.push(subHead); }
    if (itemSearch) { conditions.push(`"itemText" ILIKE $${pi++}`);         params.push(`%${itemSearch}%`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // 1. Collect distinct rawData keys in one DB-side pass
    const keyRows: { key: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT jsonb_object_keys("rawData") AS key FROM "Fin14Row" ${where}`,
      ...params
    );
    const rawCols = keyRows.map((r) => r.key);

    // 2. Fetch only the columns we need
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "rawData","majorHead","subHead","isMatched","entryBy","itemText"
         FROM "Fin14Row" ${where} ORDER BY id`,
      ...params
    );

    if (!rows.length) return NextResponse.json({ error: "No rows to export" }, { status: 404 });

    // 3. Build sheet data
    const headers = [...rawCols, "Major Head", "Sub Head", "Entry By", "Matched By", "Status"];
    const data: any[][] = [headers];
    for (const row of rows) {
      const rd = (row.rawData ?? {}) as Record<string, any>;
      data.push([
        ...rawCols.map((c) => { const v = rd[c]; return v == null ? "" : String(v); }),
        row.majorHead ?? "",
        row.subHead   ?? "",
        row.isMatched ? computeEntryBy(row.itemText, row.subHead) : "",
        row.entryBy   ?? "",
        row.isMatched ? "Matched" : "Unmatched",
      ]);
    }

    // 4. Generate Excel (dynamic import avoids cold-start cost)
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
