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
  const failing = useMemo(() => results.filter((row) => row.status !== "pass"), [results]);

  async function runAudit() {
    setError("");
    const rows = parseCsv(csv);
    const response = await fetch("/api/catalog-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Audit failed");
      return;
    }
    setSummary(data.summary);
    setResults(data.results);
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <p style={{ letterSpacing: 1, color: "#956B43" }}>FEPY PDP AUDITOR</p>
      <h1>Catalog audit</h1>
      <p>Paste the Excel export saved as CSV. This pass uses catalog rules, SEO checks, and AEO checks. It does not publish fixes.</p>
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={10} style={{ width: "100%", fontFamily: "monospace" }} />
      <button onClick={runAudit} style={{ marginTop: 12, padding: "10px 16px" }}>Run audit</button>
      {error && <p>{error}</p>}
      {summary && <p>{summary.total} rows. {summary.pass} pass, {summary.review} review, {summary.fail} fail.</p>}
      {failing.map((row) => (
        <section key={row.sku} style={{ borderTop: "1px solid #ddd", padding: "16px 0" }}>
          <h2>{row.sku} · {row.status} · {row.score}</h2>
          <p>SEO {row.seoScore} · AEO {row.aeoScore}</p>
          <ul>{row.issues.map((issue) => <li key={issue.code}><strong>{issue.message}</strong> {issue.recommendation}</li>)}</ul>
          <p><strong>Suggested title:</strong> {row.suggestedTitle}</p>
          <p><strong>Suggested intro:</strong> {row.suggestedIntro}</p>
          <p><strong>Suggested meta:</strong> {row.suggestedMeta}</p>
          <p><strong>Suggested alt:</strong> {row.suggestedAlt}</p>
        </section>
      ))}
    </main>
  );
}
