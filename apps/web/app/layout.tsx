import type { Metadata } from "next";
import { Inter, Instrument_Sans, Instrument_Serif, Lora, Source_Serif_4 } from "next/font/google";
import { ReviewNotes } from "@/components/ReviewNotes";
import "./globals.css";

const serif = Instrument_Serif({ weight: "400", subsets: ["latin", "latin-ext"], variable: "--f-serif", display: "swap" });
const pub = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--f-public", display: "swap" });
const body = Inter({ subsets: ["latin", "latin-ext"], variable: "--f-body", display: "swap" });
const cv = Source_Serif_4({ subsets: ["latin", "latin-ext"], variable: "--f-cv", display: "swap" });
const classic = Lora({ weight: "700", subsets: ["latin", "latin-ext"], variable: "--f-classic", display: "swap" });

export const metadata: Metadata = {
  title: "CV Tailor",
  description: "A new CV for every job, written from your own experience.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[serif.variable, pub.variable, body.variable, cv.variable, classic.variable].join(" ")}>
      <body>
        {children}
        {process.env.NODE_ENV === "development" ? <ReviewNotes /> : null}
      </body>
    </html>
  );
}
