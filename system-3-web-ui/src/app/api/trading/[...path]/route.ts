import { NextResponse } from "next/server";

function targetBase(): string {
  return process.env.NEXT_PUBLIC_TRADING_NODE_URL ?? "http://localhost:3000";
}

function apiKey(): string | null {
  const v = process.env.TRADING_NODE_API_KEY;
  return v && v.length > 0 ? v : null;
}

function requireUiAuth(req: Request): boolean {
  const pwd = process.env.UI_ACCESS_PASSWORD;
  if (!pwd) return true; // gate disabled
  const cookie = req.headers.get("cookie") ?? "";
  return cookie.split(";").some((c) => c.trim() === "ui_auth=1");
}

function allowedPath(pathParts: string[]): boolean {
  // Strict allowlist to reduce attack surface.
  const p = `/${pathParts.join("/")}`;
  return (
    p === "/health" ||
    p === "/status" ||
    p === "/positions" ||
    p === "/candidates" ||
    p === "/controls" ||
    p === "/controls/close-all" ||
    p === "/governance" ||
    p.startsWith("/governance/") ||
    p === "/metrics" ||
    p === "/metrics/prom"
  );
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  if (!host) return false;
  // Behind a proxy you may want X-Forwarded-Proto; for local dev this is fine.
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return origin === `${proto}://${host}`;
}

async function forward(req: Request, pathParts: string[]) {
  if (!requireUiAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!allowedPath(pathParts)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    // CSRF mitigation for cookie-auth: require same-origin.
    if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = targetBase();
  const url = new URL(pathParts.join("/"), base.endsWith("/") ? base : `${base}/`);
  url.search = new URL(req.url).search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  const key = apiKey();
  if (key) headers.set("x-api-key", key);

  const res = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer()
  });

  const body = await res.arrayBuffer();
  const out = new NextResponse(body, { status: res.status });
  res.headers.forEach((v, k) => out.headers.set(k, v));
  return out;
}

export async function GET(req: Request, ctx: { params: { path: string[] } }) {
  return await forward(req, ctx.params.path);
}
export async function POST(req: Request, ctx: { params: { path: string[] } }) {
  return await forward(req, ctx.params.path);
}
export async function PUT(req: Request, ctx: { params: { path: string[] } }) {
  return await forward(req, ctx.params.path);
}
export async function DELETE(req: Request, ctx: { params: { path: string[] } }) {
  return await forward(req, ctx.params.path);
}
