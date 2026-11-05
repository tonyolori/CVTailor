import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "fixtures") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SOURCES = ["apps/worker/src", "apps/web/app", "apps/web/components", "apps/web/lib", "packages/core/src", "packages/llm/src", "packages/render/src"].flatMap((d) => walk(join(ROOT, d)));
const NOT_TESTS = SOURCES.filter((f) => !f.endsWith(".test.ts"));
const rel = (f: string) => relative(ROOT, f);

/** One-off scripts run by hand print their results. Pipeline code goes through log(), which refuses free text. */
const MAY_PRINT = /apps\/web\/lib\/log\.ts|apps\/worker\/src\/(log\.ts|llm-check\.ts|render-check\.ts|seed\/|eval\/)/;

describe("log hygiene", () => {
  it("pipeline and web code never call console directly", () => {
    const offenders = NOT_TESTS.filter((f) => !MAY_PRINT.test(rel(f)) && /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("log calls pass no field that could hold personal text", () => {
    const risky = /\blog\([^)]*\b(email|text|html|summary|description|resume|facts?|prompt|body)\s*[:,}]/;
    const offenders = NOT_TESTS.filter((f) => !MAY_PRINT.test(rel(f)) && risky.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("secrets", () => {
  it("the service-role key is never read in code that reaches a browser", () => {
    const clientFiles = NOT_TESTS.filter((f) => f.includes("apps/web") && /^["']use client["']/m.test(readFileSync(f, "utf8")));
    expect(clientFiles.length).toBeGreaterThan(3);
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/SERVICE_ROLE|supabase\/admin|PAYSTACK_SECRET/);
    }
    expect(NOT_TESTS.some((f) => /NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET)/.test(readFileSync(f, "utf8")))).toBe(false);
  });

  it("the admin client can't be imported from client code", () => {
    expect(readFileSync(join(ROOT, "apps/web/lib/supabase/admin.ts"), "utf8")).toContain('import "server-only"');
  });

  it("no provider key literals in source", () => {
    const offenders = NOT_TESTS.filter((f) => /sk-ant-[a-z0-9]|re_[A-Za-z0-9]{16,}|sk_live_[a-z0-9]/i.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("no hard-coding", () => {
  it("model IDs only appear in the price table and config comments", () => {
    const offenders = NOT_TESTS.filter((f) => /["'`]claude-(opus|sonnet|haiku|fable)[-\w]*["'`]/.test(readFileSync(f, "utf8")) && !rel(f).endsWith("packages/llm/src/api.ts"));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the owner's seed file can't be committed", () => {
    expect(execFileSync("git", ["check-ignore", "private/owner.json"], { cwd: ROOT, encoding: "utf8" }).trim()).toBe("private/owner.json");
  });

  it("no personal data reaches tracked source", () => {
    // The owner's details live only in a gitignored file, so a fresh clone has nothing to check.
    const seedPath = join(ROOT, "private/owner.json");
    if (!existsSync(seedPath)) return;
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as { accountEmail: string; notifyEmail?: string; facts: { contact: { email: string; phone?: string } } };
    const secrets = [seed.accountEmail, seed.notifyEmail, seed.facts.contact.email, seed.facts.contact.phone].filter((v): v is string => Boolean(v));
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx|md|json|sql|toml|yml)$/.test(f) && existsSync(join(ROOT, f)));
    const offenders = tracked.filter((f) => secrets.some((v) => readFileSync(join(ROOT, f), "utf8").includes(v)));
    expect(offenders).toEqual([]);
  });

  it("core and prompts assume no profession, work mode or country", () => {
    const core = SOURCES.filter((f) => rel(f).startsWith("packages/core/src") && !/test|personas/.test(f));
    const offenders = core.filter((f) => {
      const src = readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      return /\b(nigeria|lagos|AI engineer|software engineer|backend engineer|\bMCP\b|\bRAG\b)\b/i.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the worker's real runtime", () => {
  it("renders a PDF under tsx, which vitest doesn't exercise", () => {
    const out = execFileSync(join(ROOT, "node_modules/.bin/tsx"), ["src/render-check.ts"], {
      cwd: join(ROOT, "apps/worker"),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });
    expect(out).toMatch(/pdf pages 1/);
  }, 60_000);
});
