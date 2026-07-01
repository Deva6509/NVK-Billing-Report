"use client";

import { useState, useCallback, useEffect } from "react";
import Header from "@/components/layout/Header";
import { Upload, Download, RefreshCw, FileSpreadsheet, ChevronDown, ChevronUp, Calendar, Database, Trash2 } from "lucide-react";

const ALL_COLS = [
  { key: "center",           label: "Center",                group: "Identity" },
  { key: "centerId",         label: "Center ID",             group: "Identity" },
  { key: "childId",          label: "Child ID",              group: "Identity" },
  { key: "childName",        label: "Child Name",            group: "Identity" },
  { key: "familyName",       label: "Family Name",           group: "Identity" },
  { key: "familyId",         label: "Family ID",             group: "Identity" },
  { key: "childStatus",      label: "Child Status",          group: "Enrollment" },
  { key: "familyStatus",     label: "Family Status",         group: "Enrollment" },
  { key: "classroom",        label: "Classroom",             group: "Enrollment" },
  { key: "rateSheet",        label: "Rate Sheet",            group: "Enrollment" },
  { key: "dateOfBirth",      label: "Date of Birth",         group: "Enrollment" },
  { key: "enrollDate",       label: "Enroll Date",           group: "Enrollment" },
  { key: "startDate",        label: "Start Date",            group: "Enrollment" },
  { key: "withdrawalDate",   label: "Withdrawal Date",       group: "Enrollment" },
  { key: "withdrawalReason", label: "Withdrawal Reason",     group: "Enrollment" },
  { key: "primaryGuardian",  label: "Primary Guardian",      group: "Enrollment" },
  { key: "monDay",           label: "Mon",                   group: "Schedule" },
  { key: "tueDay",           label: "Tue",                   group: "Schedule" },
  { key: "wedDay",           label: "Wed",                   group: "Schedule" },
  { key: "thuDay",           label: "Thu",                   group: "Schedule" },
  { key: "friDay",           label: "Fri",                   group: "Schedule" },
  { key: "dropOff",          label: "Drop Off",              group: "Schedule" },
  { key: "pickup",           label: "Pickup",                group: "Schedule" },
  { key: "earlyAMCare",      label: "Early AM Care",         group: "Schedule" },
  { key: "latePMCare",       label: "Late PM Care",          group: "Schedule" },
  { key: "program",          label: "Program",               group: "Schedule" },
  { key: "address1",         label: "Address 1",             group: "Address" },
  { key: "address2",         label: "Address 2",             group: "Address" },
  { key: "city",             label: "City",                  group: "Address" },
  { key: "state",            label: "State",                 group: "Address" },
  { key: "zipCode",          label: "Zip Code",              group: "Address" },
  { key: "discountType",     label: "Discount Type",         group: "Discount" },
  { key: "discountName",     label: "Discount Name",         group: "Discount" },
  { key: "mainDiscount",     label: "Main Discount",         group: "Discount" },
  { key: "amPmDiscount",     label: "AM/PM Discount",        group: "Discount" },
  { key: "totalDiscount",    label: "Total Discount",        group: "Discount" },
  { key: "billingCycle",     label: "Billing Cycle",         group: "Billing" },
  { key: "agency1",          label: "Agency 1",              group: "Billing" },
  { key: "familyContrib1",   label: "Family Contribution 1", group: "Billing" },
  { key: "contractAmt1",     label: "Contract Amount 1",     group: "Billing" },
  { key: "contractPeriod1",  label: "Contract Period 1",     group: "Billing" },
  { key: "copayAmt1",        label: "Copay Amount 1",        group: "Billing" },
  { key: "copayPeriod1",     label: "Copay Period 1",        group: "Billing" },
  { key: "agency2",          label: "Agency 2",              group: "Billing 2" },
  { key: "familyContrib2",   label: "Family Contribution 2", group: "Billing 2" },
  { key: "contractAmt2",     label: "Contract Amount 2",     group: "Billing 2" },
  { key: "contractPeriod2",  label: "Contract Period 2",     group: "Billing 2" },
  { key: "copayAmt2",        label: "Copay Amount 2",        group: "Billing 2" },
  { key: "copayPeriod2",     label: "Copay Period 2",        group: "Billing 2" },
  { key: "sourceFile",       label: "Source File",           group: "Meta" },
];
const GROUPS = Array.from(new Set(ALL_COLS.map(c => c.group)));
const DEFAULT_KEYS = ["center","centerId","childId","childName","familyName","familyId",
  "childStatus","familyStatus","classroom","rateSheet","startDate","withdrawalDate",
  "billingCycle","agency1","contractAmt1","contractPeriod1","program","dateOfBirth"];
const GROUP_COLORS: Record<string, string> = {
  "Identity":"bg-blue-100 text-blue-800","Enrollment":"bg-teal-100 text-teal-800",
  "Schedule":"bg-violet-100 text-violet-800","Address":"bg-orange-100 text-orange-800",
  "Discount":"bg-rose-100 text-rose-800","Billing":"bg-green-100 text-green-800",
  "Billing 2":"bg-emerald-100 text-emerald-800","Meta":"bg-slate-100 text-slate-700",
};

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
      onClick={() => { if (disabled) return; const i = document.createElement("input"); i.type="file"; i.multiple=true; i.accept=".xlsx,.xls"; i.onchange=()=>{ if(i.files) handle(Array.from(i.files)); }; i.click(); }}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${disabled?"border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed":dragging?"border-blue-500 bg-blue-50":"border-blue-300 bg-blue-50/50 hover:border-blue-500 hover:bg-blue-50"}`}
    >
      <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-blue-400" />
      <p className="text-sm font-semibold text-slate-700">Drop FC28 center files here</p>
      <p className="text-xs text-slate-500 mt-1">Multiple .xlsx files — one per center</p>
    </div>
  );
}

export default function FC28Page() {
  const [reportDate,   setReportDate]   = useState(() => new Date().toISOString().slice(0, 10));
  const [files,        setFiles]        = useState<File[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [uploadLog,    setUploadLog]    = useState<string[]>([]);
  const [batches,      setBatches]      = useState<any[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [dlBatchId,    setDlBatchId]    = useState("");
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_KEYS));
  const [colsOpen,     setColsOpen]     = useState(false);
  const [downloading,  setDownloading]  = useState(false);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingBatch(true);
    try {
      const res = await fetch("/api/fc28/batches");
      const j   = await res.json();
      const list = j.batches ?? [];
      setBatches(list);
      if (list.length && !dlBatchId) setDlBatchId(list[0].id);
    } finally { setLoadingBatch(false); }
  }, [dlBatchId]);

  useEffect(() => { loadBatches(); }, []);

  const upload = async () => {
    if (!files.length || !reportDate) return;
    setUploading(true);
    setUploadLog([`Parsing ${files.length} files in parallel…`]);
    try {
      // 1. Import xlsx once, then parse ALL files simultaneously
      const xlsxMod = await import("xlsx");
      const XLSX = (xlsxMod as any).default ?? xlsxMod;

      const parsed = await Promise.all(files.map(async (file) => {
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array", raw: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
        return { name: file.name, rows };
      }));

      const valid      = parsed.filter(f => f.rows.length > 0);
      const totalRows  = valid.reduce((s, f) => s + f.rows.length, 0);
      setUploadLog(prev => [...prev, `Parsed ${valid.length} files (${totalRows.toLocaleString()} rows) — sending to server…`]);

      // 2. Group ~7 files per API call (~3 MB each, under Vercel's 4.5 MB limit)
      const GROUP = 7;
      const groups: typeof valid[] = [];
      for (let i = 0; i < valid.length; i += GROUP) groups.push(valid.slice(i, i + GROUP));

      // 3. First group creates the batch (need batchId before parallel sends)
      const firstBody = JSON.stringify({ reportDate, isFinal: groups.length === 1, files: groups[0] });
      const firstRes  = await fetch("/api/fc28/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: firstBody });
      if (!firstRes.ok) { const e = await firstRes.json().catch(() => ({})); throw new Error(e.error ?? "Upload failed"); }
      const firstData = await firstRes.json();
      const batchId   = firstData.batchId as string;
      setUploadLog(prev => [...prev, `  Group 1/${groups.length} done`]);

      // 4. Send remaining groups 3 at a time concurrently
      const CONCURRENCY = 3;
      const rest = groups.slice(1);
      for (let i = 0; i < rest.length; i += CONCURRENCY) {
        const wave     = rest.slice(i, i + CONCURRENCY);
        const isLast   = i + CONCURRENCY >= rest.length;
        await Promise.all(wave.map((group, wi) => {
          const isFinal = isLast && wi === wave.length - 1;
          return fetch("/api/fc28/upload", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportDate, batchId, isFinal, files: group }),
          });
        }));
        setUploadLog(prev => [...prev, `  Groups ${i + 2}–${Math.min(i + 2 + CONCURRENCY - 1, groups.length)}/${groups.length} done`]);
      }

      // 5. If only 1 group, stats were already computed; else fetch final count
      let rowCount = firstData.rowCount;
      if (groups.length > 1) {
        const statsRes = await fetch("/api/fc28/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportDate, batchId, isFinal: true, files: [] }),
        });
        const stats = await statsRes.json().catch(() => ({}));
        rowCount = stats.rowCount ?? totalRows;
      }

      setUploadLog(prev => [...prev, ``, `✅ ${(rowCount ?? totalRows).toLocaleString()} rows · ${valid.length} files uploaded`]);
      setDlBatchId(batchId);
      setFiles([]);
      await loadBatches();
    } catch (err: any) {
      setUploadLog(prev => [...prev, `✗ ${err.message}`]);
    } finally { setUploading(false); }
  };

  const toggleCol   = (key: string) => setSelectedCols(prev => { const n=new Set(prev); n.has(key)?n.delete(key):n.add(key); return n; });
  const toggleGroup = (group: string) => {
    const keys = ALL_COLS.filter(c=>c.group===group).map(c=>c.key);
    const allOn = keys.every(k=>selectedCols.has(k));
    setSelectedCols(prev => { const n=new Set(prev); keys.forEach(k=>allOn?n.delete(k):n.add(k)); return n; });
  };

  const deleteBatch = async (id: string) => {
    if (!confirm("Delete this batch and all its rows? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/fc28/batches/${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Delete failed"); }
      if (dlBatchId === id) setDlBatchId("");
      await loadBatches();
    } catch (err: any) { alert(err.message); }
    finally { setDeletingId(null); }
  };

  const download = async () => {
    if (!dlBatchId || !selectedCols.size) return;
    setDownloading(true);
    try {
      const cols = ALL_COLS.filter(c=>selectedCols.has(c.key)).map(c=>c.key).join(",");
      const res  = await fetch(`/api/fc28/download?batchId=${dlBatchId}&cols=${cols}`);
      if (!res.ok) { const j=await res.json().catch(()=>({})); throw new Error(j.error??"Download failed"); }
      const blob    = await res.blob();
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement("a");
      const batch   = batches.find(b=>b.id===dlBatchId);
      const dateStr = batch ? new Date(batch.reportDate).toISOString().slice(0,10) : "export";
      a.href=url; a.download=`FC28_${dateStr}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { alert(err.message); }
    finally { setDownloading(false); }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header />
      <main className="flex-1 p-6 space-y-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Database className="w-5 h-5 text-blue-700" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">FC28 Enrollment Data</h1>
            <p className="text-sm text-slate-500">Upload center-wise FC28 files, merge into database, download with selected columns</p>
          </div>
        </div>

        {/* Upload */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2"><Upload className="w-4 h-4 text-blue-600" /> Upload FC28 Files</h2>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Report Date</label>
            <input type="date" value={reportDate} onChange={e=>setReportDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <DropZone onFiles={f=>setFiles(prev=>[...prev,...f])} disabled={uploading} />
          {files.length > 0 && (
            <div className="mt-3 space-y-1 max-h-36 overflow-y-auto">
              {files.map((f,i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-slate-700 font-medium">{f.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{(f.size/1024).toFixed(0)} KB</span>
                    {!uploading && <button onClick={()=>setFiles(prev=>prev.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600">✕</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-3 items-center">
            <button onClick={upload} disabled={uploading||!files.length||!reportDate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 hover:bg-blue-800 transition-colors">
              {uploading?<><RefreshCw className="w-4 h-4 animate-spin"/>Uploading…</>:<><Upload className="w-4 h-4"/>Upload {files.length>0?`${files.length} File${files.length>1?"s":""}`:"Files"}</>}
            </button>
            {files.length>0&&!uploading&&<button onClick={()=>{setFiles([]);setUploadLog([]);}} className="text-sm text-slate-500 hover:text-red-500">Clear</button>}
          </div>
          {uploadLog.length>0&&(
            <div className="mt-4 bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-300 space-y-0.5 max-h-40 overflow-y-auto">
              {uploadLog.map((l,i)=><div key={i}>{l||<br/>}</div>)}
            </div>
          )}
        </div>

        {/* History */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Calendar className="w-4 h-4 text-slate-500"/>Upload History</h2>
            <button onClick={loadBatches} className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${loadingBatch?"animate-spin":""}`}/>Refresh</button>
          </div>
          {batches.length===0?<div className="p-8 text-center text-slate-400 text-sm">No uploads yet</div>:(
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>{["Report Date","Files","Rows","Uploaded At","",""].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map(b=>(
                  <tr key={b.id} className={`hover:bg-slate-50 transition-colors ${dlBatchId===b.id?"bg-blue-50":""}`}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{new Date(b.reportDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</td>
                    <td className="px-4 py-3 text-slate-600">{b.fileCount}</td>
                    <td className="px-4 py-3 text-slate-600">{b.rowCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(b.createdAt).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">
                      <button onClick={()=>setDlBatchId(b.id)} className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${dlBatchId===b.id?"bg-blue-600 text-white":"bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700"}`}>
                        {dlBatchId===b.id?"Selected":"Select"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={()=>deleteBatch(b.id)}
                        disabled={deletingId===b.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Delete batch"
                      >
                        {deletingId===b.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Download */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2"><Download className="w-4 h-4 text-teal-600"/>Download FC28 Data</h2>
          {!dlBatchId?<p className="text-sm text-slate-500">Select a batch from history above.</p>:(
            <>
              <button onClick={()=>setColsOpen(o=>!o)} className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3 hover:text-blue-700 transition-colors">
                {colsOpen?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}
                Choose Columns ({selectedCols.size} / {ALL_COLS.length} selected)
              </button>
              {colsOpen&&(
                <div className="border border-slate-200 rounded-xl p-4 mb-4 bg-slate-50">
                  <div className="flex gap-4 mb-3">
                    <button onClick={()=>setSelectedCols(new Set(ALL_COLS.map(c=>c.key)))} className="text-xs text-blue-600 hover:underline">Select All</button>
                    <button onClick={()=>setSelectedCols(new Set())} className="text-xs text-slate-500 hover:underline">Clear All</button>
                    <button onClick={()=>setSelectedCols(new Set(DEFAULT_KEYS))} className="text-xs text-teal-600 hover:underline">Reset Default</button>
                  </div>
                  {GROUPS.map(group=>{
                    const cols=ALL_COLS.filter(c=>c.group===group);
                    const allOn=cols.every(c=>selectedCols.has(c.key));
                    const someOn=cols.some(c=>selectedCols.has(c.key));
                    return (
                      <div key={group} className="mb-3">
                        <button onClick={()=>toggleGroup(group)} className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${GROUP_COLORS[group]??"bg-slate-100 text-slate-600"}`}>{group}</span>
                          <span className="text-[11px] text-slate-400">{allOn?"✓ all":someOn?"partial":"none"}</span>
                        </button>
                        <div className="flex flex-wrap gap-3 pl-2">
                          {cols.map(c=>(
                            <label key={c.key} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={selectedCols.has(c.key)} onChange={()=>toggleCol(c.key)} className="w-3.5 h-3.5 rounded accent-blue-600"/>
                              <span className="text-xs text-slate-700">{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={download} disabled={downloading||!selectedCols.size}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold disabled:opacity-50 hover:bg-teal-800 transition-colors">
                {downloading?<><RefreshCw className="w-4 h-4 animate-spin"/>Generating…</>:<><Download className="w-4 h-4"/>Download Excel ({selectedCols.size} cols)</>}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
