"use client";
import { useEffect, useRef, useState } from "react";
import {
  X,
  ArrowUpRight,
  Check,
  Save,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  Clock3,
} from "lucide-react";
import {
  api,
  date,
  label,
  download,
  type Product,
  type Finding,
  type Job,
} from "@/lib/workspace";
import QualityReview from "@/app/catalog/QualityReview";
import { auditCatalogRow } from "@/lib/catalogAudit";
const fields = [
  ["title_en", "Product title"],
  ["title_ar", "Arabic title"],
  ["meta_title", "Search title"],
  ["meta_description", "Search description"],
  ["description_en", "Description"],
  ["specs_inline", "Specifications"],
  ["image_alt_1", "Image description"],
  ["faq_text", "FAQ"],
] as const;
export default function ProductDetail({
  id,
  onClose,
  onChange,
  onAudit,
  initialTab = "findings",
  focusFinding,
}: {
  id: string;
  initialTab?: string;
  focusFinding?: string;
  onClose: () => void;
  onChange: () => void;
  onAudit: (url: string) => void;
}) {
  const [p, setP] = useState<Product | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [compare, setCompare] = useState<Record<string, string> | null>(null);
  const [comparisonLabel, setComparisonLabel] = useState("");
  function hydrate(product: Product) {
    setP(product);
    setDraft(
      Object.fromEntries(
        fields.map(([f]) => [
          f,
          product.drafts[f]?.value ?? product.row[f] ?? "",
        ]),
      ),
    );
    setDirty(false);
  }
  useEffect(() => {
    const abort = new AbortController();
    api<Product>(`/api/workspace/products/${id}`)
      .then((v) => {
        if (!abort.signal.aborted) hydrate(v);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id]);
  useEffect(() => {
    if (focusFinding && p && tab === "findings")
      document
        .getElementById(`finding-${focusFinding}`)
        ?.scrollIntoView({ block: "center" });
  }, [focusFinding, p?.id, tab]);
  const closeRef = useRef(onClose);
  closeRef.current = () => {
    if (dirty) setNotice("Save your draft or discard changes before closing.");
    else onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = document.querySelector(".product-detail") as HTMLElement;
    const background = document.querySelectorAll(
      ".workspace-sidebar,.workspace-main",
    );
    background.forEach((e) => e.setAttribute("inert", ""));
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary",
        ),
      ).filter((e) => e.offsetParent !== null);
    controls()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const all = controls();
        if (e.shiftKey && document.activeElement === all[0]) {
          e.preventDefault();
          all[all.length - 1]?.focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === all[all.length - 1]
        ) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      background.forEach((e) => e.removeAttribute("inert"));
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [id]);
  async function saveFinding(
    f: Finding,
    values: { status: string; owner: string; note: string; dueDate: string },
  ) {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      const value = await api<Product>(
        `/api/workspace/products/${id}/findings/${f.id}`,
        "PATCH",
        { ...values, revision: p.revision },
      );
      setP(value);
      onChange();
      setNotice("Review saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      const changed = Object.fromEntries(
        fields
          .filter(([f]) => draft[f] !== (p.drafts[f]?.value ?? p.row[f] ?? ""))
          .map(([f]) => [f, draft[f]]),
      );
      if (!Object.keys(changed).length) {
        setNotice("There are no changed fields to save.");
        return;
      }
      hydrate(
        await api<Product>(`/api/workspace/products/${id}/drafts`, "PUT", {
          fields: changed,
          revision: p.revision,
          note: "Editorial draft. Verify claims and source accuracy before publishing.",
        }),
      );
      onChange();
      setNotice("Draft saved. Your storefront has not changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function suggest() {
    if (!p) return;
    const rules = auditCatalogRow(p.row, { checkArabic: false });
    setDraft({
      ...draft,
      meta_title: rules.suggestedMetaTitle,
      image_alt_1: rules.suggestedAlt,
    });
    setDirty(true);
    setNotice(
      "Identity suggestions use captured text. Check the actual image and verified variant before saving.",
    );
  }
  async function compareAudit(auditId: string) {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      const j = await api<Job>(`/api/catalog-ai/${auditId}`);
      const a = p.audits.find((a) => a.id === auditId)!;
      setCompare(
        j.results.find((r) => r.rowIndex === a.rowIndex)?.live?.extracted ||
          j.sourceRows?.[a.rowIndex] ||
          {},
      );
      setComparisonLabel(date(a.capturedAt || a.created));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not compare audits.");
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    if (dirty) {
      setNotice(
        "Save your content draft before closing, or use Discard changes.",
      );
      return;
    }
    onClose();
  };
  return (
    <div className="detail-overlay">
      <section
        className="product-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Product improvement detail"
      >
        <header className="detail-header">
          <div>
            <p className="eyebrow">PRODUCT WORKSPACE</p>
            <h2>{p?.row.title_en || "Loading product…"}</h2>
            <p className="muted small">
              {p?.row.sku || "SKU not captured"} · Revision {p?.revision || "—"}{" "}
              · Captured {date(p?.capturedAt)} UAE
            </p>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close product detail"
          >
            <X size={20} />
          </button>
        </header>
        <div className="detail-tabs" role="tablist">
          {["findings", "content", "evidence", "history"].map((t) => (
            <button
              role="tab"
              aria-selected={tab === t}
              key={t}
              onClick={() => setTab(t)}
            >
              {t === "content"
                ? "Content studio"
                : label(t).replace(/^./, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
        <div className="detail-body">
          {error && (
            <div className="error-box" role="alert">
              {error}
              <button
                onClick={async () => {
                  hydrate(await api<Product>(`/api/workspace/products/${id}`));
                  setError("");
                }}
              >
                Reload latest version
              </button>
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {p && (
            <>
              <div className="detail-actions">
                {p.row.product_url && (
                  <>
                    <a
                      className="secondary"
                      href={p.row.product_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open storefront
                      <ArrowUpRight size={15} />
                    </a>
                    <button
                      className="primary"
                      disabled={busy || dirty}
                      onClick={() => onAudit(p.row.product_url)}
                    >
                      <RefreshCw size={15} />
                      Capture fresh evidence
                    </button>
                  </>
                )}
                <button
                  className="secondary"
                  disabled={dirty}
                  onClick={() => download("fepy-product-workspace.json", p)}
                >
                  Export product
                </button>
              </div>
              {tab === "findings" && (
                <>
                  <div className="scope-note">
                    <Check size={17} />
                    <span>
                      {p.latestResult?.quality?.manufacturerStatus ===
                      "document_compared"
                        ? "Matching manufacturer document compared. Confirm regional revision and exact pack."
                        : "Manufacturer accuracy is not verified. Inspect sources before changing factual claims."}
                    </span>
                  </div>
                  <div className="finding-list">
                    {[...p.findings]
                      .sort(
                        (a, b) =>
                          (a.severity === "high" ? 0 : 1) -
                          (b.severity === "high" ? 0 : 1),
                      )
                      .map((f) => (
                        <ReviewCard
                          key={`${f.id}-${p.revision}`}
                          finding={f}
                          busy={busy}
                          save={(v) => saveFinding(f, v)}
                        />
                      ))}
                    {!p.findings.length && (
                      <p className="empty-inline">
                        No saved findings yet. Run an audit to collect evidence.
                      </p>
                    )}
                  </div>
                  {p.latestResult?.decisions && (
                    <section className="section-card">
                      <h3>Fast AI assessments</h3>
                      <p className="muted small">
                        {label(p.latestResult.decisions.status)} · Labels are
                        assessment signals, not independent verification.
                      </p>
                      {p.latestResult.decisions.checks?.map((c) => (
                        <div key={c.name} className="check-row">
                          <span>{label(c.name)}</span>
                          <span
                            className={`badge ${c.needsReview ? "amber" : "neutral"}`}
                          >
                            {label(c.assessment)}
                          </span>
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
              {tab === "content" && (
                <>
                  <div className="scope-note">
                    <FileText size={18} />
                    <span>
                      Work on a reviewable draft. Captured fields and
                      specifications may contain the very errors found by the
                      audit. Check manufacturer sources before reusing claims.
                    </span>
                  </div>
                  <div className="detail-actions">
                    <button className="secondary" onClick={suggest}>
                      Suggest search title & image description
                    </button>
                    <button
                      className="primary"
                      disabled={!dirty || busy}
                      onClick={saveDraft}
                    >
                      <Save size={15} />
                      Save content draft
                    </button>
                    {dirty && (
                      <button
                        className="text-button"
                        onClick={() => {
                          hydrate(p);
                          setNotice("Unsaved changes discarded.");
                        }}
                      >
                        Discard changes
                      </button>
                    )}
                  </div>
                  <div className="editor-grid">
                    {fields.map(([f, title]) => (
                      <div key={f} className="editor-field">
                        <label htmlFor={`draft-${f}`}>
                          {title}
                          <span>
                            {p.drafts[f]
                              ? `Draft saved ${date(p.drafts[f].savedAt)}`
                              : "Captured text"}
                          </span>
                        </label>
                        <textarea
                          id={`draft-${f}`}
                          aria-label={title}
                          dir={f === "title_ar" ? "rtl" : undefined}
                          rows={
                            f.includes("description") ||
                            f === "specs_inline" ||
                            f === "faq_text"
                              ? 5
                              : 2
                          }
                          value={draft[f] || ""}
                          maxLength={12000}
                          onChange={(e) => {
                            setDraft({ ...draft, [f]: e.target.value });
                            setDirty(true);
                          }}
                        />
                        <details>
                          <summary>View original captured field</summary>
                          <p className="original-field">
                            {p.row[f] || "Not captured"}
                          </p>
                        </details>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {tab === "evidence" && (
                <>
                  <div className="section-card">
                    <h3>Capture & source coverage</h3>
                    <p className="muted small">
                      Captured text availability is separate from factual
                      accuracy. Arabic availability is not evaluated from an
                      English page.
                    </p>
                    <div className="coverage-grid">
                      {p.coverage.map((c) => (
                        <div key={c.name}>
                          <strong>{c.name}</strong>
                          <span>
                            {c.present}/{c.total} fields captured
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {p.latestResult?.live?.evidence && (
                    <div className="evidence-grid">
                      {(["desktop", "mobile"] as const).map(
                        (view) =>
                          p.latestResult?.live?.evidence?.[view] && (
                            <a
                              key={view}
                              target="_blank"
                              rel="noreferrer"
                              href={`/api/catalog-ai/${p.latestAudit}/evidence/${p.latestResult.rowIndex}/${view}`}
                              className="evidence-card"
                            >
                              <ImageIcon size={20} />
                              <strong>
                                {view === "desktop" ? "Desktop" : "Mobile"}{" "}
                                first viewport
                              </strong>
                              <p>Captured {date(p.capturedAt)} UAE</p>
                              <span>Open screenshot ↗</span>
                            </a>
                          ),
                      )}
                    </div>
                  )}
                  {p.latestResult?.quality && (
                    <QualityReview quality={p.latestResult.quality} />
                  )}
                  <details className="section-card">
                    <summary>Captured product fields</summary>
                    <dl className="raw-fields">
                      {Object.entries(p.row)
                        .filter(([, v]) => v)
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{label(key)}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                </>
              )}
              {tab === "history" && (
                <>
                  <section className="section-card">
                    <h3>Compare captured versions</h3>
                    <p className="muted small">
                      A re-assessment reads saved evidence; only a fresh capture
                      can show storefront changes.
                    </p>
                    <select
                      aria-label="Compare with audit"
                      value=""
                      disabled={busy}
                      onChange={(e) => compareAudit(e.target.value)}
                    >
                      <option value="">Select a saved audit to compare</option>
                      {p.audits.map((a) => (
                        <option key={a.id} value={a.id}>
                          {date(a.capturedAt || a.created)} ·{" "}
                          {a.reassessedFrom
                            ? "Saved-evidence reassessment"
                            : "Audit"}{" "}
                          · {a.id.slice(0, 6)}
                        </option>
                      ))}
                    </select>
                    {compare && (
                      <>
                        <p className="small muted">
                          Comparing {comparisonLabel} with current capture{" "}
                          {date(p.capturedAt)}
                        </p>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Selected audit</th>
                                <th>Current capture</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from(
                                new Set([
                                  ...Object.keys(compare),
                                  ...Object.keys(p.row),
                                ]),
                              )
                                .filter((k) => compare[k] !== p.row[k])
                                .map((k) => (
                                  <tr key={k}>
                                    <td>{label(k)}</td>
                                    <td className="wrap-cell">
                                      {compare[k] || "Not captured"}
                                    </td>
                                    <td className="wrap-cell">
                                      {p.row[k] || "Not captured"}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {!Object.keys({ ...compare, ...p.row }).some(
                            (k) => compare[k] !== p.row[k],
                          ) && (
                            <p className="empty-inline">
                              No captured field differences.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                  <section className="section-card">
                    <h3>Product activity</h3>
                    <div className="timeline">
                      {[...p.activity].reverse().map((a, i) => (
                        <div key={i}>
                          <Clock3 size={16} />
                          <div>
                            <p>{a.message}</p>
                            <span>{date(a.at)} UAE</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
function ReviewCard({
  finding: f,
  busy,
  save,
}: {
  finding: Finding;
  busy: boolean;
  save: (v: {
    status: string;
    owner: string;
    note: string;
    dueDate: string;
  }) => void;
}) {
  const [status, setStatus] = useState(
    f.status === "not_detected" ? "open" : f.status,
  );
  const [owner, setOwner] = useState(f.owner);
  const [note, setNote] = useState(f.note);
  const [dueDate, setDueDate] = useState(f.dueDate);
  return (
    <article
      id={`finding-${f.id}`}
      className={`review-card ${f.severity === "high" ? "high" : ""}`}
    >
      <div className="row-between">
        <span className={`badge ${f.severity === "high" ? "red" : "amber"}`}>
          {f.severity === "high" ? "High priority" : "Review"} ·{" "}
          {f.category || "content"}
        </span>
        <span className="muted small">{label(f.status)}</span>
      </div>
      <h3>{f.finding}</h3>
      <blockquote>
        <span>CAPTURED EVIDENCE</span>
        {f.evidence}
      </blockquote>
      <p className="fix-text">
        <strong>Recommended action</strong>
        {f.action}
      </p>
      {f.sourceUrl && (
        <a
          className="source-link"
          href={f.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Manufacturer source ↗
        </a>
      )}
      {f.status === "not_detected" && (
        <p className="notice">
          This finding was not detected in a newer page capture. That does not
          certify the entire product as accurate.
        </p>
      )}
      <details className="review-controls">
        <summary>Update review, owner & notes</summary>
        <div className="form-grid">
          <label>
            Workflow status
            <select
              aria-label="Workflow status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="ready_for_recheck">Ready for fresh recheck</option>
              <option value="accepted_risk">
                Accepted risk · keep evidence
              </option>
            </select>
          </label>
          <label>
            Owner
            <input
              value={owner}
              maxLength={80}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Team member or team"
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="full-width">
            Review notes
            <textarea
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Decision, verification source or next step"
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => save({ status, owner, note, dueDate })}
        >
          <Save size={14} />
          Save review
        </button>
      </details>
    </article>
  );
}
