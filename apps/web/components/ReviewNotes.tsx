"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A note button for design review, mounted only in local development. Each note is saved with the
 * page, the job open on it and the window width, so it can be found again later.
 */
export function ReviewNotes() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [count, setCount] = useState(0);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch("/api/review-notes")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d: { count: number }) => setCount(d.count))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("saving");
    // What's on screen right now: the open job's title, if any, else the page's main heading.
    const screen = document.querySelector(".panel-head h2")?.textContent ?? document.querySelector("h1")?.textContent ?? "";
    const res = await fetch("/api/review-notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note, page: location.pathname + location.search, width: innerWidth, screen }),
    }).catch(() => null);
    if (!res?.ok) {
      setState("error");
      return;
    }
    setNote("");
    setCount((c) => c + 1);
    setState("saved");
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <div className="rv" data-path={pathname}>
      {open ? (
        <form className="rv-box" onSubmit={(e) => void save(e)}>
          <label htmlFor="rv-note">Note on this screen</label>
          <textarea
            id="rv-note"
            ref={box}
            rows={4}
            value={note}
            placeholder="What would you change here?"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(e);
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="rv-row">
            <span>{state === "saved" ? "Saved" : state === "error" ? "Couldn't save" : `${count} saved · ⌘↵ to save`}</span>
            <button type="submit" disabled={!note.trim() || state === "saving"}>
              Save note
            </button>
          </div>
        </form>
      ) : null}
      <button className="rv-toggle" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Close" : `Review note${count ? ` (${count})` : ""}`}
      </button>
    </div>
  );
}
