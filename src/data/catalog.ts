import type { Rule } from "@/lib/types";

/** Brazil: 180 days in any 360, the owner's conservative day budget (stricter than the 183-days-in-12-months guideline). */
export const BRAZIL_RULE: Rule = { id: "brazil", label: "Brasil", countryCode: "BR", region: "brazil", limit: 180, windowDays: 360, warningAt: 150 };
/**
 * Italy, fiscal presence: resident from the 183rd day of presence in the calendar year (184th in leap years), fractions of
 * a day counting as whole days (art. 2 TUIR as amended by D.Lgs. 209/2023). "Exactly at the limit is allowed", so the
 * limit is the last day still allowed: 182, or 183 in leap years.
 */
export const ITALY_RULE: Rule = { id: "italy", label: "Itália", countryCode: "IT", region: "italy", kind: "calendar-year", limit: 182, leapYearLimit: 183, windowDays: 365, warningAt: 150 };
/** Schengen short-stay rule for non-EU passports: 90 days in any 180. Optional; not part of the default workspace. */
export const SCHENGEN_RULE: Rule = { id: "schengen", label: "Schengen", countryCode: "SCHENGEN", region: "schengen", limit: 90, windowDays: 180, warningAt: 75 };

/** Rules every workspace has. */
export const DEFAULT_RULES: Rule[] = [BRAZIL_RULE, ITALY_RULE];
/** Built-in rules: the defaults plus optional ones that can be added in Settings. Their limits are not editable. */
export const CATALOG_RULES: Rule[] = [...DEFAULT_RULES, SCHENGEN_RULE];

export function createCustomRule(input: Pick<Rule, "label" | "countryCode" | "limit" | "windowDays" | "warningAt">): Rule {
  const slug = input.countryCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
  return { ...input, id: "custom-" + slug + "-" + Date.now(), region: "other" };
}
