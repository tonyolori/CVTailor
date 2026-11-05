import { ResumeSchema, type Resume } from "@cvtailor/core";

/**
 * Invented people for the landing page. One is chosen per visit, from different occupations,
 * so the page doesn't read as a service for one profession.
 */
interface ExampleJob {
  title: string;
  company: string;
  why: string;
  roleTitle: string;
  summary: string;
  bullets: string[];
  skills: string[];
}

/** The posting for a person's first job, as a job board would show it. */
interface ExamplePosting {
  employer: string;
  location: string;
  workMode: string;
  pay: string;
  about: string[];
  doing: string[];
  needs: string[];
}

interface ExamplePerson {
  name: string;
  email: string;
  location: string;
  current: { title: string; company: string; start: string };
  earlier: { title: string; company: string; start: string; end: string; bullets: string[] };
  education: { degree: string; school: string; start: string; end: string };
  credential?: { name: string };
  languages: string[];
  jobs: ExampleJob[];
  posting: ExamplePosting;
}

const PEOPLE: ExamplePerson[] = [
  {
    name: "Sam Adeyemi",
    email: "sam@example.com",
    location: "Lagos",
    current: { title: "Ward Manager", company: "St Brendan's Hospital", start: "2019-03" },
    earlier: { title: "Staff Nurse", company: "Mercy General", start: "2015-06", end: "2019-02", bullets: ["Worked across surgical and emergency wards on a rotating schedule.", "Chaired the unit's monthly patient safety meeting for two years."] },
    education: { degree: "BSc Nursing Science", school: "University of Ibadan", start: "2011", end: "2015" },
    credential: { name: "Registered Nurse, current registration" },
    languages: ["English", "Yoruba", "French (conversational)"],
    posting: {
      employer: "Harbour Health",
      location: "Lagos",
      workMode: "On site, weekdays",
      pay: "₦14m to ₦18m a year",
      about: [
        "Harbour Health runs four private hospitals and a growing network of day clinics across Lagos. We're hiring a Clinical Operations Lead to keep our wards safely staffed, on budget and ready for inspection.",
        "You'll report to the Director of Nursing and work closely with ward managers, finance and our quality team.",
      ],
      doing: [
        "Plan staffing across four wards, day and night, and bring down our reliance on agency nurses.",
        "Own the clinical operations budget and report against it every month.",
        "Improve patient flow from admission to discharge.",
        "Prepare wards for external audits and follow up on what they find.",
        "Coach ward managers, and step in on the wards when it's busy.",
      ],
      needs: [
        "A current nursing registration.",
        "At least five years running a ward or clinical unit.",
        "Experience managing a budget and a staff rota.",
        "A track record with external audits or inspections.",
        "Calm, clear communication with clinicians and managers alike.",
      ],
    },
    jobs: [
      { title: "Clinical Operations Lead", company: "Harbour Health, Lagos", why: "Your ward management experience answers their main ask, and the salary clears your floor.", roleTitle: "Clinical operations and ward leadership", summary: "Nurse manager with nine years of running busy wards, budgets and staffing.", skills: ["Staffing", "Budgeting", "Patient flow", "Audit readiness"], bullets: ["Led a ward of fourteen nurses across day and night shifts.", "Managed a yearly ward budget and came in under target two years running.", "Cut average discharge time by a fifth by redesigning patient handover.", "Built a staffing rota that cut agency shifts by a third.", "Prepared the hospital for three external audits, all passed with no major findings."] },
      { title: "Quality and Compliance Manager", company: "Aster Clinics, Nairobi", why: "Your three clean audits are what they ask for first. They want one certificate you don't hold, and the CV doesn't claim it.", roleTitle: "Clinical quality and compliance", summary: "Registered nurse who has led teams through three external audits and rewritten the procedures behind them.", skills: ["Audit preparation", "Procedure writing", "Incident reporting", "Staff training"], bullets: ["Prepared the hospital for three external audits, all passed with no major findings.", "Rewrote twelve clinical procedures to match new national standards.", "Set up an incident reporting process now used on four wards.", "Trained more than two hundred staff in infection control across three sites.", "Tracked ward performance in monthly reports for the senior team."] },
      { title: "Health Programme Manager", company: "Tideline Foundation, anywhere in Europe", why: "Your community clinics and funder reports fit their work, and they hire in the places you listed.", roleTitle: "Community health programmes", summary: "Clinician with experience running community clinics, training staff across sites and reporting to funders.", skills: ["Programme delivery", "Funder reporting", "Training", "Community partnerships"], bullets: ["Ran monthly community clinics with local health volunteers.", "Reported progress to a charity funder on a two-year community health project.", "Trained more than two hundred staff in infection control across three sites.", "Managed a yearly ward budget and came in under target two years running.", "Mentored six newly qualified nurses through their first year."] },
    ],
  },
  {
    name: "Lena Novak",
    email: "lena@example.com",
    location: "Rotterdam",
    current: { title: "Site Engineer", company: "Delta Civil Works", start: "2020-01" },
    earlier: { title: "Graduate Engineer", company: "Meridian Structures", start: "2016-09", end: "2019-12", bullets: ["Checked temporary works designs on three residential schemes.", "Surveyed and set out foundations on a twelve-storey build."] },
    education: { degree: "MSc Civil Engineering", school: "Delft University of Technology", start: "2014", end: "2016" },
    credential: { name: "Chartered Civil Engineer" },
    languages: ["Dutch", "English", "Polish"],
    posting: {
      employer: "Northline Rail",
      location: "Utrecht",
      workMode: "On site, with travel between projects",
      pay: "€64,000 to €74,000 a year",
      about: [
        "Northline Rail renews bridges, track and stations across the central Netherlands, mostly while trains keep running. We're looking for a Senior Site Engineer to lead the engineering on a bridge replacement programme starting next spring.",
        "You'll join a site team of about twenty and report to the Project Manager.",
      ],
      doing: [
        "Supervise engineers, surveyors and subcontractors on a live railway site.",
        "Keep the works on programme, and raise risks early.",
        "Review method statements and temporary works designs.",
        "Lead the daily safety briefing and site inspections.",
        "Track costs against the package budget.",
      ],
      needs: [
        "Chartered status, or close to it.",
        "Several years as a site engineer on civil or infrastructure work.",
        "Experience working next to live traffic or railways.",
        "Confidence with setting out and site surveys.",
        "Fluent Dutch and good English.",
      ],
    },
    jobs: [
      { title: "Senior Site Engineer", company: "Northline Rail, Utrecht", why: "You've led the kind of live-site work they describe, and it's an easy commute from your city.", roleTitle: "Site engineering on live infrastructure", summary: "Chartered engineer with nine years of running complex sites safely and on programme.", skills: ["Site supervision", "Setting out", "Programme control", "Safety management"], bullets: ["Supervised a team of twenty on a live rail bridge replacement.", "Brought a delayed flood defence scheme back on programme within eight weeks.", "Introduced a daily safety briefing that halved reportable incidents.", "Reviewed subcontractor method statements across four work packages.", "Managed a package budget of two million euros."] },
      { title: "Project Engineer, Flood Defence", company: "Waterways Agency, The Hague", why: "Your flood defence work is the exact experience they ask for, and the contract length suits what you asked for.", roleTitle: "Flood defence project engineering", summary: "Civil engineer who has delivered flood defence works from early design through to handover.", skills: ["Flood defence", "Contract administration", "Stakeholder liaison", "Cost control"], bullets: ["Brought a delayed flood defence scheme back on programme within eight weeks.", "Worked with local councils and residents through two public consultations.", "Managed a package budget of two million euros.", "Reviewed subcontractor method statements across four work packages.", "Prepared handover records accepted first time by the client."] },
      { title: "Construction Manager", company: "Harbourside Developments, Antwerp", why: "You've managed budgets and subcontractors at this scale. They'd like Flemish, and the CV lists Dutch, which they accept.", roleTitle: "Construction management", summary: "Site leader with a record of delivering on budget and improving safety on busy projects.", skills: ["Construction management", "Budgeting", "Subcontractor management", "Safety management"], bullets: ["Managed a package budget of two million euros.", "Reviewed subcontractor method statements across four work packages.", "Introduced a daily safety briefing that halved reportable incidents.", "Supervised a team of twenty on a live rail bridge replacement.", "Mentored four graduate engineers to chartered status."] },
    ],
  },
  {
    name: "Tomás Reyes",
    email: "tomas@example.com",
    location: "Valencia",
    current: { title: "Head of Science", company: "Colegio Levante", start: "2018-09" },
    earlier: { title: "Physics Teacher", company: "Instituto Mar Azul", start: "2012-09", end: "2018-07", bullets: ["Taught physics to students aged 12 to 18 in English and Spanish.", "Started a school robotics club that reached a national final."] },
    education: { degree: "BSc Physics", school: "University of Valencia", start: "2007", end: "2011" },
    credential: { name: "Qualified Teacher Status" },
    languages: ["Spanish", "English", "Catalan"],
    posting: {
      employer: "Northgate International School",
      location: "Madrid",
      workMode: "On site, full time, from September",
      pay: "€48,000 to €55,000 a year, with help to relocate",
      about: [
        "Northgate is a bilingual international school of 900 students aged 3 to 18. We're appointing a Deputy Head of Secondary to lead teaching and learning across the upper school.",
        "You'll sit on the senior leadership team, teach a reduced timetable in your own subject and line-manage heads of department.",
      ],
      doing: [
        "Lead the quality of teaching across the secondary school.",
        "Line-manage and coach heads of department.",
        "Track student progress and report to governors each term.",
        "Lead the curriculum review as we adopt the new national framework.",
        "Teach your own subject for about a third of the week.",
      ],
      needs: [
        "Qualified teacher status and a degree in your subject.",
        "Experience leading a department or a whole-school area.",
        "A record of raising exam results.",
        "Confidence with data on student progress.",
        "Fluent English. Spanish is a plus.",
      ],
    },
    jobs: [
      { title: "Deputy Head of Secondary", company: "Northgate International School, Madrid", why: "You've led a department and improved results, which is what they want in a deputy.", roleTitle: "Secondary school leadership", summary: "Science leader with thirteen years in the classroom and a record of raising results across a department.", skills: ["School leadership", "Staff development", "Curriculum design", "Data tracking"], bullets: ["Led a department of nine teachers across three science subjects.", "Raised top exam grades in science by a quarter over three years.", "Introduced a coaching programme now used across the school.", "Tracked student progress termly and reported to governors.", "Rewrote the science curriculum to match a new national framework."] },
      { title: "Curriculum Lead, Science", company: "Brightpath Education, remote within Europe", why: "Your curriculum rewrite and bilingual teaching fit their brief, and the role is fully remote.", roleTitle: "Science curriculum design", summary: "Physics teacher and department head who designs courses that work for students and teachers alike.", skills: ["Curriculum design", "Bilingual education", "Assessment", "Teacher training"], bullets: ["Rewrote the science curriculum to match a new national framework.", "Designed end-of-unit assessments later adopted by three partner schools.", "Taught physics to students aged 12 to 18 in English and Spanish.", "Introduced a coaching programme now used across the school.", "Ran training days for forty teachers on practical science."] },
      { title: "Teacher Training Coordinator", company: "Fundación Aprende, Valencia", why: "You've coached teachers and run training days, and it's in the city you asked for.", roleTitle: "Teacher training and coaching", summary: "Experienced teacher who helps colleagues improve through coaching, training and shared planning.", skills: ["Coaching", "Training delivery", "Mentoring", "Programme planning"], bullets: ["Introduced a coaching programme now used across the school.", "Ran training days for forty teachers on practical science.", "Mentored eight newly qualified teachers through their first year.", "Led a department of nine teachers across three science subjects.", "Designed end-of-unit assessments later adopted by three partner schools."] },
    ],
  },
];

export interface LandingJob {
  title: string;
  company: string;
  why: string;
  resume: Resume;
}

function resumeFor(p: ExamplePerson, j: ExampleJob): Resume {
  return ResumeSchema.parse({
    header: { name: p.name, roleTitle: j.roleTitle, location: p.location, email: p.email },
    summary: j.summary,
    skills: [{ group: "Skills", items: j.skills }],
    experience: [
      { title: p.current.title, company: p.current.company, start: p.current.start, end: null, bullets: j.bullets },
      p.earlier,
    ],
    education: [p.education],
    credentials: p.credential ? [p.credential] : [],
    languages: p.languages.map((name) => ({ name })),
    sectionOrder: ["summary", "experience", "skills", "credentials", "education", "languages"],
  });
}

/** One person per visit. Pass the same pick to the hero and the demo so they show the same person. */
export function pickExample(): number {
  return Math.floor(Math.random() * PEOPLE.length);
}

export function landingExample(pick: number = pickExample()): LandingJob[] {
  const person = PEOPLE[pick % PEOPLE.length]!;
  return person.jobs.map((j) => ({ title: j.title, company: j.company, why: j.why, resume: resumeFor(person, j) }));
}

export interface LandingDemo {
  posting: ExamplePosting & { title: string };
  why: string;
  resume: Resume;
}

/** A posting and the CV written for it: the person's first job. */
export function landingDemo(pick: number = pickExample()): LandingDemo {
  const person = PEOPLE[pick % PEOPLE.length]!;
  const job = person.jobs[0]!;
  return { posting: { ...person.posting, title: job.title }, why: job.why, resume: resumeFor(person, job) };
}
