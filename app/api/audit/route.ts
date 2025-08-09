import { NextRequest, NextResponse } from "next/server";
import { mockFetchPdp, draftFixes } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];
  const rows = urls.map((u) => ({ url: u, audit: draftFixes(mockFetchPdp(u)) }));
  return NextResponse.json({ rows });
}
