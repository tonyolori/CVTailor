import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CoverLetterSchema, CV_STYLES, ResumeSchema, type ResumeInput } from "@cvtailor/core";
import { countPages, dateRange, orderedSections, renderCoverLetterPdf, renderResumePdf } from "./index";

/** Reads text by position, the way PDF parsers and ATS extractors do: a space only where there's a visible gap. */
async function pdfText(pdf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastX = 0;
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const newLine = lastY !== null && Math.abs(y - lastY) > 2;
      const gap = x - lastX;
      if (newLine || gap > 1.5) out += " ";
      out += item.str;
      lastX = x + item.width;
      lastY = y;
    }
    out += "\n";
  }
  return out.replace(/\s+/g, " ");
}

const base: ResumeInput = {
  header: {
    name: "Şahin Ñandú Ọlá",
    roleTitle: "Staff Nurse",
    location: "Manchester, UK",
    phone: "+44 000 000",
    email: "s@example.com",
    links: [{ label: "Portfolio", url: "https://example.com/p" }],
  },
  summary: "Experienced nurse who keeps wards calm.",
  summarySuggestion: { identity: "SECRET-EDITOR-ADVICE", hook: "h", fit: "f" },
  skills: [{ group: "Clinical", items: ["Wound care", "Care planning"] }],
  experience: [
    {
      title: "Staff Nurse",
      company: "Riverside Hospital",
      location: "Manchester",
      start: "2018-09",
      end: null,
      bullets: ["Cared for up to 8 patients per shift.", "Mentored 12 student nurses."],
    },
    { title: "Healthcare Assistant", company: "Care Home", start: "2016-01", end: "2018-08", bullets: ["Supported residents."] },
  ],
  education: [{ degree: "BSc Adult Nursing", school: "University of Salford", start: "2015", end: "2018" }],
  credentials: [{ name: "NMC Registration", issuer: "Nursing and Midwifery Council", year: "2018" }],
  languages: [{ name: "English", level: "Native" }],
  publications: [{ title: "On Wards", venue: "Nursing Times", year: "2022" }],
  volunteering: [{ title: "First Aider", org: "Red Cross", start: "2019", bullets: ["Staffed events."] }],
  portfolioLinks: [{ label: "Site", url: "https://example.com/site" }],
};

describe("renderResumePdf", () => {
  it("produces a one-page PDF with every section's text", async () => {
    const { pdf, pages } = await renderResumePdf(ResumeSchema.parse(base));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBe(1);
    const text = await pdfText(pdf);
    for (const expected of ["Staff Nurse", "Riverside Hospital", "NMC Registration", "On Wards", "Red Cross", "BSc Adult Nursing"]) {
      expect(text).toContain(expected);
    }
  });

  it("keeps the text layer in reading order: title, then date, then bullets", async () => {
    const text = await pdfText((await renderResumePdf(ResumeSchema.parse(base))).pdf);
    const title = text.indexOf("Healthcare Assistant");
    const date = text.indexOf("Jan 2016 – Aug 2018");
    const company = text.indexOf("Care Home");
    const bullet = text.indexOf("Supported residents");
    expect(title).toBeGreaterThanOrEqual(0);
    expect(date).toBeGreaterThan(title);
    expect(company).toBeGreaterThan(date);
    expect(bullet).toBeGreaterThan(company);
  });

  it("section headings read as words, not spaced letters", async () => {
    const text = await pdfText((await renderResumePdf(ResumeSchema.parse(base))).pdf);
    expect(text).toContain("SUMMARY");
    expect(text).toContain("EXPERIENCE");
    expect(text).not.toMatch(/S U M M A R Y/);
  });

  it("never renders the editor-only summary suggestion", async () => {
    const text = await pdfText((await renderResumePdf(ResumeSchema.parse(base))).pdf);
    expect(text).not.toContain("SECRET-EDITOR-ADVICE");
  });

  it("renders names outside basic Latin", async () => {
    const text = await pdfText((await renderResumePdf(ResumeSchema.parse(base))).pdf);
    expect(text).toContain("Şahin");
    expect(text).toContain("Ñandú");
    expect(text).toContain("Ọlá");
  });

  it("follows the chosen section order, licences first for regulated professions", async () => {
    const text = await pdfText(
      (await renderResumePdf(ResumeSchema.parse({ ...base, sectionOrder: ["credentials", "summary", "experience"] }))).pdf,
    );
    expect(text.indexOf("LICENCES AND CERTIFICATIONS")).toBeLessThan(text.indexOf("SUMMARY"));
    expect(text.indexOf("SUMMARY")).toBeLessThan(text.indexOf("EXPERIENCE"));
    expect(text).toContain("BSc Adult Nursing");
  });

  it("omits empty sections and supports both page sizes", async () => {
    const minimal = ResumeSchema.parse({ header: base.header, summary: "S", template: { pageSize: "LETTER" } });
    const { pdf } = await renderResumePdf(minimal);
    const text = await pdfText(pdf);
    expect(text).not.toContain("EDUCATION");
    const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    expect(page.view[2]).toBeCloseTo(612, 0);
  });

  it("never strands a bullet mark at the bottom of a page", async () => {
    const long = ResumeSchema.parse({
      ...base,
      experience: Array.from({ length: 6 }, (_, i) => ({
        title: `Role ${i}`,
        company: "Co",
        start: "2020-01",
        end: "2021-01",
        bullets: Array.from({ length: 8 }, () => "A long bullet that wraps over more than one line of text on the page, so that it can land right on the boundary between two pages when the content runs long."),
      })),
    });
    const { pdf, pages } = await renderResumePdf(long);
    expect(pages).toBeGreaterThan(1);
    const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.flatMap((i) => ("str" in i && i.str.trim() ? [i.str.trim()] : []));
      expect(items.at(-1), `page ${p}`).not.toBe("•");
    }
  });

  it("reports when long content runs past two pages", async () => {
    const long = ResumeSchema.parse({
      ...base,
      experience: Array.from({ length: 12 }, (_, i) => ({
        title: `Role ${i}`,
        company: "Co",
        start: "2020-01",
        end: "2021-01",
        bullets: Array.from({ length: 8 }, () => "A long bullet that takes a full line of text on the page to make the resume run long and long."),
      })),
    });
    const { pages, pdf } = await renderResumePdf(long);
    expect(pages).toBeGreaterThan(2);
    const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
    expect(doc.numPages).toBe(pages);
  });
});

describe("CV styles", () => {
  for (const style of CV_STYLES.map((c) => c.id)) {
    it(`${style}: every fact survives, readable by a parser, on one page`, async () => {
      const { pdf, pages } = await renderResumePdf(ResumeSchema.parse(base), style);
      const text = await pdfText(pdf);
      expect(pages).toBe(1);
      for (const part of ["Şahin Ñandú Ọlá", "Cared for up to 8 patients per shift.", "Licences and certifications", "NMC Registration", "Experience"]) {
        expect(text.toLowerCase()).toContain(part.toLowerCase());
      }
      expect(text).not.toContain("SECRET-EDITOR-ADVICE");
    });

    it(`${style}: cover letter renders on one page`, async () => {
      const header = ResumeSchema.parse(base).header;
      const { pages } = await renderCoverLetterPdf(
        CoverLetterSchema.parse({ header, date: "4 November 2026", subject: "Staff Nurse", salutation: "Dear team,", paragraphs: ["First paragraph.", "Second paragraph."], signOff: "Regards,", signature: header.name }),
        style,
      );
      expect(pages).toBe(1);
    });
  }

  it("the styles look different from each other", async () => {
    const resume = ResumeSchema.parse(base);
    const sizes = await Promise.all(CV_STYLES.map(async (c) => (await renderResumePdf(resume, c.id)).pdf.toString("latin1")));
    expect(new Set(sizes).size).toBe(CV_STYLES.length);
  });

  it("uses the original design unless told otherwise", async () => {
    const resume = ResumeSchema.parse(base);
    const strip = (b: Buffer) => b.toString("latin1").replace(/\/(CreationDate|ModDate|ID)[^\n]*/g, "");
    expect(strip((await renderResumePdf(resume)).pdf)).toBe(strip((await renderResumePdf(resume, "classic")).pdf));
  });
});

describe("renderCoverLetterPdf", () => {
  it("renders one page", async () => {
    const letter = CoverLetterSchema.parse({
      header: { name: "A B", roleTitle: "Accountant", email: "a@example.com" },
      date: "November 2, 2026",
      subject: "Acme – Accountant",
      salutation: "Dear Hiring Team,",
      paragraphs: ["First paragraph.", "Second paragraph."],
      signOff: "Kind regards,",
      signature: "A B",
      template: { convention: "standard", pageSize: "A4" },
    });
    const { pdf, pages } = await renderCoverLetterPdf(letter);
    expect(pages).toBe(1);
    expect(await pdfText(pdf)).toContain("Dear Hiring Team,");
  });
});

describe("helpers", () => {
  it("formats date ranges", () => {
    expect(dateRange("2024-03", null)).toBe("Mar 2024 – Present");
    expect(dateRange("2019", "2023", false)).toBe("2019 – 2023");
    expect(dateRange(undefined, undefined, false)).toBe("");
  });

  it("orderedSections keeps the choice and appends the rest", () => {
    const order = orderedSections(ResumeSchema.parse({ header: base.header, summary: "", sectionOrder: ["education"] }));
    expect(order[0]).toBe("education");
    expect(order).toContain("summary");
  });

  it("countPages ignores the /Pages tree node", () => {
    expect(countPages(Buffer.from("/Type /Pages /Type /Page /Type/Page"))).toBe(2);
  });
});
