"use client";

import { Fragment, useLayoutEffect, useRef } from "react";
import { dateRange, orderedSections, SECTION_TITLES, type CvStyle, type Resume, type ResumeSection } from "@jobtailor/core";

function Entry({ title, date, org }: { title: string; date?: string; org?: string }) {
  return (
    <>
      <div className="eh">
        <b>{title}</b>
        {date ? <span>{date}</span> : null}
      </div>
      {org ? <div className="org">{org}</div> : null}
    </>
  );
}

/** Same text, same key, so a bullet that moves between versions can be seen moving. */
function Bullets({ items }: { items: string[] }) {
  const seen = new Map<string, number>();
  return (
    <ul>
      {items.map((b) => {
        const n = seen.get(b) ?? 0;
        seen.set(b, n + 1);
        return (
          <li key={`${b}#${n}`} data-k={`${b}#${n}`}>
            {b}
          </li>
        );
      })}
    </ul>
  );
}

function body(section: ResumeSection, r: Resume): React.ReactNode {
  switch (section) {
    case "summary":
      return r.summary ? <p>{r.summary}</p> : null;
    case "skills":
      return r.skills.length
        ? r.skills.map((g, i) => (
            <p key={i}>
              {/* A lone group called Skills would only repeat the heading above it. */}
              {r.skills.length === 1 && g.group.toLowerCase() === "skills" ? null : <b style={{ fontWeight: 600 }}>{g.group}: </b>}
              {g.items.join(", ")}
            </p>
          ))
        : null;
    case "credentials":
      return r.credentials.length
        ? r.credentials.map((c, i) => (
            <div className="ent" key={i}>
              <Entry title={c.name} date={c.year} org={[c.issuer, c.reference].filter(Boolean).join(", ")} />
            </div>
          ))
        : null;
    case "experience":
      return r.experience.length
        ? r.experience.map((x, i) => (
            <div className="ent" key={`${x.company}${x.title}${i}`}>
              <Entry title={x.title} date={dateRange(x.start, x.end)} org={[x.company, x.location].filter(Boolean).join(", ")} />
              <Bullets items={x.bullets} />
            </div>
          ))
        : null;
    case "projects":
      return r.projects.length
        ? r.projects.map((p, i) => (
            <div className="ent" key={i}>
              <Entry title={[p.name, p.stack].filter(Boolean).join(", ")} />
              <Bullets items={p.bullets} />
            </div>
          ))
        : null;
    case "education":
      return r.education.length
        ? r.education.map((e, i) => (
            <div className="ent" key={i}>
              <Entry title={[e.degree, e.school, e.location].filter(Boolean).join(", ")} date={dateRange(e.start, e.end, false)} />
            </div>
          ))
        : null;
    case "languages":
      return r.languages.length ? <p>{r.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ")}</p> : null;
    case "publications":
      return r.publications.length
        ? r.publications.map((p, i) => <p key={i}>{[p.title, p.venue, p.year].filter(Boolean).join(", ")}</p>)
        : null;
    case "volunteering":
      return r.volunteering.length
        ? r.volunteering.map((v, i) => (
            <div className="ent" key={i}>
              <Entry title={`${v.title}, ${v.org}`} date={dateRange(v.start, v.end, Boolean(v.start))} />
              <Bullets items={v.bullets} />
            </div>
          ))
        : null;
    case "portfolio":
      return r.portfolioLinks.length ? <p>{r.portfolioLinks.map((l) => l.label).join(", ")}</p> : null;
  }
}

/**
 * The CV on screen, as the same structured data the PDF templates use. When it changes,
 * bullets that stayed slide to their new place and new ones fade in, so you can watch it re-tailor.
 */
export function CvSheet({ resume, style, label }: { resume: Resume; style: CvStyle; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tops = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("li[data-k]") ?? [])];
    const prev = tops.current;
    tops.current = new Map(items.map((e) => [e.dataset.k!, e.offsetTop]));
    if (!prev || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    items.forEach((e, n) => {
      const was = prev.get(e.dataset.k!);
      if (was !== undefined) {
        const dy = was - e.offsetTop;
        if (dy) e.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.3,.8,.2,1)" });
      } else {
        e.animate(
          [
            { opacity: 0, backgroundColor: "#cfe0ff" },
            { opacity: 1, backgroundColor: "#cfe0ff", offset: 0.4 },
            { opacity: 1, backgroundColor: "rgba(207,224,255,0)" },
          ],
          { duration: 1300, delay: n * 50, fill: "backwards" },
        );
      }
    });
  }, [resume]);

  const h = resume.header;
  const contact = [h.location, h.phone, h.email, ...h.links.map((l) => l.label)].filter(Boolean).join(", ");
  return (
    <div className="sheet" data-style={style} ref={ref} role={label ? "img" : undefined} aria-label={label}>
      <div className="cvi">
        <div className="nm">{h.name}</div>
        {h.roleTitle ? <div className="hl">{h.roleTitle}</div> : null}
        <div className="ct">{contact}</div>
        {orderedSections(resume).map((section) => {
          const content = body(section, resume);
          return content ? (
            <Fragment key={section}>
              <h4>{SECTION_TITLES[section]}</h4>
              {content}
            </Fragment>
          ) : null;
        })}
      </div>
    </div>
  );
}
