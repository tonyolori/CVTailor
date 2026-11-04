"use client";

import Link from "next/link";
import { useState } from "react";

/** The logo and the sidebar's links. On a phone the links fold away behind a menu button. */
export function SideNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="side-head">
        <Link className="logo" href="/dashboard">
          JobTailor
        </Link>
        <button className="side-toggle" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Menu
        </button>
      </div>
      <nav className={`side-nav ${open ? "open" : ""}`} aria-label="Main">
        {children}
      </nav>
    </>
  );
}
