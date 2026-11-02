"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="page narrow">
      <div className="card">
        <h1>JobTailor</h1>
        <p className="muted">Job matches and tailored CVs, from your own experience. Invite only for now.</p>
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
