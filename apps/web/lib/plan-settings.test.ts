import { describe, expect, it } from "vitest";
import { cvCounts, formatNaira, nairaToKobo, priceNaira } from "./plan-settings";

describe("prices", () => {
  it("reads naira, with or without commas", () => {
    expect(priceNaira("monthly", { PRICE_MONTHLY_NAIRA: "5000" })).toBe(5000);
    expect(priceNaira("once30", { PRICE_PASS_NAIRA: "4,500" })).toBe(4500);
    expect(priceNaira("topup", { PRICE_TOP_UP_NAIRA: " 1,500 " })).toBe(1500);
  });

  it("hides a plan whose price is missing or nonsense", () => {
    for (const value of [undefined, "", "free", "0", "-100"]) {
      expect(priceNaira("monthly", { PRICE_MONTHLY_NAIRA: value })).toBeNull();
    }
  });

  it("gives Paystack kobo", () => {
    expect(nairaToKobo(5000)).toBe(500000);
    expect(nairaToKobo(1499.99)).toBe(149999);
  });

  it("shows naira", () => {
    expect(formatNaira(5000)).toBe("₦5,000");
  });
});

describe("CV counts", () => {
  it("uses the defaults when nothing is set", () => {
    expect(cvCounts({})).toEqual({ plan: 30, topUp: 10, free: 3 });
  });

  it("can all be changed", () => {
    expect(cvCounts({ CVS_PER_PLAN: "40", CVS_PER_TOP_UP: "15", FREE_CVS: "5" })).toEqual({ plan: 40, topUp: 15, free: 5 });
  });

  it("allows no free CVs, and ignores nonsense", () => {
    expect(cvCounts({ FREE_CVS: "0" }).free).toBe(0);
    expect(cvCounts({ CVS_PER_PLAN: "many", CVS_PER_TOP_UP: "-1", FREE_CVS: "2.5" })).toEqual({ plan: 30, topUp: 10, free: 3 });
  });
});
