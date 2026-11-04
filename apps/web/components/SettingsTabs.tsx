import Link from "next/link";

export function SettingsTabs({ active }: { active: "general" | "cv-style" }) {
  return (
    <nav className="tabs" aria-label="Settings">
      <Link className={active === "general" ? "on" : ""} href="/settings">
        General
      </Link>
      <Link className={active === "cv-style" ? "on" : ""} href="/settings/cv-style">
        CV style
      </Link>
    </nav>
  );
}
