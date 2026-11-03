"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions";

export function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="page narrow">
      <div className="card">
        <h1>JobTailor</h1>
        <p className="muted">Job matches and tailored CVs, from your own experience. Invite only for now.</p>
        {linkFailed && !state ? (
          <div className="notice bad">That sign-in link didn't work. It may have expired or been used already. Ask for a new one here, and open it in this same browser.</div>
        ) : null}
        <form action={action} className="stack">
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "Sending..." : "Email me a sign-in link"}
          </button>
        </form>
        {state?.message ? <div className={`notice ${state.ok ? "ok" : "bad"}`}>{state.message}</div> : null}
        <small>
          <Link href="/privacy">Privacy</Link>
        </small>
      </div>
    </main>
  );
}
