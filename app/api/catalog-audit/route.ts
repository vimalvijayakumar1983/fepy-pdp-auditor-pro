import { NextResponse } from "next/server";
import { auditCatalog, type CatalogRow } from "../../../lib/catalogAudit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.rows) ? (body.rows as CatalogRow[]) : [];
  if (!rows.length) {
    return NextResponse.json({ error: "Send { rows: [...] } from the catalog export." }, { status: 400 });
  }
  return NextResponse.json(auditCatalog(rows.slice(0, 5000)));
}
