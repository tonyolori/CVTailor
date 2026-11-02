import { FactLibrarySchema, type FactLibrary } from "./facts";
import { PreferencesSchema, type Preferences } from "./preferences";

/**
 * Synthetic test personas. Every name, employer and number is invented; none is a real person.
 * Tests, evals and demos use all three so the system is never exercised by one profile only.
 */
export interface Persona {
  key: string;
  email: string;
  displayName: string;
  tz: string;
  preferences: Preferences;
  facts: FactLibrary;
}

export const remoteSoftwarePersona: Persona = {
  key: "remote-software",
  email: "persona.software@jobtailor.test",
  displayName: "Sade Testperson",
  tz: "Africa/Lagos",
  preferences: PreferencesSchema.parse({
    categories: ["software-engineering"],
    targetTitles: ["Backend Engineer", "Software Engineer"],
    expansionTitles: { a: ["Platform Engineer"], b: ["Full-stack Engineer"], c: ["Integration Engineer"] },
    workModes: ["remote"],
    remoteScope: "eligible_regions",
    eligibility: { country: "NG", regions: ["AFRICA", "EMEA"], utcOffsetHours: 1 },
    employerBase: { regions: ["EUROPE", "NORTH_AMERICA"] },
    excludeTitleKeywords: ["staff", "principal", "director", "manager"],
    excludeRoleTypes: ["sales", "training_work", "research"],
    maxYearsRequired: 5,
    languages: ["English"],
  }),
  facts: FactLibrarySchema.parse({
    contact: {
      name: "Sade Testperson",
      location: "Lagos, Nigeria",
      email: "persona.software@jobtailor.test",
      links: [{ label: "Portfolio", url: "https://example.com/sade" }],
    },
    skills: ["TypeScript", "PostgreSQL", "Docker", "Node.js"],
    languages: [{ name: "English", level: "Native" }],
    credentials: [{ id: "c1", name: "AWS Certified Developer", issuer: "Amazon Web Services", year: "2024" }],
    entries: [
      {
        id: "r1",
        kind: "role",
        title: "Backend Engineer",
        org: "Northwind Payments",
        start: "2023-02",
        end: null,
        location: "Remote",
        facts: [
          { id: "f1", text: "Built a payouts API in TypeScript and PostgreSQL used by 40 merchants" },
          { id: "f2", text: "Reduced failed payouts from 3% to 0.5% with idempotent retries" },
          { id: "f3", text: "Queue designed for 2 million jobs per day", designCapacity: true },
        ],
        variants: ["Built a payouts API used by 40 merchants, cutting failed payouts from 3% to 0.5%"],
        doNotClaim: ["led the team"],
        tags: ["TypeScript", "PostgreSQL", "payments"],
      },
      {
        id: "e1",
        kind: "education",
        title: "BSc Computer Science",
        org: "University of Ibadan",
        start: "2017",
        end: "2021",
      },
    ],
  }),
};

export const remoteAccountantPersona: Persona = {
  key: "remote-accountant",
  email: "persona.accountant@jobtailor.test",
  displayName: "Marta Exemplo",
  tz: "Europe/Lisbon",
  preferences: PreferencesSchema.parse({
    categories: ["accounting-finance"],
    targetTitles: ["Senior Accountant", "Financial Accountant"],
    expansionTitles: { a: ["Group Accountant"], b: ["Finance Business Partner"], c: ["Financial Controller"] },
    workModes: ["remote"],
    remoteScope: "eligible_regions",
    eligibility: { country: "PT", regions: ["EU", "EUROPE", "EMEA"], utcOffsetHours: 0 },
    excludeRoleTypes: ["commission"],
    minSalary: { amount: 45000, currency: "EUR", period: "year" },
    languages: ["English", "Portuguese"],
    missingCredentialPolicy: "score_penalty",
    cvTemplate: { convention: "europe", pageSize: "A4" },
  }),
  facts: FactLibrarySchema.parse({
    contact: { name: "Marta Exemplo", location: "Porto, Portugal", email: "persona.accountant@jobtailor.test" },
    skills: ["IFRS", "Excel", "Month-end close", "Consolidation", "SAP"],
    languages: [
      { name: "English", level: "Fluent" },
      { name: "Portuguese", level: "Native" },
    ],
    credentials: [
      { id: "c1", name: "ACCA", issuer: "Association of Chartered Certified Accountants", year: "2019" },
    ],
    entries: [
      {
        id: "r1",
        kind: "role",
        title: "Senior Accountant",
        org: "Atlantico Logistica",
        start: "2020-06",
        end: null,
        facts: [
          { id: "f1", text: "Cut the month-end close from 10 days to 6 days for 4 legal entities" },
          { id: "f2", text: "Prepared IFRS consolidated accounts for a group with 120 million EUR revenue" },
        ],
        tags: ["IFRS", "SAP", "Consolidation"],
      },
      {
        id: "e1",
        kind: "education",
        title: "Licenciatura in Accounting",
        org: "Universidade do Minho",
        start: "2012",
        end: "2015",
      },
    ],
  }),
};

export const onsiteNursePersona: Persona = {
  key: "onsite-nurse",
  email: "persona.nurse@jobtailor.test",
  displayName: "Grace Sampleton",
  tz: "Europe/London",
  preferences: PreferencesSchema.parse({
    categories: ["nursing-healthcare"],
    targetTitles: ["Staff Nurse", "Registered Nurse"],
    expansionTitles: { a: ["Community Nurse"], b: ["Clinic Nurse"], c: ["Nurse Educator"] },
    workModes: ["onsite", "hybrid"],
    locations: { countries: ["GB"], cities: ["Manchester"] },
    eligibility: { country: "GB", regions: ["UK", "EUROPE", "EMEA"], utcOffsetHours: 0 },
    languages: ["English"],
    missingCredentialPolicy: "hard_gate",
    cvTemplate: { convention: "uk_commonwealth", pageSize: "A4" },
  }),
  facts: FactLibrarySchema.parse({
    contact: { name: "Grace Sampleton", location: "Manchester, UK", email: "persona.nurse@jobtailor.test" },
    skills: ["Patient assessment", "Medication administration", "Wound care", "Care planning"],
    languages: [{ name: "English", level: "Native" }],
    credentials: [
      { id: "c1", name: "NMC Registration", issuer: "Nursing and Midwifery Council", year: "2018" },
      { id: "c3", name: "Registered Nurse (Adult)", issuer: "Nursing and Midwifery Council", year: "2018" },
      { id: "c2", name: "Immediate Life Support", issuer: "Resuscitation Council UK", year: "2024" },
    ],
    entries: [
      {
        id: "r1",
        kind: "role",
        title: "Staff Nurse",
        org: "Riverside Community Hospital",
        start: "2018-09",
        end: null,
        location: "Manchester",
        facts: [
          { id: "f1", text: "Cared for up to 8 patients per shift on a 28-bed acute medical ward" },
          { id: "f2", text: "Mentored 12 student nurses through clinical placements" },
        ],
        doNotClaim: ["ward manager"],
        tags: ["acute care", "mentoring"],
      },
      {
        id: "e1",
        kind: "education",
        title: "BSc Adult Nursing",
        org: "University of Salford",
        start: "2015",
        end: "2018",
      },
    ],
  }),
};

export const PERSONAS: Persona[] = [remoteSoftwarePersona, remoteAccountantPersona, onsiteNursePersona];
