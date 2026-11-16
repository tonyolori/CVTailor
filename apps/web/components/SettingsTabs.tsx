import Link from "next/link";

export function SettingsTabs({ active }: { active: "general" | "cv-style" }) {
  return (
    <nav className="tabs" aria-label="Settings">
      <Link prefetch={false} className={active === "general" ? "on" : ""} href="/settings">
        General
      </Link>
      <Link prefetch={false} className={active === "cv-style" ? "on" : ""} href="/settings/cv-style">
        CV style
      </Link>
    </nav>
  );
}
