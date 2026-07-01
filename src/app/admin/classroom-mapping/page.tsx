"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Header from "@/components/layout/Header";
import { RefreshCw, Save, Trash2, ArrowLeftRight, Plus, X, ChevronDown } from "lucide-react";

const DEFAULT_ITEMS = [
  "Infant", "Prepper", "Preschooler", "Registration",
  "School-Age Experience", "Toddler", "Twaddler", "Note", "UPK", "VPK",
];

interface Mapping {
  id: string;
  fc28Classroom: string;
  rateSheetItem: string | null;
}

function ItemDropdown({
  value,
  options,
  onChange,
  onAddOption,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onAddOption: (v: string) => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [newItem, setNewItem] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addNew = () => {
    const v = newItem.trim();
    if (!v) return;
    onAddOption(v);
    onChange(v);
    setNewItem("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between border rounded-lg px-3 py-1.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-violet-300 ${value ? "border-slate-200 text-slate-800" : "border-slate-200 text-slate-400"}`}
      >
        <span>{value || "Select item name…"}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {/* Clear option */}
          {value && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear selection
            </button>
          )}

          {/* Existing options */}
          <div className="max-h-52 overflow-y-auto">
            {options.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-violet-50 hover:text-violet-700 ${value === opt ? "bg-violet-50 text-violet-700 font-medium" : "text-slate-700"}`}
              >
                {opt}
              </button>
            ))}
          </div>

          {/* Add new option */}
          <div className="border-t border-slate-100 p-2 flex gap-1">
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }}
              placeholder="Add new item…"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <button
              type="button"
              onClick={addNew}
              disabled={!newItem.trim()}
              className="flex items-center gap-1 px-2 py-1 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-40"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClassroomMappingPage() {
  const [mappings,  setMappings]  = useState<Mapping[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [edits,     setEdits]     = useState<Record<string, string>>({});
  const [saving,    setSaving]    = useState<Record<string, boolean>>({});
  const [syncMsg,   setSyncMsg]   = useState("");
  const [options,   setOptions]   = useState<string[]>(DEFAULT_ITEMS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/classroom-mapping");
      const j    = await res.json();
      const list: Mapping[] = j.mappings ?? [];
      setMappings(list);
      const init: Record<string, string> = {};
      for (const m of list) init[m.id] = m.rateSheetItem ?? "";
      setEdits(init);
      // Add any saved values not already in the default list
      setOptions(prev => {
        const extra = list.map(m => m.rateSheetItem).filter(Boolean) as string[];
        const merged = Array.from(new Set([...prev, ...extra])).sort();
        return merged;
      });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch("/api/classroom-mapping/sync", { method: "POST" });
      const j   = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Sync failed");
      setSyncMsg(`Synced — ${j.added} new classroom(s) added, ${j.skipped} already existed`);
      await load();
    } catch (e: any) {
      setSyncMsg(`Error: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const save = async (id: string) => {
    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await fetch(`/api/classroom-mapping/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rateSheetItem: edits[id] }),
      });
      setMappings(prev => prev.map(m => m.id === id ? { ...m, rateSheetItem: edits[id] || null } : m));
    } finally { setSaving(prev => ({ ...prev, [id]: false })); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this classroom mapping?")) return;
    await fetch(`/api/classroom-mapping/${id}`, { method: "DELETE" });
    setMappings(prev => prev.filter(m => m.id !== id));
  };

  const addOption = (v: string) =>
    setOptions(prev => Array.from(new Set([...prev, v])).sort());

  const unmapped = mappings.filter(m => !m.rateSheetItem).length;
  const mapped   = mappings.length - unmapped;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Classroom Mapping" />
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">

        {/* Header card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-violet-500" />
                FC28 Classroom → Rate Sheet Item
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Map each FC28 classroom name to its Rate Sheet item name. Use the dropdown or add a new option.
              </p>
            </div>
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync from FC28"}
            </button>
          </div>
          {syncMsg && (
            <p className={`mt-3 text-sm px-3 py-2 rounded-lg ${syncMsg.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {syncMsg}
            </p>
          )}
          {mappings.length > 0 && (
            <div className="mt-4 flex gap-4 text-sm">
              <span className="text-green-700 font-medium">{mapped} mapped</span>
              <span className="text-amber-600 font-medium">{unmapped} unmapped</span>
              <span className="text-slate-500">{mappings.length} total</span>
            </div>
          )}
        </div>

        {/* Mapping table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-visible">
          {loading ? (
            <div className="p-12 text-center text-slate-400 text-sm">Loading…</div>
          ) : mappings.length === 0 ? (
            <div className="p-12 text-center">
              <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-slate-500 font-medium">No classroom mappings yet</p>
              <p className="text-slate-400 text-sm mt-1">Click "Sync from FC28" to pull classroom names from the latest FC28 upload.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 w-5/12">FC28 Classroom</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 w-5/12">Rate Sheet Item Name</th>
                  <th className="px-4 py-3 w-2/12"></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => {
                  const dirty = edits[m.id] !== (m.rateSheetItem ?? "");
                  return (
                    <tr key={m.id} className={`border-b border-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${m.rateSheetItem ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-700"}`}>
                          {m.fc28Classroom}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ItemDropdown
                          value={edits[m.id] ?? ""}
                          options={options}
                          onChange={v => setEdits(prev => ({ ...prev, [m.id]: v }))}
                          onAddOption={addOption}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          {dirty && (
                            <button
                              onClick={() => save(m.id)}
                              disabled={saving[m.id]}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-50"
                            >
                              <Save className="w-3 h-3" />
                              {saving[m.id] ? "…" : "Save"}
                            </button>
                          )}
                          <button
                            onClick={() => remove(m.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center">
          After saving mappings, re-run "Map Rate Sheet to FIN14" on the FIN14 Transactions page to apply them.
        </p>
      </main>
    </div>
  );
}
