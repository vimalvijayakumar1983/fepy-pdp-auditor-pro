import { NextRequest, NextResponse } from "next/server";
import {
  authConfigured,
  COOKIE,
  validSession,
  sameOrigin,
} from "@/lib/session";
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico"
  )
    return NextResponse.next();
  if (!authConfigured()) {
    if (path.startsWith("/api/"))
      return NextResponse.json(
        {
          error:
            "Workspace access is not configured. Set the app password and session secret.",
        },
        { status: 503 },
      );
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!(await validSession(request.cookies.get(COOKIE)?.value))) {
    if (path.startsWith("/api/"))
      return NextResponse.json(
        { error: "Sign in to your workspace." },
        { status: 401 },
      );
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !sameOrigin(request)
  )
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
