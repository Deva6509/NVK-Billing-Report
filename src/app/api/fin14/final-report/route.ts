import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export const maxDuration = 60;

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  white:     "FFFFFFFF",
  navy:      "FF003887",
  navyLight: "FF1e4da1",
  navyDark:  "FF0f2a5e",
  teal:      "FF0d9488",
  tealLight: "FFf0fdfa",
  blue50:    "FFdbeafe",
  altRow:    "FFf0f7ff",
  slate100:  "FFf1f5f9",
  slate700:  "FF334155",
  red:       "FFdc2626",
  green:     "FF16a34a",
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

function parseMoney(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  const s = String(val).replace(/[$, ]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const MAJOR_ORDER = ["Billing", "Adjustments", "Payment"];
const SUB_ORDER: Record<string, string[]> = {
  Billing:     ["Regular", "Agency", "Early/Late", "One Time", "Other"],
  Adjustments: ["Adjustments", "Discount"],
  Payment:     ["Agency"],
};

const META_COLS = [
  { label: "Child ID",        width: 11 },
  { label: "Child Name",      width: 26 },
  { label: "Center",          width: 24 },
  { label: "Billing Cycle",   width: 14 },
  { label: "Child Status",    width: 13 },
  { label: "Start Date",      width: 13 },
  { label: "Withdrawal Date", width: 16 },
  { label: "Classroom",       width: 16 },
  { label: "Family Status",   width: 14 },
];

export async function GET(req: NextRequest) {
  try {
    const sp      = new URL(req.url).searchParams;
    const batchId = sp.get("batchId");

    // ── 1. Aggregated pivot query (fast — returns ~child×category rows, not all txns) ──
    const batchFilter = batchId ? `AND r."batchId" = $1` : "";

    type PivotRow = {
      childId:       string;
      childName:     string | null;
      center:        string | null;
      billingCycle:  string | null;
      childStatus:   string | null;
      startDate:     string | null;
      withdrawalDate:string | null;
      classroom:     string | null;
      familyStatus:  string | null;
      majorHead:     string | null;
      subHead:       string | null;
      amount:        string | null;   // Postgres returns numeric as string
    };

    const pivotRows: PivotRow[] = await prisma.$queryRawUnsafe(
      `SELECT
         r."rawData"->>'Child ID'                          AS "childId",
         MAX(r."rawData"->>'Child Name')                   AS "childName",
         MAX(r."rawData"->>'Center')                       AS "center",
         MAX(r."rawData"->>'Billing Cycle (FC28)')         AS "billingCycle",
         MAX(r."rawData"->>'Child Status (FC28)')          AS "childStatus",
         MAX(r."rawData"->>'Start Date (FC28)')            AS "startDate",
         MAX(r."rawData"->>'Withdrawal Date (FC28)')       AS "withdrawalDate",
         MAX(r."rawData"->>'Classroom (FC28)')             AS "classroom",
         MAX(r."rawData"->>'Family Status (FC28)')         AS "familyStatus",
         r."majorHead",
         r."subHead",
         SUM(
           CASE
             WHEN r."rawData"->>'Amount' IS NULL
               OR trim(r."rawData"->>'Amount') = '' THEN 0
             ELSE REGEXP_REPLACE(
               REGEXP_REPLACE(r."rawData"->>'Amount', '[$, ]', '', 'g'),
               '^\\((.+)\\)$', '-\\1'
             )::numeric
           END
         ) AS "amount"
       FROM "Fin14Row" r
       WHERE length(trim(COALESCE(r."rawData"->>'Family Name', ''))) > 0
         AND length(trim(COALESCE(r."rawData"->>'Child ID',   ''))) > 0
         ${batchFilter}
       GROUP BY "childId", r."majorHead", r."subHead"
       ORDER BY MAX(r."rawData"->>'Center') NULLS LAST, "childId"`,
      ...(batchId ? [batchId] : [])
    );

    if (!pivotRows.length) {
      return NextResponse.json({ error: "No FIN14 rows found" }, { status: 404 });
    }

    // ── 2. Slim transactions query for the Transactions sheet ─────────────────
    type TxnRow = {
      childId:   string | null;
      childName: string | null;
      center:    string | null;
      item:      string | null;
      amount:    string | null;
      majorHead: string | null;
      subHead:   string | null;
    };

    const txnRows: TxnRow[] = await prisma.$queryRawUnsafe(
      `SELECT
         r."rawData"->>'Child ID'   AS "childId",
         r."rawData"->>'Child Name' AS "childName",
         r."rawData"->>'Center'     AS "center",
         r."rawData"->>'Item'       AS "item",
         r."rawData"->>'Amount'     AS "amount",
         r."majorHead"              AS "majorHead",
         r."subHead"                AS "subHead"
       FROM "Fin14Row" r
       WHERE length(trim(COALESCE(r."rawData"->>'Family Name', ''))) > 0
         AND length(trim(COALESCE(r."rawData"->>'Child ID',   ''))) > 0
         ${batchFilter}
       ORDER BY r."rawData"->>'Center' NULLS LAST, r."rawData"->>'Child ID', r.id`,
      ...(batchId ? [batchId] : [])
    );

    // ── 3. Build pivot map ────────────────────────────────────────────────────
    type ChildEntry = {
      meta:   { childId: string; childName: string; center: string; billingCycle: string; childStatus: string; startDate: string; withdrawalDate: string; classroom: string; familyStatus: string };
      totals: Map<string, number>;
    };

    const colSet  = new Set<string>();
    const childMap = new Map<string, ChildEntry>();

    for (const r of pivotRows) {
      const cid = String(r.childId ?? "").trim();
      if (!cid) continue;
      const colKey = `${r.majorHead ?? ""}|||${r.subHead ?? ""}`;
      if (r.majorHead && r.subHead) colSet.add(colKey);

      if (!childMap.has(cid)) {
        childMap.set(cid, {
          meta: {
            childId:        cid,
            childName:      r.childName    ?? "",
            center:         r.center       ?? "",
            billingCycle:   r.billingCycle ?? "",
            childStatus:    r.childStatus  ?? "",
            startDate:      r.startDate    ?? "",
            withdrawalDate: r.withdrawalDate ?? "",
            classroom:      r.classroom    ?? "",
            familyStatus:   r.familyStatus ?? "",
          },
          totals: new Map(),
        });
      }
      const entry = childMap.get(cid)!;
      const amt   = parseMoney(r.amount);
      entry.totals.set(colKey, (entry.totals.get(colKey) ?? 0) + amt);
    }

    // Order value columns by MAJOR_ORDER > SUB_ORDER > discovery
    const allCols: { major: string; sub: string }[] = [];
    for (const major of MAJOR_ORDER)
      for (const sub of SUB_ORDER[major] ?? [])
        if (colSet.has(`${major}|||${sub}`)) allCols.push({ major, sub });
    for (const key of colSet) {
      const [major, sub] = key.split("|||");
      if (!allCols.find(c => c.major === major && c.sub === sub)) allCols.push({ major, sub });
    }

    const sorted = [...childMap.entries()].sort(([, a], [, b]) => {
      const ca = a.meta.center.toLowerCase();
      const cb = b.meta.center.toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (Number(a.meta.childId) || 0) - (Number(b.meta.childId) || 0);
    });

    // Grand totals
    const colTotals = new Map<string, number>();
    let grandTotal  = 0;
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

    const numMeta = META_COLS.length;
    const numVal  = allCols.length;
    const lastCol = numMeta + numVal + 1; // +1 Grand Total

    // ── 4. Build workbook ─────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "ASA Billing Intelligence";
    wb.created = new Date();

    // ═══════════════════════════════════════════════════════════════════════════
    // SHEET 1 — Summary Report
    // ═══════════════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet("Summary Report", {
      views: [{ state: "frozen", xSplit: 3, ySplit: 11 }],
    });

    ws.columns = [
      ...META_COLS.map(c => ({ width: c.width })),
      ...allCols.map(() => ({ width: 13 })),
      { width: 15 },
    ];

    // Row 1: Title
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const r1 = ws.addRow(["ASA Billing Intelligence — FIN14 Final Report"]);
    r1.height = 28;
    const c1 = r1.getCell(1);
    c1.font      = { bold: true, size: 14, color: { argb: C.white } };
    c1.fill      = fill(C.navy);
    c1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.mergeCells(1, 1, 1, lastCol);

    // Row 2: Generated date
    const r2 = ws.addRow([`Generated: ${today}   |   Source data: see "Transactions" sheet`]);
    r2.height = 18;
    r2.getCell(1).font      = { italic: true, size: 9, color: { argb: "FF64748b" } };
    r2.getCell(1).fill      = fill(C.slate100);
    r2.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(2, 1, 2, lastCol);

    // Row 3: blank
    ws.addRow([]);

    // Row 4: KPI bar
    const r4 = ws.addRow([]);
    r4.height = 22;
    [
      { label: "Total Children",  value: sorted.length,       col: 1 },
      { label: "FIN14 Rows Used", value: txnRows.length,      col: 4 },
      { label: "Rows Excluded",   value: pivotRows.length > txnRows.length ? 0 : 0, col: 7 },
    ].forEach(({ label, value, col }) => {
      const lc = r4.getCell(col);
      const vc = r4.getCell(col + 1);
      lc.value = label; lc.font = { bold: true, size: 9, color: { argb: C.navy } }; lc.fill = fill(C.blue50); lc.alignment = { vertical: "middle", indent: 1 };
      vc.value = value; vc.font = { bold: true, size: 10, color: { argb: C.navy } }; vc.fill = fill(C.blue50); vc.alignment = { vertical: "middle" };
      ws.mergeCells(4, col, 4, col + 2);
    });

    // Row 5: blank
    ws.addRow([]);

    // Row 6: Amount summary header
    const r6 = ws.addRow([]); r6.height = 20;
    r6.getCell(1).value = "Amount Summary"; r6.getCell(1).font = { bold: true, size: 9, color: { argb: C.white } }; r6.getCell(1).fill = fill(C.teal); r6.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(6, 1, 6, 3);
    [...MAJOR_ORDER, "Grand Total"].forEach((lbl, i) => {
      const c = r6.getCell(4 + i);
      c.value = lbl; c.font = { bold: true, size: 9, color: { argb: C.white } }; c.fill = fill(C.teal); c.alignment = { vertical: "middle", horizontal: "center" }; c.border = border("thin");
    });

    // Row 7: Amount summary values
    const r7 = ws.addRow([]); r7.height = 20;
    r7.getCell(1).value = "Total"; r7.getCell(1).font = { bold: true, size: 9 }; r7.getCell(1).fill = fill(C.tealLight); r7.getCell(1).alignment = { vertical: "middle", indent: 1 };
    ws.mergeCells(7, 1, 7, 3);
    MAJOR_ORDER.forEach((major, i) => {
      const c = r7.getCell(4 + i);
      c.value = majorTotals[major] ?? 0; c.numFmt = "#,##0.00"; c.font = { bold: true, size: 9 }; c.fill = fill(C.tealLight); c.alignment = { vertical: "middle", horizontal: "right" }; c.border = border("thin");
    });
    const gtAmt = r7.getCell(4 + MAJOR_ORDER.length);
    gtAmt.value = grandTotal; gtAmt.numFmt = "#,##0.00"; gtAmt.font = { bold: true, size: 9, color: { argb: grandTotal >= 0 ? C.green : C.red } }; gtAmt.fill = fill(C.tealLight); gtAmt.alignment = { vertical: "middle", horizontal: "right" }; gtAmt.border = border("thin");

    // Row 8: blank
    ws.addRow([]);

    // Row 9: Major Head header
    const r9 = ws.addRow([]); r9.height = 20;
    META_COLS.forEach((col, ci) => {
      const c = r9.getCell(ci + 1);
      c.value = col.label; c.font = { bold: true, size: 9, color: { argb: C.white } }; c.fill = fill(C.navy); c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = medBorder();
    });
    allCols.forEach((col, ci) => {
      const c = r9.getCell(numMeta + ci + 1);
      c.value = col.major; c.font = { bold: true, size: 9, color: { argb: C.white } }; c.fill = fill(C.navy); c.alignment = { vertical: "middle", horizontal: "center" }; c.border = medBorder();
    });
    const gtH1 = r9.getCell(lastCol);
    gtH1.value = "Grand Total"; gtH1.font = { bold: true, size: 9, color: { argb: C.white } }; gtH1.fill = fill(C.navy); gtH1.alignment = { vertical: "middle", horizontal: "center" }; gtH1.border = medBorder();

    // Row 10: Sub Head header
    const r10 = ws.addRow([]); r10.height = 18;
    META_COLS.forEach((_, ci) => { const c = r10.getCell(ci + 1); c.fill = fill(C.navyLight); c.border = border("thin"); });
    allCols.forEach((col, ci) => {
      const c = r10.getCell(numMeta + ci + 1);
      c.value = col.sub; c.font = { bold: true, size: 8, color: { argb: C.white } }; c.fill = fill(C.navyLight); c.alignment = { vertical: "middle", horizontal: "center" }; c.border = border("thin");
    });
    r10.getCell(lastCol).fill = fill(C.navyLight); r10.getCell(lastCol).border = border("thin");

    ws.autoFilter = { from: { row: 9, column: 1 }, to: { row: 9, column: lastCol } };

    // Data rows
    let dataRow = 11;
    for (const [, { meta, totals }] of sorted) {
      const row    = ws.addRow([]); row.height = 16;
      const isAlt  = dataRow % 2 === 0;
      const rowFill = fill(isAlt ? C.altRow : C.white);

      const metaValues = [
        isNaN(Number(meta.childId)) ? meta.childId : Number(meta.childId),
        meta.childName, meta.center, meta.billingCycle, meta.childStatus,
        meta.startDate, meta.withdrawalDate, meta.classroom, meta.familyStatus,
      ];
      metaValues.forEach((v, ci) => {
        const c = row.getCell(ci + 1);
        c.value = v; c.fill = rowFill; c.font = { size: 9 };
        c.alignment = { vertical: "middle", horizontal: ci === 0 ? "right" : "left", indent: ci > 0 ? 1 : 0 };
        c.border = border("hair");
      });

      let rowTotal = 0;
      allCols.forEach((col, ci) => {
        const v = totals.get(`${col.major}|||${col.sub}`) ?? 0;
        const c = row.getCell(numMeta + ci + 1);
        c.value = v; c.numFmt = "#,##0.00"; c.fill = rowFill;
        c.font = { size: 9, color: { argb: v < 0 ? C.red : C.slate700 } };
        c.alignment = { vertical: "middle", horizontal: "right" }; c.border = border("hair");
        rowTotal += v;
      });

      const gtc = row.getCell(lastCol);
      gtc.value = rowTotal; gtc.numFmt = "#,##0.00";
      gtc.fill = fill(isAlt ? "FFe0ecff" : C.blue50);
      gtc.font = { bold: true, size: 9, color: { argb: rowTotal < 0 ? C.red : C.navy } };
      gtc.alignment = { vertical: "middle", horizontal: "right" }; gtc.border = border("thin");

      dataRow++;
    }

    // Grand total footer
    const rTot = ws.addRow([]); rTot.height = 20;
    const gtLbl = rTot.getCell(1);
    gtLbl.value = "GRAND TOTAL"; gtLbl.font = { bold: true, size: 10, color: { argb: C.white } };
    gtLbl.fill = fill(C.navyDark); gtLbl.alignment = { vertical: "middle", indent: 1 }; gtLbl.border = medBorder();
    ws.mergeCells(dataRow, 1, dataRow, numMeta);
    allCols.forEach((col, ci) => {
      const v = colTotals.get(`${col.major}|||${col.sub}`) ?? 0;
      const c = rTot.getCell(numMeta + ci + 1);
      c.value = v; c.numFmt = "#,##0.00"; c.fill = fill(C.navyDark);
      c.font = { bold: true, size: 9, color: { argb: C.white } };
      c.alignment = { vertical: "middle", horizontal: "right" }; c.border = medBorder();
    });
    const totGT = rTot.getCell(lastCol);
    totGT.value = grandTotal; totGT.numFmt = "#,##0.00"; totGT.fill = fill(C.navyDark);
    totGT.font = { bold: true, size: 10, color: { argb: C.white } };
    totGT.alignment = { vertical: "middle", horizontal: "right" }; totGT.border = medBorder();

    // ═══════════════════════════════════════════════════════════════════════════
    // SHEET 2 — Transactions (raw rows, numeric Amount, for drill-down)
    // ═══════════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet("Transactions", {
      views: [{ state: "frozen", xSplit: 0, ySplit: 1 }],
    });

    ws2.columns = [
      { width: 11 }, { width: 26 }, { width: 24 },
      { width: 13 }, { width: 13 },
      { width: 15 }, { width: 15 },
    ];

    const txnHeaders = ["Child ID", "Child Name", "Center", "Item", "Amount", "Major Head", "Sub Head"];
    const hRow = ws2.addRow(txnHeaders);
    hRow.height = 18;
    hRow.eachCell((cell) => {
      cell.font      = { bold: true, size: 9, color: { argb: C.white } };
      cell.fill      = fill(C.navy);
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border    = medBorder();
    });

    ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: txnHeaders.length } };

    let txnRow = 2;
    for (const r of txnRows) {
      const amt    = parseMoney(r.amount);
      const isAlt  = txnRow % 2 === 0;
      const rowFill = fill(isAlt ? C.altRow : C.white);
      const row2   = ws2.addRow([
        isNaN(Number(r.childId)) ? (r.childId ?? "") : Number(r.childId),
        r.childName  ?? "",
        r.center     ?? "",
        r.item       ?? "",
        amt,
        r.majorHead  ?? "",
        r.subHead    ?? "",
      ]);
      row2.height = 15;
      row2.eachCell((cell, col) => {
        cell.fill      = rowFill;
        cell.font      = { size: 9 };
        cell.border    = border("hair");
        if (col === 5) { cell.numFmt = "#,##0.00"; cell.alignment = { horizontal: "right" }; if (amt < 0) cell.font = { size: 9, color: { argb: C.red } }; }
        else if (col === 1) { cell.alignment = { horizontal: "right" }; }
        else { cell.alignment = { horizontal: "left", indent: 1 }; }
      });
      txnRow++;
    }

    // ── Generate & respond ────────────────────────────────────────────────────
    const buf      = await wb.xlsx.writeBuffer();
    const filename = `FIN14_Final_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf as Buffer, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Pivot-Rows":        String(sorted.length),
        "X-Txn-Rows":          String(txnRows.length),
      },
    });
  } catch (err: any) {
    console.error("final-report error:", err);
    return NextResponse.json({ error: err.message ?? "Report generation failed" }, { status: 500 });
  }
}
