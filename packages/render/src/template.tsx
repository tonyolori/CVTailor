import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
// In scope on purpose: tsx applies a tsconfig only to files it includes, so running the worker
// compiles this file with classic JSX, which needs React here. Other runners ignore the import.
import * as React from "react";
import { dateRange, orderedSections, SECTION_TITLES, type CoverLetter, type CvStyle, type Resume, type ResumeSection } from "@cvtailor/core";

void React;

/** Everything that differs between CV styles. Classic is the original design, unchanged. */
interface Theme {
  body: string;
  head: string;
  name: { family: string; weight: number; size: number; color: string; align: "center" | "left" };
  role: { size: number; color: string; weight: number; caps: boolean; spacing: number };
  headerRule: { width: number; color: string };
  h2: { size: number; color: string; weight: number; caps: boolean; spacing: number; rule: number; ruleColor: string; marginTop: number };
  text: string;
  muted: string;
  ink: string;
  accent: string;
  size: number;
  lineHeight: number;
  page: { v: number; h: number };
  entryGap: number;
  bulletGap: number;
}

const THEMES: Record<CvStyle, Theme> = {
  classic: {
    body: "Inter",
    head: "Inter",
    name: { family: "Lora", weight: 700, size: 25, color: "#16304f", align: "center" },
    role: { size: 8.8, color: "#2d5a8c", weight: 600, caps: true, spacing: 0.35 },
    headerRule: { width: 2, color: "#16304f" },
    // Tracking stays low: wider and PDF text extractors, so ATS parsers, read "S U M M A R Y".
    h2: { size: 8.6, color: "#16304f", weight: 600, caps: true, spacing: 0.34, rule: 0.75, ruleColor: "#c7d2df", marginTop: 9 },
    text: "#1f2937",
    muted: "#4b5563",
    ink: "#111827",
    accent: "#2d5a8c",
    size: 9.4,
    lineHeight: 1.36,
    page: { v: 30, h: 43 },
    entryGap: 5,
    bulletGap: 1.2,
  },
  fitted: {
    body: "Source Serif",
    head: "Source Serif",
    name: { family: "Source Serif", weight: 700, size: 25, color: "#14204A", align: "left" },
    role: { size: 11, color: "#1546E0", weight: 600, caps: false, spacing: 0 },
    headerRule: { width: 0, color: "#14204A" },
    h2: { size: 10, color: "#14204A", weight: 700, caps: false, spacing: 0, rule: 0.75, ruleColor: "#C8D2EA", marginTop: 10 },
    text: "#14204A",
    muted: "#5B678C",
    ink: "#14204A",
    accent: "#1546E0",
    size: 10,
    lineHeight: 1.38,
    page: { v: 34, h: 46 },
    entryGap: 6,
    bulletGap: 1.5,
  },
  plain: {
    body: "Inter",
    head: "Inter",
    name: { family: "Inter", weight: 700, size: 20, color: "#111111", align: "left" },
    role: { size: 10, color: "#111111", weight: 400, caps: false, spacing: 0 },
    headerRule: { width: 0, color: "#111111" },
    h2: { size: 10.5, color: "#111111", weight: 700, caps: false, spacing: 0, rule: 0, ruleColor: "#111111", marginTop: 11 },
    text: "#111111",
    muted: "#444444",
    ink: "#111111",
    accent: "#111111",
    size: 9.6,
    lineHeight: 1.38,
    page: { v: 36, h: 46 },
    entryGap: 6,
    bulletGap: 1.2,
  },
  compact: {
    body: "Inter",
    head: "Inter",
    name: { family: "Inter", weight: 700, size: 19, color: "#1546E0", align: "left" },
    role: { size: 9, color: "#1a2340", weight: 600, caps: false, spacing: 0 },
    headerRule: { width: 0, color: "#1a2340" },
    h2: { size: 8.8, color: "#1546E0", weight: 600, caps: false, spacing: 0, rule: 0.5, ruleColor: "#D5DFF5", marginTop: 7 },
    text: "#1a2340",
    muted: "#4b5563",
    ink: "#1a2340",
    accent: "#1546E0",
    size: 8.6,
    lineHeight: 1.28,
    page: { v: 24, h: 34 },
    entryGap: 3.5,
    bulletGap: 0.6,
  },
};

function stylesFor(t: Theme) {
  const center = t.name.align === "center";
  return StyleSheet.create({
    page: { paddingVertical: t.page.v, paddingHorizontal: t.page.h, fontFamily: t.body, fontSize: t.size, lineHeight: t.lineHeight, color: t.text },
    header: {
      alignItems: center ? "center" : "flex-start",
      paddingBottom: t.headerRule.width ? 7 : 2,
      borderBottomWidth: t.headerRule.width,
      borderBottomColor: t.headerRule.color,
      marginBottom: 2,
    },
    name: { fontFamily: t.name.family, fontWeight: t.name.weight as 700, fontSize: t.name.size, color: t.name.color, lineHeight: 1.2 },
    role: { fontWeight: t.role.weight as 600, fontSize: t.role.size, color: t.role.color, textTransform: t.role.caps ? "uppercase" : "none", letterSpacing: t.role.spacing, marginTop: 2 },
    contact: { fontSize: t.size - 0.4, color: t.muted, marginTop: 3, textAlign: center ? "center" : "left", lineHeight: 1.5 },
    link: { color: t.muted, textDecoration: "none" },
    h2: {
      fontFamily: t.head,
      fontWeight: t.h2.weight as 600,
      fontSize: t.h2.size,
      color: t.h2.color,
      textTransform: t.h2.caps ? "uppercase" : "none",
      letterSpacing: t.h2.spacing,
      borderBottomWidth: t.h2.rule,
      borderBottomColor: t.h2.ruleColor,
      paddingBottom: t.h2.rule ? 2 : 0,
      marginTop: t.h2.marginTop,
      marginBottom: 4,
    },
    entry: { marginBottom: t.entryGap },
    entryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    entryTitle: { fontWeight: 600, fontSize: t.size + 0.6, color: t.ink, flexShrink: 1, paddingRight: 8 },
    entryDate: { fontWeight: t.body === "Source Serif" ? 400 : 500, fontSize: t.size - 0.8, color: t.muted, flexShrink: 0 },
    org: { fontWeight: t.body === "Source Serif" ? 400 : 500, color: t.accent, marginBottom: 1 },
    bullet: { flexDirection: "row", marginTop: t.bulletGap },
    bulletMark: { width: 10, color: t.accent },
    bulletText: { flex: 1 },
    skillGroup: { fontWeight: 600, color: t.ink },
    paragraph: { marginBottom: 8.5, lineHeight: 1.5 },
    letterMeta: { marginTop: 14, marginBottom: 8.5 },
    strong: { fontWeight: 600, color: t.ink },
  });
}
type Styles = ReturnType<typeof stylesFor>;

function Header({ header, s }: { header: Resume["header"]; s: Styles }) {
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

function Bullets({ items, s }: { items: string[]; s: Styles }) {
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </>
  );
}

/** Title then date in the text layer, so applicant tracking systems read each entry correctly. */
function EntryHead({ title, date, s }: { title: string; date: string; s: Styles }) {
  return (
    <View style={s.entryRow} wrap={false}>
      <Text style={s.entryTitle}>{title}</Text>
      {date ? <Text style={s.entryDate}>{date}</Text> : null}
    </View>
  );
}

function Section({ title, children, s }: { title: string; children: React.ReactNode; s: Styles }) {
  return (
    <View>
      <Text style={s.h2} minPresenceAhead={30}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function sectionBody(section: ResumeSection, r: Resume, s: Styles, accent: string): React.ReactNode {
  switch (section) {
    case "summary":
      return r.summary ? (
        <Section s={s} title={SECTION_TITLES.summary}>
          <Text>{r.summary}</Text>
        </Section>
      ) : null;
    case "skills":
      return r.skills.length ? (
        <Section s={s} title={SECTION_TITLES.skills}>
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
        <Section s={s} title={SECTION_TITLES.credentials}>
          {r.credentials.map((c, i) => (
            <View key={i} style={{ marginBottom: 2 }}>
              <EntryHead s={s} title={c.name} date={c.year ?? ""} />
              {c.issuer || c.reference ? <Text style={s.org}>{[c.issuer, c.reference].filter(Boolean).join(", ")}</Text> : null}
            </View>
          ))}
        </Section>
      ) : null;
    case "experience":
      return r.experience.length ? (
        <Section s={s} title={SECTION_TITLES.experience}>
          {r.experience.map((x, i) => (
            <View key={i} style={s.entry}>
              <View wrap={false}>
                <EntryHead s={s} title={x.title} date={dateRange(x.start, x.end)} />
                <Text style={s.org}>{[x.company, x.location].filter(Boolean).join(", ")}</Text>
              </View>
              <Bullets s={s} items={x.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "projects":
      return r.projects.length ? (
        <Section s={s} title={SECTION_TITLES.projects}>
          {r.projects.map((p, i) => (
            <View key={i} style={s.entry}>
              <EntryHead s={s} title={[p.name, p.stack].filter(Boolean).join(" | ")} date="" />
              {p.url ? (
                <Link src={p.url} style={{ ...s.link, color: accent }}>
                  {p.url}
                </Link>
              ) : null}
              <Bullets s={s} items={p.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "education":
      return r.education.length ? (
        <Section s={s} title={SECTION_TITLES.education}>
          {r.education.map((e, i) => (
            <View key={i} style={{ marginBottom: 3 }}>
              <EntryHead
                s={s}
                title={[e.degree, e.school, e.location].filter(Boolean).join(", ")}
                date={dateRange(e.start, e.end, false)}
              />
            </View>
          ))}
        </Section>
      ) : null;
    case "languages":
      return r.languages.length ? (
        <Section s={s} title={SECTION_TITLES.languages}>
          <Text>{r.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(" | ")}</Text>
        </Section>
      ) : null;
    case "publications":
      return r.publications.length ? (
        <Section s={s} title={SECTION_TITLES.publications}>
          {r.publications.map((p, i) => (
            <Text key={i} style={{ marginBottom: 2 }}>
              {[p.title, p.venue, p.year].filter(Boolean).join(", ")}
            </Text>
          ))}
        </Section>
      ) : null;
    case "volunteering":
      return r.volunteering.length ? (
        <Section s={s} title={SECTION_TITLES.volunteering}>
          {r.volunteering.map((v, i) => (
            <View key={i} style={s.entry}>
              <EntryHead s={s} title={`${v.title}, ${v.org}`} date={dateRange(v.start, v.end, Boolean(v.start))} />
              <Bullets s={s} items={v.bullets} />
            </View>
          ))}
        </Section>
      ) : null;
    case "portfolio":
      return r.portfolioLinks.length ? (
        <Section s={s} title={SECTION_TITLES.portfolio}>
          <Text>
            {r.portfolioLinks.map((l, i) => (
              <Text key={l.url}>
                {i > 0 ? " | " : ""}
                <Link src={l.url} style={{ ...s.link, color: accent }}>
                  {l.label}
                </Link>
              </Text>
            ))}
          </Text>
        </Section>
      ) : null;
  }
}

export function ResumeDocument({ resume, style = "classic" }: { resume: Resume; style?: CvStyle }) {
  const theme = THEMES[style];
  const s = stylesFor(theme);
  return (
    <Document title={`${resume.header.name} - ${resume.header.roleTitle}`} author={resume.header.name} creator="CV Tailor" producer="CV Tailor">
      <Page size={resume.template.pageSize} style={s.page}>
        <Header s={s} header={resume.header} />
        {orderedSections(resume).map((section) => (
          <View key={section}>{sectionBody(section, resume, s, theme.accent)}</View>
        ))}
      </Page>
    </Document>
  );
}

export function CoverLetterDocument({ letter, style = "classic" }: { letter: CoverLetter; style?: CvStyle }) {
  const s = stylesFor(THEMES[style]);
  return (
    <Document title={`${letter.header.name} - ${letter.subject}`} author={letter.header.name} creator="CV Tailor" producer="CV Tailor">
      <Page size={letter.template.pageSize} style={s.page}>
        <Header s={s} header={letter.header} />
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
