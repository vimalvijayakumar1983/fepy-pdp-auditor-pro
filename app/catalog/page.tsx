"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseCsv } from "@/lib/csv";
import Findings from "./Findings";
import QualityReview, {type Quality} from "./QualityReview";
import BrowserPanel, {type BrowserSession} from "./BrowserPanel";
import LiveEvidence, { type LivePage } from "./LiveEvidence";
import { auditCatalog } from "@/lib/catalogAudit";
import type { CatalogAudit } from "@/lib/catalogAudit";

type Neighbor = { rowIndex: number; sku: string; similarity: number };
type AIResult = {
  rowIndex: number; sku: string; live?: LivePage; quality?: Quality; timings?: {imageFetchSeconds?:number;decisionsSeconds?:number;similaritySeconds?:number;qualitySeconds?:number};
  decisions: { status: string; error?: string; imageWarning?: string; checks?: { name: string; assessment: string; confidence: number | null; needsReview: boolean }[] };
  embeddings: { status: string; error?: string; imageError?: string; imageStatus?: string; imageTextSimilarity?: number | null; textNeighbors?: Neighbor[]; imageNeighbors?: Neighbor[] };
};
type HistoryItem = {id:string;created:number;status:string;mode:string;total:number;title:string;version?:string};
type Job = { reassessedFrom?:string; sourceRows?:Record<string,string>[]; created?:number; assessmentSeconds?:number; mode?: string; phase?: string; pagesCompleted?: number; pagesSkipped?: number; id: string; status: string; total: number; completed: number; results: AIResult[]; error?: string; warnings?: string[] };
type Capabilities = { decisions: { configured: boolean }; embeddings: { configured: boolean; state: string } };
const SAMPLE = `sku,product_url,title_en,title_ar,brand,model_number,category,price_aed,currency,stock_status,description_en,image_url_1,image_alt_1,meta_title,meta_description,specs_inline
FEPY-PW-001,https://www.fepy.com/power-tools/bosch-easyaquatak-120,Bosch EasyAquatak 120 High-Pressure Washer 1500W,,Bosch,06008A7971,Power Tools,370,AED,in_stock,Bosch EasyAquatak 120 is a 1500W pressure washer for small to medium outdoor cleaning jobs. It includes a 5m hose.,,,Bosch EasyAquatak 120 1500W,1500W pressure washer with 5m hose for outdoor cleaning in the UAE.,wattage: 1500W | hose_length: 5m
FEPY-HW-220,https://www.fepy.com/pattex-silicone-sealant-sl212,Pattex Silicone Sealant SL212 280ml Transparent,,Pattex,SL212,Construction Chemicals,11.25,AED,in_stock,General purpose silicone sealant.,,,Pattex SL212 sealant,,`;
const labels: Record<string, string> = { content_consistency: "Product consistency", description_quality: "Description usefulness", category_fit: "Category fit", image_match: "Image matches product", desktop_first_view: "Desktop first viewport", mobile_first_view: "Mobile first viewport" };
function timing(value: number | undefined) { return value === undefined ? "pending" : `${value}s`; }
function readable(value: string) { return value.replace(/_/g, " "); }
function reviewNeeded(ai?: AIResult) {
  return !!ai && (!!ai.quality?.findings?.length || (!!ai.quality && (ai.quality.status!=="completed" || ai.quality.manufacturerStatus!=="document_compared")) || !!ai.live?.technical?.length || ai.live?.status === "error" || ai.decisions.status === "error" || ai.decisions.status === "not_configured" || !!ai.decisions.imageWarning || !!ai.decisions.checks?.some(c => c.needsReview) || ai.embeddings.status === "error" || !!ai.embeddings.imageError || !!ai.embeddings.textNeighbors?.length || !!ai.embeddings.imageNeighbors?.length);
}

function assessmentText(value: string) {
  return ({ readable_product_area: "Visible product area is readable", visible_layout_issue: "Possible visible layout issue", consistent: "Supplied facts agree", contradiction: "Conflicting product details", useful: "Useful description", generic_or_irrelevant: "Generic or irrelevant description", fits: "Suitable category", wrong_category: "Review category", matches: "Image appears consistent", wrong_product: "Possible image mismatch", insufficient_evidence: "Not enough evidence", unavailable: "Not evaluated", refused: "Assessment unavailable" } as Record<string, string>)[value] || readable(value);
}
function checkAction(name: string, assessment: string, needsReview: boolean) {
  if (name.endsWith("_first_view")) return "Review the linked screenshot. This assesses the captured viewport only; interactions and full-page usability were not tested.";
  if (assessment === "unavailable" || assessment === "refused") return "No usable assessment returned. Review this check manually.";
  if (assessment === "insufficient_evidence") return "Add supplier-backed details or a clearer image before judging this check.";
  if (name === "description_quality" && assessment !== "useful") return "Add verified applications, distinguishing specifications and pack contents. Review the proposed summary below; it cannot supply missing facts.";
  if (name === "content_consistency" && needsReview) return "Compare brand, model, size, colour, voltage and pack quantity with a manufacturer or supplier source.";
  if (name === "category_fit" && needsReview) return "Confirm the correct product type and its category in the FEPY taxonomy.";
  if (name === "image_match" && needsReview) return "Verify the pictured model and exact variant, including colour, size and included accessories.";
  return "No issue identified in the supplied evidence. This does not independently verify manufacturer facts.";
}

export default function CatalogPage() {
  const [history,setHistory]=useState<HistoryItem[]>([]);
  const [referenceUrls,setReferenceUrls]=useState("");
  const [detailed,setDetailed]=useState(true);
  const [productQuery,setProductQuery]=useState("");
  const [mode, setMode] = useState<"csv" | "live">("live");
  const [browserSession,setBrowserSession] = useState<BrowserSession|null>(null);
  const [browserApproved,setBrowserApproved] = useState(false);
  const updateBrowser = useCallback((session:BrowserSession|null,approved:boolean)=>{setBrowserSession(session);setBrowserApproved(approved);},[]);
  const [urls, setUrls] = useState("");
  const [csv, setCsv] = useState(SAMPLE);
  const [results, setResults] = useState<CatalogAudit[]>([]);
  const [summary, setSummary] = useState<{ total: number; pass: number; review: number; fail: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [useDecisions, setUseDecisions] = useState(true);
  const [useEmbeddings, setUseEmbeddings] = useState(true);
  const [liveEmbeddings, setLiveEmbeddings] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [setupMessage, setSetupMessage] = useState("");
  const [reviewed, setReviewed] = useState<number[]>([]);
  const [sourceRows, setSourceRows] = useState<Record<string, string>[]>([]);
  const [pollError, setPollError] = useState("");
  const running = job?.status === "queued" || job?.status === "running";

  const hydrateJob = useCallback((data:Job) => {
    setJob(data);
    if (data.mode !== "live") {
      const sources=data.sourceRows||[];setSourceRows(sources);
      const audits=auditCatalog(sources);setResults(audits.results);setSummary(sources.length?audits.summary:null);
      if(!sources.length)setSetupMessage("This earlier CSV run did not retain source rows. Upload the CSV again to restore its rules results.");
      return;
    }
    const pages = data.results.filter(item=>item.live?.status === "completed");
    const sources: Record<string,string>[] = Array.from({length:data.total},()=>({}));
    pages.forEach(item=>{sources[item.rowIndex] = item.live!.extracted || {};});
    setSourceRows(sources);
    const audits = auditCatalog(sources,{checkArabic:false});
    pages.forEach(item=>{if(audits.results[item.rowIndex].status==="pass"&&reviewNeeded(item)) audits.results[item.rowIndex].status="review";});
    setResults(audits.results);
    const valid=pages.map(item=>audits.results[item.rowIndex]);
    setSummary({total:valid.length,pass:valid.filter(x=>x.status==="pass").length,review:valid.filter(x=>x.status==="review").length,fail:valid.filter(x=>x.status==="fail").length});
  },[]);
  const refreshHistory = useCallback(async()=>{
    try {const response=await fetch("/api/catalog-ai/history");const data=await response.json();if(response.ok)setHistory(data.jobs||[]);} catch { /* Current audit remains usable. */ }
  },[]);
  async function openAudit(id:string) {
    setBusy(true);setError("");setReviewed([]);
    try {const response=await fetch(`/api/catalog-ai/${id}`);const data=await response.json();if(!response.ok)throw new Error(data.error||data.detail||"Audit unavailable.");hydrateJob(data);setMode(data.mode==="live"?"live":"csv");setProductQuery("");setFilter("all");if(data.mode==="live")setUrls(data.results.map((r:AIResult)=>r.live?.requestedUrl).filter(Boolean).join("\n"));localStorage.setItem("fepy-last-audit",id);} catch(err){setError(err instanceof Error?err.message:"Could not open audit.");} finally{setBusy(false);}
  }
  async function reassess() {
    if(!job)return;setBusy(true);setError("");
    try {const response=await fetch(`/api/catalog-ai/${job.id}/reassess`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({referenceUrls:referenceUrls.split(/\s+/).filter(Boolean)})});const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||"Recheck could not start.");setJob(data);setReviewed([]);localStorage.setItem("fepy-last-audit",data.id);refreshHistory();} catch(err){setError(err instanceof Error?err.message:"Recheck failed.");} finally{setBusy(false);}
  }
  useEffect(()=>{refreshHistory();const id=localStorage.getItem("fepy-last-audit");if(id&&/^[a-f0-9]{32}$/.test(id))fetch(`/api/catalog-ai/${id}`).then(async r=>{if(r.ok){const j=await r.json();hydrateJob(j);setMode(j.mode==="live"?"live":"csv");}}).catch(()=>{});},[hydrateJob,refreshHistory]);
  useEffect(()=>{if(job?.id){localStorage.setItem("fepy-last-audit",job.id);if(!running)refreshHistory();}},[job?.id,job?.status,running,refreshHistory]);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/catalog-ai", { signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) setSetupMessage(data.error || data.detail || "AI checks are unavailable.");
      else setCapabilities(data);
    }).catch(() => { if (!abort.signal.aborted) setSetupMessage("Could not check AI availability."); });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!job?.id || !running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/catalog-ai/${job!.id}`, { signal: abort.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || "Could not refresh audit progress.");
        if (cancelled) return;
        setJob(data); setPollError(""); setSetupMessage("");
        hydrateJob(data);
        if (data.status === "failed") setError(data.error || "AI audit failed.");
        if (data.status === "queued" || data.status === "running") timer = setTimeout(poll, 2500);
      } catch (err) {
        if (!cancelled) { setPollError(err instanceof Error ? err.message : "Progress refresh failed."); timer = setTimeout(poll, 8000); }
      }
    }
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [job?.id, running, hydrateJob]);

  const aiByIndex = useMemo(() => new Map(job?.results.map(row => [row.rowIndex, row]) || []), [job?.results]);
  const shown = useMemo(() => results.map((row, index) => ({ row, index, ai: aiByIndex.get(index) })).filter(({ row, ai }) => (job?.mode !== "live" || ai?.live?.status === "completed") && (!productQuery || `${row.sku} ${row.title}`.toLowerCase().includes(productQuery.toLowerCase())) && (filter === "all" || (filter === "ai_review" ? reviewNeeded(ai) : row.status === filter))), [results, filter, aiByIndex, job?.mode,productQuery]);

  async function runAudit(withAI: boolean) {
    setError(""); setPollError(""); setBusy(true); setJob(null); setReviewed([]); setResults([]); setSummary(null);
    try {
      const rows = parseCsv(csv);
      if (rows.length > 5000) throw new Error("Use up to 5,000 rows for the rules audit.");
      if (withAI && rows.length > 500) throw new Error("Use up to 500 products per AI audit. Split larger exports into batches or run rules only.");
      if (withAI && !useDecisions && !useEmbeddings) throw new Error("Select at least one AI check.");
      setSourceRows(rows);
      const response = await fetch("/api/catalog-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rules audit failed.");
      setSummary(data.summary); setResults(data.results);
      if (withAI) {
        const aiResponse = await fetch("/api/catalog-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, decisions: useDecisions, embeddings: useEmbeddings }) });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok) throw new Error(aiData.error || aiData.detail || "AI audit could not start. Rules results remain available.");
        setJob({ ...aiData, completed: 0, results: [] });
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Audit failed. Please retry."); }
    finally { setBusy(false); }
  }

  async function runLive() {
    setError(""); setBusy(true); setPollError(""); setJob(null); setReviewed([]); setResults([]); setSummary(null); setSourceRows([]);
    try {
      const pages = [...new Set(urls.split(/\s+/).map(x=>x.trim()).filter(Boolean))];
      if (!pages.length || pages.length > 100) throw new Error("Enter 1–100 FEPY product URLs, one per line.");
      if (browserSession?.status==="active" && !browserApproved) throw new Error("The live UAE browser is not ready for automated FEPY audits. Review its access and status message.");
      const response = await fetch("/api/catalog-live", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({urls:pages,browserSessionId:browserSession?.status==="active"?browserSession.id:undefined,decisions:useDecisions,embeddings:liveEmbeddings,detailed,referenceUrls:referenceUrls.split(/\s+/).filter(Boolean)})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.detail || "Live audit could not start.");
      setJob(data);
    } catch(err) {setError(err instanceof Error ? err.message : "Live audit failed.");}
    finally {setBusy(false);}
  }

  function download() {
    const report = { exportedAt: new Date().toISOString(), summary, aiJob: job, products: results.map((row, index) => ({ source: sourceRows[index], rules: row, ai: aiByIndex.get(index) || null, manuallyReviewed: reviewed.includes(index) })).filter(product=>job?.mode!=="live" || product.ai?.live?.status==="completed") };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "fepy-catalog-audit.json"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadFindings() {
    const cells=(x:unknown)=>{let v=String(x??"");if(/^\s*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
    const lines=[["SKU","Product","Priority","Category","Finding","Evidence","Recommended fix","Source","Audit ID"]];
    for(const result of job?.results||[]) for(const f of [...(result.live?.technical||[]),...(result.quality?.findings||[])]) lines.push([result.sku,result.live?.extracted?.title_en||"",f.severity,"category" in f?String(f.category||""):"",f.finding,f.evidence,f.action,"sourceUrl" in f?String(f.sourceUrl||""):"",job?.id||""]);
    const blob=new Blob(["\ufeff"+lines.map(row=>row.map(cells).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="fepy-product-findings.csv";link.click();URL.revokeObjectURL(url);
  }

  const failedAIChecks = job?.results.filter(row => row.quality?.status === "error" || row.quality?.status === "not_configured" || row.live?.status === "error" || [row.decisions.status, row.embeddings.status].some(status => ["error", "not_configured"].includes(status)) || row.embeddings.imageStatus === "error").length || 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 text-stone-800">
      <a href="/workspace" className="mb-5 inline-block text-sm font-semibold text-emerald-800">← Product intelligence workspace</a><p className="text-xs tracking-[.25em] text-amber-800">FEPY CATALOG</p>
      <h1 className="mt-2 font-serif text-4xl">Product audit workspace</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6">Find the issue, inspect the evidence, and review a concrete fix. Page checks appear first; document comparison and detailed review follow. Publishing remains your decision.</p>
      <details className="mt-6 rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-sm">Recent audits · last 24 hours ({history.length})</summary><p className="mt-2 text-xs text-stone-500">Reopen completed runs or recheck saved evidence with the latest audit logic. Saved page evidence retains its original capture time.</p><div className="mt-3 max-h-64 space-y-2 overflow-auto">{history.map(h=><button key={h.id} disabled={busy||running} onClick={()=>openAudit(h.id)} className={`block w-full rounded-lg border p-3 text-left text-sm disabled:opacity-50 ${job?.id===h.id?"border-amber-400 bg-amber-50":"border-stone-200"}`}><span className="block font-medium">{h.title||`${h.total} product audit`}</span><span className="mt-1 block text-xs text-stone-500">{new Date(h.created*1000).toLocaleString("en-AE",{timeZone:"Asia/Dubai"})} UAE · {h.status} · {h.version?"Detailed review":"Earlier audit format"}</span></button>)}{!history.length&&<p className="text-sm text-stone-500">No recent audit available yet.</p>}</div></details>
      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <div className="mb-4 flex gap-2">{(["csv","live"] as const).map(item=><button key={item} disabled={busy || running} aria-pressed={mode===item} onClick={()=>setMode(item)} className={`rounded border px-4 py-2 text-sm ${mode===item ? "bg-amber-100 border-amber-500" : "border-stone-300"}`}>{item==="csv" ? "CSV audit" : "Live PDP audit"}</button>)}</div>
        {mode === "csv" ? <><label htmlFor="catalog-csv" className="block font-medium">Product export CSV</label>
        <p className="mt-1 text-xs text-stone-500">Quoted commas and multiline descriptions are supported. AI checks: up to 500 rows. Rules only: up to 5,000.</p>
        <input aria-label="Upload catalogue CSV" type="file" accept=".csv,text/csv" className="my-3 block text-sm" disabled={busy || running} onChange={async event => { const file = event.target.files?.[0]; if (file) { if (file.size > 10 * 1024 * 1024) { setError("CSV exceeds 10 MB."); return; } setCsv(await file.text()); } }} />
        <textarea id="catalog-csv" value={csv} disabled={busy || running} onChange={event => setCsv(event.target.value)} rows={7} className="w-full rounded border border-stone-300 p-3 font-mono text-xs" />
        </> : <><BrowserPanel session={browserSession} onSession={updateBrowser} running={!!running || busy} /><label htmlFor="catalog-urls" className="block font-medium">FEPY product page URLs</label><p className="mt-1 mb-3 text-xs text-stone-500">One HTTPS product URL per line, up to 100. Browser Use reads each live page and captures desktop/mobile evidence before assessment.</p><textarea id="catalog-urls" value={urls} disabled={busy || running} onChange={e=>setUrls(e.target.value)} rows={3} placeholder="https://www.fepy.com/your-product" className="w-full rounded border border-stone-300 p-3 font-mono text-xs" /><button disabled={busy || running} className="mt-2 text-xs underline" onClick={()=>{try {setUrls(parseCsv(csv).map(row=>row.product_url).filter(Boolean).join("\n"));} catch {setError("Load a valid CSV first.");}}}>Use product URLs from CSV</button></>}
        <div className="mt-4 flex flex-wrap gap-5 text-sm">
          <label><input type="checkbox" checked={useDecisions} disabled={busy || running} onChange={e => setUseDecisions(e.target.checked)} className="mr-2" />Fast content & image checks</label>
          <label><input type="checkbox" checked={mode === "live" ? liveEmbeddings : useEmbeddings} disabled={busy || running} onChange={e => mode === "live" ? setLiveEmbeddings(e.target.checked) : setUseEmbeddings(e.target.checked)} className="mr-2" />Image similarity & duplicate candidates</label>
        </div>
        {mode === "live" && <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4"><label className="text-sm font-semibold"><input type="checkbox" checked={detailed} disabled={busy||running} onChange={e=>setDetailed(e.target.checked)} className="mr-2"/>Detailed evidence review and manufacturer comparison</label><p className="mt-2 text-xs leading-5 text-stone-600">Adds a deeper review after fast findings. Manufacturer facts are only compared when a matching technical sheet is available. Pattex PL150 has an automatic reference; other products can use an approved source below.</p><label htmlFor="manufacturer-urls" className="mt-3 block text-xs font-medium">Manufacturer PDF sources · optional, up to two</label><textarea id="manufacturer-urls" value={referenceUrls} disabled={busy||running} onChange={e=>setReferenceUrls(e.target.value)} rows={2} placeholder="https://datasheets.tdx.henkel.com/your-technical-sheet.pdf" className="mt-2 w-full rounded-lg border border-stone-300 bg-white p-3 text-xs"/><p className="mt-1 text-xs text-stone-500">Approved sources include Henkel, Bosch Professional and Makita UAE. A different model document is excluded from comparison.</p></div>}
        {mode === "live" && <p className="mt-2 text-xs text-stone-600">Fast live audit: page findings and Decisions run first. Image similarity is optional and off by default; its first run loads a CPU model and takes longer. Page findings appear while AI checks continue.</p>}
        <p className="mt-2 text-xs text-stone-500">Selected AI checks send product data to the audit worker. Content and image decisions use OpenAI; similarity runs on the worker.</p>
        {setupMessage && <p role="status" className="mt-3 text-sm text-amber-800">{setupMessage} You can still run rules only.</p>}
        {capabilities && <p className="mt-3 text-xs text-stone-500">Decisions API: {capabilities.decisions.configured ? "configured" : "awaiting OpenAI API key"} · EmbeddingGemma 2: {readable(capabilities.embeddings.state)}. The first similarity audit may take longer while the model loads.</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={busy || running} onClick={() => mode === "live" ? runLive() : runAudit(true)} className="rounded bg-stone-800 px-5 py-3 text-sm text-amber-100 disabled:opacity-50">{busy ? "Working…" : running ? "AI audit running…" : mode === "live" ? "Audit live product pages" : "Run rules + selected AI checks"}</button>
          {mode === "csv" && <button disabled={busy || running} onClick={() => runAudit(false)} className="rounded border border-stone-300 px-5 py-3 text-sm disabled:opacity-50">Run rules only</button>}
          {job?.mode==="live" && !running && job.results.some(r=>r.live?.status==="completed") && <button disabled={busy} onClick={reassess} className="rounded border border-stone-300 px-5 py-3 text-sm">Recheck saved evidence</button>}
          {job?.results.some(r=>r.live?.technical?.length || r.quality?.findings?.length) && <button onClick={downloadFindings} className="rounded border border-stone-300 px-5 py-3 text-sm">Export findings CSV</button>}
          {(results.length > 0 || job?.status === "completed") && <button onClick={download} className="rounded border border-stone-300 px-5 py-3 text-sm">Download results</button>}
        </div>
      </section>
      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {job && <section aria-live="polite" className="mt-4 rounded bg-amber-50 p-4 text-sm"><p>{job.mode === "live" ? "Live PDP audit" : "AI audit"}: {job.status === "completed" && failedAIChecks ? "finished with errors" : readable(job.status)} · {job.completed}/{job.total} products processed{job.mode === "live" && ` · ${job.pagesCompleted || 0}/${job.total} pages attempted · ${({page_reading:"Reading pages and capturing evidence",product_image_fetch:"Preparing product image",content_decisions:"Assessing content and screenshots",source_verification:"Comparing manufacturer sources and reviewing detailed evidence",image_similarity:"Computing image similarity (first run may load model)",finished:"Finished",assessment:"Preparing assessment"} as Record<string,string>)[job.phase || "page_reading"] || readable(job.phase || "page_reading")} ${job.pagesSkipped ? `· ${job.pagesSkipped} skipped after access block` : ""}`}</p>{failedAIChecks > 0 && <p className="mt-2 font-medium text-red-800">{failedAIChecks} product(s) could not be fully audited. Review the page or AI errors below; these are not successful assessments.</p>}{job.reassessedFrom && <p className="mt-2 font-medium">Rechecked saved evidence. The product page was not recollected; the original capture time is retained.</p>}<progress className="mt-2 w-full" max={job.total} value={job.phase === "page_reading" ? job.pagesCompleted || 0 : job.completed} aria-label="AI audit progress" /><p className="mt-2 text-xs">Keep this page open to receive results. Captured findings appear before AI finishes. Audit results are available on the worker for 24 hours; download them to keep a copy.</p>{pollError && <p className="mt-2 text-red-800">{pollError} Retrying progress refresh…</p>}</section>}
      {job?.mode === "live" && job.results.filter(item=>item.live?.status === "error").map(item=><LiveEvidence key={item.rowIndex} page={item.live!} jobId={job.id} index={item.rowIndex} />)}
      {summary && <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Rows", summary.total], ["No flagged issues", summary.pass], ["Needs review", summary.review], ["Missing data", summary.fail]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 text-3xl">{value}</p></div>)}</section>}
      {results.length > 0 && <label className="mt-5 block text-sm font-medium">Find a product<input aria-label="Find a product by SKU or title" value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="SKU or product name" className="mt-2 block w-full rounded-lg border border-stone-300 p-3"/></label>}
      {results.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{["all", "fail", "review", "pass", "ai_review"].map(item => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)} className={`rounded border px-3 py-2 text-sm ${filter === item ? "border-amber-500 bg-amber-100" : "border-stone-200 bg-white"}`}>{item === "ai_review" ? "AI needs review" : readable(item)}</button>)}</div>}
      {shown.map(({ row, index, ai }) => <article key={index} className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="max-w-3xl text-xl font-semibold leading-7">{row.title || row.sku}</h2><strong className="text-sm">{reviewNeeded(ai) || row.status!=="pass" ? "Review required" : "No issue flagged in implemented checks"}</strong></div>
        <p className="mt-2 text-xs font-medium uppercase tracking-wider text-stone-500">SKU {row.sku}</p>{ai?.live?.auditedAt && <p className="mt-1 text-xs text-stone-500">Page evidence captured {new Date(ai.live.auditedAt).toLocaleString("en-AE",{timeZone:"Asia/Dubai"})} UAE{job?.reassessedFrom?" · assessed again with current checks":""}.</p>}<p className="mt-1 text-xs text-stone-500">Field-check score: {row.score}/100 · SEO fields {row.seoScore}% · AI answer fields {row.aeoScore}%. Completeness does not establish accuracy or rankings.</p>
        {ai?.timings && <p className="mt-2 text-xs text-stone-600">Processing time: image fetch {timing(ai.timings.imageFetchSeconds)} · Decisions {timing(ai.timings.decisionsSeconds)} · similarity {timing(ai.timings.similaritySeconds)} · detailed review {timing(ai.timings.qualitySeconds)}.</p>}
        {ai?.quality && <QualityReview quality={{...ai.quality,findings:[...(ai.live?.technical || []).map(f=>({...f,category: "category" in f?String(f.category):/schema|canonical|noindex|h1|currency/.test(f.code)?"seo":"accuracy"})),...ai.quality.findings]}}/>}
        {ai?.live && job && (ai.quality ? <details className="mt-4 rounded-lg border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Captured page, screenshots and extraction sources</summary><LiveEvidence page={ai.live} jobId={job.id} index={index}/></details> : <LiveEvidence page={ai.live} jobId={job.id} index={index}/>)}
        {ai?.live && !ai.quality && !running && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">This run has no detailed source comparison. Use “Recheck saved evidence” to apply the latest audit logic without opening the product again.</p>}
        {ai && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Fast AI signals and image checks</summary><div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-lg bg-stone-50 p-4"><h3 className="text-sm font-semibold">Content & image decisions</h3><p className="mt-2 text-xs text-stone-600">These fast classifications use captured page fields and screenshots. Manufacturer comparison appears in the evidence review above.</p><p className="mt-1 text-xs">{readable(ai.decisions.status)}</p>{ai.decisions.error && <p className="mt-2 text-sm text-amber-800">{ai.decisions.error}</p>}{ai.decisions.imageWarning && <p className="mt-2 text-xs text-amber-800">{ai.decisions.imageWarning}</p>}{ai.decisions.checks?.map(check => <div key={check.name} className="mt-3 rounded-lg border border-stone-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{labels[check.name] || readable(check.name)}</p><span className={`rounded-full px-2 py-1 text-xs ${check.needsReview ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>{check.needsReview ? "Review required" : "No issue detected"}</span></div><p className="mt-2">{check.needsReview && ["consistent","useful","fits","matches","readable_product_area"].includes(check.assessment)?`Uncertain — model suggested: ${assessmentText(check.assessment)}`:assessmentText(check.assessment)}</p><p className="mt-1 text-xs text-stone-500">{check.confidence !== null ? `Model confidence: ${Math.round(check.confidence * 100)}% · not an accuracy guarantee` : "No confidence assessment"}</p><p className="mt-2 text-xs leading-5 text-stone-600">{checkAction(check.name, check.assessment, check.needsReview)}</p></div>)}</section>
          <section className="rounded-lg bg-stone-50 p-4"><h3 className="text-sm font-semibold">Image similarity & duplicate candidates</h3><p className="mt-1 text-xs">{readable(ai.embeddings.status)}</p>{ai.embeddings.error && <p className="mt-2 text-sm text-amber-800">{ai.embeddings.error}</p>}{ai.embeddings.imageError && <p className="mt-2 text-xs text-amber-800">{ai.embeddings.imageError}</p>}{ai.embeddings.imageStatus === "not_supplied" && <p className="mt-2 text-xs">No primary image supplied.</p>}{ai.embeddings.imageTextSimilarity != null && <p className="mt-2 text-sm">Image/product text cosine similarity: {ai.embeddings.imageTextSimilarity.toFixed(3)}<span className="block text-xs text-stone-500">A similarity signal, not a match probability.</span></p>}{([['Similar text', ai.embeddings.textNeighbors], ['Similar images', ai.embeddings.imageNeighbors]] as [string, Neighbor[] | undefined][]).map(([label, neighbors]) => <div key={label} className="mt-3 text-sm"><p className="font-medium">{label}</p>{neighbors?.length ? neighbors.map(n => <p key={n.rowIndex}>{n.sku || `Row ${n.rowIndex + 1}`} · {n.similarity.toFixed(3)}</p>) : <p className="text-xs text-stone-500">{ai.embeddings.status === "completed" ? (running ? "Comparisons pending until all rows finish." : "No candidates above the review threshold within this upload.") : "Not evaluated."}</p>}</div>)}<p className="mt-3 text-xs text-stone-500">Verify model, size, colour and pack quantity before merging any products.</p></section>
        </div></details>}
        <Findings row={row} source={sourceRows[index] || {}} live={!!ai?.live} hasConflicts={!!ai?.quality?.findings?.length || !!ai?.decisions.checks?.some(c=>c.name==="content_consistency" && c.needsReview) || !!ai?.live?.technical?.some(f=>["speed_conflict","weight_conflict","cordless_power_review","curing_claim_conflict","generic_benefits","irrelevant_benefits"].includes(f.code))} />
        <button className="mt-4 rounded border border-stone-300 px-3 py-2 text-xs" disabled={running} onClick={() => setReviewed(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index])}>{reviewed.includes(index) ? "Reviewed · undo" : "Mark manually reviewed"}</button>
      </article>)}
      {results.length > 0 && shown.length === 0 && <p className="mt-5 text-sm text-stone-500">No products match this filter.</p>}
    </main>
  );
}
