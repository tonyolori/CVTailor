import { dateInWords, exactDate } from "@/lib/dates";

/** A date in words, with the exact date and time on hover. */
export function When({ value, timeZone }: { value: string | null | undefined; timeZone?: string }) {
  if (!value) return <span>Not yet</span>;
  return (
    <time dateTime={value} title={exactDate(value, timeZone)}>
      {dateInWords(value, new Date(), timeZone)}
    </time>
  );
}
