import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const db = prisma as any;

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDateFromFilename(filename: string): Date | null {
  const m = filename.match(/(\d+)-([a-z]+)-(\d{4})/i);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  return new Date(+m[3], month, +m[1]);
}

function toDateStr(val: any): string {
  if (!val && val !== 0) return "";
  // ISO string from client-side serialisation
  if (typeof val === "string" && val.includes("T")) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
    }
  }
  if (typeof val === "number") {
    const d = new Date((val - 25569) * 86400000);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }
  return String(val);
}

function safeDecimal(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// POST /api/fc28/sync — accepts { filename, rows[] } JSON (rows parsed client-side)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { filename: string; rows: Record<string, any>[] };
    const { filename, rows } = body;

    if (!filename || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Missing filename or rows" }, { status: 400 });
    }

    const reportDate = parseDateFromFilename(filename);
    if (!reportDate) {
      return NextResponse.json({ filesProcessed: 0, filesSkipped: 1, rowsInserted: 0, rowsSkipped: 0, totalInDb: await db.fC28Record.count() });
    }

    const dateKey = reportDate.toISOString().slice(0, 10);
    const existing = await db.fC28Record.findFirst({ where: { reportDate } });
    if (existing) {
      return NextResponse.json({ filesProcessed: 0, filesSkipped: 1, rowsInserted: 0, rowsSkipped: 0, totalInDb: await db.fC28Record.count() });
    }

    const records = rows
      .map((row) => ({
        reportDate,
        childId:                 String(row["Child ID"] ?? "").trim(),
        childName:               String(row["Child Name"] ?? "").trim() || null,
        centerId:                row["Center ID"] != null ? Number(row["Center ID"]) : null,
        center:                  String(row["Center"] ?? "").trim() || null,
        familyId:                row["Family ID"] != null ? Number(row["Family ID"]) : null,
        family:                  String(row["Family"] ?? "").trim() || null,
        childStatus:             String(row["Child Status"] ?? "").trim() || null,
        familyStatus:            String(row["Family Status"] ?? "").trim() || null,
        classroom:               String(row["Classroom"] ?? "").trim() || null,
        rateSheet:               String(row["Rate Sheet"] ?? "").trim() || null,
        dateOfBirth:             toDateStr(row["Date of Birth"]) || null,
        enrollDate:              toDateStr(row["Enroll Date"]) || null,
        startDate:               toDateStr(row["Start Date"]) || null,
        program:                 String(row["Program"] ?? "").trim() || null,
        billingCycle:            String(row["Billing Cycle"] ?? "").trim() || null,
        agency:                  String(row["Agency"] ?? "").trim() || null,
        estimatedContractAmount: safeDecimal(row["Estimated Contract Amount"]),
        rawData:                 row,
      }))
      .filter((r) => r.childId);

    if (records.length === 0) {
      return NextResponse.json({ filesProcessed: 0, filesSkipped: 1, rowsInserted: 0, rowsSkipped: 0, totalInDb: await db.fC28Record.count() });
    }

    const result    = await db.fC28Record.createMany({ data: records, skipDuplicates: true });
    const totalInDb = await db.fC28Record.count();

    return NextResponse.json({
      filesProcessed: 1,
      filesSkipped:   0,
      rowsInserted:   result.count,
      rowsSkipped:    records.length - result.count,
      totalInDb,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Sync failed" }, { status: 500 });
  }
}

// GET /api/fc28/sync — returns current DB stats
export async function GET() {
  try {
    const totalInDb   = await db.fC28Record.count();
    const reportDates = await db.fC28Record.findMany({
      select:   { reportDate: true },
      distinct: ["reportDate"],
      orderBy:  { reportDate: "desc" },
    });
    return NextResponse.json({
      totalInDb,
      syncedDates: reportDates.map((r: any) => r.reportDate.toISOString().slice(0, 10)),
    });
  } catch (err: any) {
    return NextResponse.json({ totalInDb: 0, syncedDates: [], error: err.message });
  }
}
