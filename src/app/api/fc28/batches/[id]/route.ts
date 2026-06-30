import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

// DELETE /api/fc28/batches/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // FC28Row cascade-deletes via onDelete: Cascade in schema
    await db.fC28Batch.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Delete failed" }, { status: 500 });
  }
}
