"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  FolderPlus,
  LayoutDashboard,
  Layers3,
  Loader2,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import {
  api,
  coveragePercent,
  date,
  download,
  exportFindings,
  label,
  type Job,
  type ProductSummary,
  type Project,
  type ProjectData,
} from "@/lib/workspace";
import { parseCsv } from "@/lib/csv";
import BrowserPanel, { type BrowserSession } from "@/app/catalog/BrowserPanel";
import ProductDetail from "./ProductDetail";

type View =
  | "overview"
  | "products"
  | "findings"
  | "content"
  | "audits"
  | "reports"
  | "playbook";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "products", label: "Product library", icon: Package },
  { id: "findings", label: "Improvement queue", icon: ClipboardList },
  { id: "content", label: "Content studio", icon: FileText },
  { id: "audits", label: "Audit history", icon: Activity },
  { id: "reports", label: "Reports", icon: TrendingUp },
  { id: "playbook", label: "PDP playbook", icon: BookOpen },
] as const;
const active = (status: string) =>
  !["accepted_risk", "not_detected"].includes(status);
export default function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState<ProjectData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [owner, setOwner] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [newProject, setNewProject] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [auditUrls, setAuditUrls] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [focusedFinding, setFocusedFinding] = useState<string | undefined>();
  const [job, setJob] = useState<Job | null>(null);
  const [jobProject, setJobProject] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadProjects = useCallback(async () => {
    const result = await api<{ projects: Project[] }>("/api/workspace");
    setProjects(result.projects);
    return result.projects;
  }, []);
  const reload = useCallback(async () => {
    if (!projectId) return;
    setRefreshing(true);
    try {
      setData(await api<ProjectData>(`/api/workspace/projects/${projectId}`));
      await loadProjects();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workspace could not load.");
    } finally {
      setRefreshing(false);
    }
  }, [projectId, loadProjects]);
  useEffect(() => {
    let cancelled = false;
    loadProjects()
      .then((list) => {
        if (cancelled) return;
        const saved = localStorage.getItem("fepy-project");
        setProjectId(list.find((p) => p.id === saved)?.id || list[0]?.id || "");
        const pending = localStorage.getItem("fepy-pending-workspace-audit");
        if (pending) {
          try {
            const item = JSON.parse(pending);
            if (
              /^[a-f0-9]{32}$/.test(item.jobId) &&
              list.some((p) => p.id === item.projectId)
            )
              api<Job>(`/api/catalog-ai/${item.jobId}`)
                .then((j) => {
                  setJobProject(item.projectId);
                  setJob(j);
                })
                .catch(() => {
                  localStorage.removeItem("fepy-pending-workspace-audit");
                  setNotice(
                    "The pending audit could not be restored. Check recent runs before starting another.",
                  );
                });
          } catch {
            localStorage.removeItem("fepy-pending-workspace-audit");
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);
  useEffect(() => {
    setData(null);
    setProductId(null);
    if (projectId) {
      localStorage.setItem("fepy-project", projectId);
      reload();
    }
  }, [projectId, reload]);
  const running = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!job || !running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Job>(`/api/catalog-ai/${job!.id}`);
        if (cancelled) return;
        setJob(next);
        setError("");
        if (["queued", "running"].includes(next.status))
          timer = setTimeout(poll, 2500);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Progress could not refresh.",
          );
          timer = setTimeout(poll, 8000);
        }
      }
    }
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job?.id, running]);
  useEffect(() => {
    if (!job || running || !jobProject || saveFailed) return;
    let cancelled = false;
    api(`/api/workspace/projects/${jobProject}/audits`, "POST", {
      jobId: job.id,
    })
      .then(() => {
        if (cancelled) return;
        localStorage.removeItem("fepy-pending-workspace-audit");
        setNotice(
          job.status === "failed"
            ? "The audit was interrupted. Available results have been saved; failed pages are not treated as passing."
            : "Audit and original evidence saved to your project.",
        );
        setJob(null);
        reload();
      })
      .catch((e) => {
        if (!cancelled) {
          setSaveFailed(true);
          setError(
            `Audit finished but could not be saved to the project: ${e.message}. Retry saving before closing.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job?.id, job?.status, running, jobProject, reload, saveFailed]);
  const products = useMemo(
    () =>
      data?.products.filter(
        (p) =>
          !query ||
          `${p.title} ${p.sku} ${p.brand}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ) || [],
    [data, query],
  );
  const findings = useMemo(
    () =>
      data?.findings
        .filter(
          (f) =>
            (status === "all" ||
              (status === "active" ? active(f.status) : f.status === status)) &&
            (priority === "all" || f.severity === priority) &&
            (category === "all" || f.category === category) &&
            (owner === "all" ||
              (owner === "unassigned" ? !f.owner : f.owner === owner)) &&
            (!query ||
              `${f.productTitle} ${f.finding} ${f.evidence}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .sort(
          (a, b) =>
            (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1),
        ) || [],
    [data, query, status, priority, category, owner],
  );
  const allActive = data?.findings.filter((f) => active(f.status)) || [];
  const high = allActive.filter((f) => f.severity === "high").length;
  const needsRecheck = allActive.filter(
    (f) => f.status === "ready_for_recheck",
  ).length;
  const cleanCapture =
    data?.products.filter((p) => p.auditCount > 0 && !p.open).length || 0;
  const current = projects.find((p) => p.id === projectId);
  function startAudit(urls = "") {
    setProductId(null);
    setAuditUrls(urls);
    setAuditOpen(true);
  }
  function submitted(j: Job) {
    setJob(j);
    setJobProject(projectId);
    setSaveFailed(false);
    localStorage.setItem(
      "fepy-pending-workspace-audit",
      JSON.stringify({ jobId: j.id, projectId }),
    );
    setAuditOpen(false);
    setView("overview");
  }
  async function backup() {
    try {
      download(
        "fepy-workspace-export.json",
        await api(`/api/workspace/projects/${projectId}/export`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  }
  async function importRecent(id: string) {
    try {
      await api(`/api/workspace/projects/${projectId}/audits`, "POST", {
        jobId: id,
      });
      setNotice("Audit saved to this project.");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save audit.");
    }
  }
  async function reassess(id: string) {
    try {
      const j = await api<Job>(`/api/catalog-ai/${id}/reassess`, "POST", {
        referenceUrls: [],
      });
      submitted(j);
      setNotice(
        "Reassessing saved evidence. Capture times stay unchanged; this does not visit the current storefront.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Reassessment could not start.",
      );
    }
  }
  return (
    <div className="workspace-shell">
      <a href="#workspace-main" className="skip-link">
        Skip to workspace
      </a>
      <aside className="workspace-sidebar">
        <a href="/workspace" className="brand-lockup">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          FEPY
        </a>
        <p className="sidebar-label">PRODUCT INTELLIGENCE</p>
        <label className="project-picker">
          <span>Workspace project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={loading}
          >
            <option value="" disabled>
              Select a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="sidebar-create" onClick={() => setNewProject(true)}>
          <FolderPlus size={15} />
          Create project
        </button>
        <nav aria-label="Workspace navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => {
                setView(n.id);
                setQuery("");
              }}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "findings" && allActive.length > 0 && (
                <span>{allActive.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <strong>Evidence before edits</strong>
            <p>
              Findings stay linked to their sources. Your team reviews every
              correction.
            </p>
          </div>
          <a href="/catalog">
            <ArrowUpRight size={15} />
            Advanced audit console
          </a>
          <button
            onClick={async () => {
              await api("/api/auth/logout", "POST");
              window.location.assign("/login");
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current?.name || "Get started"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="team-label">
              <span className="online-dot" />
              Shared team workspace
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={reload}
              disabled={!projectId || refreshing}
            >
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="secondary browser-control-button"
              onClick={() => setBrowserOpen(true)}
            >
              Browser sessions
            </button>
            <details className="account-menu">
              <summary className="avatar" aria-label="Workspace account">
                F
              </summary>
              <div>
                <p>Shared team workspace</p>
                <button
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    setNewProject(true);
                  }}
                >
                  <FolderPlus size={15} />
                  Create project
                </button>
                <button
                  onClick={async () => {
                    await api("/api/auth/logout", "POST");
                    window.location.assign("/login");
                  }}
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        <main id="workspace-main" className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {current?.name || "YOUR PRODUCT QUALITY WORKSPACE"}
              </p>
              <h1>{navigation.find((n) => n.id === view)?.label}</h1>
              <p>
                {
                  {
                    overview:
                      "Turn every audit into your next product improvement.",
                    products:
                      "Your products, captured evidence and improvement history.",
                    findings:
                      "A focused queue for the changes that need your team’s attention.",
                    content:
                      "Create and save content drafts with the evidence in view.",
                    audits:
                      "Reopen runs, compare captures and preserve your audit trail.",
                    reports:
                      "Share what was captured, what needs attention and what changed.",
                    playbook:
                      "A practical standard for a useful, trustworthy product page.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              {projectId && (
                <button className="secondary" onClick={backup}>
                  <Download size={15} />
                  Export workspace
                </button>
              )}
              <button
                className="primary"
                disabled={!projectId || !!running}
                onClick={() => startAudit()}
              >
                <Plus size={17} />
                New audit
              </button>
            </div>
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
              {saveFailed && (
                <button onClick={() => setSaveFailed(false)}>
                  Retry saving completed audit
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="notice row-between" role="status">
              <span>{notice}</span>
              <button
                aria-label="Dismiss message"
                className="icon-button"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {job && (
            <section className="audit-progress" aria-live="polite">
              <Loader2 size={21} className={running ? "spin" : ""} />
              <div>
                <strong>
                  {running ? "Audit in progress" : "Saving audit results"}
                </strong>
                <p>
                  {label(job.phase || job.status)} ·{" "}
                  {job.completed || job.pagesCompleted || 0}/{job.total}{" "}
                  products · {job.id.slice(0, 8)}
                </p>
              </div>
              <progress
                max={job.total}
                value={job.completed || job.pagesCompleted || 0}
              />
              <span>Evidence appears before deeper review finishes.</span>
            </section>
          )}
          {loading && (
            <div className="loading-state">
              <Loader2 className="spin" />
              Loading your workspace…
            </div>
          )}
          {!loading && !projectId && (
            <section className="welcome-card">
              <div className="welcome-icon">
                <Layers3 size={28} />
              </div>
              <p className="eyebrow">YOUR CATALOG DESERVES A SYSTEM</p>
              <h2>From one audit to continuous improvement.</h2>
              <p>
                Create a project for a category, campaign or product team. Add
                products, collect evidence, assign fixes and capture the next
                version.
              </p>
              <button className="primary" onClick={() => setNewProject(true)}>
                <FolderPlus size={17} />
                Create your first project
              </button>
              <div className="welcome-steps">
                {[
                  "Build your product library",
                  "Audit with captured evidence",
                  "Review and assign improvements",
                  "Recheck the live storefront",
                ].map((t, i) => (
                  <div key={t}>
                    <span>0{i + 1}</span>
                    {t}
                  </div>
                ))}
              </div>
            </section>
          )}
          {projectId && data && (
            <>
              {view === "overview" && (
                <>
                  <section className="overview-banner">
                    <div>
                      <span className="banner-tag">
                        <Target size={13} />A CLEARER PATH TO BETTER PDPs
                      </span>
                      <h2>Make the next improvement count.</h2>
                      <p>
                        {high
                          ? `${high} high-priority finding${high === 1 ? "" : "s"} need attention. Start with contradictory facts and claims before polishing the copy.`
                          : "Build a reliable baseline, then improve the experience one verified change at a time."}
                      </p>
                      <button
                        onClick={() => setView(high ? "findings" : "products")}
                      >
                        {high
                          ? "Review priority findings"
                          : "Explore product library"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="banner-art" aria-hidden="true">
                      <div className="art-sheet">
                        <div />
                        <div />
                        <div />
                        <span>
                          <CheckCircle2 size={18} />
                          Evidence connected
                        </span>
                      </div>
                      <div className="art-orbit">
                        <ShieldCheck size={26} />
                      </div>
                    </div>
                  </section>
                  <div className="metric-grid">
                    <Metric
                      label="Products in workspace"
                      value={data.products.length}
                      sub="Saved across audit runs"
                      icon={<Package size={18} />}
                    />
                    <Metric
                      label="Open improvements"
                      value={allActive.length}
                      sub={`${high} high priority · ${allActive.filter((f) => !f.owner).length} unassigned`}
                      icon={<ClipboardList size={18} />}
                    />
                    <Metric
                      label="Ready for recheck"
                      value={needsRecheck}
                      sub="Fresh capture required"
                      icon={<RefreshCw size={18} />}
                    />
                    <Metric
                      label="Saved audit runs"
                      value={current?.audits || data.audits.length}
                      sub="Original evidence retained"
                      icon={<Activity size={18} />}
                    />
                  </div>
                  <div className="dashboard-grid">
                    <section className="section-card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">START HERE</p>
                          <h3>Products that need attention</h3>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setView("products")}
                        >
                          View all
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <ProductTable
                        products={data.products.slice(0, 5)}
                        open={setProductId}
                      />
                      {!data.products.length && (
                        <Empty
                          title="Build your product baseline"
                          text="Import a catalog CSV or audit live FEPY product URLs. Your library starts with real data."
                          action="Add products"
                          onClick={() => startAudit()}
                        />
                      )}
                    </section>
                    <section className="section-card">
                      <p className="eyebrow">EVIDENCE COVERAGE</p>
                      <h3>What has been captured</h3>
                      <p className="muted small">
                        Field availability across saved products. This does not
                        measure factual accuracy or search rankings.
                      </p>
                      <div className="dimension-bars">
                        {[
                          "Identity",
                          "Content",
                          "Search",
                          "Media",
                          "Commerce",
                          "Answers",
                          "Arabic",
                        ].map((name) => {
                          const values = data.products.flatMap((p) =>
                            p.coverage.filter((c) => c.name === name),
                          );
                          const pct = coveragePercent(values);
                          return (
                            <div key={name}>
                              <div>
                                <span>{name}</span>
                                <strong>
                                  {values.length ? `${pct}%` : "No data"}
                                </strong>
                              </div>
                              <div className="bar-track">
                                <span style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="muted small">
                        English page captures cannot establish Arabic coverage.
                        Review Arabic catalog exports separately.
                      </p>
                    </section>
                  </div>
                  <section className="section-card next-step">
                    <Sparkles size={22} />
                    <div>
                      <h3>Build the improvement loop</h3>
                      <p>
                        {needsRecheck
                          ? "Your team has marked fixes ready. Capture fresh pages to see whether the findings are still detected."
                          : "Inspect the evidence, save a draft, assign an owner and capture a fresh page after the storefront is updated."}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setView("playbook")}
                    >
                      Open PDP playbook
                      <ArrowRight size={15} />
                    </button>
                  </section>
                </>
              )}
              {(view === "products" || view === "content") && (
                <section className="section-card">
                  <div className="section-heading">
                    <div>
                      <h3>
                        {view === "content"
                          ? "Choose a product to improve"
                          : "All products"}
                        <span className="count-chip">
                          {data.products.length}
                        </span>
                      </h3>
                      <p className="muted small">
                        {view === "content"
                          ? "Save titles, descriptions, specifications, FAQs and Arabic copy as editorial drafts."
                          : "Sorted by high-priority findings, then open improvements."}
                      </p>
                    </div>
                    <SearchBox value={query} set={setQuery} />
                  </div>
                  <ProductTable
                    products={products}
                    open={setProductId}
                    content={view === "content"}
                  />
                  {!products.length && (
                    <Empty
                      title={
                        query
                          ? "No matching products"
                          : "Your product library is empty"
                      }
                      text={
                        query
                          ? "Try another title, SKU or brand."
                          : "Import product fields or start a live audit to create your first product records."
                      }
                      action="Add products"
                      onClick={() => startAudit()}
                    />
                  )}
                </section>
              )}
              {view === "findings" && (
                <section className="section-card">
                  <div className="section-heading">
                    <h3>
                      Improvement queue
                      <span className="count-chip">{findings.length}</span>
                    </h3>
                    <button
                      className="secondary"
                      onClick={() => exportFindings(findings)}
                      disabled={!findings.length}
                    >
                      <Download size={15} />
                      Export filtered plan
                    </button>
                  </div>
                  <div className="filter-row">
                    <SearchBox value={query} set={setQuery} />
                    <select
                      aria-label="Filter workflow status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {[
                        "active",
                        "all",
                        "open",
                        "in_progress",
                        "ready_for_recheck",
                        "accepted_risk",
                        "not_detected",
                      ].map((x) => (
                        <option key={x} value={x}>
                          {label(x)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      <option value="all">All priorities</option>
                      <option value="high">High priority</option>
                      <option value="review">Review</option>
                      <option value="low">Low</option>
                    </select>
                    <select
                      aria-label="Filter category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="all">All categories</option>
                      {Array.from(
                        new Set(
                          data.findings.map((f) => f.category || "content"),
                        ),
                      ).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter owner"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                    >
                      <option value="all">All owners</option>
                      <option value="unassigned">Unassigned</option>
                      {Array.from(
                        new Set(
                          data.findings.map((f) => f.owner).filter(Boolean),
                        ),
                      ).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                  <div className="queue-list">
                    {findings.map((f) => (
                      <button
                        key={`${f.productId}-${f.id}`}
                        onClick={() => {
                          setFocusedFinding(f.id);
                          setProductId(f.productId!);
                        }}
                      >
                        <span
                          className={`priority-dot ${f.severity === "high" ? "red" : "amber"}`}
                        />
                        <div>
                          <span className="small muted">{f.productTitle}</span>
                          <strong>{f.finding}</strong>
                          <p>{f.action}</p>
                        </div>
                        <div className="queue-meta">
                          <span className="badge neutral">
                            {label(f.status)}
                          </span>
                          <span>
                            {f.owner || "Unassigned"}
                            {f.dueDate ? ` · Due ${f.dueDate}` : ""}
                          </span>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                  {!findings.length && (
                    <Empty
                      title="No findings in this view"
                      text="Try another filter or audit more products. No findings does not certify a product as accurate."
                    />
                  )}
                </section>
              )}
              {view === "audits" && (
                <>
                  <section className="section-card">
                    <div className="section-heading">
                      <div>
                        <h3>Saved audit history</h3>
                        <p className="muted small">
                          Saved runs and screenshots remain available beyond the
                          temporary 24-hour audit window.
                        </p>
                      </div>
                    </div>
                    <div className="audit-history">
                      {data.audits.map((a) => (
                        <article key={a.id}>
                          <span className="audit-icon">
                            <Activity size={19} />
                          </span>
                          <div>
                            <strong>
                              {a.total} product{a.total !== 1 ? "s" : ""} ·{" "}
                              {a.reassessedFrom
                                ? "Saved-evidence reassessment"
                                : a.mode === "live"
                                  ? "Live page audit"
                                  : "Catalog assessment"}
                            </strong>
                            <p>
                              {date(a.created)} UAE · {a.id.slice(0, 8)} ·{" "}
                              {a.timings?.totalSeconds
                                ? `${a.timings.totalSeconds}s total`
                                : "Timing not recorded"}
                            </p>
                          </div>
                          <span
                            className={`badge ${a.status === "failed" ? "red" : "neutral"}`}
                          >
                            {a.status}
                          </span>
                          <button
                            className="secondary"
                            disabled={!!running}
                            onClick={() => reassess(a.id)}
                          >
                            Reassess saved evidence
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Export audit ${a.id.slice(0, 8)}`}
                            onClick={async () => {
                              try {
                                download(
                                  "fepy-audit.json",
                                  await api(`/api/catalog-ai/${a.id}`),
                                );
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Export failed.",
                                );
                              }
                            }}
                          >
                            <Download size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                    {!data.audits.length && (
                      <Empty
                        title="No saved audits yet"
                        text="Start a live audit, or save an existing recent run below."
                        action="New audit"
                        onClick={() => startAudit()}
                      />
                    )}
                  </section>
                  <RecentAudits
                    saved={data.audits.map((a) => a.id)}
                    save={importRecent}
                  />
                </>
              )}
              {view === "reports" && (
                <section className="section-card report-card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">PRODUCT QUALITY REVIEW</p>
                      <h2>{data.project.name}</h2>
                      <p className="muted small">
                        Generated{" "}
                        {new Date().toLocaleString("en-AE", {
                          timeZone: "Asia/Dubai",
                        })}{" "}
                        UAE · Captured evidence, editorial workflow and recorded
                        findings
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => window.print()}
                    >
                      Print / save PDF
                    </button>
                  </div>
                  <div className="metric-grid">
                    <Metric
                      label="Products"
                      value={data.products.length}
                      sub="In this project"
                    />
                    <Metric
                      label="Active findings"
                      value={allActive.length}
                      sub={`${high} high priority`}
                    />
                    <Metric
                      label="Not detected on recheck"
                      value={
                        data.findings.filter((f) => f.status === "not_detected")
                          .length
                      }
                      sub="Previously identified finding"
                    />
                    <Metric
                      label="Audited without open findings"
                      value={cleanCapture}
                      sub="Within implemented checks"
                    />
                  </div>
                  <h3>Priority product review</h3>
                  <ProductTable products={data.products} open={setProductId} />
                  <div className="detail-actions">
                    <button
                      className="primary"
                      onClick={() => exportFindings(data.findings)}
                    >
                      <Download size={15} />
                      Export complete improvement plan
                    </button>
                    <button className="secondary" onClick={backup}>
                      Export evidence & drafts
                    </button>
                  </div>
                  <div className="scope-note">
                    This report covers stored fields, implemented page rules and
                    returned AI assessments. It does not establish legal
                    compliance, accessibility conformance, conversion lift, Core
                    Web Vitals or rankings. Those require their own tests and
                    measurement.
                  </div>
                </section>
              )}
              {view === "playbook" && <Playbook />}
            </>
          )}
          <footer className="workspace-footer">
            <span>FEPY Product Intelligence</span>
            <span>Captured evidence → Reviewed action → Fresh recheck</span>
            <span>All times UAE</span>
          </footer>
        </main>
      </div>
      {browserOpen && (
        <Modal title="Browser sessions" close={() => setBrowserOpen(false)}>
          <BrowserManager running={!!running} />
        </Modal>
      )}
      {newProject && (
        <ProjectDialog
          close={() => setNewProject(false)}
          created={async (p) => {
            await loadProjects();
            setProjectId(p.id);
            setNewProject(false);
            setView("overview");
          }}
        />
      )}
      {auditOpen && (
        <AuditDialog
          urls={auditUrls}
          projectId={projectId}
          close={() => setAuditOpen(false)}
          submitted={submitted}
          imported={async () => {
            setAuditOpen(false);
            setView("products");
            setNotice(
              "Catalog fields saved. Presence checks are available; manufacturer accuracy has not been verified.",
            );
            await reload();
          }}
        />
      )}
      {productId && (
        <ProductDetail
          id={productId}
          initialTab={view === "content" ? "content" : "findings"}
          focusFinding={view === "findings" ? focusedFinding : undefined}
          onClose={() => setProductId(null)}
          onChange={reload}
          onAudit={startAudit}
        />
      )}
    </div>
  );
}
function Metric({
  label: caption,
  value,
  sub,
  icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon?: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <div>
        <span>{caption}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{sub}</p>
    </article>
  );
}
function SearchBox({
  value,
  set,
}: {
  value: string;
  set: (s: string) => void;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input
        aria-label="Search products or findings"
        placeholder="Search title, SKU or finding…"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function ProductTable({
  products,
  open,
  content = false,
}: {
  products: ProductSummary[];
  open: (id: string) => void;
  content?: boolean;
}) {
  if (!products.length) return null;
  return (
    <div className="table-scroll">
      <table className="product-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Captured fields</th>
            <th>Improvements</th>
            <th>{content ? "Saved drafts" : "Last activity"}</th>
            <th>
              <span className="sr-only">Open product</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="product-name" onClick={() => open(p.id)}>
                  <span className="product-symbol">
                    <Package size={18} />
                  </span>
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {p.sku || p.brand || "SKU not captured"} · {p.auditCount}{" "}
                      audit{p.auditCount !== 1 ? "s" : ""}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <div className="mini-meter">
                  <span style={{ width: `${coveragePercent(p.coverage)}%` }} />
                </div>
                <span className="small muted">
                  {coveragePercent(p.coverage)}% available
                </span>
              </td>
              <td>
                <span
                  className={`badge ${p.high ? "red" : p.open ? "amber" : "neutral"}`}
                >
                  {p.high
                    ? `${p.high} high · ${p.open} open`
                    : `${p.open} open`}
                </span>
              </td>
              <td className="small muted">
                {content ? `${p.draftCount} fields` : date(p.updated)}
              </td>
              <td>
                <button
                  aria-label={`Open ${p.title}`}
                  className="icon-button"
                  onClick={() => open(p.id)}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <Package size={27} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={onClick}>
          {action}
          <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}
function ProjectDialog({
  close,
  created,
}: {
  close: () => void;
  created: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Create an improvement project" close={close}>
      <p className="muted">
        Group products by category, campaign or team. Audits, findings and
        drafts stay together.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            created(
              await api<Project>("/api/workspace/projects", "POST", {
                name,
                description,
              }),
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not create project.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project name
          <input
            required
            maxLength={80}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Power tools · PDP improvements"
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={500}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="The products and outcomes this team is working on"
          />
        </label>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !name.trim()}>
          <FolderPlus size={16} />
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = document.querySelector(".workspace-modal") as HTMLElement;
    const controls = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]",
        ) || [],
      ).filter((e) => e.offsetParent !== null);
    controls()[0]?.focus();
    const background = document.querySelectorAll(
      ".workspace-sidebar,.workspace-main",
    );
    background.forEach((e) => e.setAttribute("inert", ""));
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
    document.addEventListener("keydown", handler);
    return () => {
      background.forEach((e) => e.removeAttribute("inert"));
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className="modal-overlay">
      <section
        className="workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function BrowserManager({ running }: { running: boolean }) {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const update = useCallback((s: BrowserSession | null) => setSession(s), []);
  return (
    <BrowserPanel session={session} onSession={update} running={running} />
  );
}
function AuditDialog({
  urls: initial,
  projectId,
  close,
  submitted,
  imported,
}: {
  urls: string;
  projectId: string;
  close: () => void;
  submitted: (j: Job) => void;
  imported: () => void;
}) {
  const [mode, setMode] = useState("live");
  const [urls, setUrls] = useState(initial);
  const [csv, setCsv] = useState("");
  const [refs, setRefs] = useState("");
  const [decisions, setDecisions] = useState(true);
  const [detailed, setDetailed] = useState(true);
  const [similarity, setSimilarity] = useState(false);
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = useCallback((s: BrowserSession | null, a: boolean) => {
    setSession(s);
    setApproved(a);
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    try {
      if (mode === "csv") {
        const rows = parseCsv(csv);
        if (!rows.length || rows.length > 500)
          throw Error("Import 1–500 products per batch.");
        await api(`/api/workspace/projects/${projectId}/products`, "POST", {
          rows,
        });
        imported();
        return;
      }
      const pages = Array.from(new Set(urls.split(/\s+/).filter(Boolean)));
      if (!pages.length || pages.length > 100)
        throw Error("Enter 1–100 FEPY product URLs.");
      if (session?.status !== "active" || !approved)
        throw Error(
          "Start or resume an authorized UAE browser session before auditing live pages.",
        );
      const references = refs.split(/\s+/).filter(Boolean);
      if (references.length > 2)
        throw Error("Use up to two manufacturer PDFs.");
      submitted(
        await api<Job>("/api/catalog-live", "POST", {
          projectId,
          urls: pages,
          browserSessionId: session.id,
          decisions,
          detailed,
          embeddings: similarity,
          referenceUrls: references,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit could not start.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add products & start an audit" close={close}>
      <div className="segmented">
        {["live", "csv"].map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            disabled={busy}
          >
            {m === "live" ? "Live FEPY pages" : "Import catalog CSV"}
          </button>
        ))}
      </div>
      {mode === "live" ? (
        <>
          <label>
            Product page URLs
            <textarea
              autoFocus
              rows={4}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://www.fepy.com/your-product"
              disabled={busy}
            />
          </label>
          <p className="muted small">
            One canonical HTTPS FEPY product URL per line, up to 100. Each page
            is read with desktop and mobile screenshot evidence.
          </p>
          <div className="audit-options">
            <label>
              <input
                type="checkbox"
                checked={decisions}
                onChange={(e) => setDecisions(e.target.checked)}
                disabled={busy}
              />
              Fast content & image assessments
            </label>
            <label>
              <input
                type="checkbox"
                checked={detailed}
                onChange={(e) => setDetailed(e.target.checked)}
                disabled={busy}
              />
              Detailed evidence & manufacturer review
            </label>
            <label>
              <input
                type="checkbox"
                checked={similarity}
                onChange={(e) => setSimilarity(e.target.checked)}
                disabled={busy}
              />
              Similarity candidates · slower first load
            </label>
          </div>
          <label>
            Manufacturer PDF sources · optional
            <textarea
              rows={2}
              value={refs}
              onChange={(e) => setRefs(e.target.value)}
              placeholder="Approved Henkel, Bosch Professional or Makita UAE PDF URL"
              disabled={busy}
            />
          </label>
          <details className="browser-setup" open={!session}>
            <summary>UAE browser session & site access</summary>
            <BrowserPanel session={session} onSession={update} running={busy} />
          </details>
          <p className="muted small">
            Browser and AI charges apply. A site checkpoint stops collection; it
            is never treated as passing. The session remains available in the
            advanced console to stop after your audit.
          </p>
        </>
      ) : (
        <>
          <label>
            Upload catalog CSV
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 4 * 1024 * 1024) {
                  setError("Use a CSV smaller than 4 MB.");
                  return;
                }
                setCsv(await f.text());
              }}
            />
          </label>
          <label>
            Product CSV
            <textarea
              rows={7}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="sku,product_url,title_en,brand,model_number,description_en,…"
              disabled={busy}
            />
          </label>
          <p className="notice">
            Imports store your catalog fields and run presence checks. They do
            not independently validate product facts or visit FEPY. Add a
            canonical product URL or SKU to every row.
          </p>
          <button
            className="text-button"
            onClick={() =>
              download("fepy-column-reference.json", {
                columns: [
                  "sku",
                  "product_url",
                  "title_en",
                  "title_ar",
                  "brand",
                  "model_number",
                  "category",
                  "price_aed",
                  "currency",
                  "stock_status",
                  "description_en",
                  "image_url_1",
                  "image_alt_1",
                  "meta_title",
                  "meta_description",
                  "specs_inline",
                  "faq_text",
                ],
                specsFormat: "Label: value | Label: value",
              })
            }
          >
            Download column reference
          </button>
        </>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button className="secondary" disabled={busy} onClick={close}>
          Close
        </button>
        <button className="primary" disabled={busy} onClick={run}>
          {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{" "}
          {busy
            ? "Submitting…"
            : mode === "live"
              ? "Start evidence audit"
              : "Save products to library"}
        </button>
      </div>
    </Modal>
  );
}
function RecentAudits({
  saved,
  save,
}: {
  saved: string[];
  save: (id: string) => void;
}) {
  const [items, setItems] = useState<
    {
      id: string;
      title: string;
      created: number;
      status: string;
      total: number;
    }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ jobs: typeof items }>("/api/catalog-ai/history")
      .then((d) => setItems(d.jobs || []))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="section-card">
      <h3>Save an existing recent run</h3>
      <p className="muted small">
        Unsaved runs remain temporary for 24 hours. Saving a run preserves its
        evidence in this project.
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {items
        .filter(
          (a) =>
            !saved.includes(a.id) && !["queued", "running"].includes(a.status),
        )
        .map((a) => (
          <div className="recent-run" key={a.id}>
            <div>
              <strong>{a.title || `${a.total} product audit`}</strong>
              <p className="muted small">
                {date(a.created)} UAE · {a.status}
              </p>
            </div>
            <button className="secondary" onClick={() => save(a.id)}>
              Save to project
            </button>
          </div>
        ))}
    </section>
  );
}
function Playbook() {
  const sections = [
    {
      title: "Product identity & variants",
      text: "Make the exact sellable item unmistakable.",
      checks: [
        "Verified brand, model, part number and SKU",
        "Pack quantity, size, colour and included accessories",
        "Category aligned with the product’s actual use",
      ],
      scope: "Captured fields and consistency checks are available.",
    },
    {
      title: "Accuracy & specification quality",
      text: "Fix contradictions before improving persuasion.",
      checks: [
        "Manufacturer source matches the exact model and region",
        "Units, test conditions and application limits remain attached",
        "FAQ, specs and claims agree with the source",
      ],
      scope:
        "Approved PDF comparison and quoted-evidence review are available.",
    },
    {
      title: "Useful content & answers",
      text: "Help the customer choose, use and compare.",
      checks: [
        "Intended use, benefits and differences backed by facts",
        "Compatibility, application, cure times and limitations",
        "Concise FAQs based on actual questions, not invented claims",
      ],
      scope:
        "Evidence findings and manual draft editing are available. Claims require editorial review.",
    },
    {
      title: "Search & structured information",
      text: "Preserve identity across search and answer surfaces.",
      checks: [
        "Unique, readable titles and descriptions retaining exact variants",
        "Product schema, canonical and indexing signals",
        "Labelled specifications rather than keyword stuffing",
      ],
      scope:
        "Captured metadata and implemented schema checks are available. Ranking and rich-result eligibility need separate validation.",
    },
    {
      title: "Visuals, mobile & accessibility",
      text: "Make product information understandable and usable.",
      checks: [
        "Exact variant images, useful angles and readable labels",
        "Relevant image descriptions and keyboard-accessible controls",
        "Mobile layout, product information visibility and interaction",
      ],
      scope:
        "First-viewport screenshots and captured image checks are available. Full interaction, accessibility and performance testing are not automated here.",
    },
    {
      title: "Commerce & customer confidence",
      text: "Give clear reasons to buy and clear expectations.",
      checks: [
        "Current price, stock and delivery policy agree",
        "Returns, warranty and safety wording are source-backed",
        "Reviews belong to the correct SKU and show provenance",
      ],
      scope:
        "Captured commerce contradictions and review relevance signals are available. Checkout and policy enforcement need manual testing.",
    },
    {
      title: "Arabic & regional quality",
      text: "Serve the UAE customer in the right context.",
      checks: [
        "Human-reviewed Arabic title, description and terminology",
        "AED, regional model, local delivery and product suitability",
        "RTL layout, language switching and translated structured data",
      ],
      scope:
        "Arabic catalog fields and draft editing are available. An English capture does not audit the Arabic storefront.",
    },
    {
      title: "Continuous improvement",
      text: "Measure whether the work helped the customer.",
      checks: [
        "Assign an owner, due date and documented decision",
        "Publish through your existing reviewed commerce workflow",
        "Capture fresh evidence and compare versions",
        "Track conversion, returns and search performance with analytics",
      ],
      scope:
        "Assignments, saved drafts, history and fresh rechecks are available. Storefront publishing, schedules and analytics connections need separate integration.",
    },
  ];
  return (
    <div className="playbook-grid">
      {sections.map((s, i) => (
        <section className="section-card" key={s.title}>
          <span className="playbook-number">0{i + 1}</span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
          <ul>
            {s.checks.map((c) => (
              <li key={c}>
                <CheckCircle2 size={15} />
                {c}
              </li>
            ))}
          </ul>
          <div className="playbook-scope">{s.scope}</div>
        </section>
      ))}
    </div>
  );
}
