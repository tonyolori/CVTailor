import { ResumeSchema, type Resume } from "@cvtailor/core";

/** The invented person on the landing page, and three postings their CV was written for. */
interface ExampleJob {
  title: string;
  company: string;
  why: string;
  about: string;
  doing: string[];
  needs: string[];
  roleTitle: string;
  summary: string;
  bullets: string[];
  skills: string[];
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
}

const SAM: ExamplePerson = {
  name: "Sam Adeyemi",
  email: "sam@example.com",
  location: "Lagos",
  current: { title: "Ward Manager", company: "St Brendan's Hospital", start: "2019-03" },
  earlier: { title: "Staff Nurse", company: "Mercy General", start: "2015-06", end: "2019-02", bullets: ["Worked across surgical and emergency wards on a rotating schedule.", "Chaired the unit's monthly patient safety meeting for two years."] },
  education: { degree: "BSc Nursing Science", school: "University of Ibadan", start: "2011", end: "2015" },
  credential: { name: "Registered Nurse, current registration" },
  languages: ["English", "Yoruba", "French (conversational)"],
  jobs: [
    {
      title: "Clinical Operations Lead",
      company: "Harbour Health, Lagos",
      why: "Your ward management experience answers their main ask, and the salary clears your floor.",
      about: "Harbour Health runs four private hospitals and a growing network of day clinics across Lagos. We're hiring a Clinical Operations Lead to keep our wards safely staffed, on budget and ready for inspection.",
      doing: [
        "Plan staffing across four wards, day and night, and bring down our reliance on agency nurses.",
        "Own the clinical operations budget and report against it every month.",
        "Improve patient flow from admission to discharge.",
        "Prepare wards for external audits and follow up on what they find.",
      ],
      needs: [
        "A current nursing registration.",
        "At least five years running a ward or clinical unit.",
        "Experience managing a budget and a staff rota.",
        "A track record with external audits or inspections.",
      ],
      roleTitle: "Clinical operations and ward leadership",
      summary: "Nurse manager with nine years of running busy wards, budgets and staffing.",
      skills: ["Staffing", "Budgeting", "Patient flow", "Audit readiness"],
      bullets: ["Led a ward of fourteen nurses across day and night shifts.", "Managed a yearly ward budget and came in under target two years running.", "Cut average discharge time by a fifth by redesigning patient handover.", "Built a staffing rota that cut agency shifts by a third.", "Prepared the hospital for three external audits, all passed with no major findings."],
    },
    {
      title: "Quality and Compliance Manager",
      company: "Aster Clinics, Nairobi",
      why: "Your three clean audits are what they ask for first. They want one certificate you don't hold, and the CV doesn't claim it.",
      about: "Aster Clinics runs eleven outpatient clinics and two day-surgery centres across Kenya. We're looking for a Quality and Compliance Manager to keep every site ready for regulators and accreditation visits.",
      doing: [
        "Prepare our sites for regulator inspections and accreditation visits.",
        "Keep clinical procedures up to date with national standards.",
        "Run incident reporting, and make sure what we learn reaches every clinic.",
        "Train staff in infection control and patient safety.",
      ],
      needs: [
        "A clinical background, ideally in nursing.",
        "Experience leading teams through external audits.",
        "A lead auditor or healthcare quality certificate.",
        "Confidence writing clear, practical procedures.",
      ],
      roleTitle: "Clinical quality and compliance",
      summary: "Registered nurse who has led teams through three external audits and rewritten the procedures behind them.",
      skills: ["Audit preparation", "Procedure writing", "Incident reporting", "Staff training"],
      bullets: ["Prepared the hospital for three external audits, all passed with no major findings.", "Rewrote twelve clinical procedures to match new national standards.", "Set up an incident reporting process now used on four wards.", "Trained more than two hundred staff in infection control across three sites.", "Tracked ward performance in monthly reports for the senior team."],
    },
    {
      title: "Health Programme Manager",
      company: "Tideline Foundation, anywhere in Europe",
      why: "Your community clinics and funder reports fit their work, and they hire in the places you listed.",
      about: "Tideline Foundation runs community health programmes with local partners in West and East Africa. We're hiring a Health Programme Manager to lead our maternal and child health work in three countries.",
      doing: [
        "Plan and oversee programmes with partner clinics and community health workers.",
        "Manage programme budgets and keep spending on track.",
        "Write progress reports for our funders every quarter.",
        "Design training for partner staff and volunteers.",
      ],
      needs: [
        "A clinical qualification, such as nursing or midwifery.",
        "Experience running community health work or clinics.",
        "Experience reporting to funders or donors.",
        "Good English. French helps with one of our programmes.",
      ],
      roleTitle: "Community health programmes",
      summary: "Clinician with experience running community clinics, training staff across sites and reporting to funders.",
      skills: ["Programme delivery", "Funder reporting", "Training", "Community partnerships"],
      bullets: ["Ran monthly community clinics with local health volunteers.", "Reported progress to a charity funder on a two-year community health project.", "Trained more than two hundred staff in infection control across three sites.", "Managed a yearly ward budget and came in under target two years running.", "Mentored six newly qualified nurses through their first year."],
    },
  ],
};

export interface LandingJob {
  title: string;
  company: string;
  why: string;
  about: string;
  doing: string[];
  needs: string[];
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

export function landingExample(): LandingJob[] {
  return SAM.jobs.map((j) => ({ title: j.title, company: j.company, why: j.why, about: j.about, doing: j.doing, needs: j.needs, resume: resumeFor(SAM, j) }));
}
