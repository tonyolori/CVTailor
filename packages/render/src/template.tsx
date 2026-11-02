import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CoverLetter, Resume, ResumeSection } from "@jobtailor/core";

// Ported from the legacy theme: a serif name over a sans body, one navy accent, caps section
// headings with a hairline rule, dates right-aligned on each role's title line.
const NAVY = "#16304f";
const ACCENT = "#2d5a8c";
const BODY = "#1f2937";
const MUTED = "#4b5563";
const RULE = "#c7d2df";
const INK = "#111827";

const s = StyleSheet.create({
  page: {
    paddingVertical: 30,
    paddingHorizontal: 43,
    fontFamily: "Inter",
    fontSize: 9.4,
    lineHeight: 1.36,
    color: BODY,
  },
  header: { alignItems: "center", paddingBottom: 7, borderBottomWidth: 2, borderBottomColor: NAVY, marginBottom: 2 },
  name: { fontFamily: "Lora", fontWeight: 700, fontSize: 25, color: NAVY, lineHeight: 1.2 },
  role: { fontWeight: 600, fontSize: 8.8, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.35, marginTop: 2 },
  contact: { fontSize: 9, color: MUTED, marginTop: 3, textAlign: "center", lineHeight: 1.5 },
  link: { color: MUTED, textDecoration: "none" },
  // Tracking stays low: wider and PDF text extractors, so ATS parsers, read "S U M M A R Y".
  h2: {
    fontWeight: 600,
    fontSize: 8.6,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.34,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
    paddingBottom: 2,
    marginTop: 9,
    marginBottom: 4,
  },
  entry: { marginBottom: 5 },
  entryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  entryTitle: { fontWeight: 600, fontSize: 10, color: INK, flexShrink: 1, paddingRight: 8 },
  entryDate: { fontWeight: 500, fontSize: 8.6, color: MUTED, flexShrink: 0 },
  org: { fontWeight: 500, color: ACCENT, marginBottom: 1 },
  bullet: { flexDirection: "row", marginTop: 1.2 },
  bulletMark: { width: 10, color: ACCENT },
  bulletText: { flex: 1 },
  skillGroup: { fontWeight: 600, color: INK },
  paragraph: { marginBottom: 8.5, lineHeight: 1.5 },
  letterMeta: { marginTop: 14, marginBottom: 8.5 },
  strong: { fontWeight: 600, color: INK },
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})/);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`.trim();
  return value;
}

export function dateRange(start: string | null | undefined, end: string | null | undefined, open = true): string {
  const from = formatDate(start);
  const to = end ? formatDate(end) : open ? "Present" : "";
  return from && to ? `${from} – ${to}` : from || to;
}

function Header({ header }: { header: Resume["header"] }) {
  const parts = [header.location, header.phone].filter(Boolean) as string[];
  return (
    <View style={s.header}>
      <Text style={s.name}>{header.name}</Text>
      {header.roleTitle ? <Text style={s.role}>{header.roleTitle}</Text> : null}
      {parts.length > 0 ? <Text style={s.contact}>{parts.join(" | ")}</Text> : null}
      <Text style={{ ...s.contact, marginTop: 0 }}>
        <Link src={`mailto:${header.email}`} style={s.link}>
          {header.email}
        </Link>
        {header.links.map((l) => (
          <Text key={l.url}>
            {" | "}
            <Link src={l.url} style={s.link}>
              {l.label}
            </Link>
          </Text>
        ))}
      </Text>
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={s.bullet}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </>
  );
}

/** Title then date in the text layer, so applicant tracking systems read each entry correctly. */
function EntryHead({ title, date }: { title: string; date: string }) {
  return (
    <View style={s.entryRow} wrap={false}>
      <Text style={s.entryTitle}>{title}</Text>
      {date ? <Text style={s.entryDate}>{date}</Text> : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={s.h2} minPresenceAhead={30}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function sectionBody(section: ResumeSection, r: Resume): React.ReactNode {
  switch (section) {
    case "summary":
      return r.summary ? (
        <Section title="Summary">
          <Text>{r.summary}</Text>
        </Section>
      ) : null;
    case "skills":
      return r.skills.length ? (
        <Section title="Skills">
          {r.skills.map((g, i) => (
            <Text key={i} style={{ marginBottom: 1.5 }}>
              <Text style={s.skillGroup}>{g.group}: </Text>
              {g.items.join(" | ")}
            </Text>
          ))}
        </Section>
      ) : null;
    case "credentials":
      return r.credentials.length ? (
        <Section title="Licences and certifications">
          {r.credentials.map((c, i) => (
            <View key={i} style={{ marginBottom: 2 }}>
              <EntryHead title={c.name} date={c.year ?? ""} />
              {c.issuer || c.reference ? <Text style={s.org}>{[c.issuer, c.reference].filter(Boolean).join(", ")}</Text> : null}
            </View>
          ))}
        </Section>
      ) : null;
    case "experience":
      return r.experience.length ? (
        <Section title="Experience">
          {r.experience.map((x, i) => (
            <View key={i} style={s.entry}>
              <View wrap={false}>
                <EntryHead title={x.title} date={dateRange(x.start, x.end)} />
                <Text style={s.org}>{[x.company, x.location].filter(Boolean).join(", ")}</Text>
              </View>
              <Bullets items={x.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "projects":
      return r.projects.length ? (
        <Section title="Projects">
          {r.projects.map((p, i) => (
            <View key={i} style={s.entry}>
              <EntryHead title={[p.name, p.stack].filter(Boolean).join(" | ")} date="" />
              {p.url ? (
                <Link src={p.url} style={{ ...s.link, color: ACCENT }}>
                  {p.url}
                </Link>
              ) : null}
              <Bullets items={p.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "education":
      return r.education.length ? (
        <Section title="Education">
          {r.education.map((e, i) => (
            <View key={i} style={{ marginBottom: 3 }}>
              <EntryHead
                title={[e.degree, e.school, e.location].filter(Boolean).join(", ")}
                date={dateRange(e.start, e.end, false)}
              />
            </View>
          ))}
        </Section>
      ) : null;
    case "languages":
      return r.languages.length ? (
        <Section title="Languages">
          <Text>{r.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(" | ")}</Text>
        </Section>
      ) : null;
    case "publications":
      return r.publications.length ? (
        <Section title="Publications">
          {r.publications.map((p, i) => (
            <Text key={i} style={{ marginBottom: 2 }}>
              {[p.title, p.venue, p.year].filter(Boolean).join(", ")}
            </Text>
          ))}
        </Section>
      ) : null;
    case "volunteering":
      return r.volunteering.length ? (
        <Section title="Volunteering">
          {r.volunteering.map((v, i) => (
            <View key={i} style={s.entry}>
              <EntryHead title={`${v.title}, ${v.org}`} date={dateRange(v.start, v.end, Boolean(v.start))} />
              <Bullets items={v.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "portfolio":
      return r.portfolioLinks.length ? (
        <Section title="Portfolio">
          <Text>
            {r.portfolioLinks.map((l, i) => (
              <Text key={l.url}>
                {i > 0 ? " | " : ""}
                <Link src={l.url} style={{ ...s.link, color: ACCENT }}>
                  {l.label}
                </Link>
              </Text>
            ))}
          </Text>
        </Section>
      ) : null;
  }
}

/** Sections in the chosen order. A section with content that's missing from the order still appears at the end. */
export function orderedSections(r: Resume): ResumeSection[] {
  const all: ResumeSection[] = ["summary", "skills", "credentials", "experience", "projects", "education", "languages", "publications", "volunteering", "portfolio"];
  return [...new Set([...r.sectionOrder, ...all])];
}

export function ResumeDocument({ resume }: { resume: Resume }) {
  return (
    <Document title={`${resume.header.name} - ${resume.header.roleTitle}`} author={resume.header.name} creator="JobTailor" producer="JobTailor">
      <Page size={resume.template.pageSize} style={s.page}>
        <Header header={resume.header} />
        {orderedSections(resume).map((section) => (
          <View key={section}>{sectionBody(section, resume)}</View>
        ))}
      </Page>
    </Document>
  );
}

export function CoverLetterDocument({ letter }: { letter: CoverLetter }) {
  return (
    <Document title={`${letter.header.name} - ${letter.subject}`} author={letter.header.name} creator="JobTailor" producer="JobTailor">
      <Page size={letter.template.pageSize} style={s.page}>
        <Header header={letter.header} />
        <View style={s.letterMeta}>
          <Text>{letter.date}</Text>
          <Text style={{ ...s.strong, marginTop: 6 }}>{letter.subject}</Text>
        </View>
        <Text style={s.paragraph}>{letter.salutation}</Text>
        {letter.paragraphs.map((p, i) => (
          <Text key={i} style={s.paragraph}>
            {p}
          </Text>
        ))}
        <Text>{letter.signOff}</Text>
        <Text>{letter.signature}</Text>
      </Page>
    </Document>
  );
}
