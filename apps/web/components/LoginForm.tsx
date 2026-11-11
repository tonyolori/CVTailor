"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions";

function SignInFields() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <>
      <form action={action} className="pillform">
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email" />
        <button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
      {state?.message ? (
        <div className={`notice pub-msg ${state.ok ? "ok" : "bad"}`} role="status">
          {state.message}
        </div>
      ) : null}
    </>
  );
}

export function LandingSignIn() {
  return (
    <>
      <SignInFields />
      <p className="pub-note">
        Invite only for now. <Link href="/waitlist">Join the waitlist</Link>
      </p>
    </>
  );
}

export function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  return (
    <main className="wl">
      <div className="nav">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
        <Link href="/waitlist">Join the waitlist</Link>
      </div>
      <div className="wlg">
        <div>
          <h1 className="disp">Sign in.</h1>
          <p className="ex">We'll email you a link. There's no password to remember.</p>
        </div>
        <div className="wlf">
          {linkFailed ? <div className="notice bad">That sign-in link didn't work. It may have expired or been used already. Ask for a new one here, and open it in this same browser.</div> : null}
          <SignInFields />
          <p className="pub-note" style={{ marginTop: 0 }}>
            Invite only for now. <Link href="/waitlist">Join the waitlist</Link> and we'll email you when there's a place. <Link href="/privacy?from=/login">Privacy</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
