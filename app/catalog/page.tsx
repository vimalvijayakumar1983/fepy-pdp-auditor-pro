"use client";

import { useMemo, useState } from "react";

type Issue = { code: string; severity: string; message: string; recommendation: string };
type Result = {
  sku: string;
  title: string;
  score: number;
  seoScore: number;
  aeoScore: number;
  status: string;
  issues: Issue[];
  suggestedTitle: string;
  suggestedIntro: string;
  suggestedMeta: string;
  suggestedAlt: string;
};

const SAMPLE = `sku,product_url,title_en,title_ar,brand,model_number,category,price_aed,currency,stock_status,description_en,image_url_1,image_alt_1,meta_title,meta_description,specs_inline
FEPY-PW-001,https://www.fepy.com/power-tools/bosch-easyaquatak-120,Bosch EasyAquatak 120 High-Pressure Washer 1500W,,Bosch,06008A7971,Power Tools,370,AED,in_stock,Bosch EasyAquatak 120 is a 1500W pressure washer for small to medium outdoor cleaning jobs. It includes a 5m hose.,https://cdn.fepy.com/samples/easyaquatak-120.jpg,Bosch EasyAquatak 120 pressure washer,Bosch EasyAquatak 120 1500W,1500W pressure washer with 5m hose for outdoor cleaning in the UAE.,wattage: 1500W | hose_length: 5m
FEPY-HW-220,https://www.fepy.com/pattex-silicone-sealant-sl212,Pattex Silicone Sealant SL212 280ml Transparent,,Pattex,SL212,Construction Chemicals,11.25,AED,in_stock,General purpose silicone sealant.,,,Pattex SL212 sealant,,`;

function parseCsv(input: string) {
  const lines = input.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",").map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""]));
  });
}

export default function CatalogPage() {
  const [csv, setCsv] = useState(SAMPLE);
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState<{ total: number; pass: number; review: number; fail: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const shown = useMemo(() => results.filter((row) => filter === "all" || row.status === filter), [results, filter]);

  async function runAudit() {
    setError("");
    setBusy(true);
    const response = await fetch("/api/catalog-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: parseCsv(csv) }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Audit failed");
      return;
    }
    setSummary(data.summary);
    setResults(data.results);
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 64px", color: "#302E2C", fontFamily: "Georgia, serif" }}>
      <p style={{ letterSpacing: 3, fontSize: 12, color: "#956B43" }}>FEPY CATALOG</p>
      <h1 style={{ fontSize: 42, fontWeight: 500, margin: "8px 0" }}>PDP auditor</h1>
      <p style={{ maxWidth: 640, lineHeight: 1.5 }}>Paste the developer export as CSV. Each row is scored for missing data, SEO, and answer-engine readiness. Corrections stay here until someone accepts them.</p>
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} style={{ width: "100%", marginTop: 16, padding: 12, border: "1px solid #e6d7c3", background: "#fff", fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      <button onClick={runAudit} disabled={busy} style={{ marginTop: 12, background: "#302E2C", color: "#F8D798", border: 0, padding: "12px 18px", cursor: "pointer" }}>{busy ? "Scoring…" : "Run audit"}</button>
      {error && <p>{error}</p>}
      {summary && (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 24 }}>
          {[["Rows", summary.total], ["Pass", summary.pass], ["Review", summary.review], ["Fail", summary.fail]].map(([label, value]) => (
            <div key={String(label)} style={{ background: "#fff", border: "1px solid #e6d7c3", padding: 16 }}>
              <div style={{ fontSize: 12, letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 28 }}>{value}</div>
            </div>
          ))}
        </section>
      )}
      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {["all", "fail", "review", "pass"].map((item) => (
            <button key={item} onClick={() => setFilter(item)} style={{ marginRight: 8, padding: "6px 10px", border: "1px solid #CB9658", background: filter === item ? "#F8D798" : "#fff" }}>{item}</button>
          ))}
        </div>
      )}
      {shown.map((row) => (
        <article key={row.sku} style={{ background: "#fff", border: "1px solid #e6d7c3", padding: 18, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{row.sku}</h2>
            <strong>{row.status} · {row.score}</strong>
          </div>
          <p>{row.title || "No English title"}</p>
          <p>SEO {row.seoScore} · AEO {row.aeoScore}</p>
          <ul>{row.issues.map((issue) => <li key={issue.code}><strong>{issue.message}</strong> {issue.recommendation}</li>)}</ul>
          <p><strong>Suggested title:</strong> {row.suggestedTitle}</p>
          <p><strong>Suggested intro:</strong> {row.suggestedIntro}</p>
          <p><strong>Suggested meta:</strong> {row.suggestedMeta}</p>
          <p><strong>Suggested alt:</strong> {row.suggestedAlt}</p>
        </article>
      ))}
    </main>
  );
}
