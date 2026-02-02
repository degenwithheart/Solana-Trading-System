import crypto from "node:crypto";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const configured = process.env.UI_ACCESS_PASSWORD ?? "";
  if (!configured) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;
  const pwd = String(body?.password ?? "");

  const ok = safeEqual(pwd, configured);
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("ui_auth", "1", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return res;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
