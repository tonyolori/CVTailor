"use client";

import { useTransition } from "react";
import { setTrackerStatus } from "@/app/actions";

const LABELS: Record<string, string> = {
  to_apply: "To apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Dismissed",
};

export function StatusSelect({ matchId, value }: { matchId: number; value: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Application status"
      style={{ width: "auto" }}
      disabled={pending}
      defaultValue={value}
      onChange={(e) => {
        const status = e.target.value;
        start(async () => {
          await setTrackerStatus(matchId, status);
        });
      }}
    >
      {Object.entries(LABELS).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}
