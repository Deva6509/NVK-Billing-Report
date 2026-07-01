import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const db = prisma as any;

function boolVal(v: any): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  return s === "x" || s === "yes" || s === "true" || s === "1";
}

function strVal(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "N/A" ? null : s;
}

// POST /api/fc28/upload
// Body: { reportDate, batchId?, isFinal?, files: [{ name, rows[] }] }
// - First call (no batchId): creates FC28Batch, inserts rows, returns { batchId }
// - Subsequent calls: appends rows to existing batch
// - Final call (isFinal=true): updates rowCount and fileCount
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      reportDate:  string;
      batchId?:    string;
      isFinal?:    boolean;
      files: { name: string; rows: Record<string, any>[] }[];
    };

    const { reportDate, files, isFinal = false } = body;
    let { batchId } = body;

    if (!reportDate) return NextResponse.json({ error: "reportDate required" }, { status: 400 });
    if (!isFinal && !files?.length) return NextResponse.json({ error: "No files provided" }, { status: 400 });

    // Build rows for all files in this chunk
    const dbRows: any[] = [];
    let chunkFileCount = 0;

    for (const file of files) {
      if (!file.rows?.length) continue;
      chunkFileCount++;
      const rawHeaders = Object.keys(file.rows[0] ?? {});

      // Find duplicate column indices (Agency, Family Contribution, etc.)
      const headerArr = rawHeaders;
      const agencyIndices: number[] = [];
      const fcIndices: number[]     = [];
      const caIndices: number[]     = [];
      const cpIndices: number[]     = [];
      const coaIndices: number[]    = [];
      const copIndices: number[]    = [];

      // SheetJS deduplicates duplicate headers as "Agency", "Agency_1", etc.
      // We handle both the raw header array and __EMPTY style

      for (const row of file.rows) {
        const keys = Object.keys(row);
        // Agency slots — keys named "Agency" and "Agency_1" (SheetJS dedup pattern)
        const a1Key = keys.find(k => k === "Agency");
        const a2Key = keys.find(k => k === "Agency_1" || k === "__Agency_1");
        const fc1   = keys.find(k => k === "Family Contribution");
        const fc2   = keys.find(k => k === "Family Contribution_1");
        const ca1   = keys.find(k => k === "Estimated Contract Amount");
        const ca2   = keys.find(k => k === "Estimated Contract Amount_1");
        const cp1   = keys.find(k => k === "Contract Period");
        const cp2   = keys.find(k => k === "Contract Period_1");
        const coa1  = keys.find(k => k === "Estimated Copay Amount");
        const coa2  = keys.find(k => k === "Estimated Copay Amount_1");
        const cop1  = keys.find(k => k === "Copay Period");
        const cop2  = keys.find(k => k === "Copay Period_1");

        const center    = strVal(row["Center"]);
        const rateSheet = strVal(row["Rate Sheet"]);
        const dropOff   = strVal(row["Drop Off"]);
        const pickup    = strVal(row["Pickup"]);
        const program   = strVal(row["Program"]);
        const classroom = strVal(row["Classroom"]);
        const rateCardKey = [center ?? "", rateSheet ?? "", dropOff ?? "", pickup ?? "", program ?? "", classroom ?? ""].join("|");

        dbRows.push({
          batchId:         batchId ?? "__pending__",
          sourceFile:      file.name,
          center,
          centerId:        strVal(row["Center ID"]),
          familyName:      strVal(row["Family Name"]),
          familyId:        strVal(row["Family ID"]),
          childStatus:     strVal(row["Child Status"]),
          familyStatus:    strVal(row["Family Status"]),
          classroom,
          childName:       strVal(row["Child Name"]),
          childId:         strVal(row["Child ID"]),
          rateSheet,
          dateOfBirth:     strVal(row["Date of Birth"]),
          enrollDate:      strVal(row["Enroll Date"]),
          startDate:       strVal(row["Start Date"]),
          withdrawalDate:  strVal(row["Withdrawal Date"]),
          withdrawalReason:strVal(row["Withdrawal Reason"]),
          primaryGuardian: strVal(row["Primary Guardian Name"]),
          monDay:          boolVal(row["M"]),
          tueDay:          boolVal(row["T"]),
          wedDay:          boolVal(row["W"]),
          thuDay:          boolVal(row["T_1"] ?? row["T"]),
          friDay:          boolVal(row["F"]),
          address1:        strVal(row["Address 1"]),
          address2:        strVal(row["Address 2"]),
          city:            strVal(row["City"]),
          state:           strVal(row["State"]),
          zipCode:         strVal(row["Zip Code"]),
          program,
          dropOff,
          pickup,
          earlyAMCare:     strVal(row["Early AM Care"]),
          latePMCare:      strVal(row["Late PM Care"]),
          discountType:    strVal(row["Discount Type"]),
          discountName:    strVal(row["Discount Name"]),
          mainDiscount:    strVal(row["Main Discount"]),
          amPmDiscount:    strVal(row["AM/PM Discount"]),
          totalDiscount:   strVal(row["Total Discount"]),
          billingCycle:    strVal(row["Billing Cycle"]),
          agency1:         a1Key  ? strVal(row[a1Key])  : null,
          familyContrib1:  fc1    ? strVal(row[fc1])    : null,
          contractAmt1:    ca1    ? strVal(row[ca1])    : null,
          contractPeriod1: cp1    ? strVal(row[cp1])    : null,
          copayAmt1:       coa1   ? strVal(row[coa1])   : null,
          copayPeriod1:    cop1   ? strVal(row[cop1])   : null,
          agency2:         a2Key  ? strVal(row[a2Key])  : null,
          familyContrib2:  fc2    ? strVal(row[fc2])    : null,
          contractAmt2:    ca2    ? strVal(row[ca2])    : null,
          contractPeriod2: cp2    ? strVal(row[cp2])    : null,
          copayAmt2:       coa2   ? strVal(row[coa2])   : null,
          copayPeriod2:    cop2   ? strVal(row[cop2])   : null,
          rateCardKey,
        });
      }
    }

    if (!batchId) {
      // Create batch first
      const batch = await db.fC28Batch.create({
        data: { reportDate: new Date(reportDate), fileCount: 0, rowCount: 0 },
      });
      batchId = batch.id;
      // Fix pending rows
      for (const r of dbRows) r.batchId = batchId;
    }

    // Insert rows
    if (dbRows.length) {
      await db.fC28Row.createMany({ data: dbRows });
    }

    // On final chunk, update batch stats
    if (isFinal) {
      const rowCount  = await db.fC28Row.count({ where: { batchId } });
      const filenames: { sourceFile: string }[] = await db.fC28Row.findMany({
        where:   { batchId },
        select:  { sourceFile: true },
        distinct: ["sourceFile"],
      });
      await db.fC28Batch.update({
        where: { id: batchId },
        data:  { rowCount, fileCount: filenames.length },
      });
      return NextResponse.json({ batchId, rowCount, fileCount: filenames.length });
    }

    return NextResponse.json({ batchId, rowsInserted: dbRows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}
