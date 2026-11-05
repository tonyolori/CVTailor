import { CvSheet } from "@/components/CvSheet";
import type { LandingDemo as Demo } from "@/lib/landing-examples";

/** A posting as a job board would show it, beside the CV written for it. */
export function LandingDemo({ demo }: { demo: Demo }) {
  const { posting } = demo;
  return (
    <section className="demo" aria-labelledby="demo-title">
      <p className="say">A posting we found, and the CV we wrote for it from one person's own experience.</p>
      <div className="demo-g">
        <article className="jp">
          <p className="emp">{posting.employer}</p>
          <h2 className="disp" id="demo-title">
            {posting.title}
          </h2>
          <dl>
            <div>
              <dt>Location</dt>
              <dd>{posting.location}</dd>
            </div>
            <div>
              <dt>How you'd work</dt>
              <dd>{posting.workMode}</dd>
            </div>
            <div>
              <dt>Pay</dt>
              <dd>{posting.pay}</dd>
            </div>
          </dl>
          <h3>About the role</h3>
          {posting.about.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <h3>What you'll do</h3>
          <ul>
            {posting.doing.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <h3>What you'll need</h3>
          <ul>
            {posting.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="fit">
            <b>Why it's in their matches</b>
            <p>{demo.why}</p>
          </div>
        </article>
        <figure className="demo-cv">
          <CvSheet resume={demo.resume} style="fitted" label={`Example CV written for ${posting.title}`} />
          <figcaption>The CV written for this posting. Everyone here is invented.</figcaption>
        </figure>
      </div>
    </section>
  );
}
