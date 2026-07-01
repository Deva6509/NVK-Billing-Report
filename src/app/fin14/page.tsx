"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2, XCircle, RefreshCw, Search, Filter,
  Save, ChevronLeft, ChevronRight, Pencil, X, Download,
  GitMerge, FileBarChart2, Upload, FileSpreadsheet, Trash2,
} from "lucide-react";

const MAJOR_HEADS = ["Adjustments", "Billing", "Payment"];
const SUB_HEADS: Record<string, string[]> = {
  Adjustments: ["Adjustments", "Discount"],
  Billing:     ["Regular", "Agency", "Early/Late", "One Time", "Other"],
  Payment:     ["Agency"],
};

interface Fin14Row {
  id: number;
  batchId: string;
  rawData: Record<string, any>;
  itemText: string | null;
  majorHead: string | null;
  subHead: string | null;
  entryBy: string | null;
  isMatched: boolean;
}
interface PageData { total: number; page: number; pageSize: number; rows: Fin14Row[] }

function StatusPill({ isMatched, entryBy }: { isMatched: boolean; entryBy: string | null }) {
  if (!isMatched)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap"><XCircle className="w-3 h-3" />Unmatched</span>;
  if (entryBy === "System")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 whitespace-nowrap"><CheckCircle2 className="w-3 h-3" />System</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 whitespace-nowrap"><CheckCircle2 className="w-3 h-3" />Manual</span>;
}

// ── Assign Modal ──────────────────────────────────────────────────────────────
function AssignModal({ row, onClose, onSaved }: { row: Fin14Row; onClose: () => void; onSaved: () => void }) {
  const [majorHead, setMajorHead] = useState(row.majorHead ?? "Billing");
  const [subHead,   setSubHead]   = useState(row.subHead   ?? "Regular");
  const [addToMaster, setAddToMaster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const r1 = await fetch("/api/fin14", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [row.id], majorHead, subHead, entryBy: "Manual" }),
      });
      if (!r1.ok) throw new Error("Failed to update");
      if (addToMaster && row.itemText) {
        await fetch("/api/item-master", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: row.itemText, majorHead, subHead }),
        });
      }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-sm">Assign Category</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {row.itemText && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 break-words">
              {row.itemText}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Major Head</label>
            <select value={majorHead} onChange={(e) => { setMajorHead(e.target.value); setSubHead(SUB_HEADS[e.target.value][0]); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {MAJOR_HEADS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Sub Head</label>
            <select value={subHead} onChange={(e) => setSubHead(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {(SUB_HEADS[majorHead] ?? []).map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {row.itemText && (
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={addToMaster} onChange={(e) => setAddToMaster(e.target.checked)} className="rounded" />
              Also add "{row.itemText}" to Item Master
            </label>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-5 pb-4 flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#003887" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [files,   setFiles]   = useState<File[]>([]);
  const [state,   setState]   = useState<"idle" | "processing" | "done" | "error">("idle");
  const [msg,     setMsg]     = useState("");
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter((f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv"));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
    setState("idle");
  }, []);

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const openPicker = () => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true; input.accept = ".xlsx,.xls,.csv";
    input.onchange = (e) => addFiles(Array.from((e.target as HTMLInputElement).files ?? []));
    input.click();
  };

  const upload = async () => {
    if (!files.length) return;
    setState("processing");
    setMsg("Parsing files…");
    try {
      const XLSX = await import("xlsx");
      let headerKeys: string[] = [];
      const allRows: Record<string, any>[] = [];

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
        if (!rows.length) continue;
        if (!headerKeys.length) headerKeys = Object.keys(rows[0]);
        for (const row of rows) {
          const isHeader = headerKeys.some((k) => row[k] !== null && String(row[k] ?? "").trim() === k.trim());
          const isEmpty  = headerKeys.every((k) => row[k] === null || String(row[k] ?? "").trim() === "");
          if (!isHeader && !isEmpty) {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
            allRows.push(out);
          }
        }
      }

      if (!allRows.length) throw new Error("No data rows found in the uploaded files");

      // Step 1: delete all existing FIN14 data
      setMsg("Clearing previous FIN14 data…");
      const delRes = await fetch("/api/fin14", { method: "DELETE" });
      if (!delRes.ok) throw new Error("Failed to clear existing data");

      // Step 2: upload in 3000-row chunks
      setMsg(`Uploading ${allRows.length.toLocaleString()} rows…`);
      const CHUNK = 3000;
      let batchId = "";
      for (let i = 0; i < allRows.length; i += CHUNK) {
        const chunk   = allRows.slice(i, i + CHUNK);
        const isFinal = i + CHUNK >= allRows.length;
        const res = await fetch("/api/upload/consolidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, fileCount: i === 0 ? files.length : 0, batchId: batchId || undefined, isFinal }),
        });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? "Upload failed"); }
        const d = await res.json();
        if (!batchId) batchId = d.batchId;
        if (isFinal) setMsg(`Done — ${(d.rowCount ?? allRows.length).toLocaleString()} rows saved`);
      }

      setState("done");
    } catch (e: any) {
      setState("error");
      setMsg(e.message ?? "Upload failed");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800">Upload FIN14 Transactions</h2>
            <p className="text-xs text-gray-400 mt-0.5">Previous data will be replaced on upload</p>
          </div>
          <button onClick={onClose} disabled={state === "processing"} className="text-gray-400 hover:text-gray-600 disabled:opacity-30">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); if (state !== "processing") setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => state !== "processing" && openPicker()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              state === "processing" ? "opacity-40 cursor-not-allowed" :
              dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
            }`}
          >
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm font-semibold text-gray-700">Drop files here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Accepts .xlsx · .xls · .csv — multiple files allowed</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {files.map((f) => (
                <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg text-xs">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  <span className="flex-1 font-medium text-blue-800 truncate">{f.name}</span>
                  <button onClick={() => removeFile(f.name)} disabled={state === "processing"} className="text-blue-300 hover:text-blue-600 disabled:opacity-30">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Status message */}
          {msg && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              state === "error" ? "bg-red-50 text-red-600 border border-red-100" :
              state === "done"  ? "bg-green-50 text-green-700 border border-green-100" :
                                  "bg-blue-50 text-blue-700 border border-blue-100"
            }`}>
              {state === "processing" && <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
              {state === "done"  && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
              {state === "error" && <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
              {msg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-2">
          {state === "done" ? (
            <button onClick={() => { onDone(); onClose(); }} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: "#003887" }}>
              View Transactions
            </button>
          ) : (
            <>
              <button onClick={onClose} disabled={state === "processing"} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">
                Cancel
              </button>
              <button
                onClick={upload}
                disabled={!files.length || state === "processing"}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all"
                style={{ background: "#003887" }}
              >
                {state === "processing"
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Processing…</>
                  : <><Upload className="w-4 h-4" />Consolidate &amp; Upload</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Fin14Page() {
  const [filterMatched, setFilterMatched] = useState<"all"|"matched"|"unmatched">("all");
  const [filterMajor,   setFilterMajor]   = useState("");
  const [filterSub,     setFilterSub]     = useState("");
  const [itemSearch,    setItemSearch]     = useState("");
  const [page,          setPage]           = useState(1);
  const pageSize = 100;

  const [data,     setData]     = useState<PageData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [bulkMajor,      setBulkMajor]      = useState("Billing");
  const [bulkSub,        setBulkSub]        = useState("Regular");
  const [bulkSaving,     setBulkSaving]     = useState(false);
  const [flagAllSaving,  setFlagAllSaving]  = useState(false);
  const [flagAllConfirm, setFlagAllConfirm] = useState(false);

  const [assignRow,  setAssignRow]  = useState<Fin14Row | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [downloading,  setDownloading]  = useState(false);

  // Map FC28
  const [mapping,     setMapping]     = useState(false);
  const [mapResult,   setMapResult]   = useState<string | null>(null);
  const [mapProgress, setMapProgress] = useState<{
    phase: string; done: number; total: number; mapped: number; unmapped: number; pct: number; message?: string;
  } | null>(null);

  // Final Report
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterMatched === "matched")   p.set("isMatched",  "true");
      if (filterMatched === "unmatched") p.set("isMatched",  "false");
      if (filterMajor)                   p.set("majorHead",  filterMajor);
      if (filterSub)                     p.set("subHead",    filterSub);
      if (itemSearch)                    p.set("itemSearch", itemSearch);
      p.set("page",     String(page));
      p.set("pageSize", String(pageSize));
      const res  = await fetch(`/api/fin14?${p}`);
      const json = await res.json();
      setData(json);
      setSelected(new Set());
    } finally { setLoading(false); }
  }, [filterMatched, filterMajor, filterSub, itemSearch, page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

  const toggleSelect = (id: number) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll    = () => {
    if (!data) return;
    setSelected(selected.size === data.rows.length ? new Set() : new Set(data.rows.map((r) => r.id)));
  };

  const bulkAssign = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    try {
      await fetch("/api/fin14", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), majorHead: bulkMajor, subHead: bulkSub, entryBy: "Manual" }),
      });
      await load();
    } finally { setBulkSaving(false); }
  };

  const flagAll = async () => {
    setFlagAllSaving(true); setFlagAllConfirm(false);
    try {
      await fetch("/api/fin14", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagAll: true, filters: {
          ...(filterMatched === "matched"   ? { isMatched: "true" }  : {}),
          ...(filterMatched === "unmatched" ? { isMatched: "false" } : {}),
          ...(filterMajor   ? { majorHead: filterMajor }  : {}),
          ...(filterSub     ? { subHead:   filterSub }    : {}),
          ...(itemSearch    ? { itemSearch }               : {}),
        }, majorHead: bulkMajor, subHead: bulkSub, entryBy: "Manual" }),
      });
      if (itemSearch.trim()) {
        await fetch("/api/item-master", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: itemSearch.trim(), majorHead: bulkMajor, subHead: bulkSub, entryBy: "Manual" }),
        });
      }
      await load();
    } finally { setFlagAllSaving(false); }
  };

  const exportExcel = async () => {
    setDownloading(true);
    try {
      const p = new URLSearchParams();
      if (filterMatched === "matched")   p.set("isMatched",  "true");
      if (filterMatched === "unmatched") p.set("isMatched",  "false");
      if (filterMajor)                   p.set("majorHead",  filterMajor);
      if (filterSub)                     p.set("subHead",    filterSub);
      if (itemSearch)                    p.set("itemSearch", itemSearch);
      const res = await fetch(`/api/fin14/export?${p}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a"); a.href = url;
      a.download = `FIN14_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { alert(e.message); }
    finally { setDownloading(false); }
  };

  const mapFC28 = async () => {
    setMapping(true); setMapResult(null); setMapProgress(null);
    try {
      const res = await fetch("/api/fin14/map-fc28", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.phase === "complete") {
              setMapResult(`✓ ${ev.mapped} mapped, ${ev.unmapped} not in FC28`);
              setMapProgress({ ...ev, done: ev.total, pct: 100 });
              await load();
            } else if (ev.phase === "error") {
              setMapResult(`Error: ${ev.message}`);
            } else {
              setMapProgress(ev);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setMapResult(`Error: ${e.message}`);
    } finally {
      setMapping(false);
    }
  };

  const generateFinalReport = async () => {
    setReporting(true);
    try {
      const res = await fetch("/api/fin14/final-report");
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Report failed"); }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a"); a.href = url;
      a.download = `FIN14_Final_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { alert(`Report failed: ${e.message}`); }
    finally { setReporting(false); }
  };

  const rawCols: string[] = data?.rows.length
    ? Array.from(new Set(data.rows.flatMap((r) => Object.keys(r.rawData))))
    : [];

  function computeEntryBy(itemText: string | null, subHead: string | null): string {
    if (subHead === "Adjustments" && itemText) {
      const t = itemText.toUpperCase();
      if (t.includes("ASA ") || t.includes("ASA_") || t.includes("ASA-")) return "ASA";
    }
    return "CENTER";
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">FIN14 Transactions</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {data ? <><span className="font-semibold text-gray-600">{data.total.toLocaleString()}</span> rows in database</> : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm hover:brightness-110 transition-all"
          style={{ background: "#003887" }}
        >
          <Upload className="w-4 h-4" /> Upload FIN14
        </button>
      </div>

      <div className="p-4 space-y-3 w-full">

        {/* Filter bar */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={itemSearch}
              onChange={(e) => { setItemSearch(e.target.value); setPage(1); }}
              placeholder="Search item text…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-52" />
          </div>

          <select value={filterMatched} onChange={(e) => { setFilterMatched(e.target.value as any); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
            <option value="all">All Statuses</option>
            <option value="matched">Matched Only</option>
            <option value="unmatched">Unmatched Only</option>
          </select>

          <select value={filterMajor} onChange={(e) => { setFilterMajor(e.target.value); setFilterSub(""); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
            <option value="">All Major Heads</option>
            {MAJOR_HEADS.map((m) => <option key={m}>{m}</option>)}
          </select>

          <select value={filterSub} onChange={(e) => { setFilterSub(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
            <option value="">All Sub Heads</option>
            {(filterMajor ? SUB_HEADS[filterMajor] ?? [] : [...new Set(Object.values(SUB_HEADS).flat())]).map((s) => <option key={s}>{s}</option>)}
          </select>

          <button onClick={() => { setFilterMatched("all"); setFilterMajor(""); setFilterSub(""); setItemSearch(""); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600">
            Clear filters
          </button>

          <div className="ml-auto flex items-center gap-2 text-sm text-gray-500 flex-wrap">
            {data && (
              <>
                <span className="font-semibold text-gray-700">{data.total.toLocaleString()}</span> rows
                {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </>
            )}

            <button
              onClick={mapFC28}
              disabled={mapping || !data?.total}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 transition-colors"
            >
              <GitMerge className="w-3.5 h-3.5" />Map FC28 to FIN14
            </button>

            <button
              onClick={generateFinalReport}
              disabled={reporting || !data?.total}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 transition-colors"
            >
              {reporting
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating…</>
                : <><FileBarChart2 className="w-3.5 h-3.5" />Final Report</>}
            </button>
          </div>

          {/* FC28 mapping progress */}
          {(mapping || mapResult) && (
            <div className="w-full mt-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-purple-800">
                <span className="flex items-center gap-1.5">
                  {mapping
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-500" /> Mapping FC28 → FIN14…</>
                    : mapResult?.startsWith("✓")
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Mapping complete</>
                      : <><XCircle className="w-3.5 h-3.5 text-red-500" /> {mapResult}</>}
                </span>
                {mapProgress && mapProgress.total > 0 && (
                  <span className="text-purple-600 font-mono">
                    {mapProgress.done.toLocaleString()} / {mapProgress.total.toLocaleString()} · {mapProgress.pct}%
                  </span>
                )}
              </div>
              {mapProgress && mapProgress.total > 0 && (
                <div className="w-full bg-purple-200 rounded-full h-2 overflow-hidden">
                  <div className="h-2 rounded-full transition-all duration-150"
                    style={{ width: `${mapProgress.pct}%`, background: mapProgress.phase === "complete" ? "#22c55e" : "#7c3aed" }} />
                </div>
              )}
              {mapProgress && mapProgress.total > 0 && (
                <div className="flex items-center gap-4 text-xs text-purple-700">
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /><span className="font-semibold text-green-700">{mapProgress.mapped.toLocaleString()}</span> matched</span>
                  <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-gray-400" /><span className="font-semibold text-gray-500">{mapProgress.unmapped.toLocaleString()}</span> not in FC28</span>
                  {mapResult && mapProgress.phase === "complete" && (
                    <button onClick={() => { setMapResult(null); setMapProgress(null); }} className="ml-auto text-purple-400 hover:text-purple-600 text-xs">Dismiss</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bulk action bar */}
        {(selected.size > 0 || data) && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
            {selected.size > 0 && (
              <span className="text-sm font-semibold text-blue-700">{selected.size} selected</span>
            )}
            <select value={bulkMajor} onChange={(e) => { setBulkMajor(e.target.value); setBulkSub(SUB_HEADS[e.target.value][0]); }}
              className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white">
              {MAJOR_HEADS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <select value={bulkSub} onChange={(e) => setBulkSub(e.target.value)}
              className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white">
              {(SUB_HEADS[bulkMajor] ?? []).map((s) => <option key={s}>{s}</option>)}
            </select>

            {selected.size > 0 && (
              <button onClick={bulkAssign} disabled={bulkSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#003887" }}>
                <Save className="w-3.5 h-3.5" />{bulkSaving ? "Saving…" : `Apply to ${selected.size} Selected`}
              </button>
            )}

            {!flagAllConfirm ? (
              <button onClick={() => setFlagAllConfirm(true)} disabled={flagAllSaving || !data?.total}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold border-2 border-orange-400 text-orange-600 bg-white hover:bg-orange-50 disabled:opacity-40 transition-colors">
                {flagAllSaving
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Flagging…</>
                  : <><Save className="w-3.5 h-3.5" />Flag All {data?.total ? `${data.total.toLocaleString()} Matching` : "Matching"}</>}
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-lg px-3 py-1.5">
                <span className="text-xs font-semibold text-orange-700">Flag all {data?.total.toLocaleString()} rows as {bulkMajor} / {bulkSub}?</span>
                <button onClick={flagAll} className="px-3 py-1 text-xs font-bold bg-orange-500 text-white rounded-lg hover:bg-orange-600">Yes, flag all</button>
                <button onClick={() => setFlagAllConfirm(false)} className="px-2 py-1 text-xs text-orange-500 hover:text-orange-700">Cancel</button>
              </div>
            )}

            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-blue-400 hover:text-blue-600 ml-auto">Deselect all</button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {(!data || data.total === 0) && !loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
              <FileSpreadsheet className="w-12 h-12 opacity-30" />
              <p className="text-sm font-medium">No FIN14 data yet</p>
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: "#003887" }}
              >
                <Upload className="w-4 h-4" /> Upload FIN14 Files
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: "auto", width: "max-content", minWidth: "100%" }}>
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th style={{ position: "sticky", left: 0, width: 36, minWidth: 36, background: "#f3f4f6", zIndex: 20 }} className="px-2 py-2.5 text-left">
                        <input type="checkbox" checked={!!data && selected.size === data.rows.length && data.rows.length > 0} onChange={selectAll} className="rounded" />
                      </th>
                      <th style={{ position: "sticky", left: 36, minWidth: 110, background: "#f3f4f6", zIndex: 20, boxShadow: "2px 0 6px -2px rgba(0,0,0,0.12)" }} className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">
                        Status
                      </th>
                      {rawCols.map((c) => (
                        <th key={c} className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">{c}</th>
                      ))}
                      <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50 border-l-2 border-blue-200">Major Head</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Sub Head</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Entry By</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Matched By</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data?.rows.map((row) => {
                      const entryBy  = computeEntryBy(row.itemText, row.majorHead ? row.subHead : null);
                      const stickyBg = selected.has(row.id) ? "#dbeafe" : !row.isMatched ? "#fffbeb" : "#ffffff";
                      return (
                        <tr key={row.id} className={`${selected.has(row.id) ? "bg-blue-100" : row.isMatched ? "hover:bg-gray-50" : "bg-amber-50 hover:bg-amber-100"}`}>
                          <td style={{ position: "sticky", left: 0, width: 36, minWidth: 36, background: stickyBg, zIndex: 10 }} className="px-2 py-2">
                            <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} className="rounded" />
                          </td>
                          <td style={{ position: "sticky", left: 36, minWidth: 110, background: stickyBg, zIndex: 10, boxShadow: "2px 0 6px -2px rgba(0,0,0,0.12)" }} className="px-3 py-2">
                            <StatusPill isMatched={row.isMatched} entryBy={row.entryBy} />
                          </td>
                          {rawCols.map((c) => (
                            <td key={c} className="px-3 py-2 text-gray-700">
                              {row.rawData[c] === null || row.rawData[c] === undefined || String(row.rawData[c]).trim() === ""
                                ? <span className="text-gray-300">—</span>
                                : String(row.rawData[c])}
                            </td>
                          ))}
                          <td className="px-3 py-2 bg-blue-50/40 border-l-2 border-blue-200 font-semibold text-gray-700">
                            {row.majorHead
                              ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${row.majorHead === "Billing" ? "bg-blue-100 text-blue-700" : row.majorHead === "Adjustments" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>{row.majorHead}</span>
                              : <span className="text-amber-400 italic text-[11px]">—</span>}
                          </td>
                          <td className="px-3 py-2 bg-blue-50/40 text-gray-600 text-[11px]">{row.subHead ?? <span className="text-amber-400 italic">—</span>}</td>
                          <td className="px-3 py-2 bg-blue-50/40">
                            {row.isMatched
                              ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${entryBy === "ASA" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>{entryBy}</span>
                              : <span className="text-gray-300 text-[11px]">—</span>}
                          </td>
                          <td className="px-3 py-2 bg-blue-50/40 text-gray-500 text-[11px]">{row.entryBy ?? <span className="text-gray-300">—</span>}</td>
                          <td className="px-3 py-2 bg-blue-50/40">
                            <button onClick={() => setAssignRow(row)}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${row.isMatched ? "border border-gray-200 text-gray-500 hover:bg-gray-100" : "bg-amber-500 text-white hover:bg-amber-600"}`}>
                              <Pencil className="w-3 h-3" />{row.isMatched ? "Edit" : "Assign"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && data?.rows.length === 0 && (
                      <tr>
                        <td colSpan={rawCols.length + 6} className="px-4 py-10 text-center text-sm text-gray-400">
                          No transactions match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>{data ? `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, data.total).toLocaleString()} of ${data.total.toLocaleString()}` : "—"}</span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">«</button>
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">‹</button>
                  <span className="px-3 py-1 rounded bg-gray-100 font-semibold text-gray-700">{page} / {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">›</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">»</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {assignRow && (
        <AssignModal row={assignRow} onClose={() => setAssignRow(null)} onSaved={() => { setAssignRow(null); load(); }} />
      )}
      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onDone={() => { setPage(1); load(); }} />
      )}
    </div>
  );
}
