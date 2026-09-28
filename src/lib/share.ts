import { CATALOG_RULES, DEFAULT_RULES, parseDate, toDateKey } from "./rules";
import type { Region, Rule, TrackerState, Trip } from "./types";
/** Size cap for a decoded share link and, via the route, for a synced state. */
export const MAX_STATE_CHARS = 700_000;
const MAX_RULE_ID_CHARS = 100;
/**
 * Data format written by this version. Version 2 moved to per-country tax days: stays in Italy recorded under the old
 * "schengen" region become Italy trips, and the Schengen rule leaves the workspace unless some trip still uses it.
 */
export const STATE_VERSION = 2;
const ITALY_NAMES = new Set(["italy", "italia", "itália"]);
function encode(value: string): string { return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode(value: string): string { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); return decodeURIComponent(escape(atob(padded))); }
export function encodeState(state: TrackerState): string { return encode(JSON.stringify(state)); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return Number.isFinite(date.getTime()) && toDateKey(date) === value;
}
function validRegion(value: unknown): value is Region { return value === "brazil" || value === "italy" || value === "schengen" || value === "other"; }
/** Version 1 → 2: a Schengen stay whose country is Italy is an Italy stay. */
function migrateTrip(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = value as Partial<Trip>;
  if (item.region !== "schengen" || typeof item.country !== "string" || !ITALY_NAMES.has(item.country.trim().toLowerCase())) return value;
  if (item.ruleId !== undefined && item.ruleId !== null && item.ruleId !== "" && item.ruleId !== "schengen") return value;
  return { ...item, region: "italy", ruleId: "italy" };
}
function normalizeTrip(value: unknown, index: number, rules: Rule[]): Trip | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Trip>;
  if (!validRegion(item.region) || !validDate(item.start) || !validDate(item.end) || item.start > item.end) return null;
  // A trip naming a rule must name an existing one, and takes that rule's region. Legacy trips without a ruleId in a
  // built-in region are moved onto that built-in rule; "other" trips without a ruleId stay rule-less (counted by no rule).
  let ruleId: string | undefined;
  let region: Region = item.region;
  if (item.ruleId !== undefined && item.ruleId !== null && item.ruleId !== "") {
    const rule = typeof item.ruleId === "string" ? rules.find((candidate) => candidate.id === item.ruleId) : undefined;
    if (!rule) return null;
    ruleId = rule.id;
    region = rule.region;
  } else if (item.region !== "other") {
    const rule = rules.find((candidate) => candidate.id === item.region);
    if (!rule) return null;
    ruleId = rule.id;
  }
  return { id: typeof item.id === "string" && item.id ? item.id : "imported-" + index, ...(ruleId ? { ruleId } : {}), region, country: typeof item.country === "string" && item.country.trim() ? item.country.trim() : item.region === "brazil" ? "Brazil" : item.region === "italy" || item.region === "schengen" ? "Italy" : "Other", start: item.start, end: item.end, notes: typeof item.notes === "string" ? item.notes.slice(0, 500) : undefined };
}
/** A catalog rule keeps the catalog's numbers (only its label and alert are the user's); a custom rule keeps its own. */
function normalizeRule(value: unknown, fallback: Rule, catalog = false): Rule {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Partial<Rule>;
  const limit = !catalog && typeof item.limit === "number" && Number.isFinite(item.limit) ? Math.max(1, Math.floor(item.limit)) : fallback.limit;
  const windowDays = !catalog && typeof item.windowDays === "number" && Number.isFinite(item.windowDays) ? Math.max(1, Math.floor(item.windowDays)) : fallback.windowDays;
  const storedWarning = typeof item.warningAt === "number" && Number.isFinite(item.warningAt) ? Math.max(0, Math.floor(item.warningAt)) : fallback.warningAt;
  // An alert above the limit (e.g. kept from an older, larger catalog limit) falls back to the catalog's alert.
  const warningAt = storedWarning <= limit ? storedWarning : catalog ? fallback.warningAt : limit;
  return { ...fallback, label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 80) : fallback.label, countryCode: typeof item.countryCode === "string" && item.countryCode.trim() ? item.countryCode.trim().slice(0, 20).toUpperCase() : fallback.countryCode, limit, windowDays, warningAt };
}
export function normalizeState(value: unknown): TrackerState | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as { version?: unknown; trips?: unknown; rules?: unknown };
  if (!Array.isArray(parsed.trips) || !Array.isArray(parsed.rules)) return null;
  const migrating = typeof parsed.version !== "number" || parsed.version < STATE_VERSION;
  const rawTrips = migrating ? parsed.trips.map(migrateTrip) : parsed.trips;
  const rules = parsed.rules.map((rule) => {
    if (!rule || typeof rule !== "object") return null;
    const item = rule as Partial<Rule>;
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > MAX_RULE_ID_CHARS || typeof item.label !== "string" || !validRegion(item.region)) return null;
    // Built-in rules keep their region; every other rule is a custom one, which lives in "other".
    const builtIn = CATALOG_RULES.find((rule) => rule.id === item.id);
    if (builtIn) return normalizeRule(item, { ...builtIn, label: item.label }, true);
    // A custom rule has no defaults to fall back on: its numbers must be present.
    if (![item.limit, item.windowDays, item.warningAt].every((field) => typeof field === "number" && Number.isFinite(field))) return null;
    return normalizeRule(item, { id: item.id, label: item.label, countryCode: typeof item.countryCode === "string" ? item.countryCode : item.id.toUpperCase(), region: "other", limit: 1, windowDays: 1, warningAt: 0 });
  });
  if (rules.some((rule) => !rule) || new Set(rules.filter((rule): rule is Rule => Boolean(rule)).map((rule) => rule.id)).size !== rules.length) return null;
  let validRules = rules.filter((rule): rule is Rule => Boolean(rule));
  for (const fallback of DEFAULT_RULES) if (!validRules.some((rule) => rule.id === fallback.id)) validRules.push(fallback);
  // A legacy trip in a built-in region brings that region's catalog rule along (e.g. Schengen, no longer a default).
  for (const trip of rawTrips) {
    const region = trip && typeof trip === "object" ? (trip as Partial<Trip>).region : undefined;
    const catalog = region && region !== "other" ? CATALOG_RULES.find((rule) => rule.region === region) : undefined;
    if (catalog && !validRules.some((rule) => rule.id === catalog.id)) validRules.push(catalog);
  }
  const trips = rawTrips.map((trip, index) => normalizeTrip(trip, index, validRules));
  if (trips.some((trip) => !trip)) return null;
  const validTrips = trips.filter((trip): trip is Trip => Boolean(trip));
  // After the move to Italy, a Schengen rule no trip uses is the old default, not a choice: drop it.
  if (migrating) validRules = validRules.filter((rule) => rule.id !== "schengen" || validTrips.some((trip) => trip.ruleId === "schengen"));
  return { version: STATE_VERSION, trips: validTrips, rules: validRules };
}
export function decodeState(value: string): TrackerState | null {
  try {
    if (value.length > MAX_STATE_CHARS) return null;
    return normalizeState(JSON.parse(decode(value)));
  } catch { return null; }
}
