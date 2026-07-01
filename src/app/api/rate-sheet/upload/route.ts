import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const db = prisma as any;

// Fixed columns to keep as-is (lowercase for matching)
const FIXED_KEYS = new Set([
  "center", "entity", "version name", "created", "modified",
  "active", "drop off", "pick up", "program",
]);

// Map lowercase column name → DB field
const FIXED_MAP: Record<string, string> = {
  "center":       "center",
  "entity":       "entity",
  "version name": "versionName",
  "created":      "created",
  "modified":     "modified",
  "active":       "active",
  "drop off":     "dropOff",
  "pick up":      "pickUp",
  "program":      "program",
};

function str(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "N/A" ? null : s;
}

// Convert "6:30 AM" / "3:00 PM" → "06:30:00" / "15:00:00" for key matching
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

// POST /api/rate-sheet/upload
// Body: { files: [{ name, rows[] }] }
// Always replaces all existing Rate Sheet data.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { files: { name: string; rows: Record<string, any>[] }[] };
    const { files } = body;
    if (!files?.length) return NextResponse.json({ error: "No files provided" }, { status: 400 });

    // Clear existing data (cascade deletes rows)
    await db.rateSheetBatch.deleteMany({});

    // Create new batch
    const batch = await db.rateSheetBatch.create({
      data: { fileCount: files.length, rowCount: 0 },
    });

    const dbRows: any[] = [];

    for (const file of files) {
      if (!file.rows?.length) continue;

      for (const row of file.rows) {
        // Build a lowercase-keyed map of this row
        const lcRow: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          lcRow[k.trim().toLowerCase()] = v;
        }

        // Skip rows where Active = "No"
        const activeVal = str(lcRow["active"]);
        if (activeVal?.toLowerCase() === "no") continue;

        // Extract fixed columns
        const fixed = {
          batchId:     batch.id,
          sourceFile:  file.name,
          center:      str(lcRow["center"]),
          entity:      str(lcRow["entity"]),
          versionName: str(lcRow["version name"]),
          created:     str(lcRow["created"]),
          modified:    str(lcRow["modified"]),
          active:      activeVal,
          dropOff:     str(lcRow["drop off"]),
          pickUp:      str(lcRow["pick up"]),
          program:     str(lcRow["program"]),
        };

        // Unpivot all non-fixed columns
        const centerShort = (fixed.center ?? "").split(",")[0].trim();
        for (const [k, v] of Object.entries(row)) {
          if (FIXED_KEYS.has(k.trim().toLowerCase())) continue;
          const val      = str(v);
          if (val === null) continue; // skip empty pivot values
          const itemName = k.trim();
          const rateCardKey        = [centerShort, fixed.versionName ?? "", to24h(fixed.dropOff), to24h(fixed.pickUp), fixed.program ?? "", itemName].join("|");
          const earlyAMRateCardKey = [centerShort, fixed.versionName ?? "", "Early AM Care", itemName].join("|");
          const latePMRateCardKey  = [centerShort, fixed.versionName ?? "", "Late PM Care",  itemName].join("|");
          dbRows.push({ ...fixed, itemName, itemValue: val, rateCardKey, earlyAMRateCardKey, latePMRateCardKey });
        }
      }
    }

    if (dbRows.length) {
      await db.rateSheetRow.createMany({ data: dbRows });
    }

    // Update batch stats
    await db.rateSheetBatch.update({
      where: { id: batch.id },
      data:  { rowCount: dbRows.length },
    });

    return NextResponse.json({ batchId: batch.id, rowCount: dbRows.length, fileCount: files.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}
