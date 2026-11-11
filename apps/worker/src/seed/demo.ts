/**
 * A demo account with a realistic spread of jobs, for clicking through the web app: matches at every
 * stage, finished CVs, one that failed its fact check, a job with no posting text and one the person
 * pasted in. Local only. Re-running it starts the account over.
 *
 *   npm run seed:demo, then sign in as demo@cvtailor.test (the link lands in Mailpit, :54324)
 */
import { EnrichedJobSchema, PERSONAS, ResumeSchema, type EnrichedJobInput } from "@cvtailor/core";
import { loadConfig } from "../config";
import { must, serviceClient } from "../db";
import { upsertUser } from "./users";

const config = loadConfig();
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.SUPABASE_URL)) {
  throw new Error("seed:demo only runs against a local Supabase.");
}
const db = serviceClient(config);

const EMAIL = "demo@cvtailor.test";
const URL_PREFIX = "https://demo.cvtailor.test/jobs/";
const nurse = PERSONAS.find((p) => p.key === "onsite-nurse")!;

const userId = await upsertUser(db, {
  email: EMAIL,
  displayName: "Grace Sampleton",
  tz: nurse.tz,
  isSynthetic: true,
  preferences: nurse.preferences,
  facts: { ...nurse.facts, contact: { ...nurse.facts.contact, email: EMAIL } },
});

// Start over: this account's matches (CVs cascade), its pasted jobs, and the shared demo jobs.
must(await db.from("matches").delete().eq("user_id", userId), "clear matches");
must(await db.from("jobs").delete().like("url", `${URL_PREFIX}%`), "clear demo jobs");
must(await db.from("daily_summaries").delete().eq("user_id", userId), "clear summaries");

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

interface DemoJob {
  slug: string;
  title: string;
  company: string;
  city: string;
  mode: "onsite" | "hybrid" | "remote";
  decision: "picked" | "worth-a-look" | "unscored" | "pasted";
  status: "to_apply" | "applied" | "interview" | "offer" | "rejected" | "dismissed";
  ago: number;
  score?: number;
  reason?: string;
  cv?: "rendered" | "failed";
  failure?: string;
  /** No posting text held, so the person has to paste it. */
  noText?: boolean;
  source?: string;
  enriched?: Partial<EnrichedJobInput>;
  text: string;
}

const JOBS: DemoJob[] = [
  {
    slug: "staff-nurse-amu",
    title: "Staff Nurse, Acute Medical Unit",
    company: "Northern Care NHS Trust",
    city: "Manchester",
    mode: "onsite",
    decision: "picked",
    status: "to_apply",
    ago: 0,
    score: 9,
    cv: "rendered",
    reason: "Staff Nurse is one of your titles, it's on-site in Manchester, and it asks for NMC registration and two years in acute care. You have both.",
    enriched: {
      mustHaves: ["NMC registration", "At least two years in acute care", "IV therapy and cannulation"],
      applicantInstructions: ["Quote your NMC PIN in your supporting statement."],
      salary: { min: 33000, max: 37000, currency: "GBP", period: "year" },
    },
    text: "Our 30-bed Acute Medical Unit is looking for a Staff Nurse to join a supportive team on a rotating day and night pattern.\n\nYou will assess and plan care for acutely unwell adults, give IV therapy, and help train students and newly qualified nurses.\n\nYou will need current NMC registration and at least two years of acute care experience. Please quote your NMC PIN in your supporting statement.",
  },
  {
    slug: "rn-surgical",
    title: "Registered Nurse, Surgical Ward",
    company: "Oakfield Hospital",
    city: "Salford",
    mode: "onsite",
    decision: "picked",
    status: "to_apply",
    ago: 0,
    score: 8.5,
    reason: "Registered Nurse is one of your titles, Salford is close to Manchester, and the wound care it asks for is in your profile.",
    source: "himalayas",
    enriched: { mustHaves: ["NMC registration", "Post-operative care", "Wound care"] },
    text: "A 24-bed general surgical ward is recruiting Registered Nurses for day shifts.\n\nYou will care for patients before and after surgery, manage wounds and drains, and plan discharges with the wider team.",
  },
  {
    slug: "community-nurse",
    title: "Community Nurse",
    company: "Riverside Health",
    city: "Manchester",
    mode: "hybrid",
    decision: "worth-a-look",
    status: "to_apply",
    ago: 0,
    score: 7,
    reason: "Close to your titles rather than one of them. It needs a full driving licence, which your profile doesn't mention.",
    source: "remoteok",
    enriched: { mustHaves: ["NMC registration", "Full UK driving licence", "Caseload management"] },
    text: "Join our district nursing team visiting patients at home across south Manchester. Some admin days can be worked from home.\n\nYou will need a full UK driving licence and access to a car.",
  },
  {
    slug: "clinic-nurse",
    title: "Clinic Nurse",
    company: "Penrose Clinics",
    city: "Stockport",
    mode: "onsite",
    decision: "worth-a-look",
    status: "to_apply",
    ago: 1,
    score: 6.5,
    cv: "failed",
    failure: "failed_fact_check",
    reason: "Outpatient clinic work, where your experience is on a ward. Worth a look if you'd like regular hours.",
    source: "jobicy",
    enriched: { mustHaves: ["NMC registration", "Phlebotomy"] },
    text: "A busy outpatient clinic needs a Clinic Nurse for weekday sessions, Monday to Friday.\n\nPhlebotomy experience is essential.",
  },
  {
    slug: "nurse-educator",
    title: "Nurse Educator",
    company: "Kingsway College",
    city: "Manchester",
    mode: "hybrid",
    decision: "worth-a-look",
    status: "to_apply",
    ago: 1,
    score: 6,
    reason: "One of your stretch titles. You mentored 12 student nurses, but it asks for a teaching qualification your profile doesn't have.",
    enriched: { mustHaves: ["NMC registration", "Teaching qualification, or willing to work towards one"] },
    text: "Teach practical nursing skills to first-year students in our clinical skills lab. Two days a week can be worked from home.",
  },
  {
    slug: "ward-sister",
    title: "Ward Sister",
    company: "St Anne's Hospice",
    city: "Bolton",
    mode: "onsite",
    decision: "unscored",
    status: "to_apply",
    ago: 1,
    source: "workingnomads",
    text: "Ward Sister, inpatient unit. Full details on our website.",
  },
  {
    slug: "night-team",
    title: "Staff Nurse, Night Team",
    company: "Lakeside NHS Trust",
    city: "Manchester",
    mode: "onsite",
    decision: "picked",
    status: "to_apply",
    ago: 3,
    score: 8,
    noText: true,
    reason: "Staff Nurse is one of your titles and it's in Manchester. Nights only, which your preferences don't rule out.",
    text: "",
  },
  {
    slug: "practice-nurse",
    title: "Practice Nurse",
    company: "Ashby Medical Group",
    city: "Bolton",
    mode: "onsite",
    decision: "pasted",
    status: "to_apply",
    ago: 2,
    cv: "rendered",
    text: "Ashby Medical Group is looking for a Practice Nurse to run chronic disease clinics, give vaccinations and take bloods.\n\nNMC registration required. Training in cervical screening will be given.",
  },
  {
    slug: "day-surgery",
    title: "Staff Nurse, Day Surgery",
    company: "Moorside Clinic",
    city: "Manchester",
    mode: "onsite",
    decision: "picked",
    status: "applied",
    ago: 12,
    score: 8.5,
    cv: "rendered",
    reason: "Staff Nurse is one of your titles and it's on-site in Manchester, with weekday hours.",
    text: "Day surgery unit, Monday to Friday. Pre-assessment, recovery and discharge of day-case patients.",
  },
  {
    slug: "cardiology",
    title: "Registered Nurse, Cardiology",
    company: "Pennine Heart Centre",
    city: "Oldham",
    mode: "onsite",
    decision: "worth-a-look",
    status: "applied",
    ago: 5,
    score: 7,
    cv: "rendered",
    reason: "Registered Nurse is one of your titles. Cardiology is new to you, and Oldham is a longer commute.",
    text: "Cardiology ward caring for patients with heart failure and after cardiac procedures.",
  },
  {
    slug: "senior-staff-nurse",
    title: "Senior Staff Nurse",
    company: "Lakeside NHS Trust",
    city: "Manchester",
    mode: "onsite",
    decision: "picked",
    status: "interview",
    ago: 9,
    score: 9,
    cv: "rendered",
    reason: "A step up from Staff Nurse, on an acute ward like yours, and your mentoring counts towards the leadership it asks for.",
    text: "Senior Staff Nurse on a busy acute medical ward. You will lead shifts and support junior staff.",
  },
  {
    slug: "theatre-nurse",
    title: "Theatre Nurse",
    company: "Hale Private Hospital",
    city: "Altrincham",
    mode: "onsite",
    decision: "worth-a-look",
    status: "rejected",
    ago: 20,
    score: 6.5,
    cv: "rendered",
    reason: "Theatre work is new to you, but the hospital trains nurses moving from wards.",
    text: "Scrub and recovery nurse for our main theatres.",
  },
  {
    slug: "agency-nurse",
    title: "Agency Nurse",
    company: "Swift Staffing",
    city: "Manchester",
    mode: "onsite",
    decision: "worth-a-look",
    status: "dismissed",
    ago: 6,
    score: 6,
    reason: "Nursing in Manchester, but agency shifts across many sites.",
    text: "Flexible agency shifts across Greater Manchester.",
  },
];

const facts = nurse.facts;
const resumeFor = (title: string) =>
  ResumeSchema.parse({
    header: { name: facts.contact.name, roleTitle: title.split(",")[0], location: facts.contact.location, email: EMAIL },
    summary: "Registered adult nurse with six years on a 28-bed acute medical ward, caring for up to eight patients a shift and mentoring student nurses.",
    skills: [{ group: "Clinical", items: facts.skills }],
    experience: facts.entries
      .filter((e) => e.kind === "role")
      .map((e) => ({ title: e.title, company: e.org, location: e.location, start: e.start, end: e.end, bullets: e.facts.map((f) => f.text) })),
    education: facts.entries.filter((e) => e.kind === "education").map((e) => ({ degree: e.title, school: e.org, start: e.start, end: e.end })),
    credentials: facts.credentials.map((c) => ({ name: c.name, issuer: c.issuer, year: c.year })),
    languages: facts.languages,
    sectionOrder: ["summary", "credentials", "experience", "skills", "education"],
    template: { pageSize: "A4", convention: "uk_commonwealth" },
  });

for (const j of JOBS) {
  const pasted = j.decision === "pasted";
  const enriched = EnrichedJobSchema.parse({
    isOpen: true,
    workMode: j.mode,
    locations: [{ country: "GB", city: j.city }],
    category: "nursing-healthcare",
    seniority: "mid",
    requiredCredentials: ["NMC Registration"],
    ...j.enriched,
  });
  const job = must(
    await db
      .from("jobs")
      .insert({
        url: `${URL_PREFIX}${j.slug}`,
        apply_url: `${URL_PREFIX}${j.slug}/apply`,
        title: j.title,
        company: j.company,
        source: pasted ? "pasted" : (j.source ?? "greenhouse"),
        posted_at: new Date(Date.now() - (j.ago + 2) * 86_400_000).toISOString(),
        raw_text: j.noText ? null : j.text,
        enriched,
        status: "verified",
        last_verified: new Date().toISOString(),
        category: "nursing-healthcare",
        country: "GB",
        work_mode: j.mode,
        location_text: `${j.city}, UK`,
        owner_id: pasted ? userId : null,
      })
      .select("id")
      .single(),
    `job ${j.slug}`,
  );
  if (!job) throw new Error(`job ${j.slug}: nothing returned`);
  const match = must(
    await db
      .from("matches")
      .insert({
        user_id: userId,
        job_id: job.id,
        decision: j.decision,
        score: j.score ?? null,
        reason: j.reason ?? null,
        tracker_status: j.status,
        run_date: day(j.ago),
        tailor_status: j.cv ?? "none",
        tailor_error: j.failure ?? null,
      })
      .select("id")
      .single(),
    `match ${j.slug}`,
  );
  if (!match) throw new Error(`match ${j.slug}: nothing returned`);
  if (j.cv === "rendered") {
    must(await db.from("resume_versions").insert({ match_id: match.id, user_id: userId, kind: "resume", json: resumeFor(j.title), source: "ai" }), `cv ${j.slug}`);
  }
}

must(
  await db.from("daily_summaries").insert({
    user_id: userId,
    run_date: day(0),
    status: "sent",
    data: {
      date: day(0),
      sources: ["Himalayas", "Remotive", "Remote OK", "We Work Remotely", "Jobicy", "Working Nomads", "Employer job boards"].map((label) => ({ label })),
      gaps: ["No job source covers hybrid nursing roles in Manchester, United Kingdom yet, so this search can't return results for them. This isn't the same as there being no jobs."],
      notes: [],
      closeCalls: [{ company: "Salford Royal", title: "Charge Nurse", reason: "Asks for a mentorship qualification your profile doesn't list." }],
      roles: [],
      failed: [],
      skipped: [],
      unscored: 1,
      worthALook: [],
    },
  }),
  "summary",
);

console.log(`seeded demo account ${EMAIL} with ${JOBS.length} jobs`);
