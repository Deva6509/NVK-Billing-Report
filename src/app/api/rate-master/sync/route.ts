import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const db = prisma as any;

function extractCenterName(fullHeader: string): string {
  // "Hudson Yards 417 West 35th Street..." → "Hudson Yards"
  const m = fullHeader.match(/^([^\d]+)/);
  return m ? m[1].trim().replace(/,\s*$/, "") : fullHeader.trim();
}

function parseMoney(val: any): number {
  if (!val && val !== 0) return 0;
  const s = String(val).replace(/[$, ]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// POST /api/rate-master/sync
// Body: { centerFull, rows: [{ cycle, item, childName, payer, amount, rateSheet }] }
// Clears existing records for this center, then inserts new ones (idempotent re-upload)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      centerFull: string;
      rows: { cycle: string; item: string; childName: string; payer?: string; amount: string; rateSheet?: string }[];
    };

    const { centerFull, rows } = body;
    if (!centerFull || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Missing centerFull or rows" }, { status: 400 });
    }

    const center = extractCenterName(centerFull);

    // Clear existing records for this center before re-inserting
    await db.rateMasterRow.deleteMany({ where: { center } });

    const records = rows
      .filter((r) => r.childName && r.item)
      .map((r) => ({
        center,
        centerFull,
        childName: r.childName.trim(),
        payer:     r.payer?.trim() || null,
        cycle:     r.cycle?.trim() || null,
        item:      r.item.trim(),
        amount:    parseMoney(r.amount),
        rateSheet: r.rateSheet?.trim() || null,
      }));

    const result = await db.rateMasterRow.createMany({ data: records });

    const totalInDb = await db.rateMasterRow.count();
    const centers: { center: string }[] = await db.rateMasterRow.findMany({
      select:   { center: true },
      distinct: ["center"],
    });

    return NextResponse.json({
      center,
      rowsInserted: result.count,
      totalInDb,
      centers: centers.map((c: any) => c.center),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Sync failed" }, { status: 500 });
  }
}

// GET /api/rate-master/sync — DB stats
export async function GET() {
  try {
    const totalInDb = await db.rateMasterRow.count();
    const centers: { center: string; centerFull: string }[] = await db.rateMasterRow.findMany({
      select:   { center: true, centerFull: true },
      distinct: ["center"],
      orderBy:  { center: "asc" },
    });
    const childCounts: { center: string; _count: { id: number } }[] = await db.rateMasterRow.groupBy({
      by:      ["center"],
      _count:  { id: true },
    });
    const countMap = new Map(childCounts.map((c: any) => [c.center, c._count.id]));

    return NextResponse.json({
      totalInDb,
      centers: centers.map((c: any) => ({
        center:     c.center,
        centerFull: c.centerFull,
        rowCount:   countMap.get(c.center) ?? 0,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ totalInDb: 0, centers: [], error: err.message });
  }
}
