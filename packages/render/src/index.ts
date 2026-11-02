import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { CoverLetter, Resume } from "@jobtailor/core";
import { CoverLetterDocument, ResumeDocument } from "./template";

export { dateRange, formatDate, orderedSections } from "./template";

const require = createRequire(import.meta.url);

function fontFile(pkg: string, file: string): string {
  return join(dirname(require.resolve(`${pkg}/package.json`)), file);
}

let registered = false;

/**
 * Bundled fonts render the same on any machine. These are the full Google Fonts files, not
 * the latin or latin-ext subsets: those lack letters such as "Ọ" and draw the wrong glyph,
 * which would corrupt many people's names. Only the glyphs used get embedded in each PDF.
 */
function registerFonts(): void {
  if (registered) return;
  registered = true;
  const inter = (weight: number, name: string) => ({
    src: fontFile("@expo-google-fonts/inter", `${weight}${name}/Inter_${weight}${name}.ttf`),
    fontWeight: weight,
  });
  Font.register({ family: "Inter", fonts: [inter(400, "Regular"), inter(500, "Medium"), inter(600, "SemiBold"), inter(700, "Bold")] });
  Font.register({
    family: "Lora",
    fonts: [{ src: fontFile("@expo-google-fonts/lora", "700Bold/Lora_700Bold.ttf"), fontWeight: 700 }],
  });
  // No automatic hyphens: an ATS should see whole words.
  Font.registerHyphenationCallback((word) => [word]);
}

export interface RenderedPdf {
  pdf: Buffer;
  pages: number;
}

async function render(element: ReactElement): Promise<RenderedPdf> {
  registerFonts();
  const pdf = await renderToBuffer(element as never);
  return { pdf, pages: countPages(pdf) };
}

/** Counts leaf page objects, without a PDF parser. The renderer's output format is known. */
export function countPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/** One renderer for email, download and preview. Needs only Node, so the web app can run it with the worker off. */
export function renderResumePdf(resume: Resume): Promise<RenderedPdf> {
  return render(createElement(ResumeDocument, { resume }));
}

export function renderCoverLetterPdf(letter: CoverLetter): Promise<RenderedPdf> {
  return render(createElement(CoverLetterDocument, { letter }));
}

export const MAX_RESUME_PAGES = 2;
export const MAX_LETTER_PAGES = 1;
