import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 60;

const db = prisma as any;

// GET /api/rate-sheet/download?center=...  (center is optional filter)
export async function GET(req: NextRequest) {
  try {
    const sp     = new URL(req.url).searchParams;
    const center = sp.get("center") || undefined;

    const batch = await db.rateSheetBatch.findFirst({ orderBy: { uploadedAt: "desc" } });
    if (!batch) return NextResponse.json({ error: "No rate sheet data uploaded yet" }, { status: 404 });

    const rows = await db.rateSheetRow.findMany({
      where:   { batchId: batch.id, ...(center ? { center } : {}) },
      orderBy: [{ center: "asc" }, { program: "asc" }, { itemName: "asc" }],
    });

    if (!rows.length) return NextResponse.json({ error: "No rows found" }, { status: 404 });

    const headers = ["Rate Card Key", "Center", "Entity", "Version Name", "Created", "Modified",
                     "Active", "Drop Off", "Pick Up", "Program", "Item Name", "Item Value", "Source File"];

    const data: any[][] = [headers];
    for (const r of rows) {
      data.push([
        r.rateCardKey ?? "", r.center ?? "", r.entity ?? "", r.versionName ?? "",
        r.created ?? "", r.modified ?? "", r.active ?? "", r.dropOff ?? "",
        r.pickUp ?? "", r.program ?? "", r.itemName ?? "", r.itemValue ?? "", r.sourceFile ?? "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [40, 22, 16, 20, 14, 14, 8, 14, 14, 22, 28, 18, 28].map(w => ({ wch: w }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rate Sheet");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const dateStr  = new Date(batch.uploadedAt).toISOString().slice(0, 10);
    const filename = `RateSheet_${dateStr}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Download failed" }, { status: 500 });
  }
}
