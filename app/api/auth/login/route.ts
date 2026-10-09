import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  authConfigured,
  COOKIE,
  createSession,
  sameOrigin,
  secureRequest,
} from "@/lib/session";
export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; since: number }>();
export async function POST(request: NextRequest) {
  if (!authConfigured())
    return NextResponse.json(
      {
        error:
          "Workspace access needs setup. Ask the app administrator to configure access.",
      },
      { status: 503 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  for (const [key, value] of attempts)
    if (now - value.since > 15 * 60 * 1000) attempts.delete(key);
  const record = attempts.get(ip) || { count: 0, since: now };
  if (record.count >= 10)
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  record.count++;
  attempts.set(ip, record);
  const body = await request.json().catch(() => null);
  const supplied =
    typeof body?.password === "string" && body.password.length <= 512
      ? body.password
      : "";
  const hash = (v: string) => createHash("sha256").update(v).digest();
  if (!timingSafeEqual(hash(supplied), hash(process.env.AUDITOR_APP_PASSWORD!)))
    return NextResponse.json(
      { error: "That workspace password is incorrect." },
      { status: 401 },
    );
  attempts.delete(ip);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(COOKIE, await createSession(), {
    httpOnly: true,
    secure: secureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
