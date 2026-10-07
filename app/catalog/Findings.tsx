"use client";

import { useState } from "react";
import type { AuditIssue, CatalogAudit } from "@/lib/catalogAudit";

const guidance: Record<string, { field: string; area: string; why: string }> = {
  missing_sku: { field: "sku", area: "Product identity", why: "Each sellable variant needs a stable identifier." },
  missing_title: { field: "title_en", area: "SEO + AI search", why: "A clear product name helps buyers and search systems identify the item." },
  short_title: { field: "title_en", area: "SEO + AI search", why: "Review whether the title identifies the exact model and variant; short titles can still be adequate." },
  missing_brand: { field: "brand", area: "Product identity", why: "A verified brand helps distinguish similar products." },
  brand_not_in_title: { field: "title_en", area: "SEO", why: "Including the brand can make a product result easier to recognise." },
  missing_model: { field: "model_number", area: "AI search", why: "A model or part number supports exact product comparisons when one exists." },
  missing_url: { field: "product_url", area: "SEO", why: "The export needs an absolute product URL so the item can be linked. Live indexing has not been checked." },
  missing_price: { field: "price_aed", area: "Shopping information", why: "A valid current price is needed for a trustworthy product offer." },
  missing_stock: { field: "stock_status", area: "Shopping information", why: "Accurate availability supports buying decisions and product feeds." },
  missing_image: { field: "image_url_1", area: "Image search + matching", why: "Without an image link in the export, this audit cannot compare the image with the product." },
  missing_alt: { field: "image_alt_1", area: "Accessibility + image SEO", why: "Descriptive alt text explains the visible product. Verify it against the actual image." },
  thin_description: { field: "description_en", area: "SEO + AI search", why: "A factual summary and specific buying information make the listing more useful and easier to interpret." },
  missing_specs: { field: "specs_inline", area: "AI search", why: "Labelled facts and units help compare products without guessing their specifications." },
  missing_arabic: { field: "title_ar", area: "Arabic storefront", why: "Relevant only if the product is offered on an Arabic storefront; review the translation before publishing." },
  missing_meta_title: { field: "meta_title", area: "SEO", why: "A descriptive, unique title gives search systems a suitable title-link candidate." },
  long_meta_title: { field: "meta_title", area: "SEO", why: "Check readability in a search preview. Character counts are editorial guidance, not ranking rules." },
  weak_meta: { field: "meta_description", area: "SEO", why: "A useful summary can improve the search snippet; search engines may choose different text." },
};

function priority(issue: AuditIssue) { return issue.severity === "fail" ? "High" : ["thin_description", "missing_specs", "weak_meta"].includes(issue.code) ? "Medium" : "Review"; }

function DraftField({ label, field, current, proposed, hint, live }: { label: string; field: string; current: string; proposed: string; hint: string; live?: boolean; hasConflicts?:boolean }) {
  const [copyState, setCopyState] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(proposed); setCopyState("Copied"); }
    catch { setCopyState("Select the draft text to copy"); }
  }
  return <section className="rounded-lg border border-stone-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">{label}</h4><p className="mt-1 text-xs text-stone-500">{field}</p></div><button type="button" disabled={!proposed} onClick={copy} aria-label={`Copy ${label}`} className="rounded border border-stone-300 px-3 py-1.5 text-xs disabled:opacity-40">Copy draft</button></div>
    <p className="mt-3 text-xs font-medium text-stone-500">{live ? "Captured page field" : "Current export"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600">{current || "Not supplied"}</p>
    <p className="mt-3 text-xs font-medium text-emerald-800">Proposed draft</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{proposed || "Verified product information is needed before a draft can be prepared."}</p>
    <p className="mt-2 text-xs leading-5 text-stone-500">{hint}</p><p role="status" className="text-xs text-emerald-800">{copyState}</p>
  </section>;
}

export default function Findings({ row, source, live = false, hasConflicts = false }: { row: CatalogAudit; source: Record<string, string>; live?: boolean; hasConflicts?:boolean }) {
  const sorted = [...row.issues].sort((a, b) => (["High", "Medium", "Review"].indexOf(priority(a))) - (["High", "Medium", "Review"].indexOf(priority(b))));
  const drafts = [
    { label: "Product title / H1", field: "title_en", proposed: row.suggestedTitle, hint: "Preserves the supplied brand, model and variant. Check accuracy and avoid repeated keywords." },
    { label: "Search title", field: "meta_title", proposed: row.suggestedMetaTitle, hint: "Editorial guide: around 50–60 characters. Search engines may rewrite the title; preserve the distinguishing product identity." },
    { label: "Answer-ready product summary", field: "description_en", proposed: hasConflicts ? "" : row.suggestedIntro, hint: "Uses the supplied description and labelled specifications. If these are thin or generic, add verified use, material, variant and pack contents before publishing." },
    { label: "Search description", field: "meta_description", proposed: hasConflicts ? "" : row.suggestedMeta, hint: "Summarises supplied facts without unverified delivery, warranty or performance claims. Aim for a readable snippet, not keyword repetition." },
    { label: "Image alt text", field: "image_alt_1", proposed: row.suggestedAlt, hint: "A candidate based on the product title. Confirm that it describes the actual image; do not use it for a different view or accessory." },
  ];
  return <div className="mt-6 space-y-5">
    <section><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">What to fix first</h3><span className="text-xs text-stone-500">{row.issues.length} {live ? "captured-field" : "export"} findings</span></div><p className="mt-1 text-xs text-stone-500">{live ? "Checks use captured English page fields. A field not captured may still exist elsewhere on the site. Resolve conflicting facts before using any draft below." : "These checks inspect the uploaded data. Missing fields may already exist on the live website."}</p>
      <div className="mt-3 space-y-3">{sorted.map(issue => {
        const info = guidance[issue.code];
        return <div key={issue.code} className="rounded-lg border border-stone-200 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${priority(issue) === "High" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>{priority(issue)}</span><span className="text-xs text-stone-500">{info?.area || "Catalogue quality"}</span></div><h4 className="mt-2 text-sm font-semibold">{issue.message}</h4><p className="mt-1 text-sm leading-6 text-stone-600">{info?.why}</p><p className="mt-2 text-sm leading-6"><strong>Action: </strong>{issue.recommendation}</p><p className="mt-2 text-xs text-stone-500">Field: {info?.field || issue.code}</p></div>;
      })}{!sorted.length && <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">No missing-data issues found in these rules. Check AI assessments and the live page before publication.</p>}</div>
    </section>
    {hasConflicts && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Description and search-description drafts are withheld until the conflicting or unverified specifications above are resolved.</p>}
    <details open className="rounded-xl bg-stone-50 p-4"><summary className="cursor-pointer font-semibold">Suggested SEO and AI search corrections</summary><p className="mt-2 text-xs leading-5 text-stone-600">Reviewable drafts from {live ? "captured page fields" : "the CSV"}, not verified manufacturer copy. These improve content readiness; ranking or AI citations are not measured by this audit.</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{drafts.map(draft => <DraftField key={draft.field} {...draft} live={live} current={source[draft.field] || ""} />)}</div>
      <section className="mt-4 rounded-lg border border-stone-200 bg-white p-4"><h4 className="text-sm font-semibold">Specifications for an answer-ready facts table</h4>{row.facts?.length ? <dl className="mt-3 divide-y divide-stone-100">{row.facts.map((fact, index) => <div key={index} className="grid grid-cols-2 gap-3 py-2 text-sm"><dt className="text-stone-500">{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : <p className="mt-2 text-sm text-amber-900">No labelled specifications supplied. Add verified facts with units; a rewritten description cannot replace them.</p>}<p className="mt-2 text-xs text-stone-500">Source: {live ? "captured page specifications" : "specs_inline from this CSV"}.</p></section>
      <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><h4 className="text-sm font-semibold">Facts to verify before publishing</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{row.missingFacts?.map(fact => <li key={fact}>{fact}</li>)}</ul></section>
    </details>
    <details className="rounded-lg border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Live-page SEO and AI search checks</summary><p className="mt-2 text-xs text-stone-500">{live ? "Some rendered-page checks appear in the live evidence above. The checks below still require validation; this audit does not measure indexing or rankings." : "Not evaluated by a CSV audit. Verify these on the published product page."}</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6"><li>Confirm the canonical URL, crawl access and indexability. Keep the product description and specifications visible as page text.</li><li>Validate Product and Offer structured data against the visible product, current price, currency, stock and exact variant. Do not invent GTINs, ratings or reviews.</li><li>Keep product feeds and the published page consistent. Link the item from the relevant category and verify its image URLs.</li><li>If an Arabic version exists, review the translation and language links. Publish useful buying answers only where a supplier source supports them.</li></ul><a className="mt-3 inline-block text-xs underline" href="https://developers.google.com/search/docs/appearance/ai-features" target="_blank" rel="noreferrer">Google guidance on AI search features</a></details>
  </div>;
}
