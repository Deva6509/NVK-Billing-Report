"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Upload, Users, DollarSign,
  AlertTriangle, FileText, Settings, Building2, BarChart3,
  GitCompare, Search, Bell, ChevronDown, ChevronRight, Activity, BookOpen, Database, Receipt
} from "lucide-react";
import { useState } from "react";

const nav = [
  { href: "/dashboard",             icon: LayoutDashboard, label: "Executive Dashboard" },
  {
    icon: Upload,
    label: "File Upload",
    children: [
      { href: "/upload",        label: "Upload Files" },
      { href: "/upload/review", label: "Review & Flag" },
    ],
  },
  { href: "/fc28",                   icon: Database, label: "FC28 Enrollment" },
  { href: "/rate-sheet",            icon: Receipt,  label: "Rate Sheet" },
  { href: "/admin/item-master",     icon: BookOpen, label: "Item Master" },
  { href: "/admin/asa-employees",   icon: Users,    label: "ASA Employees" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<string[]>(["File Upload"]);

  function toggle(label: string) {
    setExpanded((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen text-white shrink-0 shadow-2xl z-20 relative overflow-hidden" style={{ background: "linear-gradient(180deg, #003a8c 0%, #002247 100%)" }}>
      {/* top ambient glow */}
      <div className="pointer-events-none absolute -top-24 -left-10 w-64 h-64 bg-blue-400/20 rounded-full blur-[80px]" />
      {/* Logo */}
      <div className="relative flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide">
          <div className="w-9 h-9 rounded-xl bg-white text-[#003887] flex items-center justify-center font-black text-base shadow-lg">
            ASA
          </div>
          <div className="leading-tight">
            <div className="font-black tracking-tight">Billing</div>
            <div className="text-[10px] font-medium text-blue-200/70 uppercase tracking-[0.2em]">Intelligence</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-5 space-y-1 px-3 custom-scrollbar">
        {nav.map((item) => {
          if ("children" in item && item.children) {
            const isOpen = expanded.includes(item.label);
            const Icon = item.icon;
            const anyActive = item.children.some((c) => pathname.startsWith(c.href));
            return (
              <div key={item.label} className="mb-1">
                <button
                  onClick={() => toggle(item.label)}
                  className={cn(
                    "flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all",
                    anyActive ? "bg-white/10 text-white" : "text-blue-100/80 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <span className="flex-1 text-left tracking-wide">{item.label}</span>
                  {isOpen ? <ChevronDown className="w-4 h-4 opacity-70" /> : <ChevronRight className="w-4 h-4 opacity-50" />}
                </button>
                {isOpen && (
                  <div className="ml-5 mt-1 space-y-0.5 border-l-2 border-blue-700/50 pl-4 py-1">
                    {item.children.map((child) => {
                      const isActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "block px-3 py-2 rounded-lg text-[13px] transition-all",
                            isActive
                              ? "bg-white/15 text-white font-semibold shadow-sm"
                              : "text-blue-200/70 hover:bg-white/10 hover:text-blue-50 font-medium"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all mb-1",
                isActive ? "bg-white/15 text-white shadow-sm" : "text-blue-100/80 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-blue-800/50 bg-[#002f73] flex items-center justify-center">
        <span className="text-xs font-medium text-blue-300/60 tracking-wider uppercase">ASA Billing Portal v2.0</span>
      </div>
    </aside>
  );
}
