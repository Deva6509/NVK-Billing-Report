"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import {
  Upload, CheckCircle2, XCircle, RefreshCw,
  Download, Lock, ChevronRight, FileSpreadsheet, Zap, Trash2,
  FolderOpen, Pencil, X, Check, AlertCircle, Database,
} from "lucide-react";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DropZone({
  onFiles,
  disabled,
  color,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  color: string;
}) {
  const [dragging, setDragging] = useState(false);

  const handle = useCallback(
    (files: File[]) => {
      if (disabled) return;
      const valid = files.filter(
        (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv")
      );
      if (valid.length) onFiles(valid);
    },
    [onFiles, disabled]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(Array.from(e.dataTransfer.files)); }}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
        disabled
          ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-50"
          : dragging
          ? "border-blue-500 bg-blue-50 cursor-copy"
          : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100 cursor-pointer"
      }`}
      onClick={() => {
        if (disabled) return;
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".xlsx,.xls,.csv";
        input.onchange = (e) => {
          handle(Array.from((e.target as HTMLInputElement).files ?? []));
        };
        input.click();
      }}
    >
      <Upload className="w-8 h-8 mx-auto mb-3" style={{ color: disabled ? "#d1d5db" : color }} />
      <p className="text-sm font-semibold text-gray-700">
        {disabled ? "Complete previous step first" : "Drop files here or click to browse"}
      </p>
      <p className="text-xs text-gray-400 mt-1">Accepts .xlsx · .xls · .csv — multiple files allowed</p>
    </div>
  );
}

// ── FC28 History Card ─────────────────────────────────────────────────────────

interface DbStats { totalInDb: number; syncedDates: string[]; }
interface SyncResult { filesProcessed: number; filesSkipped: number; rowsInserted: number; rowsSkipped: number; totalInDb: number; }

function FC28HistoryCard() {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [downloading,  setDownloading]  = useState(false);
  const [dlResult,     setDlResult]     = useState<{ rows: number } | null>(null);
  const [dlError,      setDlError]      = useState<string | null>(null);
  const [dbStats,      setDbStats]      = useState<DbStats | null>(null);
  const [syncing,      setSyncing]      = useState(false);
  const [syncResult,   setSyncResult]   = useState<SyncResult | null>(null);
  const [syncError,    setSyncError]    = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const res = await fetch("/api/fc28/sync");
      if (res.ok) setDbStats(await res.json());
    } catch {}
  };

  useEffect(() => { loadStats(); }, []);

  const addFiles = useCallback((incoming: File[]) => {
    setPendingFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
    });
    setSyncResult(null);
    setSyncError(null);
  }, []);

  const removeFile = (name: string) => setPendingFiles((prev) => prev.filter((f) => f.name !== name));

  const download = async () => {
    setDownloading(true);
    setDlError(null);
    setDlResult(null);
    try {
      const res = await fetch("/api/fc28/history");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      const rows = Number(res.headers.get("X-Row-Count") ?? 0);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `FC28_History_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setDlResult({ rows });
    } catch (e: any) {
      setDlError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  const syncToDb = async () => {
    if (pendingFiles.length === 0) return;
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      // Parse all FC28 files client-side to avoid Vercel's 4.5 MB upload limit
      const XLSX = await import("xlsx");

      let totalFilesProcessed = 0;
      let totalFilesSkipped   = 0;
      let totalRowsInserted   = 0;
      let totalRowsSkipped    = 0;
      let lastTotalInDb       = 0;

      for (const file of pendingFiles) {
        const buffer = await file.arrayBuffer();
        const wb     = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const ws     = wb.Sheets[wb.SheetNames[0]];
        const rows   = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];

        // Serialise Date objects to ISO strings so they survive JSON serialisation
        const serialised = rows.map((row) => {
          const out: Record<string, any> = {};
          for (const [k, v] of Object.entries(row)) {
            out[k] = v instanceof Date ? v.toISOString() : v;
          }
          return out;
        });

        const res  = await fetch("/api/fc28/sync", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ filename: file.name, rows: serialised }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        totalFilesProcessed += data.filesProcessed ?? 0;
        totalFilesSkipped   += data.filesSkipped   ?? 0;
        totalRowsInserted   += data.rowsInserted   ?? 0;
        totalRowsSkipped    += data.rowsSkipped     ?? 0;
        lastTotalInDb        = data.totalInDb       ?? lastTotalInDb;
      }

      setSyncResult({ filesProcessed: totalFilesProcessed, filesSkipped: totalFilesSkipped, rowsInserted: totalRowsInserted, rowsSkipped: totalRowsSkipped, totalInDb: lastTotalInDb });
      setPendingFiles([]);
      await loadStats();
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden border-teal-200">
      {/* Header */}
      <div className="px-6 py-4 flex items-center gap-4" style={{ background: "#f0fdfa" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow"
          style={{ background: "#0d9488" }}>
          <Database className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-800">FC28 History — Upload &amp; Sync to Database</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Upload weekly FC28 files. New dates are added to the database; already-synced dates are skipped automatically.
            Use <strong>Map FC28 to FIN14</strong> on the Review page to enrich FIN14 transactions with child master data.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* DB stats */}
        {dbStats && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="font-semibold text-gray-700">
              {dbStats.totalInDb.toLocaleString()} records in DB
            </span>
            {dbStats.syncedDates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {dbStats.syncedDates.map((d) => (
                  <span key={d} className="bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full font-medium">
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drop zone */}
        <DropZone onFiles={addFiles} disabled={syncing} color="#0d9488" />

        {/* Pending files list */}
        {pendingFiles.length > 0 && (
          <div className="space-y-1">
            {pendingFiles.map((f) => (
              <div key={f.name} className="flex items-center justify-between px-3 py-1.5 bg-teal-50 rounded-lg text-xs">
                <span className="font-medium text-teal-800 truncate">{f.name}</span>
                <button onClick={() => removeFile(f.name)} className="ml-2 text-teal-400 hover:text-teal-700 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload & Sync button */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={syncToDb}
            disabled={syncing || pendingFiles.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 hover:brightness-110"
            style={{ background: "#1d4ed8" }}
          >
            {syncing
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""}…</>
              : <><Database className="w-4 h-4" /> Upload &amp; Sync to Database {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ""}</>}
          </button>

          {syncResult && (
            <div className="text-xs text-green-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {syncResult.filesProcessed} file{syncResult.filesProcessed !== 1 ? "s" : ""} → {syncResult.rowsInserted.toLocaleString()} rows added
              {syncResult.filesSkipped > 0 && <span className="text-gray-400 ml-1">({syncResult.filesSkipped} already synced)</span>}
            </div>
          )}
          {syncError && (
            <span className="text-xs text-red-500 font-medium flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> {syncError}
            </span>
          )}
        </div>

        {/* Download consolidated history */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-3">
            <button
              onClick={download}
              disabled={downloading || !dbStats?.totalInDb}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 hover:brightness-110"
              style={{ background: "#0d9488" }}
            >
              {downloading
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
                : <><Download className="w-4 h-4" /> Download FC28 Consolidated History</>}
            </button>

            {dlResult && (
              <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {dlResult.rows.toLocaleString()} rows downloaded
              </span>
            )}
            {dlError && (
              <span className="text-xs text-red-500 font-medium flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> {dlError}
              </span>
            )}
          </div>
        </div>

        {/* FIN14 enrichment note */}
        <div className="bg-teal-50 border border-teal-100 rounded-lg px-4 py-2.5 flex items-start gap-2">
          <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-teal-700">
            <span className="font-semibold">After uploading FC28 files,</span> use <strong>Map FC28 to FIN14</strong> on the Review page to enrich FIN14 transactions with Billing Cycle, Child Status, Start Date, Withdrawal Date, Classroom, Family Status, and Date of Birth.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── FIN14 Steps ───────────────────────────────────────────────────────────────

function Step1({ onDone }: { onDone: (batchId: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
    });
    setState("idle");
    setRowCount(null);
    setMatchedCount(null);
    setUnmatchedCount(null);
    setBatchId(null);
    setErrorMsg(null);
    setLastBlob(null);
  }, []);

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
    setState("idle");
    setRowCount(null);
    setMatchedCount(null);
    setUnmatchedCount(null);
    setBatchId(null);
    setErrorMsg(null);
    setLastBlob(null);
  };

  const consolidate = async () => {
    if (files.length === 0) return;
    setState("processing");
    setErrorMsg(null);

    try {
      // Parse all Excel files in the browser to avoid Vercel's 4.5 MB upload limit
      const XLSX = await import("xlsx");
      let headerKeys: string[] = [];
      const allRows: Record<string, any>[] = [];

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
        if (rows.length === 0) continue;
        if (headerKeys.length === 0) headerKeys = Object.keys(rows[0]);
        for (const row of rows) {
          const isHeader = headerKeys.some((k) => row[k] !== null && String(row[k] ?? "").trim() === k.trim());
          const isEmpty  = headerKeys.every((k) => row[k] === null || String(row[k] ?? "").trim() === "");
          if (!isHeader && !isEmpty) allRows.push(row);
        }
      }

      if (allRows.length === 0) throw new Error("No data rows found in the uploaded files");

      // Send in 3000-row chunks to stay within Vercel's 4.5MB body limit
      const CHUNK = 3000;
      const chunks: Record<string, any>[][] = [];
      for (let i = 0; i < allRows.length; i += CHUNK) chunks.push(allRows.slice(i, i + CHUNK));

      let batchId = "";
      let finalRes: Response | null = null;

      for (let i = 0; i < chunks.length; i++) {
        const isFinal = i === chunks.length - 1;
        const res = await fetch("/api/upload/consolidate", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            rows:      chunks[i],
            fileCount: i === 0 ? files.length : 0,
            batchId:   batchId || undefined,
            isFinal,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Server error" }));
          throw new Error(err.message ?? "Server error");
        }
        if (isFinal) { finalRes = res; }
        else         { const d = await res.json(); batchId = d.batchId; }
      }

      const res      = finalRes!;
      const rows      = Number(res.headers.get("X-Row-Count") ?? 0);
      const matched   = Number(res.headers.get("X-Matched-Count") ?? 0);
      const unmatched = Number(res.headers.get("X-Unmatched-Count") ?? 0);
      const bid       = res.headers.get("X-Batch-Id") ?? null;
      const blob = await res.blob();
      setLastBlob(blob);
      setRowCount(rows);
      setMatchedCount(matched);
      setUnmatchedCount(unmatched);
      setBatchId(bid);
      setState("done");
      onDone(bid ?? "");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Something went wrong");
      setState("error");
    }
  };

  const download = () => {
    if (!lastBlob) return;
    const url = URL.createObjectURL(lastBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "FIN14_Consolidated.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden border-gray-200">
      <div className="px-6 py-4 flex items-center gap-4" style={{ background: "#00388710" }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow"
          style={{ background: state === "done" ? "#22c55e" : "#003887" }}
        >
          {state === "done" ? <CheckCircle2 className="w-5 h-5" /> : "1"}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-800">Step 1 — Upload FIN14 Transaction Files</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Add all center-wise FIN14 files. The app will stack them together, remove repeated headers and blank rows, then give you a single clean file to download.
          </p>
        </div>
        {state === "done" && rowCount !== null && (
          <Badge variant="success">{rowCount.toLocaleString()} rows</Badge>
        )}
      </div>

      <div className="p-6 space-y-4">
        <DropZone onFiles={addFiles} color="#003887" />

        {files.length > 0 && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {files.map((f) => (
              <div key={f.name} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                <FileSpreadsheet className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400">{formatBytes(f.size)}</p>
                </div>
                <button
                  onClick={() => removeFile(f.name)}
                  className="text-gray-300 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {state === "error" && errorMsg && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {errorMsg}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={consolidate}
            disabled={files.length === 0 || state === "processing"}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#003887" }}
          >
            {state === "processing" ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Consolidating {files.length} file{files.length !== 1 ? "s" : ""}...</>
            ) : (
              <><FileSpreadsheet className="w-4 h-4" /> {files.length > 0 ? `Consolidate ${files.length} File${files.length !== 1 ? "s" : ""}` : "Consolidate Files"}</>
            )}
          </button>

          {state === "done" && lastBlob && (
            <button
              onClick={download}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all"
              style={{ borderColor: "#003887", color: "#003887" }}
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          )}
        </div>

        {state === "done" && rowCount !== null && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                <p className="text-lg font-bold text-gray-800">{rowCount.toLocaleString()}</p>
                <p className="text-xs text-gray-500">Total Rows</p>
              </div>
              <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
                <p className="text-lg font-bold text-green-700">{(matchedCount ?? 0).toLocaleString()}</p>
                <p className="text-xs text-green-600">Auto-Matched</p>
              </div>
              <div className={`rounded-lg px-3 py-2 text-center ${(unmatchedCount ?? 0) > 0 ? "bg-amber-50" : "bg-green-50"}`}>
                <p className={`text-lg font-bold ${(unmatchedCount ?? 0) > 0 ? "text-amber-700" : "text-green-700"}`}>
                  {(unmatchedCount ?? 0).toLocaleString()}
                </p>
                <p className={`text-xs ${(unmatchedCount ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}>Unmatched</p>
              </div>
            </div>

            <Link
              href={`/upload/review${batchId ? `?batchId=${batchId}` : ""}`}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all"
              style={{ borderColor: (unmatchedCount ?? 0) > 0 ? "#f59e0b" : "#22c55e", color: (unmatchedCount ?? 0) > 0 ? "#d97706" : "#16a34a" }}
            >
              <FileSpreadsheet className="w-4 h-4" />
              {(unmatchedCount ?? 0) > 0
                ? `Review & Flag ${(unmatchedCount ?? 0).toLocaleString()} Unmatched Transactions`
                : "Review All Transactions"}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Step2({ locked }: { locked: boolean }) {
  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-all ${locked ? "border-gray-200 opacity-60" : "border-gray-200"}`}>
      <div className="px-6 py-4 flex items-center gap-4" style={{ background: locked ? "#f9fafb" : "#8b5cf608" }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow"
          style={{ background: locked ? "#d1d5db" : "#8b5cf6" }}
        >
          {locked ? <Lock className="w-5 h-5" /> : "2"}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-800">Step 2 — Upload FIN02 Rate Master Files</h3>
          <p className="text-xs text-gray-500 mt-0.5">Upload FIN02 rate master files. The app will consolidate and clean the data.</p>
        </div>
        {locked && <Badge variant="gray">Complete Step 1 first</Badge>}
      </div>
      {!locked && (
        <div className="p-6">
          <DropZone onFiles={() => {}} color="#8b5cf6" />
          <p className="text-xs text-gray-400 text-center mt-3">FIN02 processing coming soon</p>
        </div>
      )}
    </div>
  );
}

function Step3({ locked }: { locked: boolean }) {
  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-all ${locked ? "border-gray-200 opacity-60" : "border-gray-200"}`}>
      <div className="px-6 py-4 flex items-center gap-4" style={{ background: locked ? "#f9fafb" : "#fef9f0" }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow"
          style={{ background: locked ? "#d1d5db" : "#f59e0b" }}
        >
          {locked ? <Lock className="w-5 h-5" /> : "3"}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-800">Step 3 — Process Transactions</h3>
          <p className="text-xs text-gray-500 mt-0.5">Run the billing processing engine against the uploaded FIN14 data.</p>
        </div>
        {locked && <Badge variant="gray">Complete previous steps first</Badge>}
      </div>
      {!locked && (
        <div className="p-6">
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-amber-50 border-2 border-amber-300 text-amber-700 opacity-70 cursor-not-allowed"
          >
            <Zap className="w-4 h-4" />
            Processing Logic — Coming Soon
          </button>
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  const [step1Done, setStep1Done] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header title="File Upload Center" user={{ name: "Admin", email: "admin@asaind.co.in", role: "SUPER_ADMIN" }} />

      <div className="p-6 max-w-3xl mx-auto w-full space-y-5">

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Upload Progress</p>
          <div className="flex items-center gap-2">
            {[
              { label: "FIN14 Transactions", done: step1Done },
              { label: "FIN02 Rate Master",  done: false },
              { label: "Process Data",        done: false },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold flex-1 justify-center ${
                  s.done ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500"
                }`}>
                  {s.done && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {s.label}
                </div>
                {i < 2 && <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        {/* FC28 History — inline card */}
        <FC28HistoryCard />

        <Step1 onDone={(bid) => { setStep1Done(true); }} />
        <Step2 locked={!step1Done} />
        <Step3 locked={true} />

      </div>
    </div>
  );
}
