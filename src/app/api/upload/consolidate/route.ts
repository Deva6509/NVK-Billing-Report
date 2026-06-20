import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

function computeEntryBy(itemText: string | null, subHead: string | null): string {
  if (subHead === "Adjustments" && itemText) {
    const t = itemText.toUpperCase();
    if (t.includes("ASA ") || t.includes("ASA_") || t.includes("ASA-")) return "ASA";
  }
  return "CENTER";
}

function matchItem(txnItem: string, masters: { id: number; item: string; majorHead: string; subHead: string }[]) {
  if (!txnItem) return null;
  const lower = txnItem.toLowerCase();
  const sorted = [...masters].sort((a, b) => b.item.length - a.item.length);
  return sorted.find((m) => lower.includes(m.item.toLowerCase())) ?? null;
}

// POST /api/upload/consolidate
// Body: { rows, fileCount, batchId?, isFinal }
// - First chunk (no batchId): creates batch, inserts rows, returns { batchId }
// - Middle chunks (batchId, isFinal=false): appends rows, returns { batchId }
// - Last chunk (batchId, isFinal=true): appends rows, generates Excel, returns file
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incomingRows: Record<string, any>[] = body.rows ?? [];
    const fileCount: number  = body.fileCount ?? 0;
    const existingBatchId: string | undefined = body.batchId;
    const isFinal: boolean   = body.isFinal ?? true;

    if (!incomingRows.length) {
      return NextResponse.json({ success: false, message: "No data rows provided" }, { status: 400 });
    }

    // Load item master once
    let masters: { id: number; item: string; majorHead: string; subHead: string }[] = [];
    try {
      masters = await (prisma as any).itemMaster.findMany({ where: { isActive: true } });
    } catch { /* table may not exist */ }

    const headerKeys = Object.keys(incomingRows[0] ?? {});
    const itemCol = headerKeys.find((k) => k.trim().toLowerCase() === "item") ?? null;

    // Apply item matching to this chunk's rows
    const dbRows = incomingRows.map((row) => {
      const txnItem = itemCol ? String(row[itemCol] ?? "").trim() : "";
      const match   = txnItem ? matchItem(txnItem, masters) : null;
      return {
        rawData:   row,
        itemText:  txnItem || null,
        majorHead: match?.majorHead ?? null,
        subHead:   match?.subHead   ?? null,
        entryBy:   match ? "System" : null,
        isMatched: !!match,
      };
    });

    let batchId: string;

    if (!existingBatchId) {
      // First chunk — create batch with rows
      const batch = await (prisma as any).fin14Batch.create({
        data: {
          fileCount,
          rowCount:       0,
          matchedCount:   0,
          unmatchedCount: 0,
          rows: { create: dbRows },
        },
      });
      batchId = batch.id;
    } else {
      // Subsequent chunk — append rows to existing batch
      batchId = existingBatchId;
      await (prisma as any).fin14Row.createMany({
        data: dbRows.map((r) => ({ ...r, batchId })),
      });
    }

    // Return early if more chunks are coming
    if (!isFinal) {
      return NextResponse.json({ batchId });
    }

    // Final chunk — fetch ALL rows for this batch, update stats, build Excel
    const allRows = await (prisma as any).fin14Row.findMany({
      where:   { batchId },
      orderBy: { id: "asc" },
    });

    const matchedCount   = allRows.filter((r: any) => r.isMatched).length;
    const unmatchedCount = allRows.length - matchedCount;

    await (prisma as any).fin14Batch.update({
      where: { id: batchId },
      data:  { rowCount: allRows.length, matchedCount, unmatchedCount },
    });

    // Build Excel output
    const allHeaderKeys: string[] = allRows[0]?.rawData ? Object.keys(allRows[0].rawData) : [];
    const outputRows = allRows.map((row: any) => {
      const txnItem = itemCol ? String(row.rawData?.[itemCol] ?? "").trim() : "";
      const out: Record<string, any> = {};
      for (const k of allHeaderKeys) out[k] = row.rawData[k] ?? null;
      out["Major Head"] = row.majorHead ?? "";
      out["Sub Head"]   = row.subHead   ?? "";
      out["Entry By"]   = computeEntryBy(txnItem, row.subHead);
      out["Matched By"] = row.entryBy   ?? "";
      return out;
    });

    const ws = XLSX.utils.json_to_sheet(outputRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Consolidated");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="FIN14_Consolidated.xlsx"`,
        "X-Row-Count":         String(allRows.length),
        "X-File-Count":        String(fileCount),
        "X-Matched-Count":     String(matchedCount),
        "X-Unmatched-Count":   String(unmatchedCount),
        "X-Batch-Id":          batchId,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message ?? "Internal error" }, { status: 500 });
  }
}
