"use client";
import React, { useRef, useState, ChangeEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pills";
import { StatusBadge, ScoreBar } from "@/components/ui/status";
import { APP_NAME } from "@/lib/audit";
import { Trash2 } from "lucide-react";

/** ---- Local theme + helpers (kept in this file) ---- */
const theme = {
  primary: {
    from: "from-indigo-600",
    to: "to-fuchsia-600",
    softFrom: "from-indigo-50",
    softTo: "to-fuchsia-50",
  },
  ok: { bg: "bg-emerald-100", text: "text-emerald-800", bar: "bg-emerald-500" },
  warn: { bg: "bg-amber-100", text: "text-amber-800", bar: "bg-amber-500" },
  danger: { bg: "bg-rose-100", text: "text-rose-800", bar: "bg-rose-500" },
};

const normalizeUrl = (u: string) => {
  if (!u) return "";
  const s = ("" + u).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) return `https://${s}`;
  return "";
};

const extractUrls = (text: string) => {
  const rows = text.replace(/\r/g, "").split(/\n|\t|,/).map(x => x.trim()).filter(Boolean);
  const noHeader = rows.filter(x => !/^url$/i.test(x));
  return noHeader.map(normalizeUrl).filter(Boolean);
};
/** --------------------------------------------------- */

export default function Page() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [singleUrl, setSingleUrl] = useState("");
  const [batchText, setBatchText] = useState("");
  const [showList, setShowList] = useState(false);

  /** URL management */
  const addUrls = (list: string[]) => {
    const merged = Array.from(new Set([...(urls || []), ...list.map(normalizeUrl).filter(Boolean)]));
    setUrls(merged);
  };
  const addSingle = () => {
    if (!singleUrl.trim()) return;
    addUrls([singleUrl.trim()]);
    setSingleUrl("");
  };
  const removeUrl = (urlToRemove: string) => setUrls(prev => prev.filter(u => u !== urlToRemove));
  const clearUrls = () => setUrls([]);
  const addBatch = () => {
    if (!batchText.trim()) return;
    addUrls(extractUrls(batchText));
    setBatchText("");
  };
  const handleCsv = async (file: File) => {
    const text = await file.text();
    addUrls(extractUrls(text));
  };

  /** REAL audit via API */
  const runAudit = async () => {
    if (!urls.length) {
      setRows([]);
      return;
    }
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    setRows(data.rows || []);
  };

  /** Detail section */
  const RowDetail = ({ item }: { item: any }) => {
    const a = item.audit;
    const Section = ({
      label,
      current,
      suggested,
      ok,
      reason,
    }: {
      label: string;
      current: any;
      suggested: any;
      ok: boolean;
      reason: string;
    }) => (
      <Card className="mb-4 border-0 shadow-sm ring-1 ring-gray-200">
        <CardHeader
          className={`flex flex-row items-center justify-between bg-gradient-to-r ${theme.primary.softFrom} ${theme.primary.softTo}`}
        >
          <div className="flex items-center gap-2">
            <Pill className={`${ok ? `${theme.ok.bg} ${theme.ok.text}` : `${theme.danger.bg} ${theme.danger.text}`}`}>
              {ok ? "Approved" : "Needs fix"}
            </Pill>
            <span className="font-semibold">{label}</span>
          </div>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Current</div>
            <div className="text-sm bg-white p-3 rounded-xl ring-1 ring-gray-100 shadow-sm whitespace-pre-wrap">
              {Array.isArray(current) || typeof current === "object" ? JSON.stringify(current, null, 2) : current}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Suggested</div>
            <div className="text-sm bg-white p-3 rounded-xl ring-1 ring-gray-100 shadow-sm whitespace-pre-wrap">
              {Array.isArray(suggested) || typeof suggested === "object"
                ? JSON.stringify(suggested, null, 2)
                : suggested}
            </div>
            <div className="mt-2 text-xs text-gray-600">
              <span className="font-medium">Reason:</span> {reason}
            </div>
          </div>
        </CardContent>
      </Card>
    );

    return (
      <div>
        {"error" in a && a.error ? (
          <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
            Fetch/parse error: {a.error}
          </div>
        ) : null}
        <Section label="Title" {...a.title} />
        <Section label="About" {...a.about} />
        <Section label="Bullets" {...a.bullets} />
        <Section label="Specs" {...a.specs} />
        <Section label="Images" current={`Count: ${a.images.currentCount}`} {...a.images} />
        <Section label="Price" {...a.price} />
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className={`mx-auto max-w-7xl mb-6 rounded-2xl shadow-sm ring-1 ring-gray-200 bg-white overflow-hidden`}>
        <div className={`px-6 py-5 bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white`}>
          <h1 className="text-2xl font-bold">{APP_NAME}</h1>
          <p className="text-white/80 text-sm">Add URLs, run checks, and review side-by-side fixes.</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6">
        {/* Add URLs */}
        <Card className="border-0 shadow-sm ring-1 ring-gray-200">
          <CardHeader className={`flex items-center justify-between bg-gradient-to-r from-indigo-50 to-fuchsia-50`}>
            <CardTitle>1) Add URLs</CardTitle>
            <div className="flex items-center gap-2">
              <Pill className="bg-white text-gray-700 ring-1 ring-gray-200">Loaded: {urls.length}</Pill>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input
                placeholder="Enter single URL (press Enter or Tab to add)"
                value={singleUrl}
                onChange={e => setSingleUrl(e.target.value)}
                onBlur={addSingle}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSingle();
                  }
                }}
                className="h-11 rounded-xl"
              />
              <Button onClick={addSingle} className="h-11 rounded-xl">
                Add URL
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Textarea
                placeholder="Paste multiple URLs — separated by newline, comma, or tab"
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                className="min-h-[92px] rounded-xl"
              />
              <Button onClick={addBatch} className="h-11 rounded-xl">
                Add Batch
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                accept=".csv,.txt"
                ref={fileRef}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsv(f);
                }}
                className="rounded-xl"
              />
              <Button variant="ghost" size="sm" onClick={() => setShowList(s => !s)} className="rounded-full">
                {showList ? "Hide loaded list" : "Show loaded list"}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearUrls} className="rounded-full">
                Clear all
              </Button>
            </div>

            {showList && urls.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl ring-1 ring-gray-200 bg-white">
                <ul className="divide-y">
                  {urls.map(u => (
                    <li key={u} className="flex justify-between items-center px-3 py-2 text-sm">
                      <span className="truncate max-w-[75%]" title={u}>
                        {u}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => removeUrl(u)} className="rounded-full">
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run Audit */}
        <Card className="border-0 shadow-sm ring-1 ring-gray-200">
          <CardHeader className={`bg-gradient-to-r from-indigo-50 to-fuchsia-50`}>
            <CardTitle>2) Run Audit</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button onClick={runAudit} className="rounded-xl">
              Run Audit
            </Button>
            <Pill className="bg-white ring-1 ring-gray-200 text-gray-700">Auditing {urls.length || 0} URL(s)</Pill>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="border-0 shadow-sm ring-1 ring-gray-200">
          <CardHeader className={`bg-gradient-to-r from-indigo-50 to-fuchsia-50`}>
            <CardTitle>3) Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-2xl ring-1 ring-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-white/70 backdrop-blur sticky top-0">
                  <tr>
                    <th className="p-3 text-left">URL</th>
                    <th className="p-3 text-left">Overall</th>
                    <th className="p-3 text-left">Checks</th>
                    <th className="p-3 text-left">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {rows.map(item => {
                    const a = item.audit;
                    const open = !!expanded[item.url];
                    return (
                      <React.Fragment key={item.url}>
                        <tr className="border-t hover:bg-indigo-50/40">
                          <td className="p-3 align-top text-indigo-700 underline">
                            <a href={item.url} target="_blank" rel="noreferrer">
                              {item.url}
                            </a>
                          </td>
                          <td className="p-3 align-top space-y-2">
                            <StatusBadge ok={a.passed} label="Overall" />
                            <div className="text-xs text-gray-600">Score: {a.score}%</div>
                            <ScoreBar value={a.score} />
                          </td>
                          <td className="p-3 align-top flex flex-wrap gap-1">
                            <StatusBadge ok={a.title.ok} label="Title" />
                            <StatusBadge ok={a.about.ok} label="About" />
                            <StatusBadge ok={a.bullets.ok} label="Bullets" />
                            <StatusBadge ok={a.specs.ok} label="Specs" />
                            <StatusBadge ok={a.images.ok} label="Images" />
                            <StatusBadge ok={a.price.ok} label="Price" />
                          </td>
                          <td className="p-3 align-top">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setExpanded(e => ({ ...e, [item.url]: !open }))}
                              className="rounded-full"
                            >
                              {open ? "Hide" : "View"}
                            </Button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={4} className="bg-white p-3">
                              <RowDetail item={item} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
