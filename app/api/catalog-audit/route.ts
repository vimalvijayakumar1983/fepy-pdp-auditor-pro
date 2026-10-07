import { NextResponse } from "next/server";
import { z } from "zod";
import { auditCatalog } from "../../../lib/catalogAudit";
const row = z.record(z.union([z.string().max(8000), z.number().finite(), z.null()])).refine(value => Object.keys(value).length <= 40);
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ rows: z.array(row).min(1).max(5000) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Send 1–5,000 product rows with text or numeric fields (maximum 8,000 characters per field)." }, { status: 400 });
  return NextResponse.json(auditCatalog(parsed.data.rows.map(value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item ?? ""])))));
}
