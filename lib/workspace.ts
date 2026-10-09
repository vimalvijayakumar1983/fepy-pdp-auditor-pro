import type { Quality, Issue } from "@/app/catalog/QualityReview";
import type { LivePage } from "@/app/catalog/LiveEvidence";
export type Coverage = { name: string; present: number; total: number };
export type Finding = Issue & {
  id: string;
  status: string;
  owner: string;
  note: string;
  dueDate: string;
  auditId?: string;
  capturedAt?: string;
  productId?: string;
  productTitle?: string;
  revision?: number;
};
export type AuditResult = {
  rowIndex: number;
  sku: string;
  live?: LivePage;
  quality?: Quality;
  decisions: {
    status: string;
    checks?: {
      name: string;
      assessment: string;
      needsReview: boolean;
      confidence?: number | null;
    }[];
  };
  embeddings: { status: string };
  timings?: Record<string, number | boolean>;
};
export type Job = {
  id: string;
  created: number;
  status: string;
  mode?: string;
  total: number;
  completed: number;
  pagesCompleted?: number;
  phase?: string;
  error?: string;
  results: AuditResult[];
  sourceRows?: Record<string, string>[];
  timings?: Record<string, number>;
  reassessedFrom?: string;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  created: number;
  products?: number;
  open?: number;
  high?: number;
  audits?: number;
};
export type ProductSummary = {
  id: string;
  title: string;
  sku: string;
  url: string;
  brand: string;
  category: string;
  updated: number;
  revision: number;
  open: number;
  high: number;
  auditCount: number;
  latestAudit?: string;
  coverage: Coverage[];
  draftCount: number;
  owners: string[];
};
export type SavedAudit = {
  id: string;
  rowIndex: number;
  created: number;
  capturedAt?: string;
  status: string;
  reassessedFrom?: string;
};
export type Product = {
  id: string;
  projectId: string;
  identity: string;
  row: Record<string, string>;
  created: number;
  updated: number;
  revision: number;
  findings: Finding[];
  drafts: Record<
    string,
    {
      value: string;
      savedAt: number;
      basedOnAudit?: string;
      note: string;
      status: string;
    }
  >;
  activity: { at: number; kind: string; message: string }[];
  audits: SavedAudit[];
  coverage: Coverage[];
  latestAudit?: string;
  latestResult?: AuditResult;
  capturedAt?: string;
};
export type ProjectData = {
  project: Project;
  products: ProductSummary[];
  findings: Finding[];
  audits: (Omit<SavedAudit, "rowIndex"> & {
    total: number;
    mode: string;
    timings: Record<string, number>;
  })[];
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (response.status === 401) {
    window.location.assign("/login");
    throw Error("Your session expired. Sign in again.");
  }
  if (!response.ok)
    throw Error(
      data.error || data.detail || "This request could not be completed.",
    );
  return data;
}
export function label(value: string) {
  return value.replace(/_/g, " ");
}
export function date(value?: number | string) {
  return value
    ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
        "en-AE",
        {
          timeZone: "Asia/Dubai",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        },
      )
    : "Not captured";
}
export function coveragePercent(items: Coverage[]) {
  const total = items.reduce((n, x) => n + x.total, 0);
  return total
    ? Math.round((items.reduce((n, x) => n + x.present, 0) / total) * 100)
    : 0;
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function exportFindings(findings: Finding[]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^\s*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [
    [
      "Product",
      "Priority",
      "Category",
      "Finding",
      "Evidence",
      "Action",
      "Status",
      "Owner",
      "Due date",
      "Note",
      "Source",
      "Audit",
    ],
    ...findings.map((f) => [
      f.productTitle,
      f.severity,
      f.category,
      f.finding,
      f.evidence,
      f.action,
      f.status,
      f.owner,
      f.dueDate,
      f.note,
      f.sourceUrl,
      f.auditId,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "fepy-improvement-plan.csv";
  a.click();
  URL.revokeObjectURL(url);
}
