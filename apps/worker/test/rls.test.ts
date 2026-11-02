import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { serviceClient } from "../src/db";

/**
 * Proves row-level security with two real signed-in users against local Supabase.
 * Needs `npm run db:start`, then `npm run db:reset`.
 */
const config = loadConfig();

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.SUPABASE_URL)) {
  throw new Error("This suite wipes and rewrites data, so it only runs against local Supabase.");
}
const admin = serviceClient(config);
const PASSWORD = "local-test-only-password";

function anon(): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

async function ensureUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  await admin.from("allowed_emails").upsert({ email });
  const existing = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!existing.data) {
    const made = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (made.error) throw made.error;
  } else {
    await admin.auth.admin.updateUserById(existing.data.id, { password: PASSWORD });
  }
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { id: data.user.id, client };
}

let a: { id: string; client: SupabaseClient };
let b: { id: string; client: SupabaseClient };
let jobId: number;
let matchB: number;
let versionB: number;

beforeAll(async () => {
  a = await ensureUser("rls.a@jobtailor.test");
  b = await ensureUser("rls.b@jobtailor.test");

  for (const u of [a, b]) {
    await admin.from("preferences").upsert({ user_id: u.id, data: { owner: u.id } });
    await admin.from("fact_library").upsert({ user_id: u.id, data: { owner: u.id } });
    await admin.from("daily_summaries").upsert({ user_id: u.id, run_date: "2026-01-01", data: {} });
    await admin.from("runs").insert({ user_id: u.id, stage: "tailor" });
  }
  const job = await admin
    .from("jobs")
    .upsert({ url: "https://example.com/rls-job", company: "Acme", title: "T", source: "test" }, { onConflict: "url" })
    .select("id")
    .single();
  if (job.error) throw job.error;
  jobId = job.data.id;
  const match = await admin
    .from("matches")
    .upsert({ user_id: b.id, job_id: jobId, decision: "picked" }, { onConflict: "user_id,job_id" })
    .select("id")
    .single();
  if (match.error) throw match.error;
  matchB = match.data.id;
  const version = await admin
    .from("resume_versions")
    .insert({ match_id: matchB, user_id: b.id, source: "ai", json: {} })
    .select("id")
    .single();
  if (version.error) throw version.error;
  versionB = version.data.id;
  await admin.from("documents").insert({
    match_id: matchB,
    user_id: b.id,
    kind: "resume_pdf",
    storage_path: `${b.id}/x.pdf`,
    version_id: versionB,
  });
  await admin.from("ai_tasks").insert({ user_id: b.id, kind: "extract_facts", input: {} });
  await admin.storage.from("documents").upload(`${b.id}/x.pdf`, new Blob(["pdf"]), { upsert: true });
});

describe("invite-only signup hook", () => {
  it("rejects an email that isn't on the allow-list", async () => {
    const { error } = await anon().auth.signUp({ email: `stranger${Date.now()}@example.com`, password: PASSWORD });
    expect(error?.message).toContain("invite-only");
  });

  it("allows an email on the allow-list, ignoring case", async () => {
    const email = `invited${Date.now()}@jobtailor.test`;
    await admin.from("allowed_emails").insert({ email });
    const { data, error } = await anon().auth.signUp({ email: email.toUpperCase(), password: PASSWORD });
    expect(error).toBeNull();
    expect(data.user?.email).toBe(email);
    if (data.user) await admin.auth.admin.deleteUser(data.user.id);
    await admin.from("allowed_emails").delete().eq("email", email);
  });
});

describe("one user cannot read another user's rows", () => {
  const ownerColumn: Record<string, string> = {
    profiles: "id",
    preferences: "user_id",
    fact_library: "user_id",
    matches: "user_id",
    resume_versions: "user_id",
    documents: "user_id",
    runs: "user_id",
    daily_summaries: "user_id",
    ai_tasks: "user_id",
    subscriptions: "user_id",
    payments: "user_id",
  };

  for (const [table, column] of Object.entries(ownerColumn)) {
    it(`${table}: A sees nothing of B's`, async () => {
      const { data, error } = await a.client.from(table).select("*").eq(column, b.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  it("B can read their own rows", async () => {
    expect((await b.client.from("matches").select("id").eq("user_id", b.id)).data).toHaveLength(1);
    expect((await b.client.from("resume_versions").select("id")).data).toHaveLength(1);
    expect((await b.client.from("preferences").select("user_id")).data).toEqual([{ user_id: b.id }]);
  });

  it("A cannot update B's rows", async () => {
    const res = await a.client.from("matches").update({ tracker_status: "applied" }).eq("id", matchB).select();
    expect(res.data ?? []).toEqual([]);
    const row = await admin.from("matches").select("tracker_status").eq("id", matchB).single();
    expect(row.data?.tracker_status).toBe("to_apply");
  });

  it("A cannot download B's PDF", async () => {
    const { data, error } = await a.client.storage.from("documents").download(`${b.id}/x.pdf`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    const own = await b.client.storage.from("documents").download(`${b.id}/x.pdf`);
    expect(own.error).toBeNull();
  });

  it("a signed-out visitor reads nothing", async () => {
    for (const table of ["profiles", "jobs", "matches", "categories"]) {
      const { data, error } = await anon().from(table).select("*");
      expect(error ?? data).toSatisfy((v: unknown) => v !== null && (!Array.isArray(v) || v.length === 0));
    }
  });
});

describe("protected columns", () => {
  for (const [column, value] of [
    ["plan", "pro"],
    ["paid_until", "2099-01-01"],
    ["is_synthetic", true],
    ["unsubscribe_token", "00000000-0000-0000-0000-000000000000"],
  ] as const) {
    it(`a user cannot change their own ${column}`, async () => {
      const { error } = await a.client.from("profiles").update({ [column]: value }).eq("id", a.id);
      expect(error?.code).toBe("42501");
    });
  }

  it("a user can change the columns they own", async () => {
    const { error } = await a.client.from("profiles").update({ display_name: "A" }).eq("id", a.id);
    expect(error).toBeNull();
  });

  it("a user can only change tracker_status on a match", async () => {
    const own = await admin
      .from("matches")
      .upsert({ user_id: a.id, job_id: jobId, decision: "picked" }, { onConflict: "user_id,job_id" })
      .select("id")
      .single();
    const score = await a.client.from("matches").update({ score: 10 }).eq("id", own.data!.id);
    expect(score.error?.code).toBe("42501");
    const status = await a.client.from("matches").update({ tracker_status: "applied" }).eq("id", own.data!.id);
    expect(status.error).toBeNull();
  });
});

describe("resume versions", () => {
  it("a user cannot forge an AI draft", async () => {
    const { error } = await b.client
      .from("resume_versions")
      .insert({ match_id: matchB, user_id: b.id, source: "ai", json: {} });
    expect(error).not.toBeNull();
  });

  it("a user can save their own edit", async () => {
    const { error } = await b.client
      .from("resume_versions")
      .insert({ match_id: matchB, user_id: b.id, source: "user", json: {} });
    expect(error).toBeNull();
  });

  it("a user cannot add a version to someone else's match", async () => {
    const { error } = await a.client
      .from("resume_versions")
      .insert({ match_id: matchB, user_id: a.id, source: "user", json: {} });
    expect(error).not.toBeNull();
  });
});

describe("shared and internal tables", () => {
  it("a user can read jobs but not write them", async () => {
    expect((await a.client.from("jobs").select("id").eq("id", jobId)).data).toHaveLength(1);
    expect((await a.client.from("jobs").insert({ url: "https://x", company: "x", title: "x", source: "x" })).error).not.toBeNull();
    expect((await a.client.from("jobs").update({ title: "hacked" }).eq("id", jobId)).error).not.toBeNull();
    expect((await a.client.from("jobs").delete().eq("id", jobId)).error).not.toBeNull();
  });

  for (const table of ["companies", "allowed_emails", "app_settings", "match_scores", "daily_runs", "category_review"]) {
    it(`${table} is closed to users`, async () => {
      const read = await a.client.from(table).select("*");
      expect(read.error?.code ?? (read.data as unknown[]).length).toSatisfy((v: unknown) => v === "42501" || v === 0);
      const write = await a.client.from(table).insert({ key: "x", value: {}, email: "x", ats: "gh", slug: "x" });
      expect(write.error).not.toBeNull();
    });
  }

  it("a user cannot write payments or subscriptions", async () => {
    const pay = await a.client.from("payments").insert({ user_id: a.id, event_id: "e", reference: "r", amount_kobo: 1, status: "success" });
    expect(pay.error).not.toBeNull();
    const sub = await a.client.from("subscriptions").insert({ user_id: a.id, plan: "pro", status: "active" });
    expect(sub.error).not.toBeNull();
  });

  it("a user can read categories only", async () => {
    expect((await a.client.from("categories").select("id")).data?.length).toBeGreaterThan(5);
    expect((await a.client.from("categories").insert({ id: "x", label: "x" })).error).not.toBeNull();
  });

  it("a user can queue an AI task for themselves but not mark it done or impersonate", async () => {
    const own = await a.client.from("ai_tasks").insert({ user_id: a.id, kind: "suggest_titles", input: {} });
    expect(own.error).toBeNull();
    const forged = await a.client.from("ai_tasks").insert({ user_id: a.id, kind: "suggest_titles", input: {}, status: "done" });
    expect(forged.error).not.toBeNull();
    const other = await a.client.from("ai_tasks").insert({ user_id: b.id, kind: "suggest_titles", input: {} });
    expect(other.error).not.toBeNull();
  });

  it("a user cannot claim from the AI queue", async () => {
    const { error } = await a.client.rpc("claim_ai_task");
    expect(error).not.toBeNull();
  });
});

describe("account deletion", () => {
  it("cascades through every table", async () => {
    const email = `gone${Date.now()}@jobtailor.test`;
    const u = await ensureUser(email);
    await admin.from("preferences").insert({ user_id: u.id, data: {} });
    await admin.from("matches").insert({ user_id: u.id, job_id: jobId, decision: "picked" });
    await admin.auth.admin.deleteUser(u.id);
    expect((await admin.from("profiles").select("id").eq("id", u.id)).data).toEqual([]);
    expect((await admin.from("preferences").select("user_id").eq("user_id", u.id)).data).toEqual([]);
    expect((await admin.from("matches").select("id").eq("user_id", u.id)).data).toEqual([]);
    await admin.from("allowed_emails").delete().eq("email", email);
  });
});
