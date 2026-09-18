import { DEFAULT_RULES, parseDate, toDateKey } from "./rules";
import type { Region, Rule, TrackerState, Trip } from "./types";
function encode(value: string): string { return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode(value: string): string { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); return decodeURIComponent(escape(atob(padded))); }
export function encodeState(state: TrackerState): string { return encode(JSON.stringify(state)); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return Number.isFinite(date.getTime()) && toDateKey(date) === value;
}
function validRegion(value: unknown): value is Region { return value === "brazil" || value === "schengen" || value === "other"; }
function normalizeTrip(value: unknown, index: number): Trip | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Trip>;
  if (!validRegion(item.region) || !validDate(item.start) || !validDate(item.end) || item.start > item.end) return null;
  return { id: typeof item.id === "string" && item.id ? item.id : "imported-" + index, region: item.region, country: typeof item.country === "string" && item.country.trim() ? item.country.trim() : item.region === "brazil" ? "Brazil" : item.region === "schengen" ? "Italy" : "Other", start: item.start, end: item.end, notes: typeof item.notes === "string" ? item.notes : undefined };
}
function normalizeRule(value: unknown, fallback: Rule): Rule {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Partial<Rule>;
  const limit = typeof item.limit === "number" && Number.isFinite(item.limit) ? Math.max(1, Math.floor(item.limit)) : fallback.limit;
  const windowDays = typeof item.windowDays === "number" && Number.isFinite(item.windowDays) ? Math.max(1, Math.floor(item.windowDays)) : fallback.windowDays;
  const warningAt = typeof item.warningAt === "number" && Number.isFinite(item.warningAt) ? Math.min(limit, Math.max(0, Math.floor(item.warningAt))) : fallback.warningAt;
  return { ...fallback, label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : fallback.label, limit, windowDays, warningAt };
}
export function decodeState(value: string): TrackerState | null {
  try {
    const parsed = JSON.parse(decode(value)) as { trips?: unknown; rules?: unknown };
    if (!Array.isArray(parsed.trips) || !Array.isArray(parsed.rules)) return null;
    const ruleById = new Map(parsed.rules.filter((rule): rule is { id: string } => Boolean(rule && typeof rule === "object" && "id" in rule && typeof rule.id === "string")).map((rule) => [rule.id, rule]));
    const rules = DEFAULT_RULES.map((fallback) => normalizeRule(ruleById.get(fallback.id), fallback));
    const trips = parsed.trips.map((trip, index) => normalizeTrip(trip, index)).filter((trip): trip is Trip => Boolean(trip));
    return { trips, rules };
  } catch { return null; }
}
