"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import { Upload, Download, RefreshCw, FileSpreadsheet, FileText, CheckCircle2, AlertCircle } from "lucide-react";

function DropZone({ onFiles, disabled }: { onFiles: (f: File[]) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const handle = (files: File[]) => {
    if (disabled) return;
    const v = files.filter(f => f.name.endsWith(".xlsx") || f.name.endsWith(".xls"));
    if (v.length) onFiles(v);
  };
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handle(Array.from(e.dataTransfer.files)); }}
      onClick={() => {
        if (disabled) return;
        const i = document.createElement("input");
        i.type = "file"; i.multiple = true; i.accept = ".xlsx,.xls";
        i.onchange = () => { if (i.files) handle(Array.from(i.files)); };
        i.click();
      }}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
        disabled ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
        : dragging ? "border-amber-500 bg-amber-50"
        : "border-amber-300 bg-amber-50/40 hover:border-amber-500 hover:bg-amber-50"
      }`}
    >
      <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-amber-400" />
      <p className="text-sm font-semibold text-slate-700">Drop center-wise Rate Sheet files here</p>
      <p className="text-xs text-slate-500 mt-1">Multiple .xlsx files — one per center</p>
    </div>
  );
}

export default function RateSheetPage() {
  const [files,       setFiles]       = useState<File[]>([]);
  const [uploading,   setUploading]   = useState(false);
  const [uploadLog,   setUploadLog]   = useState<string[]>([]);
  const [uploadDone,  setUploadDone]  = useState(false);
  const [current,     setCurrent]     = useState<any>(null);
  const [downloading, setDownloading] = useState(false);

  const loadCurrent = useCallback(async () => {
    const res = await fetch("/api/rate-sheet/current");
    const j   = await res.json();
    setCurrent(j.batch ?? null);
  }, []);

  useEffect(() => { loadCurrent(); }, []);

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    setUploadLog([`Processing ${files.length} file(s)…`]);
    setUploadDone(false);

    try {
      const allFiles: { name: string; rows: Record<string, any>[] }[] = [];

      for (const file of files) {
        setUploadLog(prev => [...prev, `Parsing ${file.name}…`]);
        const xlsxMod = await import("xlsx");
        const XLSX = (xlsxMod as any).default ?? xlsxMod;
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array", raw: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
        setUploadLog(prev => [...prev, `  ${rows.length.toLocaleString()} rows read`]);
        allFiles.push({ name: file.name, rows });
      }

      setUploadLog(prev => [...prev, `Uploading & processing…`]);
      const res = await fetch("/api/rate-sheet/upload", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ files: allFiles }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Upload failed");
      }

      const j = await res.json();
      setUploadLog(prev => [
        ...prev, ``,
        `✅ Done — ${j.rowCount.toLocaleString()} unpivoted rows from ${j.fileCount} files`,
        `   (Active=No rows filtered out)`,
      ]);
      setUploadDone(true);
      setFiles([]);
      await loadCurrent();
    } catch (err: any) {
      setUploadLog(prev => [...prev, `✗ ${err.message}`]);
    } finally {
      setUploading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/rate-sheet/download");
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Download failed"); }
      const blob    = await res.blob();
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement("a");
      const dateStr = current ? new Date(current.uploadedAt).toISOString().slice(0, 10) : "export";
      a.href = url; a.download = `RateSheet_${dateStr}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { alert(err.message); }
    finally { setDownloading(false); }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header />
      <main className="flex-1 p-6 space-y-6 max-w-4xl mx-auto w-full">

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <FileText className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Rate Sheet Master</h1>
            <p className="text-sm text-slate-500">Upload center-wise rate sheets — fixed columns kept, all others unpivoted to rows</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-bold">Uploading replaces all existing rate sheet data.</span>{" "}
            Always upload all center files together in one batch.
          </p>
        </div>

        {/* Process info */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">How it works</p>
          <div className="flex flex-wrap gap-3 text-sm text-slate-700">
            {[
              "1. Keep: Center, Entity, Version Name, Created, Modified, Active, Drop Off, Pick Up, Program",
              "2. Unpivot all other columns → Item Name / Item Value rows",
              "3. Remove rows where Active = No",
              "4. Merge all center files into one table",
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2 w-full">
                <CheckCircle2 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Current data status */}
        {current && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Current Data</p>
              <p className="text-sm text-slate-800">
                <span className="font-bold">{current.rowCount.toLocaleString()}</span> rows ·{" "}
                <span className="font-bold">{current.fileCount}</span> center files ·{" "}
                uploaded {new Date(current.uploadedAt).toLocaleString("en-IN")}
              </p>
            </div>
            <button
              onClick={download}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold disabled:opacity-50 hover:bg-teal-800 transition-colors"
            >
              {downloading ? <><RefreshCw className="w-4 h-4 animate-spin" />Generating…</> : <><Download className="w-4 h-4" />Download Excel</>}
            </button>
          </div>
        )}

        {/* Upload */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Upload className="w-4 h-4 text-amber-600" /> Upload Rate Sheet Files
          </h2>
          <DropZone onFiles={f => setFiles(prev => [...prev, ...f])} disabled={uploading} />

          {files.length > 0 && (
            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-slate-700 font-medium">{f.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                    {!uploading && (
                      <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-3 items-center">
            <button
              onClick={upload}
              disabled={uploading || !files.length}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-amber-700 transition-colors"
            >
              {uploading
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Processing…</>
                : <><Upload className="w-4 h-4" />Upload {files.length > 0 ? `${files.length} File${files.length > 1 ? "s" : ""}` : "Files"}</>
              }
            </button>
            {files.length > 0 && !uploading && (
              <button onClick={() => { setFiles([]); setUploadLog([]); }} className="text-sm text-slate-500 hover:text-red-500">Clear</button>
            )}
          </div>

          {uploadLog.length > 0 && (
            <div className="mt-4 bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-300 space-y-0.5 max-h-48 overflow-y-auto">
              {uploadLog.map((l, i) => <div key={i}>{l || <br />}</div>)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
