import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const db = prisma as any;

function to24h(t: string | null): string {
  if (!t) return "";
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return t.trim();
  let h = parseInt(m[1], 10);
  const min = m[2], sec = m[3] ?? "00", ampm = m[4].toUpperCase();
  if (ampm === "AM") { if (h === 12) h = 0; }
  else               { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${min}:${sec}`;
}

// POST /api/fc28/recompute-keys
// Uses DISTINCT combinations so 38k rows → ~200-500 groups → one bulk SQL UPDATE.
export async function POST() {
  try {
    const classroomMappingRows: { fc28Classroom: string; rateSheetItem: string | null }[] =
      await db.classroomMapping.findMany();
    const classroomMap = new Map<string, string>();
    for (const c of classroomMappingRows) {
      if (c.rateSheetItem) classroomMap.set(c.fc28Classroom, c.rateSheetItem);
    }

    const latestBatch = await db.fC28Batch.findFirst({ orderBy: { reportDate: "desc" } });
    if (!latestBatch) return NextResponse.json({ error: "No FC28 batch found" }, { status: 404 });

    // Load only distinct field combinations — vastly fewer rows than total
    const combos: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT
         COALESCE(center,      '') AS center,
         COALESCE("rateSheet", '') AS "rateSheet",
         COALESCE("dropOff",   '') AS "dropOff",
         COALESCE(pickup,      '') AS pickup,
         COALESCE(program,     '') AS program,
         COALESCE(classroom,   '') AS classroom
       FROM "FC28Row"
       WHERE "batchId" = $1`,
      latestBatch.id
    );

    let mapped = 0, unmapped = 0;
    const valueParts: string[] = [];
    const params: any[] = [];
    let pi = 1;

    for (const c of combos) {
      const centerShort        = c.center.split(",")[0].trim();
      const classroom          = c.classroom;
      const revisedClassroom   = classroom ? (classroomMap.get(classroom) ?? null) : null;
      const effectiveClassroom = revisedClassroom ?? classroom;
      const dropOff24          = to24h(c.dropOff  || null);
      const pickup24           = to24h(c.pickup    || null);
      const rateSheet          = c.rateSheet;
      const program            = c.program;

      const rateCardKey        = [centerShort, rateSheet, dropOff24, pickup24, program,          effectiveClassroom].join("|");
      const earlyAMRateCardKey = [centerShort, rateSheet, dropOff24, pickup24, "Early AM Care",  effectiveClassroom].join("|");
      const latePMRateCardKey  = [centerShort, rateSheet, dropOff24, pickup24, "Late PM Care",   effectiveClassroom].join("|");

      revisedClassroom ? mapped++ : unmapped++;

      valueParts.push(
        `($${pi},$${pi+1},$${pi+2},$${pi+3},$${pi+4},$${pi+5},$${pi+6},$${pi+7}::text,$${pi+8},$${pi+9})`
      );
      params.push(
        c.center, c.rateSheet, c.dropOff, c.pickup, c.program, c.classroom,
        rateCardKey, revisedClassroom, earlyAMRateCardKey, latePMRateCardKey
      );
      pi += 10;
    }

    if (valueParts.length > 0) {
      params.push(latestBatch.id);
      await prisma.$executeRawUnsafe(
        `UPDATE "FC28Row" AS t
         SET "rateCardKey"        = v.rck,
             "revisedClassroom"   = v.rc,
             "earlyAMRateCardKey" = v.eam,
             "latePMRateCardKey"  = v.lpm
         FROM (VALUES ${valueParts.join(",")}) AS v(ctr,rs,doff,pup,prog,cls,rck,rc,eam,lpm)
         WHERE t."batchId" = $${pi}
           AND COALESCE(t.center,      '') = v.ctr
           AND COALESCE(t."rateSheet", '') = v.rs
           AND COALESCE(t."dropOff",   '') = v.doff
           AND COALESCE(t.pickup,      '') = v.pup
           AND COALESCE(t.program,     '') = v.prog
           AND COALESCE(t.classroom,   '') = v.cls`,
        ...params
      );
    }

    return NextResponse.json({
      combos: combos.length,
      mapped,
      unmapped,
      message: `${combos.length} combinations recomputed — ${mapped} classrooms mapped, ${unmapped} unmapped`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Recompute failed" }, { status: 500 });
  }
}
