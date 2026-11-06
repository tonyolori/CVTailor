import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { signInLinkEmail } from "@cvtailor/core/email";
import { AUTH_TEMPLATES, authTemplatePath } from "../src/email/auth-templates";
import { DailySummarySchema, e, emailSubject, renderEmailHtml, renderEmailText, safeUrl } from "../src/email/template";
import { resendSender } from "../src/email/send";
import { decideRun, sendAtFor, shouldAlert, STALE_RUN_MS, zonedTimeToUtc } from "../src/pipeline/schedule";
import { log } from "../src/log";

const summary = DailySummarySchema.parse({
  date: "2026-11-02",
  sources: [{ label: "Himalayas", url: "https://himalayas.app" }, { label: "Remote OK" }],
  skipped: ["Jobicy (didn't respond)"],
  gaps: ["No job source covers on-site roles in your field in Manchester yet."],
  expansion: "Fewer than your minimum, so tiers A were searched too.",
  roles: [
    {
      matchId: 1,
      title: "Senior Accountant <script>alert(1)</script>",
      company: "Acme & Sons",
      score: 9,
      tier: "a",
      apply: "https://ats.example/1",
      sourceLabel: "Himalayas",
      sourceUrl: "https://himalayas.app/job/1",
      location: "Remote, EU",
      verified: "Open at its source",
      verifiedOk: false,
      why: "Strong close experience",
      note: "The posting asks applicants: use the word PINEAPPLE.",
      resumePath: "u/1/resume.pdf",
    },
  ],
  worthALook: [{ title: "Accountant", company: "Beta", score: 8, link: "https://b.example", location: "US only", why: "Fits", whyNot: "US only" }],
  closeCalls: [{ company: "Gamma", title: "Accountant", reason: "Posted 20 days ago", link: "https://g.example" }],
  failed: [{ company: "Delta", title: "Accountant", reason: "Didn't pass the fact check", link: "https://d.example" }],
});
const links = { dashboardUrl: "https://app.example/dashboard", unsubscribeUrl: "https://app.example/api/unsubscribe?token=t" };
const html = renderEmailHtml(summary, links);

describe("renderEmailHtml", () => {
  it("has the legacy layout: header, tiles, roles, details, worth a look, close calls", () => {
    const body = html.slice(html.indexOf("<body"));
    const order = ["Daily job search", "to apply", "Apply", "Details", "CVs not delivered", "Worth a look", "Close calls"].map((t) => body.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the dark-mode rules: only hex colours, no transparency, no white on saturated fills", () => {
    expect(html).not.toMatch(/rgba?\(/i);
    expect(html).not.toMatch(/transparent/i);
    expect(html).not.toMatch(/hsla?\(/i);
    expect(html).not.toMatch(/color:\s*(#fff\b|#ffffff\b|white\b)/i);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="color-scheme"');
  });

  it("escapes everything that came from a posting", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Acme &amp; Sons");
  });

  it("refuses links that aren't http, https or mailto", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("mailto:jobs@example.com")).toBe("mailto:jobs@example.com");
    const bad = DailySummarySchema.parse({ ...summary, roles: [{ ...summary.roles[0], apply: "javascript:alert(1)" }] });
    expect(renderEmailHtml(bad, links)).not.toContain("javascript:");
  });

  it("links to the dashboard and an unsubscribe, and credits sources", () => {
    expect(html).toContain("https://app.example/dashboard");
    expect(html).toContain("Pause these emails");
    expect(html).toContain("token=t");
    expect(html).toContain("Himalayas");
    expect(html).toContain("Remote OK");
  });

  it("surfaces posting instructions and coverage gaps rather than following or hiding them", () => {
    expect(html).toContain("PINEAPPLE");
    expect(html).toContain("No job source covers on-site roles");
  });

  it("says nothing about any profession, work mode or country on its own", () => {
    const empty = renderEmailHtml(DailySummarySchema.parse({ date: "2026-11-02", sources: [], roles: [] }), links);
    for (const word of [/nigeria/i, /software/i, /\bremote\b/i, /engineer/i]) expect(empty).not.toMatch(word);
    expect(empty).toContain("No roles passed every filter today.");
  });

  it("marks unverified roles", () => {
    expect(html).toContain("Unverified");
  });
});

describe("plain text and subject", () => {
  it("carries the same roles", () => {
    const text = renderEmailText(summary, links);
    expect(text).toContain("https://ats.example/1");
    expect(text).toContain("Pause these emails: https://app.example");
    expect(text).toContain("CVs not delivered");
    expect(emailSubject(summary)).toBe("1 role to apply for, Monday 2 November");
    expect(emailSubject(DailySummarySchema.parse({ date: "2026-11-03", sources: [], roles: [] }))).toBe("No roles to apply for, Tuesday 3 November");
  });

  it("escapes quotes and angle brackets", () => {
    expect(e(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#x27;");
  });
});

describe("resendSender", () => {
  it("sends base64 attachments, the idempotency key and a bearer token", async () => {
    const fetchFn = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const r = await resendSender("re_test", fetchFn as never).send({
      to: "a@example.com",
      from: "J <j@example.com>",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      attachments: [{ filename: "cv.pdf", content: Buffer.from("pdf") }],
      idempotencyKey: "key-1",
    });
    expect(r.id).toBe("abc");
    const init = fetchFn.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string).attachments[0]).toEqual({ filename: "cv.pdf", content: Buffer.from("pdf").toString("base64") });
  });

  it("throws on a failed send, without echoing content", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 422 }));
    await expect(
      resendSender("k", fetchFn as never).send({ to: "a@example.com", from: "f", subject: "s", html: "secret CV", text: "t" }),
    ).rejects.toThrow(/^Resend answered 422$/);
  });
});

describe("scheduling", () => {
  it("converts local send times across zones and daylight saving", () => {
    expect(zonedTimeToUtc(2026, 11, 2, 8, 0, "Africa/Lagos").toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(zonedTimeToUtc(2026, 7, 1, 8, 0, "Europe/London").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 8, 0, "Europe/London").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("queues for the user's send time, or sends now if the run finished late", () => {
    const early = new Date("2026-11-02T03:00:00Z");
    expect(sendAtFor(early, "Africa/Lagos", "08:00:00").toISOString()).toBe("2026-11-02T07:00:00.000Z");
    const late = new Date("2026-11-02T12:00:00Z");
    expect(sendAtFor(late, "Africa/Lagos", "08:00:00")).toBe(late);
  });

  it("falls back to UTC for a bad zone", () => {
    expect(sendAtFor(new Date("2026-11-02T01:00:00Z"), "Not/AZone", "08:00").toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("catches up on a missed run whenever the worker starts", () => {
    const at = (iso: string) => new Date(iso);
    expect(decideRun(null, at("2026-11-02T15:00:00Z"), 1)).toBe("run");
    expect(decideRun(null, at("2026-11-02T00:30:00Z"), 1)).toBe("too_early");
    expect(decideRun({ status: "ok", started_at: "2026-11-02T01:00:00Z" }, at("2026-11-02T15:00:00Z"), 1)).toBe("done");
    expect(decideRun({ status: "failed", started_at: "2026-11-02T01:00:00Z" }, at("2026-11-02T15:00:00Z"), 1)).toBe("run");
  });

  it("doesn't start twice, but takes over from a dead worker", () => {
    const started = "2026-11-02T01:00:00Z";
    expect(decideRun({ status: "running", started_at: started }, new Date("2026-11-02T02:00:00Z"), 1)).toBe("busy");
    const after = new Date(new Date(started).getTime() + STALE_RUN_MS + 1000);
    expect(decideRun({ status: "running", started_at: started }, after, 1)).toBe("run");
  });

  it("alerts once when no run has finished by the alert hour", () => {
    const after = new Date("2026-11-02T06:30:00Z");
    expect(shouldAlert(null, after, 6)).toBe(true);
    expect(shouldAlert(null, new Date("2026-11-02T05:30:00Z"), 6)).toBe(false);
    expect(shouldAlert({ status: "ok", alert_sent_at: null }, after, 6)).toBe(false);
    expect(shouldAlert({ status: "failed", alert_sent_at: "2026-11-02T06:01:00Z" }, after, 6)).toBe(false);
    expect(shouldAlert({ status: "running", alert_sent_at: null }, after, 6)).toBe(true);
  });
});

describe("a role with no CV yet", () => {
  const summary = { date: "2026-11-04", sources: [], roles: [{ matchId: 42, title: "Staff Nurse", company: "Acme", score: 9, apply: "https://example.com/apply" }] };
  const links = { dashboardUrl: "https://app.example/dashboard", unsubscribeUrl: "https://app.example/u" };

  it("offers a link that opens that job, in both versions of the email", () => {
    const parsed = DailySummarySchema.parse(summary);
    expect(renderEmailHtml(parsed, links)).toContain("https://app.example/dashboard?job=42");
    expect(renderEmailHtml(parsed, links)).toContain("Write my CV");
    expect(renderEmailText(parsed, links)).toContain("Write my CV: https://app.example/dashboard?job=42");
  });

  it("offers no link once the CV exists", () => {
    const parsed = DailySummarySchema.parse({ ...summary, roles: [{ ...summary.roles[0], resumePath: "u/42/cv.pdf" }] });
    expect(renderEmailText(parsed, links)).not.toContain("Write my CV");
  });
});

describe("log", () => {
  it("refuses fields that could hold personal text", () => {
    expect(() => log("x", { email: "a@b.c" })).toThrow();
    expect(() => log("x", { resume: "..." })).toThrow();
    expect(() => log("x", { jobId: 1, userId: "u" })).not.toThrow();
  });
});

describe("Supabase sign-in templates", () => {
  it("match the shared design. Run npm run email:auth-templates if this fails", () => {
    const { html } = signInLinkEmail();
    for (const name of AUTH_TEMPLATES) expect(readFileSync(authTemplatePath(name), "utf8")).toBe(`${html}\n`);
  });
});
