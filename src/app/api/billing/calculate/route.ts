import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

// "Matched" tolerance and the fractional-difference band (tunable).
const MATCH_TOLERANCE = 1; // within $1 = Matched
const FRACTIONAL_PCT = 0.02; // within 2% of expected = Fractional Difference
const DEFAULT_WEEKLY_FACTOR = 4.33;

const norm = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Normalize a classroom to its age group: "Infant A" → "infant", "Preschool 1" → "preschool".
// Map any FC28 classroom (Infant A/B, Infants, Preschool 3A, 3PK, VPK, School-Age
// Experience…) to one of the rate card's canonical bands. Order matters
// (twaddler before toddler; upk before preschool).
const CLASS_BANDS: [RegExp, string][] = [
  [/infant/, "infant"],
  [/twaddler/, "twaddler"],
  [/toddler/, "toddler"],
  [/prepper/, "prepper"],
  [/\bupk\b/, "upk"],
  [/preschool|3pk|vpk|\bpk\b/, "preschool"],
  [/school.?age/, "school-age"],
];
const normClass = (s: any) => {
  const t = norm(s);
  for (const [re, band] of CLASS_BANDS) if (re.test(t)) return band;
  return t.replace(/\s+[a-z0-9]+$/, "").trim(); // generic fallback: drop trailing section
};

// ── Date helpers for proration ──────────────────────────────────────────────
function workdays(start: Date, end: Date): number {
  if (end < start) return 0;
  let n = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function mondays(start: Date, end: Date): number {
  if (end < start) return 0;
  let n = 0;
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() === 1) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const today = new Date();
    const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    // ── Reference data ──────────────────────────────────────────────────────
    const centers = await prisma.center.findMany();
    const centerById = new Map(centers.map((c) => [c.id, c]));

    const children = await prisma.child.findMany({
      include: { enrollments: { where: { isLatest: true } } },
    });
    const childById = new Map(children.map((c) => [c.id, c]));
    const childrenByFamily = new Map<string, typeof children>();
    for (const c of children) {
      const arr = childrenByFamily.get(c.familyId) ?? [];
      arr.push(c);
      childrenByFamily.set(c.familyId, arr);
    }

    // Rate cards indexed by progressively-relaxed keys for best-match lookup.
    // Each entry keeps the components so gross can honour each child's early/late
    // care flags (gross = monthly fee + early-rate[if early care] + late-rate[if late care]).
    type RC = { fee: number; early: number; late: number };
    const rateCards = await prisma.rateCard.findMany({ where: { isActive: true } });
    const rcExact = new Map<string, RC>(); // center|version|program|classroom|times
    const rcNoTimes = new Map<string, RC>(); // center|version|program|classroom
    const rcNoVersion = new Map<string, RC>(); // center|program|classroom
    const rcMetaByCenter = new Map<string, { entity: string | null; state: string | null }>();
    for (const rc of rateCards) {
      if (!rcMetaByCenter.has(norm(rc.centerName)) && (rc.entity || rc.state))
        rcMetaByCenter.set(norm(rc.centerName), { entity: rc.entity, state: rc.state });
    }
    for (const rc of rateCards) {
      const comp: RC = { fee: Number(rc.monthlyFees), early: Number(rc.earlyAMRate), late: Number(rc.latePMRate) };
      const base = [norm(rc.centerName), norm(rc.version), norm(rc.program), normClass(rc.classroom)];
      const setIfBetter = (m: Map<string, RC>, k: string) => { if (!m.has(k) || m.get(k)!.fee === 0) m.set(k, comp); };
      setIfBetter(rcExact, [...base, norm(rc.dropOff), norm(rc.latePickup)].filter(Boolean).join("|"));
      setIfBetter(rcNoTimes, base.filter(Boolean).join("|"));
      setIfBetter(rcNoVersion, [norm(rc.centerName), norm(rc.program), normClass(rc.classroom)].filter(Boolean).join("|"));
    }

    // Self-heal: rate cards are imported before centers exist, so back-fill each
    // center's Entity/State from the rate-card master here (keeps /centers correct).
    for (const c of centers) {
      if (c.entity && c.state) continue;
      const meta = rcMetaByCenter.get(norm(c.name));
      if (meta && (meta.entity || meta.state)) {
        const entity = c.entity ?? meta.entity;
        const state = c.state ?? meta.state;
        await prisma.center.update({ where: { id: c.id }, data: { entity, state } });
        c.entity = entity; c.state = state; // keep in-memory copy fresh for this run
      }
    }

    // ── Transactions → per child/period buckets with category breakdown ───────
    const transactions = await prisma.transaction.findMany({ include: { center: true } });

    type Bucket = {
      childId: string; familyId: string; centerId: string | null; centerName: string;
      billingPeriod: string; billingMonth: number; billingYear: number;
      regular: number; agency: number; discount: number; earlyLate: number;
      oneTime: number; other: number; adjustments: number; payments: number;
      lastTxDate: Date | null; invoice: string;
    };
    const buckets = new Map<string, Bucket>();
    const unallocated: { familyId: string; period: string; net: number }[] = [];

    const bucketFor = (child: (typeof children)[number], tx: (typeof transactions)[number]) => {
      const period = tx.billingPeriod || defaultPeriod;
      const key = `${child.id}::${period}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          childId: child.id, familyId: child.familyId,
          centerId: tx.centerId ?? child.centerId, centerName: tx.center?.name ?? "",
          billingPeriod: period, billingMonth: tx.billingMonth ?? today.getMonth() + 1,
          billingYear: tx.billingYear ?? today.getFullYear(),
          regular: 0, agency: 0, discount: 0, earlyLate: 0, oneTime: 0, other: 0, adjustments: 0,
          payments: 0, lastTxDate: null, invoice: "",
        };
        buckets.set(key, b);
      }
      return b;
    };

    for (const tx of transactions) {
      const charge = Number(tx.chargeAmount) || 0;
      const credit = Number(tx.creditAmount) || 0;
      const payment = Number(tx.paymentAmount) || 0;
      const signed = charge - credit; // net effect on the bill (credits reduce)

      let child = tx.childId ? childById.get(tx.childId) : undefined;
      if (!child) {
        const kids = childrenByFamily.get(tx.familyId) ?? [];
        if (kids.length === 1) child = kids[0];
        else { unallocated.push({ familyId: tx.familyId, period: tx.billingPeriod || defaultPeriod, net: signed }); continue; }
      }

      const b = bucketFor(child, tx);
      b.payments += payment;
      switch (tx.subHead) {
        case "Regular": b.regular += signed; break;
        case "Agency": b.agency += signed; break;
        case "Discount": b.discount += signed; break;
        case "Early-Late": b.earlyLate += signed; break;
        case "One Time": b.oneTime += signed; break;
        case "Adjustments": b.adjustments += signed; break;
        case "Payment": break; // already counted in payments
        default: b.other += signed; break;
      }
      if (tx.transactionDate && (!b.lastTxDate || tx.transactionDate > b.lastTxDate)) b.lastTxDate = tx.transactionDate;
      if (!b.invoice && tx.invoiceNumber) b.invoice = tx.invoiceNumber;
    }

    // Carry-forward comments: prior-period remark/detailedRemark by childId.
    const priorByChild = new Map<string, { remark: string | null; detailedRemark: string | null }>();
    {
      const periods = [...new Set([...buckets.values()].map((b) => b.billingPeriod))];
      for (const p of periods) {
        const [y, m] = p.split("-").map(Number);
        const prior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
        const prevFacts = await prisma.billingFact.findMany({
          where: { billingPeriod: prior, OR: [{ remark: { not: null } }, { detailedRemark: { not: null } }] },
          select: { childId: true, remark: true, detailedRemark: true },
        });
        for (const f of prevFacts) priorByChild.set(f.childId, { remark: f.remark, detailedRemark: f.detailedRemark });
      }
    }

    // ── Build a fact per bucket ───────────────────────────────────────────────
    let processed = 0;
    const summary: Record<string, any>[] = [];

    for (const b of buckets.values()) {
      const child = childById.get(b.childId)!;
      const enr = child.enrollments[0];
      const center = b.centerId ? centerById.get(b.centerId) : centerById.get(child.centerId);
      const coreFactor = Number(center?.coreWeeklyFactor) || DEFAULT_WEEKLY_FACTOR;
      const rcMeta = rcMetaByCenter.get(norm(b.centerName)) ?? rcMetaByCenter.get(norm(center?.name));
      const entity = center?.entity ?? rcMeta?.entity ?? null;
      const state = center?.state ?? rcMeta?.state ?? null;

      // Actuals by category. Actual billed (total) = everything except payments.
      const actualAmount = b.regular + b.agency + b.discount + b.earlyLate + b.oneTime + b.other + b.adjustments;
      const collectedAmount = b.payments;
      // For the Expected-vs-Actual comparison we use the RECURRING billing only —
      // tuition (Regular) + Agency + Early/Late, net of Discounts. One-time fees,
      // "Other", and Adjustments are not part of the rate-card expectation, so
      // including them would falsely flag children as over-billed (matches the
      // May report, which reconciles against Agency + Regular).
      const recurringActual = b.regular + b.agency + b.earlyLate + b.discount;

      // ── Expected (rate card + FC28) ──
      const [py, pm] = b.billingPeriod.split("-").map(Number);
      const monthStart = new Date(py, pm - 1, 1);
      const monthEnd = new Date(py, pm, 0);
      const totalDays = workdays(monthStart, monthEnd);
      const monthWeeks = mondays(monthStart, monthEnd) || coreFactor;

      const exp = computeExpected({ enr, center, coreFactor, monthStart, monthEnd, totalDays, monthWeeks,
        rcExact, rcNoTimes, rcNoVersion });

      const hasExpected = exp.expected > 0;
      const expectedAmount = exp.expected;
      const varianceAmount = hasExpected ? expectedAmount - recurringActual : 0;
      // Clamp to fit Decimal(6,2); precision beyond ±9999% is meaningless.
      const variancePercent = hasExpected
        ? Math.max(-9999.99, Math.min(9999.99, (varianceAmount / expectedAmount) * 100))
        : 0;
      const leakageAmount = hasExpected && varianceAmount > MATCH_TOLERANCE ? varianceAmount : 0;

      const { status, category } = categorize({
        hasExpected, expectedAmount, actualAmount: recurringActual, varianceAmount,
        finalDays: exp.finalDays, totalDays, startedThisMonth: exp.startedThisMonth,
      });

      const prior = priorByChild.get(b.childId);

      await prisma.billingFact.upsert({
        where: { childId_billingPeriod: { childId: b.childId, billingPeriod: b.billingPeriod } },
        create: {
          childId: b.childId, familyId: b.familyId, centerId: center?.id ?? child.centerId,
          billingPeriod: b.billingPeriod, billingMonth: b.billingMonth, billingYear: b.billingYear,
          expectedAmount, actualAmount, collectedAmount, varianceAmount, variancePercent, leakageAmount,
          grossBilling: exp.gross, agencyBilling: exp.agencyBilling, copayBilling: exp.copayBilling,
          programFeeBilling: exp.programFee, finalDaysBilled: exp.finalDays, finalWeeksBilled: exp.finalWeeks,
          actualRegular: b.regular, actualAgency: b.agency, actualDiscount: b.discount,
          actualEarlyLate: b.earlyLate, actualOneTime: b.oneTime, actualOther: b.other, actualAdjustments: b.adjustments,
          entity, state,
          agencyName: enr?.agencyName ?? null, billingCycle: enr?.billingCycle ?? null,
          enrollmentStatus: enr?.status ?? null,
          billingStatus: status as any, varianceCategory: category as any,
          remark: prior?.remark ?? null, detailedRemark: prior?.detailedRemark ?? null,
          snapshotDate: new Date(),
        },
        update: {
          centerId: center?.id ?? child.centerId,
          expectedAmount, actualAmount, collectedAmount, varianceAmount, variancePercent, leakageAmount,
          grossBilling: exp.gross, agencyBilling: exp.agencyBilling, copayBilling: exp.copayBilling,
          programFeeBilling: exp.programFee, finalDaysBilled: exp.finalDays, finalWeeksBilled: exp.finalWeeks,
          actualRegular: b.regular, actualAgency: b.agency, actualDiscount: b.discount,
          actualEarlyLate: b.earlyLate, actualOneTime: b.oneTime, actualOther: b.other, actualAdjustments: b.adjustments,
          entity, state,
          agencyName: enr?.agencyName ?? null, billingCycle: enr?.billingCycle ?? null,
          enrollmentStatus: enr?.status ?? null,
          billingStatus: status as any, varianceCategory: category as any,
          snapshotDate: new Date(),
        },
      });

      summary.push({
        "Entity": entity ?? "", "State": state ?? "", "Center": b.centerName,
        "Child ID": child.childId, "Child Name": child.fullName,
        "Status": enr?.status ?? "", "Agency": enr?.agencyName ?? "", "Billing Cycle": enr?.billingCycle ?? "",
        "Billing Period": b.billingPeriod, "Days Billed": exp.finalDays,
        "Gross (Rate Card)": round2(exp.gross), "Expected": hasExpected ? round2(expectedAmount) : "",
        "Actual Regular": round2(b.regular), "Actual Agency": round2(b.agency),
        "Actual Discount": round2(b.discount), "Actual Other": round2(b.earlyLate + b.oneTime + b.other),
        "Actual Adjustments": round2(b.adjustments), "Actual Billed": round2(actualAmount),
        "Collected": round2(collectedAmount), "Variance": hasExpected ? round2(varianceAmount) : "",
        "Category": category, "Remark": prior?.remark ?? "", "Detailed Remark": prior?.detailedRemark ?? "",
      });
      processed++;
    }

    // ── Excel report ──────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Billing Report");
    if (unallocated.length) {
      const byFam = new Map<string, number>();
      for (const u of unallocated) byFam.set(`${u.familyId}::${u.period}`, (byFam.get(`${u.familyId}::${u.period}`) ?? 0) + u.net);
      const rows = [...byFam.entries()].map(([k, net]) => {
        const [familyId, period] = k.split("::");
        return { "Family ID": familyId, "Billing Period": period, "Unallocated Net": round2(net) };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Unallocated (multi-child)");
    }
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
    const filename = `Calculated_Billing_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Processed": String(processed),
        "X-Unallocated": String(unallocated.length),
      },
    });

    return NextResponse.json({
      success: true, processed, unallocatedLines: unallocated.length,
      message: `Calculated ${processed} child-period facts.` +
        (unallocated.length ? ` (${unallocated.length} family-level lines need allocation)` : ""),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message ?? "Internal error" }, { status: 500 });
  }
}

// ── Expected-billing engine (mirrors the May report's FC28 formulas) ──────────
function computeExpected(args: any) {
  const { enr, coreFactor, monthStart, monthEnd, totalDays, monthWeeks, rcExact, rcNoTimes, rcNoVersion } = args;
  const blank = { expected: 0, gross: 0, agencyBilling: 0, copayBilling: 0, programFee: 0, finalDays: 0, finalWeeks: 0, startedThisMonth: false };
  if (!enr) return blank;

  // Rate-card lookup via progressively-relaxed keys (best match wins).
  const center = norm(args.center?.name);
  const ver = norm(enr.rateCardVersion);
  const prog = norm(enr.programCode ?? enr.schedule);
  const cls = normClass(enr.cleanClassroom ?? enr.classroom);
  const keyExact = [center, ver, prog, cls, norm(enr.dropOff), norm(enr.pickup)].filter(Boolean).join("|");
  const keyNoTimes = [center, ver, prog, cls].filter(Boolean).join("|");
  const keyNoVer = [center, prog, cls].filter(Boolean).join("|");
  const rc = rcExact.get(keyExact) ?? rcNoTimes.get(keyNoTimes) ?? rcNoVersion.get(keyNoVer) ?? null;

  let gross = 0;
  let matchedRateCard = false;
  if (rc && rc.fee > 0) {
    // Gross = monthly fee + early/late add-ons only when the child uses them.
    gross = rc.fee + (enr.earlyAMCare ? rc.early : 0) + (enr.latePMCare ? rc.late : 0);
    matchedRateCard = true;
  } else {
    // Fall back to the FC28 contract amount if no rate card matched (keeps coverage).
    gross = Number(enr.estimatedContractAmount) || 0;
  }

  // Proration window: clamp enrollment to the billing month.
  const start = enr.startDate ? new Date(enr.startDate) : monthStart;
  const finalStart = start > monthStart ? start : monthStart;
  const wd = enr.withdrawalDate ? new Date(enr.withdrawalDate) : null;
  const finalEnd = wd && wd < monthEnd ? wd : monthEnd;
  const finalDays = workdays(finalStart, finalEnd);
  const finalWeeks = mondays(finalStart, finalEnd);
  const startedThisMonth = finalStart > monthStart;

  const DAY = totalDays || 21;
  const WEEK = coreFactor || 4.33;
  const toMonthly = (amt: number | null, period: string | null): number | null => {
    if (amt == null || period == null) return null;
    if (period === "Day") return amt * DAY;
    if (period === "Week") return amt * WEEK;
    return amt; // Month or unknown
  };

  const hasAgency = !!enr.agencyName;
  const copayAmt = enr.estimatedCopayAmount != null ? Number(enr.estimatedCopayAmount) : null;
  const hasCopay = copayAmt != null;
  const agencyMonthly = toMonthly(enr.estimatedContractAmount != null ? Number(enr.estimatedContractAmount) : null, enr.contractPeriod) ?? 0;
  let copayMonthly: number;
  if (copayAmt == null || enr.copayPeriod == null) copayMonthly = Math.max(0, gross - agencyMonthly);
  else copayMonthly = toMonthly(copayAmt, enr.copayPeriod) ?? 0;

  const isWeekly = (enr.billingCycle ?? "").toLowerCase().includes("week");
  const proRata = (full: number) =>
    isWeekly ? (monthWeeks > 0 ? (full / WEEK) * finalWeeks : full)
             : (DAY > 0 ? full * (finalDays / DAY) : full);

  const programFee = proRata(gross);
  const agencyBilling = proRata(agencyMonthly);
  const copayBilling = proRata(copayMonthly);

  let expected: number;
  if (hasAgency && hasCopay) expected = agencyBilling + copayBilling;
  else expected = programFee; // private, or agency-only / copay-only

  return { expected, gross, agencyBilling, copayBilling, programFee, finalDays, finalWeeks, startedThisMonth, matchedRateCard };
}

function categorize(a: any): { status: string; category: string } {
  const { hasExpected, expectedAmount, actualAmount, varianceAmount, startedThisMonth } = a;
  if (!hasExpected) return { status: actualAmount > 0 ? "ACTUAL_ONLY" : "NOT_BILLED", category: "UNCATEGORIZED" };
  const absDiff = Math.abs(varianceAmount);
  if (absDiff <= MATCH_TOLERANCE) return { status: "MATCHED", category: "MATCHED" };
  if (absDiff <= Math.max(MATCH_TOLERANCE, expectedAmount * FRACTIONAL_PCT))
    return { status: "MATCHED", category: "FRACTIONAL_DIFFERENCE" };
  if (varianceAmount > 0) {
    // under-billed
    if (actualAmount === 0) return { status: "NOT_BILLED", category: startedThisMonth ? "NEW_START" : "BILLING_PENDING" };
    return { status: "UNDERBILLED", category: "SHORT_BILLING" };
  }
  return { status: "OVERBILLED", category: "EXCESS_BILLING" }; // over-billed
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
