import { describe, expect, it } from "vitest";
import {
  EnrichedJobSchema,
  FactLibrarySchema,
  PreferencesSchema,
  ResumeSchema,
  evaluateGates,
  findMissingCredentials,
  numbersIn,
  onsiteNursePersona,
  regionsOfCountry,
  remoteAccountantPersona,
  remoteSoftwarePersona,
  salaryMeetsFloor,
  verifyCoverLetter,
  verifyResume,
} from "./index";

const NOW = new Date("2026-11-02T00:00:00Z");

const prefs = remoteSoftwarePersona.preferences;
const softwareCreds = remoteSoftwarePersona.facts.credentials.map((c) => c.name);

const job = (over: Record<string, unknown> = {}, title = "Backend Engineer") => ({
  title,
  enriched: EnrichedJobSchema.parse({
    isOpen: true,
    postedAt: "2026-10-28",
    workMode: "remote",
    worldwide: true,
    employerBase: { country: "DE", regions: ["EU"] },
    category: "software-engineering",
    seniority: "mid",
    maxYearsRequired: 3,
    ...over,
  }),
});

describe("evaluateGates: remote software persona", () => {
  it("passes a worldwide remote role", () => {
    expect(evaluateGates(job(), prefs, NOW).pass).toBe(true);
  });

  it("a country list that omits the candidate beats a worldwide label", () => {
    const r = evaluateGates(job({ worldwide: true, eligibleCountries: ["DE", "FR"] }), prefs, NOW);
    expect(r.pass).toBe(false);
    expect(r.nearMiss).toBe(true);
  });

  it("a country list naming the candidate passes", () => {
    expect(evaluateGates(job({ worldwide: false, eligibleCountries: ["NG", "KE"] }), prefs, NOW).pass).toBe(true);
  });

  it("EMEA passes unless work authorisation elsewhere is required", () => {
    expect(evaluateGates(job({ worldwide: false, eligibleRegions: ["EMEA"] }), prefs, NOW).pass).toBe(true);
    const r = evaluateGates(
      job({ worldwide: false, eligibleRegions: ["EMEA"], requiresWorkAuthorization: ["GB"] }),
      prefs,
      NOW,
    );
    expect(r.pass).toBe(false);
  });

  it("work authorisation the user holds satisfies the requirement", () => {
    const p = PreferencesSchema.parse({ ...prefs, eligibility: { ...prefs.eligibility, workAuthorization: ["GB"] } });
    const r = evaluateGates(job({ requiresWorkAuthorization: ["GB"], worldwide: true }), p, NOW);
    expect(r.failed).not.toContain("location");
  });

  it("plain remote with no location info is unclear and a near miss", () => {
    const r = evaluateGates(job({ worldwide: false }), prefs, NOW);
    expect(r.failed).toEqual(["location"]);
    expect(r.nearMiss).toBe(true);
  });

  it("a hybrid role fails on work mode and is a near miss", () => {
    const r = evaluateGates(job({ workMode: "hybrid", worldwide: false }), prefs, NOW);
    expect(r.failed).toContain("work_mode");
    expect(r.nearMiss).toBe(true);
  });

  it("rejects old postings, excluded titles and long experience asks", () => {
    expect(evaluateGates(job({ postedAt: "2026-09-01" }), prefs, NOW).failed).toContain("age");
    expect(evaluateGates(job({}, "Staff Backend Engineer"), prefs, NOW).failed).toContain("exclusion");
    expect(evaluateGates(job({ maxYearsRequired: 8 }), prefs, NOW).failed).toContain("seniority");
  });

  it("role-type exclusions come from the user's preferences", () => {
    expect(evaluateGates(job({ roleTypes: ["sales"] }), prefs, NOW).failed).toContain("role_type");
    const other = PreferencesSchema.parse({ ...prefs, excludeRoleTypes: [] });
    expect(evaluateGates(job({ roleTypes: ["sales"] }), other, NOW).failed).not.toContain("role_type");
  });

  it("rejects time-zone windows that exclude the user's offset", () => {
    const r = evaluateGates(job({ tzRestriction: { minUtcOffset: -8, maxUtcOffset: -5 } }), prefs, NOW);
    expect(r.failed).toContain("timezone");
  });

  it("an employer known only by a region counts when that region is inside the wanted one", () => {
    expect(evaluateGates(job({ employerBase: { regions: ["EU"] } }), prefs, NOW).failed).not.toContain("employer_base");
    expect(evaluateGates(job({ employerBase: { regions: ["APAC"] } }), prefs, NOW).failed).toContain("employer_base");
  });

  it("an unknown employer base stays in, with a note", () => {
    const r = evaluateGates(job({ employerBase: {} }), prefs, NOW);
    expect(r.pass).toBe(true);
    expect(r.notes).toContain("employer base unknown");
  });

  it("checks the employer base only when the user sets one", () => {
    expect(evaluateGates(job({ employerBase: { country: "NG" } }), prefs, NOW).failed).toContain("employer_base");
    const any = PreferencesSchema.parse({ ...prefs, employerBase: null });
    expect(evaluateGates(job({ employerBase: { country: "NG" } }), any, NOW).pass).toBe(true);
  });

  it("a different category fails, and 'other' passes through to scoring", () => {
    expect(evaluateGates(job({ category: "nursing-healthcare" }), prefs, NOW).failed).toContain("category");
    expect(evaluateGates(job({ category: "other" }), prefs, NOW).pass).toBe(true);
  });
});

describe("evaluateGates: remote accountant persona", () => {
  const p = remoteAccountantPersona.preferences;
  const creds = remoteAccountantPersona.facts.credentials.map((c) => c.name);
  const acct = (over: Record<string, unknown> = {}) =>
    job({ category: "accounting-finance", worldwide: false, eligibleRegions: ["EU"], employerBase: {}, ...over }, "Senior Accountant");

  it("passes an EU-limited remote role for someone in the EU", () => {
    expect(evaluateGates(acct(), p, NOW, { credentials: creds }).pass).toBe(true);
  });

  it("rejects a role limited to countries outside the user's list", () => {
    const r = evaluateGates(acct({ eligibleRegions: [], eligibleCountries: ["US"] }), p, NOW, { credentials: creds });
    expect(r.failed).toContain("location");
  });

  it("a salary floor applies only when comparable, otherwise it is noted", () => {
    const low = { min: 30000, max: 40000, currency: "EUR", period: "year" };
    expect(evaluateGates(acct({ salary: low }), p, NOW, { credentials: creds }).failed).toContain("salary");
    const usd = { min: 30000, max: 40000, currency: "USD", period: "year" };
    const r = evaluateGates(acct({ salary: usd }), p, NOW, { credentials: creds });
    expect(r.failed).not.toContain("salary");
    expect(r.notes).toContain("salary unknown");
    expect(evaluateGates(acct(), p, NOW, { credentials: creds }).notes).toContain("salary unknown");
  });

  it("a missing credential is a note under score_penalty, not a failure", () => {
    const r = evaluateGates(acct({ requiredCredentials: ["CPA"] }), p, NOW, { credentials: creds });
    expect(r.pass).toBe(true);
    expect(r.missingCredentials).toEqual(["CPA"]);
  });

  it("the language gate rejects a language the user doesn't have", () => {
    const r = evaluateGates(acct({ languagesRequired: ["German"] }), p, NOW, { credentials: creds });
    expect(r.failed).toContain("language");
    expect(r.nearMiss).toBe(false);
  });
});

describe("evaluateGates: on-site nurse persona", () => {
  const p = onsiteNursePersona.preferences;
  const creds = onsiteNursePersona.facts.credentials.map((c) => c.name);
  const ward = (over: Record<string, unknown> = {}, title = "Staff Nurse") =>
    job(
      {
        category: "nursing-healthcare",
        workMode: "onsite",
        worldwide: false,
        employerBase: {},
        locations: [{ country: "GB", city: "Manchester" }],
        ...over,
      },
      title,
    );

  it("passes an on-site role in the user's city", () => {
    expect(evaluateGates(ward(), p, NOW, { credentials: creds }).pass).toBe(true);
  });

  it("matches city names regardless of case and accents", () => {
    const r = evaluateGates(ward({ locations: [{ country: "GB", city: "MANCHESTER" }] }), p, NOW, { credentials: creds });
    expect(r.pass).toBe(true);
  });

  it("rejects another city, as a near miss", () => {
    const r = evaluateGates(ward({ locations: [{ country: "GB", city: "Leeds" }] }), p, NOW, { credentials: creds });
    expect(r.failed).toEqual(["location"]);
    expect(r.nearMiss).toBe(true);
  });

  it("an unknown location fails as unclear", () => {
    const r = evaluateGates(ward({ locations: [] }), p, NOW, { credentials: creds });
    expect(r.reasons).toContain("role location unclear");
  });

  it("a remote role fails on work mode for an on-site user", () => {
    const r = evaluateGates(ward({ workMode: "remote", worldwide: true, locations: [] }), p, NOW, { credentials: creds });
    expect(r.failed).toContain("work_mode");
    expect(r.nearMiss).toBe(true);
  });

  it("'Staff Nurse' isn't caught by another persona's 'staff' exclusion", () => {
    expect(evaluateGates(ward(), p, NOW, { credentials: creds }).failed).not.toContain("exclusion");
  });

  it("a required licence the user lacks is a hard gate", () => {
    const r = evaluateGates(ward({ requiredCredentials: ["Midwifery Registration"] }), p, NOW, { credentials: creds });
    expect(r.failed).toContain("credential");
    expect(r.nearMiss).toBe(false);
  });

  it("a required licence the user holds passes", () => {
    const r = evaluateGates(ward({ requiredCredentials: ["NMC Registration"] }), p, NOW, { credentials: creds });
    expect(r.pass).toBe(true);
  });
});

describe("helpers", () => {
  it("regionsOfCountry is data-driven", () => {
    expect(regionsOfCountry("NG")).toEqual(expect.arrayContaining(["AFRICA", "EMEA"]));
    expect(regionsOfCountry("PT")).toEqual(expect.arrayContaining(["EU", "EUROPE"]));
    expect(regionsOfCountry("GB")).toEqual(expect.arrayContaining(["UK", "EUROPE"]));
    expect(regionsOfCountry("GB")).not.toContain("EU");
  });

  it("salaryMeetsFloor annualises across periods", () => {
    const floor = { amount: 60000, currency: "GBP", period: "year" as const };
    expect(salaryMeetsFloor({ min: null, max: 6000, currency: "GBP", period: "month" }, floor)).toBe(true);
    expect(salaryMeetsFloor({ min: null, max: 20, currency: "GBP", period: "hour" }, floor)).toBe(false);
  });

  it("findMissingCredentials matches on whole words, not fragments", () => {
    expect(findMissingCredentials(["RN"], ["Unrelated Learning Certificate"])).toEqual(["RN"]);
    expect(findMissingCredentials(["NMC"], ["NMC Registration"])).toEqual([]);
    expect(findMissingCredentials(["Active NMC PIN"], ["NMC Registration"])).toEqual([]);
  });

  it("holding a broad registration doesn't imply a narrower one", () => {
    expect(findMissingCredentials(["NMC Midwifery Registration"], ["NMC Registration"])).toEqual(["NMC Midwifery Registration"]);
    expect(findMissingCredentials(["V300 independent prescribing"], ["NMC Registration", "Registered Nurse (Adult)"])).toHaveLength(1);
  });
});

const lib = FactLibrarySchema.parse({
  contact: { name: "Test User", email: "t@example.com" },
  skills: ["TypeScript"],
  credentials: [{ id: "c1", name: "ACCA", issuer: "ACCA Global", year: "2019" }],
  languages: [{ name: "English" }],
  publications: [{ id: "p1", title: "On Ledgers" }],
  portfolioLinks: [{ label: "Site", url: "https://example.com/site" }],
  entries: [
    {
      id: "e1",
      kind: "role",
      title: "Backend Developer",
      org: "Acme Bank",
      start: "2024-03",
      end: null,
      facts: [
        { id: "f1", text: "Built 6 products across 10 services, about 70,000 lines of C#" },
        { id: "f2", text: "Architecture sized for 5 million events per day", designCapacity: true },
      ],
      doNotClaim: ["20+ services"],
      tags: ["C#", "PostgreSQL"],
    },
    { id: "ed1", kind: "education", title: "BSc", org: "Uni", start: "2019", end: "2023" },
    { id: "v1", kind: "volunteering", title: "Treasurer", org: "Food Bank" },
  ],
});

const baseResume = () =>
  ResumeSchema.parse({
    header: { name: "Test User", roleTitle: "Backend Engineer", email: "t@example.com" },
    summary: "Backend engineer with C# experience.",
    skills: [{ group: "Languages", items: ["C#", "Postgres"] }],
    experience: [
      {
        title: "Backend Developer",
        company: "Acme Bank",
        start: "2024-03",
        end: null,
        bullets: ["Delivered 6 products across 10 services, about 70k lines of C#."],
      },
    ],
    education: [{ degree: "BSc", school: "Uni", start: "2019", end: "2023" }],
  });

describe("numbersIn", () => {
  it("expands k and m suffixes and ignores digits inside words", () => {
    expect(numbersIn("70k lines, 5 million, OAuth2, C#12")).toEqual([70000, 5_000_000]);
  });
});

describe("verifyResume", () => {
  const messages = (r: ReturnType<typeof verifyResume>) => r.issues.map((i) => i.message).join("\n");

  it("accepts a resume built from the library", () => {
    const r = verifyResume(baseResume(), lib);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("flags invented numbers, terms and forbidden claims", () => {
    const r = baseResume();
    r.experience[0]!.bullets.push("Led 25 engineers across 20+ services.");
    r.skills[0]!.items.push("Rust");
    const v = verifyResume(r, lib);
    expect(v.ok).toBe(false);
    expect(messages(v)).toContain("Number 25");
    expect(messages(v)).toContain("20+ services");
    expect(messages(v)).toContain("Rust");
  });

  it("flags design-capacity figures phrased as measured", () => {
    const r = baseResume();
    r.experience[0]!.bullets.push("Processed 5 million events per day.");
    expect(verifyResume(r, lib).issues.some((i) => i.message.includes("built for"))).toBe(true);
  });

  it("flags an invented credential in the credentials section", () => {
    const r = baseResume();
    r.credentials.push({ name: "CPA", issuer: "AICPA" });
    const v = verifyResume(r, lib);
    expect(v.ok).toBe(false);
    expect(messages(v)).toContain('Credential "CPA"');
  });

  it("accepts a library credential, and rejects a changed issuer or year", () => {
    const r = baseResume();
    r.credentials.push({ name: "ACCA", issuer: "ACCA Global", year: "2019" });
    expect(verifyResume(r, lib).ok).toBe(true);
    r.credentials[0]!.year = "2015";
    expect(verifyResume(r, lib).ok).toBe(false);
  });

  it("flags credential claims in running text", () => {
    const r = baseResume();
    r.summary = "Certified public accountant and backend engineer.";
    expect(verifyResume(r, lib).ok).toBe(false);
    const abbr = baseResume();
    abbr.summary = "Backend engineer, PMP.";
    expect(messages(verifyResume(abbr, lib))).toContain("PMP");
  });

  it("flags an invented degree, employer, language, publication or volunteering org", () => {
    const degree = baseResume();
    degree.education.push({ degree: "MSc", school: "Uni" });
    expect(verifyResume(degree, lib).ok).toBe(false);

    const employer = baseResume();
    employer.experience.push({ title: "CTO", company: "Fake Corp", start: "2020", end: "2021", bullets: ["x"] });
    expect(verifyResume(employer, lib).ok).toBe(false);

    const language = baseResume();
    language.languages.push({ name: "French" });
    expect(verifyResume(language, lib).ok).toBe(false);

    const pub = baseResume();
    pub.publications.push({ title: "Invented Paper" });
    expect(verifyResume(pub, lib).ok).toBe(false);

    const vol = baseResume();
    vol.volunteering.push({ title: "Treasurer", org: "Other Org", end: null, bullets: [] });
    expect(verifyResume(vol, lib).ok).toBe(false);
  });

  it("accepts optional sections that come from the library", () => {
    const r = baseResume();
    r.languages.push({ name: "English" });
    r.publications.push({ title: "On Ledgers" });
    r.volunteering.push({ title: "Treasurer", org: "Food Bank", end: null, bullets: [] });
    r.portfolioLinks.push({ label: "Site", url: "https://example.com/site/" });
    expect(verifyResume(r, lib).ok).toBe(true);
  });

  it("verifies persona resumes in non-software terms", () => {
    const nurse = onsiteNursePersona.facts;
    const r = ResumeSchema.parse({
      header: { name: nurse.contact.name, roleTitle: "Staff Nurse", email: nurse.contact.email },
      summary: "Registered midwife with experience on a 28-bed acute medical ward.",
      skills: [{ group: "Clinical", items: ["Wound care", "Care planning"] }],
      credentials: [{ name: "NMC Registration", issuer: "Nursing and Midwifery Council", year: "2018" }],
      experience: [
        {
          title: "Staff Nurse",
          company: "Riverside Community Hospital",
          start: "2018-09",
          bullets: ["Cared for up to 8 patients per shift."],
        },
      ],
      education: [{ degree: "BSc Adult Nursing", school: "University of Salford" }],
      sectionOrder: ["credentials", "summary", "experience", "skills", "education"],
    });
    const v = verifyResume(r, nurse);
    // The library has "Registered Nurse (Adult)", which doesn't support a midwifery claim.
    expect(messages(v)).toContain('"Registered midwife"');
    r.summary = "Registered nurse with experience on a 28-bed acute medical ward.";
    const fixed = verifyResume(r, nurse);
    expect(fixed.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("verifyCoverLetter", () => {
  it("applies the same fact checks to running text", () => {
    const letter = {
      header: { name: "T", roleTitle: "X", email: "t@example.com", links: [] },
      date: "November 2, 2026",
      subject: "X",
      salutation: "Dear Hiring Team,",
      paragraphs: ["I delivered 6 products.", "I led 25 people and I am a certified public accountant."],
      signOff: "Kind regards,",
      signature: "T",
      template: { convention: "standard" as const, pageSize: "A4" as const },
    };
    const v = verifyCoverLetter(letter, lib);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.path)).toEqual(["paragraphs[1]", "paragraphs[1]"]);
  });
});
