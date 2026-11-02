import { describe, expect, it } from "vitest";
import { FactLibrarySchema } from "@jobtailor/core";
import { parseMonth, parseProject, parseWorkExperiences } from "../src/seed/parse-library";

const SAMPLE = `# Library

Intro paragraph.

---

## Pastry Chef, Example Bakery (client: Hotel Group)

Oct 2025 – Present
Stack: Ovens / Mixers (planetary) / Spreadsheets

**Portfolio facts (use for scope lines)**

- Ran three product lines:
  - **Bread**: daily loaves
  - **Cakes**: weddings
- Team of 4

**Portfolio variants**

- Ran three product lines for a hotel group

**Notes**

- Never write "head chef". Employed by the bakery.

### Night shift \`#ops\` \`#leadership\`

**Facts**

- Baked 500 loaves a night
- _(design capacity)_ Kitchen sized for 2,000 loaves a night

**Variants**

- Baked 500 loaves a night

## Assistant Baker, Other Bakery

Jul 2022 – Sep 2022

### Prep \`#ops\`

**Facts**

- Prepared dough

---

## Skills not tied to a role

- Sourdough, Lamination (learned at home)
- Food safety: certificate course
`;

describe("parseWorkExperiences", () => {
  const lib = parseWorkExperiences(SAMPLE);

  it("splits roles and topics and keeps dates", () => {
    const orgs = lib.entries.map((e) => e.org);
    expect(new Set(orgs)).toEqual(new Set(["Example Bakery", "Other Bakery"]));
    const first = lib.entries[0]!;
    expect(first.title).toBe("Pastry Chef");
    expect(first.start).toBe("2025-10");
    expect(first.end).toBeNull();
    expect(lib.entries.find((e) => e.org === "Other Bakery")?.end).toBe("2022-09");
  });

  it("attaches nested bullets to their parent", () => {
    const facts = lib.entries[0]!.facts.map((f) => f.text);
    expect(facts).toContain("Ran three product lines: Bread: daily loaves");
    expect(facts).toContain("Team of 4");
  });

  it("marks design-capacity facts and strips the marker", () => {
    const fact = lib.entries.flatMap((e) => e.facts).find((f) => f.designCapacity);
    expect(fact?.text).toBe("Kitchen sized for 2,000 loaves a night");
  });

  it("extracts doNotClaim phrases and keeps topic tags", () => {
    expect(lib.entries[0]!.doNotClaim).toEqual(["head chef"]);
    const night = lib.entries.find((e) => e.id.includes("night-shift"));
    expect(night?.tags).toEqual(["ops", "leadership"]);
  });

  it("collects skills from the stack and the skills section", () => {
    expect(lib.skills).toEqual(expect.arrayContaining(["Ovens", "Mixers", "Sourdough", "Lamination", "Food safety"]));
  });

  it("produces a library that passes the schema", () => {
    const parsed = FactLibrarySchema.safeParse({ contact: { name: "T", email: "t@example.com" }, ...lib });
    expect(parsed.success).toBe(true);
  });
});

describe("parseProject", () => {
  it("reads name, url and topics", () => {
    const p = parseProject(`# Cookbook\n\nhttps://example.com/book\nStack: Ink / Paper\n\n### Recipes \`#food\`\n\n**Facts**\n\n- 40 recipes\n`);
    expect(p.entries[0]?.kind).toBe("project");
    expect(p.entries[0]?.url).toBe("https://example.com/book");
    expect(p.skills).toEqual(["Ink", "Paper"]);
  });
});

describe("parseMonth", () => {
  it("handles short month names only", () => {
    expect(parseMonth("Mar 2024")).toBe("2024-03");
    expect(parseMonth("soon")).toBeNull();
  });
});
