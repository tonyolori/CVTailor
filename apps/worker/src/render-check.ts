import { ResumeSchema } from "@cvtailor/core";
import { renderResumePdf } from "@cvtailor/render";
const r = await renderResumePdf(ResumeSchema.parse({ header: { name: "Ọla", roleTitle: "X", email: "a@b.co" }, summary: "hi" }));
console.log("pdf pages", r.pages, "bytes", r.pdf.length);
