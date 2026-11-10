import Link from "next/link";

/** Profile is two pages under one heading: the facts CVs are written from, and what to match against. */
export function ProfileTabs({ active }: { active: "experience" | "wants" }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Profile</h1>
        <p className="muted">What we match jobs against, and the only facts your CVs are written from.</p>
      </div>
      <nav className="tabs" aria-label="Profile">
        <Link className={active === "experience" ? "on" : ""} aria-current={active === "experience" ? "page" : undefined} href="/library">
          Your experience
        </Link>
        <Link className={active === "wants" ? "on" : ""} aria-current={active === "wants" ? "page" : undefined} href="/preferences">
          What you want
        </Link>
      </nav>
    </div>
  );
}
