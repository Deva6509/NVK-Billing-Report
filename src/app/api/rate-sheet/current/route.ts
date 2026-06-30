import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

// GET /api/rate-sheet/current — returns the latest batch info
export async function GET() {
  try {
    const batch = await db.rateSheetBatch.findFirst({
      orderBy: { uploadedAt: "desc" },
    });
    return NextResponse.json({ batch: batch ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
