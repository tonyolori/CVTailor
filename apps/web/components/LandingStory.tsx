"use client";

import { useEffect, useRef, useState } from "react";
import { CvSheet } from "@/components/CvSheet";
import type { LandingJob } from "@/lib/landing-examples";

const TINTS = ["#dfebff", "#ccddff", "#b8d0ff"];

/** Stays on screen while you scroll, and rewrites the same person's CV for each job. */
export function LandingStory({ jobs }: { jobs: LandingJob[] }) {
  const [step, setStep] = useState(0);
  const pin = useRef<HTMLElement>(null);

  useEffect(() => {
    let queued = false;
    const update = () => {
      queued = false;
      const el = pin.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -r.top / (r.height - innerHeight)));
      setStep(Math.min(jobs.length - 1, Math.floor(progress * jobs.length)));
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    update();
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, [jobs.length]);

  const job = jobs[step]!;
  return (
    <section className="pin" ref={pin}>
      <div className="stick" style={{ "--bg": TINTS[step] } as React.CSSProperties}>
        <div>
          <p className="say">Same person, same facts. Keep scrolling and watch the CV change for each job.</p>
          <h2 className="disp jt">{job.title}</h2>
          <p className="co">{job.company}</p>
          <div className="jd">
            <p>{job.about}</p>
            <div className="jd-g">
              <div>
                <h3>What you'll do</h3>
                <ul>
                  {job.doing.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>What you'll need</h3>
                <ul>
                  {job.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <p className="wy">{job.why}</p>
          <div className="ticks" aria-hidden="true">
            {jobs.map((j, i) => (
              <i key={j.title} className={i <= step ? "d" : ""} />
            ))}
          </div>
        </div>
        <CvSheet resume={job.resume} style="fitted" label={`Example CV written for ${job.title}`} />
      </div>
    </section>
  );
}
