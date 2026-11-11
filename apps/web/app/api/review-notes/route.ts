import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { log, logged } from "@/lib/log";

/**
 * Design review notes, local development only: each note goes to `.local/review-notes.md` at the
 * repo root (gitignored), with the page it was written on. Nothing here exists in a production build.
 */
const FILE = path.join(process.cwd(), "..", "..", ".local", "review-notes.md");
const dev = process.env.NODE_ENV === "development";

export const GET = logged("GET /api/review-notes", async () => {
  if (!dev) return new NextResponse(null, { status: 404 });
  const text = await readFile(FILE, "utf8").catch(() => "");
  return NextResponse.json({ count: (text.match(/^## /gm) ?? []).length });
});

export const POST = logged("POST /api/review-notes", async (req: Request) => {
  if (!dev) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => null)) as { note?: unknown; page?: unknown; width?: unknown; screen?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 4000) : "";
  if (!note) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  const page = typeof body?.page === "string" ? body.page.slice(0, 300) : "?";
  const screen = typeof body?.screen === "string" ? body.screen.slice(0, 200) : "";
  const width = typeof body?.width === "number" ? Math.round(body.width) : 0;
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  await mkdir(path.dirname(FILE), { recursive: true });
  await appendFile(FILE, `## ${when} · ${page} · ${width}px${screen ? ` · ${screen}` : ""}\n\n${note}\n\n`);
  // The note is the reviewer's own text, so only its length is logged.
  log("review_note.saved", { chars: note.length });
  return NextResponse.json({ ok: true });
});
