import { DEFAULT_RULES, parseDate, toDateKey } from "./rules";
import type { Region, Rule, TrackerState, Trip } from "./types";
const LEGACY_OTHER_RULE: Rule = { id: "legacy-other", label: "Outro (revisar)", countryCode: "OTHER", region: "other", limit: 1, windowDays: 1, warningAt: 1 };
function encode(value: string): string { return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode(value: string): string { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); return decodeURIComponent(escape(atob(padded))); }
export function encodeState(state: TrackerState): string { return encode(JSON.stringify(state)); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return Number.isFinite(date.getTime()) && toDateKey(date) === value;
}
function validRegion(value: unknown): value is Region { return value === "brazil" || value === "schengen" || value === "other"; }
function normalizeTrip(value: unknown, index: number, rules: Rule[]): Trip | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Trip>;
  if (!validRegion(item.region) || !validDate(item.start) || !validDate(item.end) || item.start > item.end) return null;
  const legacyCountry = typeof item.country === "string" ? item.country.trim().toLowerCase() : "";
  const legacyRule = item.region === "other" && legacyCountry ? rules.find((rule) => rule.region === "other" && rule.label.trim().toLowerCase() === legacyCountry) : undefined;
  const ruleId = typeof item.ruleId === "string" && rules.some((rule) => rule.id === item.ruleId) ? item.ruleId : legacyRule?.id || (item.region === "other" ? LEGACY_OTHER_RULE.id : item.region);
  if (!rules.some((rule) => rule.id === ruleId)) return null;
  return { id: typeof item.id === "string" && item.id ? item.id : "imported-" + index, ruleId, region: item.region, country: typeof item.country === "string" && item.country.trim() ? item.country.trim() : item.region === "brazil" ? "Brazil" : item.region === "schengen" ? "Italy" : "Other", start: item.start, end: item.end, notes: typeof item.notes === "string" ? item.notes.slice(0, 500) : undefined };
}
function normalizeRule(value: unknown, fallback: Rule): Rule {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Partial<Rule>;
  const limit = typeof item.limit === "number" && Number.isFinite(item.limit) ? Math.max(1, Math.floor(item.limit)) : fallback.limit;
  const windowDays = typeof item.windowDays === "number" && Number.isFinite(item.windowDays) ? Math.max(1, Math.floor(item.windowDays)) : fallback.windowDays;
  const warningAt = typeof item.warningAt === "number" && Number.isFinite(item.warningAt) ? Math.min(limit, Math.max(0, Math.floor(item.warningAt))) : fallback.warningAt;
  return { ...fallback, label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 80) : fallback.label, countryCode: typeof item.countryCode === "string" && item.countryCode.trim() ? item.countryCode.trim().slice(0, 20).toUpperCase() : fallback.countryCode, limit, windowDays, warningAt };
}
export function normalizeState(value: unknown): TrackerState | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as { trips?: unknown; rules?: unknown };
  if (!Array.isArray(parsed.trips) || !Array.isArray(parsed.rules)) return null;
  const rules = parsed.rules.map((rule) => {
    if (!rule || typeof rule !== "object") return null;
    const item = rule as Partial<Rule>;
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.label !== "string" || item.region !== "brazil" && item.region !== "schengen" && item.region !== "other") return null;
    const legacyCountryCode = item.id === "brazil" ? "BR" : item.id === "schengen" ? "SCHENGEN" : item.id.toUpperCase();
    return normalizeRule(item, { id: item.id, label: item.label, countryCode: typeof item.countryCode === "string" ? item.countryCode : legacyCountryCode, region: item.region, limit: Number(item.limit), windowDays: Number(item.windowDays), warningAt: Number(item.warningAt) });
  });
  if (rules.some((rule) => !rule) || new Set(rules.filter((rule): rule is Rule => Boolean(rule)).map((rule) => rule.id)).size !== rules.length) return null;
  const validRules = rules.filter((rule): rule is Rule => Boolean(rule));
  for (const fallback of DEFAULT_RULES) if (!validRules.some((rule) => rule.id === fallback.id)) validRules.push(fallback);
  if (parsed.trips.some((trip) => trip && typeof trip === "object" && (trip as Partial<Trip>).region === "other" && !(trip as Partial<Trip>).ruleId) && !validRules.some((rule) => rule.id === LEGACY_OTHER_RULE.id)) validRules.push(LEGACY_OTHER_RULE);
  const trips = parsed.trips.map((trip, index) => normalizeTrip(trip, index, validRules));
  if (trips.some((trip) => !trip)) return null;
  return { trips: trips.filter((trip): trip is Trip => Boolean(trip)), rules: validRules };
}
export function decodeState(value: string): TrackerState | null {
  try {
    if (value.length > 700_000) return null;
    return normalizeState(JSON.parse(decode(value)));
  } catch { return null; }
}
