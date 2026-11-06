"use client";

import Link, { useLinkStatus } from "next/link";

/** Marks the link while its page loads, so a click shows at once even when the server is slow. */
function Pending() {
  const { pending } = useLinkStatus();
  return <span className="nv-pend" data-on={pending || undefined} aria-hidden="true" />;
}

export function NavLink({ href, className, current, children }: { href: string; className: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link className={className} aria-current={current ? "page" : undefined} href={href}>
      {children}
      <Pending />
    </Link>
  );
}
