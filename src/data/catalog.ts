import type { Rule } from "@/lib/types";

export const DEFAULT_RULES: Rule[] = [
  { id: "brazil", label: "Brasil", countryCode: "BR", region: "brazil", limit: 180, windowDays: 360, warningAt: 150 },
  { id: "schengen", label: "Schengen", countryCode: "SCHENGEN", region: "schengen", limit: 90, windowDays: 180, warningAt: 75 },
];

export function createCustomRule(input: Pick<Rule, "label" | "countryCode" | "limit" | "windowDays" | "warningAt">): Rule {
  const slug = input.countryCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
  return { ...input, id: "custom-" + slug + "-" + Date.now(), region: "other" };
}
