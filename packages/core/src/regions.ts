import { z } from "zod";

export const Region = z.enum([
  "EU",
  "EUROPE",
  "UK",
  "EMEA",
  "AFRICA",
  "NORTH_AMERICA",
  "LATAM",
  "APAC",
  "MENA",
]);
export type Region = z.infer<typeof Region>;

const EU = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");
const EUROPE_NON_EU = "AL AD BA BY CH FO GB GI IS LI MC MD ME MK NO RS SM UA VA XK".split(" ");
const AFRICA =
  "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW".split(
    " ",
  );
const NORTH_AMERICA = "US CA".split(" ");
const LATAM = "AR BO BR CL CO CR CU DO EC GT HN HT MX NI PA PE PR PY SV UY VE".split(" ");
const APAC = "AU BD BN BT CN FJ HK ID IN JP KH KR LA LK MM MN MO MY NP NZ PG PH PK SG TH TL TW VN".split(" ");
const MENA = "AE BH DZ EG IL IQ IR JO KW LB LY MA OM PS QA SA SD SY TN TR YE".split(" ");

const REGION_COUNTRIES: Record<Region, Set<string>> = {
  EU: new Set(EU),
  EUROPE: new Set([...EU, ...EUROPE_NON_EU]),
  UK: new Set(["GB"]),
  EMEA: new Set([...EU, ...EUROPE_NON_EU, ...AFRICA, ...MENA]),
  AFRICA: new Set(AFRICA),
  NORTH_AMERICA: new Set(NORTH_AMERICA),
  LATAM: new Set(LATAM),
  APAC: new Set(APAC),
  MENA: new Set(MENA),
};

/** Every region a country falls in. Used to prefill onboarding and to check employer base. */
export function regionsOfCountry(country: string): Region[] {
  const c = country.toUpperCase();
  return Region.options.filter((r) => REGION_COUNTRIES[r].has(c));
}

export function countryInRegion(country: string, region: Region): boolean {
  return REGION_COUNTRIES[region].has(country.toUpperCase());
}

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return displayNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
