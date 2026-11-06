"use client";

import { useEffect, useRef, useState } from "react";
import { CvSheet } from "@/components/CvSheet";
import type { LandingJob } from "@/lib/landing-examples";

const TINTS = ["#dfebff", "#ccddff", "#b8d0ff"];

/** Three postings to scroll past, beside one CV that rewrites itself for whichever you're reading. */
export function LandingStory({ jobs }: { jobs: LandingJob[] }) {
  const [step, setStep] = useState(0);
  const posts = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let queued = false;
    const update = () => {
      queued = false;
      const reached = posts.current.filter((el) => el && el.getBoundingClientRect().top < innerHeight * 0.5).length;
      setStep(Math.max(0, reached - 1));
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
  }, []);

  const job = jobs[step]!;
  return (
    <section className="story" style={{ "--bg": TINTS[step] } as React.CSSProperties}>
      <p className="say">Same person, same facts. Keep scrolling and watch the CV change for each job.</p>
      <div className="story-g">
        <div>
          {jobs.map((j, i) => (
            <div
              className="sp"
              key={j.title}
              ref={(el) => {
                posts.current[i] = el;
              }}
            >
              <article className="jp">
                <p className="emp">{j.posting.employer}</p>
                <h2 className="disp">{j.title}</h2>
                <dl>
                  <div>
                    <dt>Location</dt>
                    <dd>{j.posting.location}</dd>
                  </div>
                  <div>
                    <dt>How you'd work</dt>
                    <dd>{j.posting.workMode}</dd>
                  </div>
                  <div>
                    <dt>Pay</dt>
                    <dd>{j.posting.pay}</dd>
                  </div>
                </dl>
                <h3>About the role</h3>
                {j.posting.about.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                <h3>What you'll do</h3>
                <ul>
                  {j.posting.doing.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <h3>What you'll need</h3>
                <ul>
                  {j.posting.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <div className="fit">
                  <b>Why it's in their matches</b>
                  <p>{j.why}</p>
                </div>
              </article>
              <div className="cv-inline">
                <CvSheet resume={j.resume} style="fitted" label={`Example CV written for ${j.title}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="story-cv">
          <CvSheet resume={job.resume} style="fitted" label={`Example CV written for ${job.title}`} />
        </div>
      </div>
    </section>
  );
}
