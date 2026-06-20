import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export const maxDuration = 60;

const db = prisma as any;

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  navyFg:    "FFFFFFFF",
  navy:      "FF003887",
  navyLight: "FF1e4da1",
  teal:      "FF0d9488",
  tealLight: "FFf0fdfa",
  blue50:    "FFdbeafe",
  blue100:   "FFbfdbfe",
  slate50:   "FFf8fafc",
  slate100:  "FFf1f5f9",
  slate200:  "FFe2e8f0",
  slate700:  "FF334155",
  white:     "FFFFFFFF",
  green:     "FF16a34a",
  red:       "FFdc2626",
  altRow:    "FFf0f7ff",
  totals:    "FF0f2a5e",
};

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
function border(style: ExcelJS.BorderStyle = "thin"): Partial<ExcelJS.Borders> {
  const s = { style, color: { argb: "FFcbd5e1" } };
  return { top: s, left: s, bottom: s, right: s };
}
function medBorder(): Partial<ExcelJS.Borders> {
  const s = { style: "medium" as ExcelJS.BorderStyle, color: { argb: "FF94a3b8" } };
  return { top: s, left: s, bottom: s, right: s };
}
function money(n: number): string { return "#,##0.00"; }

function parseMoney(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  const s = String(val).replace(/[$, ]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const ROW_FIELDS = [
  { label: "Child ID",        wch: 11,  key: (r: any) => r.rawData?.["Child ID"]               ?? "" },
  { label: "Child Name",      wch: 26,  key: (r: any) => r.rawData?.["Child Name"]             ?? "" },
  { label: "Center",          wch: 24,  key: (r: any) => r.rawData?.["Center"]                 ?? "" },
  { label: "Billing Cycle",   wch: 14,  key: (r: any) => r.rawData?.["Billing Cycle (FC28)"]   ?? r.rawData?.["Billing Cycle"] ?? "" },
  { label: "Child Status",    wch: 13,  key: (r: any) => r.rawData?.["Child Status (FC28)"]    ?? "" },
  { label: "Start Date",      wch: 13,  key: (r: any) => r.rawData?.["Start Date (FC28)"]      ?? "" },
  { label: "Withdrawal Date", wch: 16,  key: (r: any) => r.rawData?.["Withdrawal Date (FC28)"] ?? "" },
  { label: "Classroom",       wch: 16,  key: (r: any) => r.rawData?.["Classroom (FC28)"]       ?? "" },
  { label: "Family Status",   wch: 14,  key: (r: any) => r.rawData?.["Family Status (FC28)"]   ?? "" },
];

const MAJOR_ORDER = ["Billing", "Adjustments", "Payment"];
const SUB_ORDER: Record<string, string[]> = {
  Billing:     ["Regular", "Agency", "Early/Late", "One Time", "Other"],
  Adjustments: ["Adjustments", "Discount"],
  Payment:     ["Agency"],
};

export async function GET(req: NextRequest) {
  try {
    const sp      = new URL(req.url).searchParams;
    const batchId = sp.get("batchId");
    const where: any = {};
    if (batchId) where.batchId = batchId;

    const rows = await db.fin14Row.findMany({ where, orderBy: { id: "asc" } });
    if (!rows.length) return NextResponse.json({ error: "No FIN14 rows found" }, { status: 404 });

    // ── Filter ────────────────────────────────────────────────────────────────
    const filtered = rows.filter((r: any) => {
      const fn  = String(r.rawData?.["Family Name"] ?? "").trim();
      if (!fn || fn === "—" || fn === "-") return false;
      const cid = String(r.rawData?.["Child ID"]   ?? "").trim();
      if (!cid || cid === "—" || cid === "-") return false;
      return true;
    });
    const excluded = rows.length - filtered.length;

    // ── Determine value columns ───────────────────────────────────────────────
    const colSet = new Set<string>();
    for (const r of filtered) if (r.majorHead && r.subHead) colSet.add(`${r.majorHead}|||${r.subHead}`);

    const allCols: { major: string; sub: string }[] = [];
    for (const major of MAJOR_ORDER)
      for (const sub of SUB_ORDER[major] ?? [])
        if (colSet.has(`${major}|||${sub}`)) allCols.push({ major, sub });
    for (const key of colSet) {
      const [major, sub] = key.split("|||");
      if (!allCols.find(c => c.major === major && c.sub === sub)) allCols.push({ major, sub });
    }

    // ── Build pivot ───────────────────────────────────────────────────────────
    type PivotRow = { meta: (string | number)[]; totals: Map<string, number> };
    const pivotMap = new Map<string, PivotRow>();

    for (const r of filtered) {
      const childId = String(r.rawData?.["Child ID"] ?? "").trim();
      const colKey  = `${r.majorHead}|||${r.subHead}`;
      const amount  = parseMoney(r.rawData?.["Amount"]);
      if (!pivotMap.has(childId)) {
        const cidNum = Number(childId);
        const meta = ROW_FIELDS.map((f, i) => i === 0 && !isNaN(cidNum) ? cidNum : f.key(r));
        pivotMap.set(childId, { meta, totals: new Map() });
      }
      const entry = pivotMap.get(childId)!;
      entry.totals.set(colKey, (entry.totals.get(colKey) ?? 0) + amount);
    }

    // ── Sort by Center → Child ID numeric ────────────────────────────────────
    const sorted = [...pivotMap.entries()].sort(([cidA, a], [cidB, b]) => {
      const ca = String(a.meta[2]).toLowerCase();
      const cb = String(b.meta[2]).toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (Number(cidA) || 0) - (Number(cidB) || 0);
    });

    // ── Column totals ─────────────────────────────────────────────────────────
    const colTotals = new Map<string, number>();
    let grandTotal = 0;
    for (const [, { totals }] of sorted) {
      for (const col of allCols) {
        const k = `${col.major}|||${col.sub}`;
        const v = totals.get(k) ?? 0;
        colTotals.set(k, (colTotals.get(k) ?? 0) + v);
        grandTotal += v;
      }
    }
    const majorTotals: Record<string, number> = {};
    for (const major of MAJOR_ORDER) majorTotals[major] = 0;
    for (const col of allCols) {
      const v = colTotals.get(`${col.major}|||${col.sub}`) ?? 0;
      majorTotals[col.major] = (majorTotals[col.major] ?? 0) + v;
    }

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "ASA Billing Intelligence";
    wb.created  = new Date();

    const ws = wb.addWorksheet("Final Report", {
      views: [{ state: "frozen", xSplit: 3, ySplit: 11 }],
    });

    const numMeta = ROW_FIELDS.length;
    const numVal  = allCols.length;
    const lastCol = numMeta + numVal + 1; // +1 for Grand Total

    // Helper: set column widths
    ws.columns = [
      ...ROW_FIELDS.map(f => ({ width: f.wch })),
      ...allCols.map(() => ({ width: 13 })),
      { width: 15 },  // Grand Total
    ];

    // ── ROW 1: Title ──────────────────────────────────────────────────────────
    const titleRow = ws.addRow(["ASA Billing Intelligence — FIN14 Final Report"]);
    titleRow.height = 28;
    const titleCell = titleRow.getCell(1);
    titleCell.font   = { bold: true, size: 14, color: { argb: C.white } };
    titleCell.fill   = fill(C.navy);
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.mergeCells(1, 1, 1, lastCol);

    // ── ROW 2: Generated date ─────────────────────────────────────────────────
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const genRow = ws.addRow([`Generated: ${today}`]);
    genRow.height = 18;
    genRow.getCell(1).font      = { italic: true, size: 9, color: { argb: "FF64748b" } };
    genRow.getCell(1).fill      = fill(C.slate100);
    genRow.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(2, 1, 2, lastCol);

    // ── ROW 3: blank ──────────────────────────────────────────────────────────
    ws.addRow([]);

    // ── ROW 4: KPI bar ────────────────────────────────────────────────────────
    const kpiRow = ws.addRow([]);
    kpiRow.height = 22;
    const kpis = [
      { label: "Total Children", value: sorted.length, col: 1 },
      { label: "FIN14 Rows Used", value: filtered.length, col: 4 },
      { label: "Rows Excluded",  value: excluded, col: 7 },
    ];
    for (const kpi of kpis) {
      const lc = kpiRow.getCell(kpi.col);
      const vc = kpiRow.getCell(kpi.col + 1);
      lc.value = kpi.label;
      lc.font  = { bold: true, size: 9, color: { argb: C.navy } };
      lc.fill  = fill(C.blue50);
      lc.alignment = { vertical: "middle", indent: 1 };
      vc.value = kpi.value;
      vc.font  = { bold: true, size: 10, color: { argb: C.navy } };
      vc.fill  = fill(C.blue50);
      vc.alignment = { vertical: "middle" };
      ws.mergeCells(4, kpi.col, 4, kpi.col + 2);
    }

    // ── ROW 5: blank ──────────────────────────────────────────────────────────
    ws.addRow([]);

    // ── ROW 6: Amount summary header ──────────────────────────────────────────
    const amtHdrRow = ws.addRow([]);
    amtHdrRow.height = 20;
    amtHdrRow.getCell(1).value = "Amount Summary";
    amtHdrRow.getCell(1).font  = { bold: true, size: 9, color: { argb: C.white } };
    amtHdrRow.getCell(1).fill  = fill(C.teal);
    amtHdrRow.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(6, 1, 6, 3);
    const amtLabels = [...MAJOR_ORDER, "Grand Total"];
    amtLabels.forEach((lbl, i) => {
      const c = amtHdrRow.getCell(4 + i);
      c.value = lbl;
      c.font  = { bold: true, size: 9, color: { argb: C.white } };
      c.fill  = fill(C.teal);
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border = border("thin");
    });

    // ── ROW 7: Amount summary values ──────────────────────────────────────────
    const amtValRow = ws.addRow([]);
    amtValRow.height = 20;
    amtValRow.getCell(1).value = "Total";
    amtValRow.getCell(1).font  = { bold: true, size: 9 };
    amtValRow.getCell(1).fill  = fill(C.tealLight);
    amtValRow.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(7, 1, 7, 3);
    MAJOR_ORDER.forEach((major, i) => {
      const c = amtValRow.getCell(4 + i);
      c.value      = majorTotals[major] ?? 0;
      c.numFmt     = "#,##0.00";
      c.font       = { bold: true, size: 9, color: { argb: (majorTotals[major] ?? 0) >= 0 ? C.slate700 : "FFdc2626" } };
      c.fill       = fill(C.tealLight);
      c.alignment  = { vertical: "middle", horizontal: "right" };
      c.border     = border("thin");
    });
    const gtCell = amtValRow.getCell(4 + MAJOR_ORDER.length);
    gtCell.value     = grandTotal;
    gtCell.numFmt    = "#,##0.00";
    gtCell.font      = { bold: true, size: 9, color: { argb: grandTotal >= 0 ? C.green : "FFdc2626" } };
    gtCell.fill      = fill(C.tealLight);
    gtCell.alignment = { vertical: "middle", horizontal: "right" };
    gtCell.border    = border("thin");

    // ── ROW 8: blank ──────────────────────────────────────────────────────────
    ws.addRow([]);

    // ── ROW 9: Major Head header ──────────────────────────────────────────────
    const hdr1Row = ws.addRow([]);
    hdr1Row.height = 20;
    ROW_FIELDS.forEach((f, ci) => {
      const c = hdr1Row.getCell(ci + 1);
      c.value     = f.label;
      c.font      = { bold: true, size: 9, color: { argb: C.white } };
      c.fill      = fill(C.navy);
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border    = medBorder();
    });
    allCols.forEach((col, ci) => {
      const c = hdr1Row.getCell(numMeta + ci + 1);
      c.value     = col.major;
      c.font      = { bold: true, size: 9, color: { argb: C.white } };
      c.fill      = fill(C.navy);
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border    = medBorder();
    });
    const gtHdr1 = hdr1Row.getCell(lastCol);
    gtHdr1.value     = "Grand Total";
    gtHdr1.font      = { bold: true, size: 9, color: { argb: C.white } };
    gtHdr1.fill      = fill(C.navy);
    gtHdr1.alignment = { vertical: "middle", horizontal: "center" };
    gtHdr1.border    = medBorder();

    // ── ROW 10: Sub Head header ───────────────────────────────────────────────
    const hdr2Row = ws.addRow([]);
    hdr2Row.height = 18;
    ROW_FIELDS.forEach((_, ci) => {
      const c = hdr2Row.getCell(ci + 1);
      c.value     = "";
      c.fill      = fill(C.navyLight);
      c.border    = border("thin");
    });
    allCols.forEach((col, ci) => {
      const c = hdr2Row.getCell(numMeta + ci + 1);
      c.value     = col.sub;
      c.font      = { bold: true, size: 8, color: { argb: C.white } };
      c.fill      = fill(C.navyLight);
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border    = border("thin");
    });
    const gtHdr2 = hdr2Row.getCell(lastCol);
    gtHdr2.value     = "";
    gtHdr2.fill      = fill(C.navyLight);
    gtHdr2.border    = border("thin");

    // Autofilter on the Major Head row (row 9)
    ws.autoFilter = {
      from: { row: 9, column: 1 },
      to:   { row: 9, column: lastCol },
    };

    // ── DATA ROWS ─────────────────────────────────────────────────────────────
    let dataRow = 11;
    for (const [, { meta, totals }] of sorted) {
      const row   = ws.addRow([]);
      row.height  = 16;
      const isAlt = (dataRow % 2 === 0);
      const rowFill = fill(isAlt ? C.altRow : C.white);

      // Meta cells
      meta.forEach((v, ci) => {
        const c = row.getCell(ci + 1);
        c.value     = v;
        c.fill      = rowFill;
        c.font      = { size: 9 };
        c.alignment = { vertical: "middle", horizontal: ci === 0 ? "right" : "left", indent: ci > 0 ? 1 : 0 };
        c.border    = border("hair");
      });

      // Value cells
      let rowTotal = 0;
      allCols.forEach((col, ci) => {
        const v = totals.get(`${col.major}|||${col.sub}`) ?? 0;
        const c = row.getCell(numMeta + ci + 1);
        c.value     = v;
        c.numFmt    = "#,##0.00";
        c.fill      = rowFill;
        c.font      = { size: 9, color: { argb: v < 0 ? C.red : C.slate700 } };
        c.alignment = { vertical: "middle", horizontal: "right" };
        c.border    = border("hair");
        rowTotal   += v;
      });

      // Grand Total cell
      const gtc = row.getCell(lastCol);
      gtc.value     = rowTotal;
      gtc.numFmt    = "#,##0.00";
      gtc.fill      = fill(isAlt ? "FFe0ecff" : C.blue50);
      gtc.font      = { bold: true, size: 9, color: { argb: rowTotal < 0 ? C.red : C.navy } };
      gtc.alignment = { vertical: "middle", horizontal: "right" };
      gtc.border    = border("thin");

      dataRow++;
    }

    // ── GRAND TOTAL ROW ───────────────────────────────────────────────────────
    const totRow  = ws.addRow([]);
    totRow.height = 20;
    const gtLabel = totRow.getCell(1);
    gtLabel.value     = "GRAND TOTAL";
    gtLabel.font      = { bold: true, size: 10, color: { argb: C.white } };
    gtLabel.fill      = fill(C.totals);
    gtLabel.alignment = { vertical: "middle", indent: 1 };
    gtLabel.border    = medBorder();
    ws.mergeCells(dataRow, 1, dataRow, numMeta);

    allCols.forEach((col, ci) => {
      const v = colTotals.get(`${col.major}|||${col.sub}`) ?? 0;
      const c = totRow.getCell(numMeta + ci + 1);
      c.value     = v;
      c.numFmt    = "#,##0.00";
      c.fill      = fill(C.totals);
      c.font      = { bold: true, size: 9, color: { argb: C.white } };
      c.alignment = { vertical: "middle", horizontal: "right" };
      c.border    = medBorder();
    });
    const totGT = totRow.getCell(lastCol);
    totGT.value     = grandTotal;
    totGT.numFmt    = "#,##0.00";
    totGT.fill      = fill(C.totals);
    totGT.font      = { bold: true, size: 10, color: { argb: C.white } };
    totGT.alignment = { vertical: "middle", horizontal: "right" };
    totGT.border    = medBorder();

    // ── Write & respond ───────────────────────────────────────────────────────
    const buf      = await wb.xlsx.writeBuffer();
    const filename = `FIN14_Final_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf as Buffer, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Pivot-Rows":        String(sorted.length),
        "X-Excluded-Rows":     String(excluded),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Report generation failed" }, { status: 500 });
  }
}
