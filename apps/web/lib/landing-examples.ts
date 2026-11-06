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
  posting: ExamplePosting;
}

/** The job's posting, as a job board would show it. */
export interface ExamplePosting {
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
    jobs: [
      {
        title: "Clinical Operations Lead",
        company: "Harbour Health, Lagos",
        why: "Your ward management experience answers their main ask, and the salary clears your floor.",
        roleTitle: "Clinical operations and ward leadership",
        summary: "Nurse manager with nine years of running busy wards, budgets and staffing.",
        skills: ["Staffing", "Budgeting", "Patient flow", "Audit readiness"],
        bullets: ["Led a ward of fourteen nurses across day and night shifts.", "Managed a yearly ward budget and came in under target two years running.", "Cut average discharge time by a fifth by redesigning patient handover.", "Built a staffing rota that cut agency shifts by a third.", "Prepared the hospital for three external audits, all passed with no major findings."],
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
      },
      {
        title: "Quality and Compliance Manager",
        company: "Aster Clinics, Nairobi",
        why: "Your three clean audits are what they ask for first. They want one certificate you don't hold, and the CV doesn't claim it.",
        roleTitle: "Clinical quality and compliance",
        summary: "Registered nurse who has led teams through three external audits and rewritten the procedures behind them.",
        skills: ["Audit preparation", "Procedure writing", "Incident reporting", "Staff training"],
        bullets: ["Prepared the hospital for three external audits, all passed with no major findings.", "Rewrote twelve clinical procedures to match new national standards.", "Set up an incident reporting process now used on four wards.", "Trained more than two hundred staff in infection control across three sites.", "Tracked ward performance in monthly reports for the senior team."],
        posting: {
          employer: "Aster Clinics",
          location: "Nairobi",
          workMode: "On site, with visits to our clinics",
          pay: "KSh 4.2m to KSh 5.4m a year, with help to relocate",
          about: [
            "Aster Clinics runs eleven outpatient clinics and two day-surgery centres across Kenya. We're looking for a Quality and Compliance Manager to keep every site ready for regulators and accreditation visits.",
            "You'll report to the Medical Director and lead a quality team of three.",
          ],
          doing: [
            "Prepare our sites for regulator inspections and accreditation visits.",
            "Keep clinical procedures up to date with national standards.",
            "Run incident reporting, and make sure what we learn reaches every clinic.",
            "Train staff in infection control and patient safety.",
            "Report on quality to the leadership team every month.",
          ],
          needs: [
            "A clinical background, ideally in nursing.",
            "Experience leading teams through external audits.",
            "A lead auditor or healthcare quality certificate.",
            "Confidence writing clear, practical procedures.",
            "Happy to travel between sites.",
          ],
        },
      },
      {
        title: "Health Programme Manager",
        company: "Tideline Foundation, anywhere in Europe",
        why: "Your community clinics and funder reports fit their work, and they hire in the places you listed.",
        roleTitle: "Community health programmes",
        summary: "Clinician with experience running community clinics, training staff across sites and reporting to funders.",
        skills: ["Programme delivery", "Funder reporting", "Training", "Community partnerships"],
        bullets: ["Ran monthly community clinics with local health volunteers.", "Reported progress to a charity funder on a two-year community health project.", "Trained more than two hundred staff in infection control across three sites.", "Managed a yearly ward budget and came in under target two years running.", "Mentored six newly qualified nurses through their first year."],
        posting: {
          employer: "Tideline Foundation",
          location: "Anywhere in Europe",
          workMode: "Remote, with two field visits a year",
          pay: "€52,000 to €60,000 a year",
          about: [
            "Tideline Foundation runs community health programmes with local partners in West and East Africa. We're hiring a Health Programme Manager to lead our maternal and child health work in three countries.",
            "You'll work remotely and report to the Head of Programmes, with partner clinics and community health workers on the ground.",
          ],
          doing: [
            "Plan and oversee programmes with partner clinics and community health workers.",
            "Manage programme budgets and keep spending on track.",
            "Write progress reports for our funders every quarter.",
            "Design training for partner staff and volunteers.",
            "Visit the programmes in person about twice a year.",
          ],
          needs: [
            "A clinical qualification, such as nursing or midwifery.",
            "Experience running community health work or clinics.",
            "Experience reporting to funders or donors.",
            "Confidence managing a budget.",
            "Good English. French helps with one of our programmes.",
          ],
        },
      },
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
    jobs: [
      {
        title: "Senior Site Engineer",
        company: "Northline Rail, Utrecht",
        why: "You've led the kind of live-site work they describe, and it's an easy commute from your city.",
        roleTitle: "Site engineering on live infrastructure",
        summary: "Chartered engineer with nine years of running complex sites safely and on programme.",
        skills: ["Site supervision", "Setting out", "Programme control", "Safety management"],
        bullets: ["Supervised a team of twenty on a live rail bridge replacement.", "Brought a delayed flood defence scheme back on programme within eight weeks.", "Introduced a daily safety briefing that halved reportable incidents.", "Reviewed subcontractor method statements across four work packages.", "Managed a package budget of two million euros."],
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
      },
      {
        title: "Project Engineer, Flood Defence",
        company: "Waterways Agency, The Hague",
        why: "Your flood defence work is the exact experience they ask for, and the contract length suits what you asked for.",
        roleTitle: "Flood defence project engineering",
        summary: "Civil engineer who has delivered flood defence works from early design through to handover.",
        skills: ["Flood defence", "Contract administration", "Stakeholder liaison", "Cost control"],
        bullets: ["Brought a delayed flood defence scheme back on programme within eight weeks.", "Worked with local councils and residents through two public consultations.", "Managed a package budget of two million euros.", "Reviewed subcontractor method statements across four work packages.", "Prepared handover records accepted first time by the client."],
        posting: {
          employer: "Waterways Agency",
          location: "The Hague",
          workMode: "Office and site, two-year contract",
          pay: "€58,000 to €66,000 a year",
          about: [
            "The Waterways Agency looks after the dikes, locks and flood barriers along the western coast. We need a Project Engineer for a two-year programme to strengthen five kilometres of river dike.",
            "You'll split your time between our office in The Hague and the sites, and report to the Programme Manager.",
          ],
          doing: [
            "Manage design and construction contracts with our engineering partners.",
            "Keep the works on programme and on budget.",
            "Work with councils, landowners and residents affected by the works.",
            "Review contractors' method statements and site safety.",
            "Prepare handover records for the team that maintains the dike.",
          ],
          needs: [
            "A degree in civil engineering.",
            "Experience on flood defence, coastal or water infrastructure.",
            "Contract administration on public works.",
            "Comfortable leading public meetings.",
            "Fluent Dutch.",
          ],
        },
      },
      {
        title: "Construction Manager",
        company: "Harbourside Developments, Antwerp",
        why: "You've managed budgets and subcontractors at this scale. They'd like Flemish, and the CV lists Dutch, which they accept.",
        roleTitle: "Construction management",
        summary: "Site leader with a record of delivering on budget and improving safety on busy projects.",
        skills: ["Construction management", "Budgeting", "Subcontractor management", "Safety management"],
        bullets: ["Managed a package budget of two million euros.", "Reviewed subcontractor method statements across four work packages.", "Introduced a daily safety briefing that halved reportable incidents.", "Supervised a team of twenty on a live rail bridge replacement.", "Mentored four graduate engineers to chartered status."],
        posting: {
          employer: "Harbourside Developments",
          location: "Antwerp",
          workMode: "On site, full time",
          pay: "€70,000 to €82,000 a year, with a company car",
          about: [
            "Harbourside Developments is building 240 homes and a public quay on the old docks in Antwerp. We're looking for a Construction Manager to run the second phase, from groundworks to handover.",
            "You'll lead the site team and our subcontractors, and report to the Project Director.",
          ],
          doing: [
            "Run day-to-day construction across the site.",
            "Manage subcontractors and hold them to their programmes.",
            "Own the phase budget and agree changes with the client.",
            "Lead site safety, from inductions to inspections.",
            "Develop the junior engineers on the team.",
          ],
          needs: [
            "Several years managing construction sites.",
            "Experience with budgets of a few million euros.",
            "Firm, fair management of subcontractors.",
            "A strong safety record.",
            "Flemish preferred. Dutch is accepted.",
          ],
        },
      },
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
    jobs: [
      {
        title: "Deputy Head of Secondary",
        company: "Northgate International School, Madrid",
        why: "You've led a department and improved results, which is what they want in a deputy.",
        roleTitle: "Secondary school leadership",
        summary: "Science leader with thirteen years in the classroom and a record of raising results across a department.",
        skills: ["School leadership", "Staff development", "Curriculum design", "Data tracking"],
        bullets: ["Led a department of nine teachers across three science subjects.", "Raised top exam grades in science by a quarter over three years.", "Introduced a coaching programme now used across the school.", "Tracked student progress termly and reported to governors.", "Rewrote the science curriculum to match a new national framework."],
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
      },
      {
        title: "Curriculum Lead, Science",
        company: "Brightpath Education, remote within Europe",
        why: "Your curriculum rewrite and bilingual teaching fit their brief, and the role is fully remote.",
        roleTitle: "Science curriculum design",
        summary: "Physics teacher and department head who designs courses that work for students and teachers alike.",
        skills: ["Curriculum design", "Bilingual education", "Assessment", "Teacher training"],
        bullets: ["Rewrote the science curriculum to match a new national framework.", "Designed end-of-unit assessments later adopted by three partner schools.", "Taught physics to students aged 12 to 18 in English and Spanish.", "Introduced a coaching programme now used across the school.", "Ran training days for forty teachers on practical science."],
        posting: {
          employer: "Brightpath Education",
          location: "Anywhere in Europe",
          workMode: "Fully remote",
          pay: "€45,000 to €52,000 a year",
          about: [
            "Brightpath writes science courses for bilingual schools, and more than sixty schools across Europe teach them. We're hiring a Curriculum Lead to own our secondary science courses.",
            "You'll lead a small team of writers and editors, and work closely with teachers in our partner schools.",
          ],
          doing: [
            "Plan and write science units for students aged 11 to 18.",
            "Design assessments that work in English and Spanish.",
            "Gather feedback from teachers and revise the courses each year.",
            "Run online training for teachers new to our courses.",
            "Keep the courses in line with national frameworks.",
          ],
          needs: [
            "Experience teaching secondary science.",
            "Experience designing a curriculum or scheme of work.",
            "Experience teaching in two languages.",
            "Clear writing, for students and teachers alike.",
            "Fluent English and Spanish.",
          ],
        },
      },
      {
        title: "Teacher Training Coordinator",
        company: "Fundación Aprende, Valencia",
        why: "You've coached teachers and run training days, and it's in the city you asked for.",
        roleTitle: "Teacher training and coaching",
        summary: "Experienced teacher who helps colleagues improve through coaching, training and shared planning.",
        skills: ["Coaching", "Training delivery", "Mentoring", "Programme planning"],
        bullets: ["Introduced a coaching programme now used across the school.", "Ran training days for forty teachers on practical science.", "Mentored eight newly qualified teachers through their first year.", "Led a department of nine teachers across three science subjects.", "Designed end-of-unit assessments later adopted by three partner schools."],
        posting: {
          employer: "Fundación Aprende",
          location: "Valencia",
          workMode: "Hybrid, three days a week in schools or our office",
          pay: "€38,000 to €44,000 a year",
          about: [
            "Fundación Aprende supports teachers in state schools across the Valencia region. We're looking for a Teacher Training Coordinator to plan and lead our coaching programme for new teachers.",
            "You'll work with a team of five trainers and around thirty partner schools.",
          ],
          doing: [
            "Plan the year's training programme with our partner schools.",
            "Coach new teachers, and train mentors in each school.",
            "Run training days on classroom practice.",
            "Follow how teachers progress and report to our board.",
            "Build lasting relationships with head teachers.",
          ],
          needs: [
            "Several years of classroom teaching.",
            "Experience coaching or mentoring teachers.",
            "Experience running training for adults.",
            "Good organisation across a whole school year.",
            "Fluent Spanish. Valencian is a plus.",
          ],
        },
      },
    ],
  },
];

export interface LandingJob {
  title: string;
  company: string;
  why: string;
  resume: Resume;
  posting: ExamplePosting;
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

export function landingExample(pick: number = Math.floor(Math.random() * PEOPLE.length)): LandingJob[] {
  const person = PEOPLE[pick % PEOPLE.length]!;
  return person.jobs.map((j) => ({ title: j.title, company: j.company, why: j.why, resume: resumeFor(person, j), posting: j.posting }));
}
