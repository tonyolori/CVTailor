import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobTailor",
  description: "Job matches and tailored CVs, from your own experience.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
