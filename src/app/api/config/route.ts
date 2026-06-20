import { NextResponse } from "next/server";

// Config route — folder path configuration is no longer used in cloud deployment.
// FC28 files are uploaded directly via the Upload page.
export async function GET() {
  return NextResponse.json({ fc28HistoryPath: "" });
}

export async function PATCH() {
  return NextResponse.json({ fc28HistoryPath: "" });
}

export async function POST() {
  return NextResponse.json({ valid: false, error: "Folder paths are not supported in cloud mode. Upload files directly." });
}
