import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.UI_ACCESS_PASSWORD;
  // If no password configured, do not gate (explicit choice).
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/unlock")) return NextResponse.next();
  if (pathname.startsWith("/api/logout")) return NextResponse.next();
  if (pathname.startsWith("/unlock")) return NextResponse.next();

  const ok = req.cookies.get("ui_auth")?.value === "1";
  if (ok) return NextResponse.next();

  // For API routes, return 401 instead of redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
