import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

// GET /api/fc28/latest — returns latest FC28 record per Child ID as JSON (reads from DB)
export async function GET() {
  try {
    const records = await db.fC28Record.findMany({
      orderBy:  { reportDate: "desc" },
      distinct: ["childId"],
    });

    const data: Record<string, any> = {};
    for (const r of records) {
      const withdrawalDate =
        r.childStatus && r.childStatus.toLowerCase() !== "active"
          ? r.reportDate.toISOString().slice(0, 10)
          : "";

      data[r.childId] = {
        startDate:      r.startDate      ?? "",
        dob:            r.dateOfBirth    ?? "",
        withdrawalDate,
        billingCycle:   r.billingCycle   ?? "",
        childStatus:    r.childStatus    ?? "",
        reportDate:     r.reportDate.toISOString().slice(0, 10),
      };
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
