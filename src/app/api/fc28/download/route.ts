import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 60;

const db = prisma as any;

// All available columns with display labels
export const FC28_COLUMNS = [
  { key: "center",          label: "Center" },
  { key: "centerId",        label: "Center ID" },
  { key: "childId",         label: "Child ID" },
  { key: "childName",       label: "Child Name" },
  { key: "familyName",      label: "Family Name" },
  { key: "familyId",        label: "Family ID" },
  { key: "childStatus",     label: "Child Status" },
  { key: "familyStatus",    label: "Family Status" },
  { key: "classroom",       label: "Classroom" },
  { key: "rateSheet",       label: "Rate Sheet" },
  { key: "dateOfBirth",     label: "Date of Birth" },
  { key: "enrollDate",      label: "Enroll Date" },
  { key: "startDate",       label: "Start Date" },
  { key: "withdrawalDate",  label: "Withdrawal Date" },
  { key: "withdrawalReason",label: "Withdrawal Reason" },
  { key: "primaryGuardian", label: "Primary Guardian" },
  { key: "monDay",          label: "Mon" },
  { key: "tueDay",          label: "Tue" },
  { key: "wedDay",          label: "Wed" },
  { key: "thuDay",          label: "Thu" },
  { key: "friDay",          label: "Fri" },
  { key: "address1",        label: "Address 1" },
  { key: "address2",        label: "Address 2" },
  { key: "city",            label: "City" },
  { key: "state",           label: "State" },
  { key: "zipCode",         label: "Zip Code" },
  { key: "program",         label: "Program" },
  { key: "dropOff",         label: "Drop Off" },
  { key: "pickup",          label: "Pickup" },
  { key: "earlyAMCare",     label: "Early AM Care" },
  { key: "latePMCare",      label: "Late PM Care" },
  { key: "discountType",    label: "Discount Type" },
  { key: "discountName",    label: "Discount Name" },
  { key: "mainDiscount",    label: "Main Discount" },
  { key: "amPmDiscount",    label: "AM/PM Discount" },
  { key: "totalDiscount",   label: "Total Discount" },
  { key: "billingCycle",    label: "Billing Cycle" },
  { key: "agency1",         label: "Agency 1" },
  { key: "familyContrib1",  label: "Family Contribution 1" },
  { key: "contractAmt1",    label: "Contract Amount 1" },
  { key: "contractPeriod1", label: "Contract Period 1" },
  { key: "copayAmt1",       label: "Copay Amount 1" },
  { key: "copayPeriod1",    label: "Copay Period 1" },
  { key: "agency2",         label: "Agency 2" },
  { key: "familyContrib2",  label: "Family Contribution 2" },
  { key: "contractAmt2",    label: "Contract Amount 2" },
  { key: "contractPeriod2", label: "Contract Period 2" },
  { key: "copayAmt2",       label: "Copay Amount 2" },
  { key: "copayPeriod2",    label: "Copay Period 2" },
  { key: "rateCardKey",     label: "Rate Card Key" },
  { key: "sourceFile",      label: "Source File" },
];

// GET /api/fc28/download?batchId=...&cols=center,childId,...
export async function GET(req: NextRequest) {
  try {
    const sp      = new URL(req.url).searchParams;
    const batchId = sp.get("batchId");
    const colsParam = sp.get("cols");

    if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

    // Determine columns to export
    const selectedKeys = colsParam
      ? colsParam.split(",").map(c => c.trim()).filter(Boolean)
      : FC28_COLUMNS.map(c => c.key);

    const validCols = FC28_COLUMNS.filter(c => selectedKeys.includes(c.key));
    if (!validCols.length) return NextResponse.json({ error: "No valid columns" }, { status: 400 });

    // Fetch rows
    const rows = await db.fC28Row.findMany({
      where:   { batchId },
      orderBy: [{ center: "asc" }, { childName: "asc" }],
    });

    if (!rows.length) return NextResponse.json({ error: "No rows found for this batch" }, { status: 404 });

    const batch   = await db.fC28Batch.findUnique({ where: { id: batchId } });
    const dateStr = batch?.reportDate
      ? new Date(batch.reportDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Build worksheet data: header + rows
    const header = validCols.map(c => c.label);
    const data: any[][] = [header];
    for (const r of rows) {
      data.push(validCols.map(c => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        return v;
      }));
    }

    const ws  = XLSX.utils.aoa_to_sheet(data);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FC28 Data");

    // Column widths
    ws["!cols"] = validCols.map(c => ({
      wch: c.key === "childName" || c.key === "familyName" ? 24
         : c.key === "center" || c.key.includes("reason") || c.key.includes("Guardian") ? 28
         : c.key.includes("Day") ? 6
         : 14,
    }));

    // Freeze header row
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    const buf      = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `FC28_${dateStr}.xlsx`;

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
