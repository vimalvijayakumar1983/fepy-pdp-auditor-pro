import { NextRequest, NextResponse } from "next/server";
import { COOKIE, sameOrigin, secureRequest } from "@/lib/session";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: secureRequest(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}
