"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/layout/Header";
import {
  CheckCircle2, XCircle, RefreshCw, Search, Filter,
  Plus, Save, ChevronLeft, ChevronRight, BookOpen, Pencil, X, Download,
  GitMerge, FileBarChart2,
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

function AssignModal({
  row,
  onClose,
  onSaved,
}: { row: Fin14Row; onClose: () => void; onSaved: () => void }) {
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
          body: JSON.stringify({ item: row.itemText, majorHead, subHead, entryBy: "Manual" }),
        });
      }
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800">Assign Category</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400 hover:text-gray-600" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-700 break-all leading-relaxed">
          {row.itemText ?? "—"}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Major Head</label>
            <select value={majorHead} onChange={(e) => { setMajorHead(e.target.value); setSubHead(SUB_HEADS[e.target.value][0]); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {MAJOR_HEADS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Sub Head</label>
            <select value={subHead} onChange={(e) => setSubHead(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {(SUB_HEADS[majorHead] ?? []).map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {row.itemText && (
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={addToMaster} onChange={(e) => setAddToMaster(e.target.checked)} className="rounded" />
            <BookOpen className="w-3.5 h-3.5 text-blue-500" />
            Also add <span className="font-semibold">"{row.itemText.slice(0, 40)}{row.itemText.length > 40 ? "…" : ""}"</span> to Item Master
          </label>
        )}

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 px-4 py-2 text-sm rounded-lg text-white font-semibold disabled:opacity-50"
            style={{ background: "#003887" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ReviewPageContent() {
  const sp = useSearchParams();
  const initialBatch = sp.get("batchId") ?? "";

  const [batchId, setBatchId] = useState(initialBatch);
  const [filterMatched, setFilterMatched] = useState<"all"|"matched"|"unmatched">("all");
  const [filterMajor,   setFilterMajor]   = useState("");
  const [filterSub,     setFilterSub]     = useState("");
  const [itemSearch,    setItemSearch]     = useState("");
  const [page,          setPage]           = useState(1);
  const pageSize = 100;

  const [data,     setData]     = useState<PageData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Bulk assign
  const [bulkMajor,      setBulkMajor]      = useState("Billing");
  const [bulkSub,        setBulkSub]        = useState("Regular");
  const [bulkSaving,     setBulkSaving]     = useState(false);
  const [flagAllSaving,  setFlagAllSaving]  = useState(false);
  const [flagAllConfirm, setFlagAllConfirm] = useState(false);

  // Row-level assign modal
  const [assignRow, setAssignRow] = useState<Fin14Row | null>(null);

  // Export
  const [downloading,   setDownloading]   = useState(false);
  // Map FC28 — live progress
  const [mapping,    setMapping]    = useState(false);
  const [mapResult,  setMapResult]  = useState<string | null>(null);
  const [mapProgress, setMapProgress] = useState<{
    phase: string; done: number; total: number; mapped: number; unmapped: number; pct: number; message?: string;
  } | null>(null);
  // Final Report
  const [reporting,     setReporting]     = useState(false);

  const exportExcel = async () => {
    setDownloading(true);
    try {
      const p = new URLSearchParams();
      if (batchId)                        p.set("batchId",    batchId);
      if (filterMatched === "matched")    p.set("isMatched",  "true");
      if (filterMatched === "unmatched")  p.set("isMatched",  "false");
      if (filterMajor)                    p.set("majorHead",  filterMajor);
      if (filterSub)                      p.set("subHead",    filterSub);
      if (itemSearch)                     p.set("itemSearch", itemSearch);
      const res = await fetch(`/api/fin14/export?${p}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `FIN14_Review_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Export failed. Please try again."); }
    finally { setDownloading(false); }
  };

  const mapFC28 = async () => {
    setMapping(true);
    setMapResult(null);
    setMapProgress({ phase: "init", done: 0, total: 0, mapped: 0, unmapped: 0, pct: 0, message: "Starting…" });
    try {
      const res = await fetch("/api/fin14/map-fc28", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ batchId: batchId || undefined }),
      });
      if (!res.body) throw new Error("No stream");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";           // keep incomplete last line
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            setMapProgress({
              phase:   evt.phase   ?? "mapping",
              done:    evt.done    ?? 0,
              total:   evt.total   ?? 0,
              mapped:  evt.mapped  ?? 0,
              unmapped: evt.unmapped ?? 0,
              pct:     evt.pct     ?? 0,
              message: evt.message,
            });
            if (evt.phase === "complete") {
              setMapResult(`✓ ${evt.mapped} children mapped · ${evt.unmapped} not in FC28 DB`);
            }
            if (evt.phase === "error") {
              setMapResult(`✗ ${evt.message}`);
            }
          } catch { /* ignore malformed events */ }
        }
      }
    } catch (e: any) {
      setMapResult(`✗ ${e.message}`);
      setMapProgress(null);
    } finally {
      setMapping(false);
    }
  };

  const generateFinalReport = async () => {
    setReporting(true);
    try {
      const p = new URLSearchParams();
      if (batchId) p.set("batchId", batchId);
      const res = await fetch(`/api/fin14/final-report?${p}`);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Report failed"); }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `FIN14_Final_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Report generation failed: ${e.message}`);
    } finally {
      setReporting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (batchId)                        p.set("batchId",    batchId);
      if (filterMatched === "matched")    p.set("isMatched",  "true");
      if (filterMatched === "unmatched")  p.set("isMatched",  "false");
      if (filterMajor)                    p.set("majorHead",  filterMajor);
      if (filterSub)                      p.set("subHead",    filterSub);
      if (itemSearch)                     p.set("itemSearch", itemSearch);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      const res  = await fetch(`/api/fin14?${p}`);
      const json = await res.json();
      setData(json);
      // Sync the resolved batchId back so Map FC28 / Flag All use the correct batch
      if (json.batchId && !batchId) setBatchId(json.batchId);
      setSelected(new Set());
    } finally { setLoading(false); }
  }, [batchId, filterMatched, filterMajor, filterSub, itemSearch, page]);

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
      const filters: Record<string, string> = {};
      if (batchId)                        filters.batchId    = batchId;
      if (filterMatched === "matched")    filters.isMatched  = "true";
      if (filterMatched === "unmatched")  filters.isMatched  = "false";
      if (filterMajor)                    filters.majorHead  = filterMajor;
      if (filterSub)                      filters.subHead    = filterSub;
      if (itemSearch)                     filters.itemSearch = itemSearch;
      await fetch("/api/fin14", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagAll: true, filters, majorHead: bulkMajor, subHead: bulkSub, entryBy: "Manual" }),
      });

      // If a search term was active, add it to Item Master so next consolidation auto-matches
      if (itemSearch.trim()) {
        await fetch("/api/item-master", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: itemSearch.trim(), majorHead: bulkMajor, subHead: bulkSub, entryBy: "Manual" }),
        });
      }

      await load();
    } finally { setFlagAllSaving(false); }
  };

  // Determine all columns to show from first row's rawData
  const rawCols: string[] = data?.rows[0] ? Object.keys(data.rows[0].rawData) : [];

  // Formula: ASA if SubHead=Adjustments AND item contains "ASA " / "ASA_" / "ASA-"
  function computeEntryBy(itemText: string | null, subHead: string | null): string {
    if (subHead === "Adjustments" && itemText) {
      const t = itemText.toUpperCase();
      if (t.includes("ASA ") || t.includes("ASA_") || t.includes("ASA-")) return "ASA";
    }
    return "CENTER";
  }

  const unmatchedInView = data?.rows.filter((r) => !r.isMatched).length ?? 0;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header title="FIN14 Transaction Review" user={{ name: "Admin", email: "admin@asaind.co.in", role: "SUPER_ADMIN" }} />

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
            Clear
          </button>

          <div className="ml-auto flex items-center gap-2 text-sm text-gray-500 flex-wrap">
            {data && (
              <>
                <span className="font-semibold text-gray-700">{data.total.toLocaleString()}</span> rows
                {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </>
            )}

            {/* Map FC28 Masters button */}
            <button
              onClick={mapFC28}
              disabled={mapping || !data?.total}
              title="Merge FC28 fields (Billing Cycle, Child Status, Start Date, Withdrawal Date, Family Status, Classroom, DOB) into FIN14 rows by Child ID"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 transition-colors"
            >
              <GitMerge className="w-3.5 h-3.5" />Map FC28 to FIN14
            </button>

            {/* Generate Final Report button — includes Summary + Transactions sheets */}
            <button
              onClick={generateFinalReport}
              disabled={reporting || !data?.total}
              title="Downloads a 2-sheet Excel: Summary (pivot by child) + Transactions (all raw rows)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 transition-colors"
            >
              {reporting
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating…</>
                : <><FileBarChart2 className="w-3.5 h-3.5" />Generate Final Report</>}
            </button>
          </div>

          {/* Live mapping progress panel */}
          {(mapping || mapResult) && (
            <div className="w-full mt-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 space-y-2">
              {/* Top row: label + counts */}
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
                    {mapProgress.done.toLocaleString()} / {mapProgress.total.toLocaleString()} children
                    {" · "}{mapProgress.pct}%
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {mapProgress && mapProgress.total > 0 && (
                <div className="w-full bg-purple-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-150"
                    style={{
                      width: `${mapProgress.pct}%`,
                      background: mapProgress.phase === "complete" ? "#22c55e" : "#7c3aed",
                    }}
                  />
                </div>
              )}

              {/* Stats row */}
              {mapProgress && mapProgress.total > 0 && (
                <div className="flex items-center gap-4 text-xs text-purple-700">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span className="font-semibold text-green-700">{mapProgress.mapped.toLocaleString()}</span> matched in FC28
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-gray-400" />
                    <span className="font-semibold text-gray-500">{mapProgress.unmapped.toLocaleString()}</span> not in FC28 DB
                  </span>
                  {mapProgress.total > 0 && (
                    <span className="text-purple-500">
                      {mapProgress.total - mapProgress.done > 0
                        ? `${(mapProgress.total - mapProgress.done).toLocaleString()} remaining`
                        : "all processed"}
                    </span>
                  )}
                  {mapResult && mapProgress.phase === "complete" && (
                    <button onClick={() => { setMapResult(null); setMapProgress(null); }}
                      className="ml-auto text-purple-400 hover:text-purple-600 text-xs">
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bulk action bar — shown whenever there is a selection OR data is loaded */}
        {(selected.size > 0 || data) && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
            {selected.size > 0 && (
              <span className="text-sm font-semibold text-blue-700">{selected.size} selected</span>
            )}

            {/* Shared dropdowns */}
            <select value={bulkMajor} onChange={(e) => { setBulkMajor(e.target.value); setBulkSub(SUB_HEADS[e.target.value][0]); }}
              className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white">
              {MAJOR_HEADS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <select value={bulkSub} onChange={(e) => setBulkSub(e.target.value)}
              className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white">
              {(SUB_HEADS[bulkMajor] ?? []).map((s) => <option key={s}>{s}</option>)}
            </select>

            {/* Apply to selected (page) */}
            {selected.size > 0 && (
              <button onClick={bulkAssign} disabled={bulkSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#003887" }}>
                <Save className="w-3.5 h-3.5" />{bulkSaving ? "Saving…" : `Apply to ${selected.size} Selected`}
              </button>
            )}

            {/* Flag ALL matching filter — with confirm step */}
            {!flagAllConfirm ? (
              <button
                onClick={() => setFlagAllConfirm(true)}
                disabled={flagAllSaving || !data?.total}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold border-2 border-orange-400 text-orange-600 bg-white hover:bg-orange-50 disabled:opacity-40 transition-colors"
              >
                {flagAllSaving
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Flagging…</>
                  : <><Save className="w-3.5 h-3.5" />Flag All {data?.total ? `${data.total.toLocaleString()} Matching` : "Matching"}</>}
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-lg px-3 py-1.5">
                <span className="text-xs font-semibold text-orange-700">
                  Flag all {data?.total.toLocaleString()} rows as {bulkMajor} / {bulkSub}?
                </span>
                <button onClick={flagAll} className="px-3 py-1 text-xs font-bold bg-orange-500 text-white rounded-lg hover:bg-orange-600">Yes, flag all</button>
                <button onClick={() => setFlagAllConfirm(false)} className="px-2 py-1 text-xs text-orange-500 hover:text-orange-700">Cancel</button>
              </div>
            )}

            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-blue-400 hover:text-blue-600 ml-auto">
                Deselect all
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: "auto", width: "max-content", minWidth: "100%" }}>
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {/* Sticky: checkbox */}
                  <th style={{ position: "sticky", left: 0, width: 36, minWidth: 36, background: "#f3f4f6", zIndex: 20 }} className="px-2 py-2.5 text-left">
                    <input type="checkbox" checked={!!data && selected.size === data.rows.length && data.rows.length > 0} onChange={selectAll} className="rounded" />
                  </th>
                  {/* Sticky: status */}
                  <th style={{ position: "sticky", left: 36, minWidth: 110, background: "#f3f4f6", zIndex: 20, boxShadow: "2px 0 6px -2px rgba(0,0,0,0.12)" }} className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">
                    Status
                  </th>

                  {/* All raw FIN14 columns */}
                  {rawCols.map((c) => (
                    <th key={c} className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">{c}</th>
                  ))}

                  {/* Added category columns — highlighted blue */}
                  <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50 border-l-2 border-blue-200">Major Head</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Sub Head</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Entry By</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Matched By</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-blue-500 uppercase tracking-wide bg-blue-50">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data?.rows.map((row) => {
                  const entryBy = computeEntryBy(row.itemText, row.majorHead ? row.subHead : null);
                  const stickyBg = selected.has(row.id) ? "#dbeafe" : !row.isMatched ? "#fffbeb" : "#ffffff";
                  return (
                  <tr key={row.id}
                    className={`${selected.has(row.id) ? "bg-blue-100" : row.isMatched ? "hover:bg-gray-50" : "bg-amber-50 hover:bg-amber-100"}`}>
                    {/* Checkbox — sticky with explicit bg */}
                    <td style={{ position: "sticky", left: 0, width: 36, minWidth: 36, background: stickyBg, zIndex: 10 }} className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} className="rounded" />
                    </td>
                    {/* Status — sticky with explicit bg */}
                    <td style={{ position: "sticky", left: 36, minWidth: 110, background: stickyBg, zIndex: 10, boxShadow: "2px 0 6px -2px rgba(0,0,0,0.12)" }} className="px-3 py-2">
                      <StatusPill isMatched={row.isMatched} entryBy={row.entryBy} />
                    </td>

                    {/* All raw columns — no truncation, full content visible */}
                    {rawCols.map((c) => (
                      <td key={c} className="px-3 py-2 text-gray-700">
                        {row.rawData[c] === null || row.rawData[c] === undefined || String(row.rawData[c]).trim() === ""
                          ? <span className="text-gray-300">—</span>
                          : String(row.rawData[c])}
                      </td>
                    ))}

                    {/* Category columns */}
                    <td className="px-3 py-2 bg-blue-50/40 border-l-2 border-blue-200 font-semibold text-gray-700">
                      {row.majorHead
                        ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${row.majorHead === "Billing" ? "bg-blue-100 text-blue-700" : row.majorHead === "Adjustments" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>{row.majorHead}</span>
                        : <span className="text-amber-400 italic text-[11px]">—</span>}
                    </td>
                    <td className="px-3 py-2 bg-blue-50/40 text-gray-600 text-[11px]">
                      {row.subHead ?? <span className="text-amber-400 italic">—</span>}
                    </td>
                    {/* Entry By — formula derived */}
                    <td className="px-3 py-2 bg-blue-50/40">
                      {row.isMatched
                        ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${entryBy === "ASA" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>{entryBy}</span>
                        : <span className="text-gray-300 text-[11px]">—</span>}
                    </td>
                    {/* Matched By — who ran the match (System/Manual) */}
                    <td className="px-3 py-2 bg-blue-50/40 text-gray-500 text-[11px]">
                      {row.entryBy ?? <span className="text-gray-300">—</span>}
                    </td>
                    {/* Action */}
                    <td className="px-3 py-2 bg-blue-50/40">
                      <button
                        onClick={() => setAssignRow(row)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          row.isMatched
                            ? "border border-gray-200 text-gray-500 hover:bg-gray-100"
                            : "bg-amber-500 text-white hover:bg-amber-600"
                        }`}
                      >
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

          {/* Pagination footer */}
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
        </div>
      </div>

      {/* Assign/Edit modal */}
      {assignRow && (
        <AssignModal
          row={assignRow}
          onClose={() => setAssignRow(null)}
          onSaved={() => { setAssignRow(null); load(); }}
        />
      )}
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-sm text-gray-500">Loading…</div>}>
      <ReviewPageContent />
    </Suspense>
  );
}
