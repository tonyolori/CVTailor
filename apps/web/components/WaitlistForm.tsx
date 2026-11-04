"use client";

import Link from "next/link";
import { useActionState } from "react";
import { joinWaitlist } from "@/app/actions";

export function WaitlistForm() {
  const [state, action, pending] = useActionState(joinWaitlist, null);
  if (state?.ok) {
    return (
      <div className="wlf" role="status">
        <h2>You're on the list.</h2>
        <p className="muted">We'll email you when there's a place for you. Nothing else to do for now.</p>
      </div>
    );
  }
  return (
    <form className="wlf" action={action}>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </label>
      <label>
        <span>
          Name <span className="opt">(optional)</span>
        </span>
        <input name="name" autoComplete="name" maxLength={120} />
      </label>
      <label>
        <span>
          What work are you looking for? <span className="opt">(optional)</span>
        </span>
        <input name="looking_for" maxLength={200} />
      </label>
      <label className="hp" aria-hidden="true">
        Leave this empty
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label className="wlc">
        <input type="checkbox" name="consent" required />
        <span>
          I agree that JobTailor can keep these details and email me about joining. I can ask for them to be deleted at any time. <Link href="/privacy">Privacy</Link>
        </span>
      </label>
      {state?.message ? (
        <div className="notice bad" role="alert">
          {state.message}
        </div>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "Joining..." : "Join the waitlist"}
      </button>
    </form>
  );
}
