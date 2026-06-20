import { NextResponse } from "next/server";

// Billing export via local filesystem is no longer supported in cloud deployment.
// Use /api/fin14/final-report to generate and download the pivot report.
export async function GET() {
  return NextResponse.json(
    { error: "Use the Generate Final Report button on the Review page to download the report." },
    { status: 410 }
  );
}
