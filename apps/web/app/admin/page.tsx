import { allowEmail, removeEmail, setKillSwitch } from "@/app/actions";
import { Nav } from "@/components/Nav";
import { requireAdmin } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";

export default async function AdminPage() {
  const { user } = await requireAdmin();
  const db = adminClient();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: allowed }, { data: killSwitch }, { data: dailyRuns }, { data: runs }, { data: profiles }, { data: review }] = await Promise.all([
    db.from("allowed_emails").select("email,note,created_at").order("created_at", { ascending: false }),
    db.from("app_settings").select("value").eq("key", "kill_switch").maybeSingle(),
    db.from("daily_runs").select("run_date,status,started_at,finished_at,detail").order("run_date", { ascending: false }).limit(7),
    db.from("runs").select("run_date,user_id,stage,status,cost_usd,calls,provider").gte("run_date", since).limit(5000),
    db.from("profiles").select("id,email,plan,paid_until,active,is_synthetic"),
    db.from("category_review").select("raw_value,seen").order("seen", { ascending: false }).limit(20),
  ]);

  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const byDay = new Map<string, number>();
  const perUser = new Map<string, { cost: number; days: Set<string> }>();
  let provider = "";
  for (const r of runs ?? []) {
    const cost = Number(r.cost_usd);
    byDay.set(r.run_date, (byDay.get(r.run_date) ?? 0) + cost);
    if (r.provider) provider = r.provider;
    if (r.user_id) {
      const u = perUser.get(r.user_id) ?? { cost: 0, days: new Set<string>() };
      u.cost += cost;
      u.days.add(r.run_date);
      perUser.set(r.user_id, u);
    }
  }
  const failures = (runs ?? []).filter((r) => r.status === "failed").length;
  const killed = killSwitch?.value === true;

  return (
    <>
      <Nav email={user.email ?? ""} />
      <main className="page">
        <h1>Admin</h1>

        <div className="card">
          <div className="row between">
            <h2>AI kill switch</h2>
            <span className={`chip ${killed ? "bad" : "ok"}`}>{killed ? "AI stopped" : "AI running"}</span>
          </div>
          <form action={setKillSwitch}>
            <input type="hidden" name="on" value={killed ? "false" : "true"} />
            <button className={killed ? "primary" : "danger"} type="submit">
              {killed ? "Resume AI work" : "Stop all AI work"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Last runs</h2>
          {provider === "claude-subscription" ? <p className="muted">Subscription mode: costs below are the SDK's estimates, not charges. They draw on your Claude plan's limits.</p> : null}
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Finished</th>
                  <th>Spend (USD)</th>
                </tr>
              </thead>
              <tbody>
                {(dailyRuns ?? []).map((r) => (
                  <tr key={r.run_date}>
                    <td>{r.run_date}</td>
                    <td>
                      <span className={`chip ${r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "info"}`}>{r.status}</span>
                    </td>
                    <td>{r.finished_at ? new Date(r.finished_at).toLocaleTimeString() : "-"}</td>
                    <td>{(byDay.get(r.run_date) ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {failures > 0 ? <p className="muted">{failures} stage failures in the last 14 days. See the runs table.</p> : null}
        </div>

        <div className="card">
          <h2>Cost per user per day</h2>
          <p className="muted">Last 14 days, for pricing against naira revenue. Excludes shared collection and enrichment.</p>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Average per active day</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...perUser.entries()].map(([id, u]) => (
                  <tr key={id}>
                    <td className="overflow-wrap">{emailById.get(id) ?? id}</td>
                    <td>${(u.cost / Math.max(1, u.days.size)).toFixed(4)}</td>
                    <td>${u.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Who can sign up</h2>
          <form action={allowEmail} className="grid2">
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Note
              <input name="note" />
            </label>
            <div>
              <button className="primary" type="submit">
                Invite
              </button>
            </div>
          </form>
          <div className="table">
            <table>
              <tbody>
                {(allowed ?? []).map((a) => (
                  <tr key={a.email}>
                    <td className="overflow-wrap">{a.email}</td>
                    <td className="muted">{a.note}</td>
                    <td>
                      <form action={removeEmail}>
                        <input type="hidden" name="email" value={a.email} />
                        <button type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {review?.length ? (
          <div className="card">
            <h2>Categories to review</h2>
            <p className="muted">The model proposed these, and they aren't in the categories table.</p>
            {review.map((r) => (
              <small key={r.raw_value}>
                {r.raw_value} ({r.seen})
              </small>
            ))}
          </div>
        ) : null}
      </main>
    </>
  );
}
