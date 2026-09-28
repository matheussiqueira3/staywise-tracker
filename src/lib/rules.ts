import type { Region, Rule, RuleStatus, Trip } from "./types";

export { CATALOG_RULES, DEFAULT_RULES } from "@/data/catalog";

/**
 * Whether a trip counts toward a rule. Trips name their rule by `ruleId`; legacy trips without one belong to the
 * built-in rule of their region. Trips in "other" without a ruleId belong to no rule (recorded only to block overlaps).
 */
export function tripMatchesRule(trip: Pick<Trip, "ruleId" | "region">, rule: Pick<Rule, "id" | "region">): boolean {
  return trip.ruleId ? trip.ruleId === rule.id : rule.region !== "other" && trip.region === rule.region;
}
/** The rule a trip counts toward, or undefined when it has none. */
export function ruleForTrip(rules: Rule[], trip: Pick<Trip, "ruleId" | "region">): Rule | undefined { return rules.find((rule) => tripMatchesRule(trip, rule)); }
export function parseDate(value: string): Date { return new Date(value + "T12:00:00Z"); }
export function toDateKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function addDays(value: string, amount: number): string { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return toDateKey(date); }
export function inclusiveDays(start: string, end: string): number { return Math.max(0, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1); }
export function overlaps(trip: Trip, start: string, end: string): boolean { return trip.start <= end && trip.end >= start; }
export function daysInWindow(trips: Trip[], rule: Pick<Rule, "id" | "region">, start: string, end: string): number {
  const occupied = new Set<string>();
  for (const trip of trips) {
    if (!tripMatchesRule(trip, rule) || trip.start > trip.end || !overlaps(trip, start, end)) continue;
    const clippedStart = trip.start > start ? trip.start : start;
    const clippedEnd = trip.end < end ? trip.end : end;
    for (let date = clippedStart; date <= clippedEnd; date = addDays(date, 1)) occupied.add(date);
  }
  return occupied.size;
}
/** Upper bound for a rule's window and limit (10 years), so absurd settings cannot freeze the UI. */
const MAX_RULE_DAYS = 3660;
function sanitizeRule(rule: Rule): Rule {
  const limit = Math.min(MAX_RULE_DAYS, Math.max(1, Math.floor(rule.limit) || 1));
  const safe: Rule = { ...rule, limit, windowDays: Math.min(MAX_RULE_DAYS, Math.max(1, Math.floor(rule.windowDays) || 1)), warningAt: Math.min(limit, Math.max(0, Math.floor(rule.warningAt) || 0)) };
  if (rule.leapYearLimit !== undefined) safe.leapYearLimit = Math.min(MAX_RULE_DAYS, Math.max(limit, Math.floor(rule.leapYearLimit) || limit));
  return safe;
}

// A rule counts days over a period that ends on the day being judged. Rolling rules look back `windowDays` days; calendar-year
// rules look back to 1 January. Everything else (every day evaluated, later-trip impact, last safe day) is shared.
export function isCalendarYear(rule: Pick<Rule, "kind">): boolean { return rule.kind === "calendar-year"; }
function isLeapYear(year: number): boolean { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }
/** Most days allowed in the period ending on `date` (exactly at the limit is allowed). */
export function limitOn(rule: Rule, date: string): number {
  return isCalendarYear(rule) && isLeapYear(Number(date.slice(0, 4))) ? rule.leapYearLimit ?? rule.limit : rule.limit;
}
/** First day of the counting period that ends on `date`. */
export function periodStart(rule: Rule, date: string): string { return isCalendarYear(rule) ? date.slice(0, 4) + "-01-01" : addDays(date, -(rule.windowDays - 1)); }
/** Last day whose count a day of presence on `date` changes. */
function reachEnd(rule: Rule, date: string): string { return isCalendarYear(rule) ? date.slice(0, 4) + "-12-31" : addDays(date, rule.windowDays - 1); }
/** Longest single stay worth asking about: a calendar-year stay can use the rest of one year and the next year's budget. */
export function maxStayLength(rule: Rule): number { return isCalendarYear(rule) ? 2 * (rule.leapYearLimit ?? rule.limit) : rule.limit; }
/** Short description of the rule, e.g. "90 dias a cada 180" or "182 dias por ano civil (183 em ano bissexto)". */
export function describeRule(rule: Rule): string {
  if (!isCalendarYear(rule)) return rule.limit + " dias a cada " + rule.windowDays;
  return rule.limit + " dias por ano civil" + (rule.leapYearLimit && rule.leapYearLimit !== rule.limit ? " (" + rule.leapYearLimit + " em ano bissexto)" : "");
}

/** "limite de 182 dias em 2026" or "limite de 90 dias": the limit that applies on `date`, named with its period. */
export function limitPhrase(rule: Rule, date: string): string { return "limite de " + limitOn(rule, date) + " dias" + (isCalendarYear(rule) ? " em " + date.slice(0, 4) : ""); }
/** "160 de 182 dias em 2026" or "80 de 90 dias na janela": days used in the period ending on `date`. */
export function usageLabel(rule: Rule, used: number, date: string): string { return used + " de " + limitOn(rule, date) + " dias " + (isCalendarYear(rule) ? "em " + date.slice(0, 4) : "na janela"); }

/** Exactly at the limit is allowed. A warning needs at least one used day, so warningAt 0 never warns on an empty history. */
function levelFor(rule: Rule, used: number, limit: number): RuleStatus["status"] { return used > limit ? "over" : used > 0 && used >= rule.warningAt ? "warning" : "ok"; }
export function statusFor(rule: Rule, trips: Trip[], asOf: string): RuleStatus {
  const safeRule = sanitizeRule(rule);
  const windowStart = periodStart(safeRule, asOf);
  const used = daysInWindow(trips, safeRule, windowStart, asOf);
  const limit = limitOn(safeRule, asOf);
  return { rule: safeRule, asOf, used, limit, remaining: Math.max(0, limit - used), windowStart, status: levelFor(safeRule, used, limit) };
}
/** The count on `date` if `stay` (a planned stay under this rule) were saved: the days in the period and where it starts. */
export function statusWithStay(rule: Rule, trips: Trip[], stay: { start: string; end: string } | null, date: string): RuleStatus {
  return statusFor(rule, stay ? trips.concat({ id: "planned-stay", ruleId: rule.id, region: rule.region, country: "", start: stay.start, end: stay.end }) : trips, date);
}
export type CountedRun = { start: string; end: string; days: number; leavesFrom: string; leavesUntil: string };
/**
 * Days counted on `date`, as runs of consecutive days, each with the dates its days stop counting: `windowDays` days after
 * each day for a rolling rule, 1 January for a calendar-year rule.
 */
export function countedRuns(rule: Rule, trips: Trip[], date: string): CountedRun[] {
  const safeRule = sanitizeRule(rule);
  const from = periodStart(safeRule, date);
  const days = new Set<string>();
  for (const trip of trips) {
    if (!tripMatchesRule(trip, safeRule) || trip.start > trip.end || !overlaps(trip, from, date)) continue;
    for (let day = trip.start > from ? trip.start : from; day <= trip.end && day <= date; day = addDays(day, 1)) days.add(day);
  }
  const leaves = (day: string) => isCalendarYear(safeRule) ? (Number(date.slice(0, 4)) + 1) + "-01-01" : addDays(day, safeRule.windowDays);
  const runs: CountedRun[] = [];
  for (const day of [...days].sort()) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.end, 1) === day) { last.end = day; last.days++; last.leavesUntil = leaves(day); }
    else runs.push({ start: day, end: day, days: 1, leavesFrom: leaves(day), leavesUntil: leaves(day) });
  }
  return runs;
}
export type YearBudget = { year: number; used: number; limit: number; remaining: number; over: boolean };
/** Days of a calendar-year rule in `year`, counting every saved trip (past and planned). */
export function yearBudget(rule: Rule, trips: Trip[], year: number): YearBudget {
  const safeRule = sanitizeRule(rule);
  const start = year + "-01-01";
  const used = daysInWindow(trips, safeRule, start, year + "-12-31");
  const limit = limitOn(safeRule, start);
  return { year, used, limit, remaining: Math.max(0, limit - used), over: used > limit };
}
export function statusForDate(rule: Rule, trips: Trip[], date: string): RuleStatus { return statusFor(rule, trips, date); }
const formatters = new Map<string, Intl.DateTimeFormat>();
/** Formats a date key in pt-BR. Always in UTC: keys are parsed at 12:00Z, so a local zone at UTC+12..+14 would show the next day. */
export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  const resolved: Intl.DateTimeFormatOptions = { ...(options || { day: "2-digit", month: "short" }), timeZone: "UTC" };
  const key = JSON.stringify(resolved);
  let formatter = formatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat("pt-BR", resolved); formatters.set(key, formatter); }
  return formatter.format(parseDate(value));
}
export function formatFullDate(value: string): string { return formatDate(value, { day: "2-digit", month: "long", year: "numeric" }); }
/** Local calendar date of `now` (not UTC: late evening in São Paulo is still "today"). */
export function isoToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The limit rule for a region, or undefined when the region has no rule (e.g. "other"). */
export function ruleForRegion(rules: Rule[], region: Region): Rule | undefined { return rules.find((rule) => rule.region === region); }

/** Built-in rules (Brasil, Itália, Schengen) carry limits from the catalog; only their alert threshold is a preference. */
export function isBuiltInRule(rule: Pick<Rule, "region">): boolean { return rule.region !== "other"; }
export type RuleNumbers = Pick<Rule, "limit" | "windowDays" | "warningAt">;
export type RuleNumbersInput = { limit: string; windowDays: string; warningAt: string };
/**
 * Validates rule numbers typed by the user. Rejects instead of clamping, so a half-typed value never becomes a limit.
 * An empty alert means 0 (never warn before the limit).
 */
export function parseRuleNumbers(input: RuleNumbersInput): { ok: true; value: RuleNumbers } | { ok: false; error: string } {
  const read = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  const limit = read(input.limit);
  const windowDays = read(input.windowDays);
  const warningAt = input.warningAt.trim() === "" ? 0 : read(input.warningAt);
  if (!(limit >= 1 && limit <= MAX_RULE_DAYS)) return { ok: false, error: "O limite precisa ser um número inteiro entre 1 e " + MAX_RULE_DAYS + "." };
  if (!(windowDays >= limit && windowDays <= MAX_RULE_DAYS)) return { ok: false, error: "A janela precisa ser um número inteiro maior ou igual ao limite." };
  if (!(warningAt >= 0 && warningAt <= limit)) return { ok: false, error: "O alerta precisa ser um número inteiro entre 0 e o limite." };
  return { ok: true, value: { limit, windowDays, warningAt } };
}

export type TripAnalysis = {
  safe: boolean;
  firstWarningDate?: string;
  firstOverDate?: string;
  lastSafeDate?: string;
  maxUsed: number;
  maxUsedDate: string;
};

export type AffectedTrip = { trip: Trip; firstOverDate: string; excessDays: number };

export type TripSimulation = TripAnalysis & {
  /** Days above the limit at the worst day of the candidate trip itself. */
  excessDays: number;
  /** Saved trips that are within the limit today but would go over if the candidate were saved. */
  affectedTrips: AffectedTrip[];
  /** Saved trips that already exceed the limit on their own and would exceed by more; excessDays = added days. */
  worsenedTrips: AffectedTrip[];
};

export type MaxSafeStay = {
  start: string;
  lastSafeDate: string | null;
  daysAvailable: number;
  firstOverDate?: string;
  /** "limit": staying one more day exceeds the rule. "later-trip": it would push a saved later trip over. */
  limitedBy?: "limit" | "later-trip";
  blockingTrip?: AffectedTrip;
  /** First day of this stay at or above the rule's warningAt (still within the limit), if any. */
  firstWarningDate?: string;
};

/** Verdict for one saved trip, evaluated on every day of it against all saved trips. */
export type TripStatus = { tripId: string; status: "ok" | "warning" | "over" | "none"; maxUsed: number; excessDays: number; firstOverDate?: string; firstWarningDate?: string };

type Candidate = Pick<Trip, "region" | "start" | "end"> & { id?: string; ruleId?: string };

/** Whether a proposed stay counts toward the rule: by ruleId when given, else by region (custom rules have region "other"). */
function candidateCounts(candidate: Pick<Candidate, "ruleId" | "region">, rule: Rule): boolean {
  return candidate.ruleId ? candidate.ruleId === rule.id : candidate.region === rule.region;
}

// Day-by-day occupancy for one rule over [from, from + size). Rolling sums over it make every
// calculation linear in the number of days instead of re-scanning all trips for each day.
type Span = { trip: Trip; first: number; last: number };
type Ledger = { from: string; size: number; occupied: Uint8Array; spans: Span[] };

function createLedger(trips: Trip[], rule: Rule, from: string, to: string): Ledger {
  const size = inclusiveDays(from, to);
  const occupied = new Uint8Array(size);
  const spans: Span[] = [];
  for (const trip of trips) {
    if (!tripMatchesRule(trip, rule) || trip.start > trip.end || !overlaps(trip, from, to)) continue;
    const first = trip.start > from ? inclusiveDays(from, trip.start) - 1 : 0;
    const last = trip.end < to ? inclusiveDays(from, trip.end) - 1 : size - 1;
    occupied.fill(1, first, last + 1);
    spans.push({ trip, first, last });
  }
  return { from, size, occupied, spans: spans.sort((a, b) => a.first - b.first) };
}

/** Days counted in the period ending on each ledger day. */
function usedSeries(ledger: Ledger, rule: Rule): Int32Array {
  if (!isCalendarYear(rule)) return rollingUsed(ledger.occupied, rule.windowDays);
  const used = new Int32Array(ledger.size);
  let nextReset = inclusiveDays(ledger.from, (Number(ledger.from.slice(0, 4)) + 1) + "-01-01") - 1;
  let sum = 0;
  for (let index = 0; index < ledger.size; index++) {
    if (index === nextReset) { sum = 0; nextReset += isLeapYear(Number(addDays(ledger.from, index).slice(0, 4))) ? 366 : 365; }
    sum += ledger.occupied[index];
    used[index] = sum;
  }
  return used;
}
/** Limit on each ledger day. */
function limitSeries(ledger: Ledger, rule: Rule): Int32Array {
  const limits = new Int32Array(ledger.size).fill(rule.limit);
  if (!isCalendarYear(rule)) return limits;
  for (let year = Number(ledger.from.slice(0, 4)), last = Number(addDays(ledger.from, ledger.size - 1).slice(0, 4)); year <= last; year++) {
    const first = Math.max(0, inclusiveDays(ledger.from, year + "-01-01") - 1);
    const end = Math.min(ledger.size, inclusiveDays(ledger.from, year + "-12-31"));
    limits.fill(limitOn(rule, year + "-01-01"), first, end);
  }
  return limits;
}
/** Ledger index of the last day that a day of presence on ledger day `index` changes. */
function reachIndex(ledger: Ledger, rule: Rule, index: number): number { return isCalendarYear(rule) ? inclusiveDays(ledger.from, reachEnd(rule, addDays(ledger.from, index))) - 1 : index + rule.windowDays - 1; }

function rollingUsed(occupied: Uint8Array, windowDays: number): Int32Array {
  const used = new Int32Array(occupied.length);
  let sum = 0;
  for (let index = 0; index < occupied.length; index++) {
    sum += occupied[index];
    if (index >= windowDays) sum -= occupied[index - windowDays];
    used[index] = sum;
  }
  return used;
}

type LaterImpact = { kind: "affected" | "worsened"; item: AffectedTrip };

/**
 * Ledger range that also covers the whole extent (plus its window) of every trip of the rule with a day in
 * (reachFrom, reachTo], so "already over" can be judged on the entire saved trip, not only on the days in reach.
 */
function extendedRange(trips: Trip[], rule: Rule, from: string, to: string, reachFrom: string, reachTo: string): { from: string; to: string } {
  for (const trip of trips) {
    if (!tripMatchesRule(trip, rule) || trip.start > trip.end || trip.end <= reachFrom || trip.start > reachTo) continue;
    const tripFrom = periodStart(rule, trip.start);
    if (tripFrom < from) from = tripFrom;
    if (trip.end > to) to = trip.end;
  }
  return { from, to };
}

/**
 * Effect of the candidate on a saved trip whose days in (reachLo - 1, reachHi] the candidate's window reaches
 * (`used` with the candidate, `baseUsed` without). A day is impacted when it is over the limit and the candidate
 * adds to it. The trip is "worsened" when it is already over on any of its days without the candidate
 * (excessDays = most days the candidate adds above the limit on one day), otherwise "affected"
 * (excessDays = worst excess with the candidate). The ledger must cover the whole span unclipped.
 */
function laterImpact(ledger: Ledger, span: Span, reachLo: number, reachHi: number, used: Int32Array, baseUsed: Int32Array, limits: Int32Array): LaterImpact | undefined {
  const lo = Math.max(span.first, reachLo);
  const hi = Math.min(span.last, reachHi);
  let first = -1;
  let affectedExcess = 0;
  let addedExcess = 0;
  for (let index = lo; index <= hi; index++) {
    const withCandidate = used[index];
    const limit = limits[index];
    if (withCandidate <= limit || withCandidate <= baseUsed[index]) continue;
    if (first < 0) first = index;
    affectedExcess = Math.max(affectedExcess, withCandidate - limit);
    addedExcess = Math.max(addedExcess, withCandidate - Math.max(baseUsed[index], limit));
  }
  if (first < 0) return undefined;
  let alreadyOver = false;
  for (let index = span.first; index <= span.last && !alreadyOver; index++) alreadyOver = baseUsed[index] > limits[index];
  const firstOverDate = addDays(ledger.from, first);
  return alreadyOver
    ? { kind: "worsened", item: { trip: span.trip, firstOverDate, excessDays: addedExcess } }
    : { kind: "affected", item: { trip: span.trip, firstOverDate, excessDays: affectedExcess } };
}

function simulate(rule: Rule, trips: Trip[], candidate: Candidate, withAffected: boolean): TripSimulation {
  const safeRule = sanitizeRule(rule);
  const { start, end } = candidate;
  if (start > end) return { safe: true, maxUsed: 0, maxUsedDate: start, excessDays: 0, affectedTrips: [], worsenedTrips: [] };
  const others = candidate.id ? trips.filter((trip) => trip.id !== candidate.id) : trips;
  const reach = reachEnd(safeRule, end);
  const { from, to } = withAffected
    ? extendedRange(others, safeRule, periodStart(safeRule, start), reach, end, reach)
    : { from: periodStart(safeRule, start), to: end };
  const base = createLedger(others, safeRule, from, to);
  const counts = candidateCounts(candidate, safeRule);
  const withCandidate = base.occupied.slice();
  const startIndex = inclusiveDays(from, start) - 1;
  const endIndex = inclusiveDays(from, end) - 1;
  if (counts) withCandidate.fill(1, startIndex, endIndex + 1);
  const used = usedSeries({ ...base, occupied: withCandidate }, safeRule);
  const limits = limitSeries(base, safeRule);

  let maxUsed = 0;
  let maxUsedDate = start;
  let excessDays = 0;
  let firstWarningDate: string | undefined;
  let firstOverDate: string | undefined;
  for (let index = startIndex; index <= endIndex; index++) {
    const level = levelFor(safeRule, used[index], limits[index]);
    if (used[index] > maxUsed) { maxUsed = used[index]; maxUsedDate = addDays(from, index); }
    excessDays = Math.max(excessDays, used[index] - limits[index]);
    if (level === "warning" && !firstWarningDate) firstWarningDate = addDays(from, index);
    if (level === "over" && !firstOverDate) firstOverDate = addDays(from, index);
  }

  const affectedTrips: AffectedTrip[] = [];
  const worsenedTrips: AffectedTrip[] = [];
  if (withAffected && counts) {
    const baseUsed = usedSeries(base, safeRule);
    const reachLast = reachIndex(base, safeRule, endIndex);
    for (const span of base.spans) {
      if (span.last <= endIndex || span.first > reachLast) continue;
      const impact = laterImpact(base, span, endIndex + 1, reachLast, used, baseUsed, limits);
      if (impact) (impact.kind === "affected" ? affectedTrips : worsenedTrips).push(impact.item);
    }
  }

  return {
    safe: !firstOverDate && affectedTrips.length === 0 && worsenedTrips.length === 0,
    firstWarningDate,
    firstOverDate,
    lastSafeDate: firstOverDate ? addDays(firstOverDate, -1) : undefined,
    maxUsed,
    maxUsedDate,
    excessDays,
    affectedTrips,
    worsenedTrips,
  };
}

/** Evaluates every day of a proposed trip against the rule. Does not look past the trip's exit. */
export function analyzeTrip(rule: Rule, trips: Trip[], region: Region, tripStart: string, tripEnd: string): TripAnalysis {
  const { safe, firstWarningDate, firstOverDate, lastSafeDate, maxUsed, maxUsedDate } = simulate(rule, trips, { region, start: tripStart, end: tripEnd }, false);
  return { safe, firstWarningDate, firstOverDate, lastSafeDate, maxUsed, maxUsedDate };
}

/**
 * Evaluates every day of a proposed trip and every day of saved later trips whose window it reaches.
 * `candidate.id` excludes the trip being edited from the saved trips.
 */
export function simulateTrip(rule: Rule, trips: Trip[], candidate: Candidate): TripSimulation {
  return simulate(rule, trips, candidate, true);
}

const MIN_STAY_SEARCH_DAYS = 366;

/**
 * Last exit date for a stay starting on `entryDate` that keeps this stay within the limit and neither pushes a
 * saved later trip over nor adds excess to one already over. Consistent with `simulateTrip(...).safe`.
 * The stay counts toward the rule when `region === rule.region` (pass `rule.region` for a custom rule).
 */
export function maxSafeStay(rule: Rule, trips: Trip[], region: Region, entryDate: string): MaxSafeStay {
  const safeRule = sanitizeRule(rule);
  // When the window is longer than the limit, a continuous stay goes over by day limit + 1, so search that far.
  // Otherwise the stay can never exceed the limit on its own and one year is enough.
  const searchDays = safeRule.windowDays > safeRule.limit ? Math.max(MIN_STAY_SEARCH_DAYS, safeRule.limit) : MIN_STAY_SEARCH_DAYS;
  const searchEnd = addDays(entryDate, searchDays);
  const reach = reachEnd(safeRule, searchEnd);
  const { from, to } = extendedRange(trips, safeRule, periodStart(safeRule, entryDate), reach, entryDate, reach);
  const ledger = createLedger(trips, safeRule, from, to);
  const baseUsed = usedSeries(ledger, safeRule);
  const limits = limitSeries(ledger, safeRule);
  const used = baseUsed.slice();
  const entryIndex = inclusiveDays(from, entryDate) - 1;
  const counts = region === safeRule.region;
  let lastSafeDate: string | null = null;
  let firstWarningDate: string | undefined;

  for (let day = 0; day <= searchDays; day++) {
    const index = entryIndex + day;
    const date = addDays(entryDate, day);
    // Adding this day only changes days [index, reach], exactly the saved days simulateTrip checks for an exit on `date`.
    // A saved day there is impacted when it goes over the limit, since the candidate just added to it. Days not changed
    // now were checked at an earlier exit, so this finds the first exit simulateTrip calls unsafe.
    const reachLast = reachIndex(ledger, safeRule, index);
    let impactedDay = -1;
    if (counts && !ledger.occupied[index]) {
      const stop = Math.min(ledger.size, reachLast + 1);
      for (let affected = index; affected < stop; affected++) {
        used[affected]++;
        if (impactedDay < 0 && affected > index && ledger.occupied[affected] && used[affected] > limits[affected]) impactedDay = affected;
      }
    }
    if (used[index] > limits[index]) return result("limit", date);
    if (impactedDay >= 0) {
      const span = ledger.spans.find((item) => item.first <= impactedDay && item.last >= impactedDay);
      const impact = span && laterImpact(ledger, span, index + 1, reachLast, used, baseUsed, limits);
      if (impact) return result("later-trip", date, impact.item);
    }
    lastSafeDate = date;
    if (!firstWarningDate && levelFor(safeRule, used[index], limits[index]) === "warning") firstWarningDate = date;
  }
  return result();

  function result(limitedBy?: MaxSafeStay["limitedBy"], firstOverDate?: string, blockingTrip?: AffectedTrip): MaxSafeStay {
    return { start: entryDate, lastSafeDate, daysAvailable: lastSafeDate ? inclusiveDays(entryDate, lastSafeDate) : 0, firstOverDate, limitedBy, blockingTrip, firstWarningDate };
  }
}

export type TripConflicts = { otherRegion: Trip[]; sameRegion: Trip[] };

/** Identity of the place a trip is in: its rule when it names one, else its region. */
function placeKey(trip: Pick<Trip, "ruleId" | "region">): string { return trip.ruleId ?? trip.region; }

/** A travel day: one trip ends on the day the other starts. That day counts for both places (fractions of a day count). */
function sharesOnlyTravelDay(a: Pick<Trip, "start" | "end">, b: Pick<Trip, "start" | "end">): boolean {
  return (a.end === b.start && a.start < a.end && b.start < b.end) || (b.end === a.start && b.start < b.end && a.start < a.end);
}
/**
 * Saved trips overlapping the candidate's dates. Being in two places on the same day is a conflict, except the travel day
 * between two stays: `otherRegion` holds trips under a different rule (or region, for trips without a rule), `sameRegion`
 * those under the same one.
 */
export function findConflicts(trips: Trip[], candidate: Candidate): TripConflicts {
  const key = placeKey(candidate);
  const overlapping = trips.filter((trip) => trip.id !== candidate.id && overlaps(trip, candidate.start, candidate.end));
  return { otherRegion: overlapping.filter((trip) => placeKey(trip) !== key && !sharesOnlyTravelDay(trip, candidate)), sameRegion: overlapping.filter((trip) => placeKey(trip) === key) };
}

/**
 * First entry date on or after `from` where a genuinely new stay of `lengthDays` is safe and overlaps no saved trip of
 * any rule or region (days already booked under the same rule add no new days, but they are not a new stay), or null.
 */
export function earliestEntryFor(rule: Rule, trips: Trip[], lengthDays: number, from: string, horizonDays = 730): { start: string; end: string } | null {
  const safeRule = sanitizeRule(rule);
  const length = Math.floor(lengthDays);
  if (!(length >= 1) || length > maxStayLength(safeRule)) return null;
  for (let day = 0; day <= horizonDays; day++) {
    const start = addDays(from, day);
    const candidate = { region: safeRule.region, ruleId: safeRule.id, start, end: addDays(start, length - 1) };
    if (trips.some((trip) => overlaps(trip, candidate.start, candidate.end))) continue;
    if (simulate(safeRule, trips, candidate, true).safe) return { start: candidate.start, end: candidate.end };
  }
  return null;
}

/** The trip covering `today`, if any. */
export function currentTrip(trips: Trip[], today: string): Trip | undefined {
  return trips.filter((trip) => trip.start <= today && trip.end >= today).sort((a, b) => b.start.localeCompare(a.start))[0];
}

/** Trips that start after `today`, earliest first. */
export function upcomingTrips(trips: Trip[], today: string): Trip[] {
  return trips.filter((trip) => trip.start > today).sort((a, b) => a.start.localeCompare(b.start));
}

/** Status of every saved trip keyed by trip id, each day evaluated against all saved trips; "none" for trips without a rule. */
export function tripStatuses(rules: Rule[], trips: Trip[]): Map<string, TripStatus> {
  const statuses = new Map<string, TripStatus>();
  for (const trip of trips) {
    const rule = ruleForTrip(rules, trip);
    if (!rule || trip.start > trip.end) { statuses.set(trip.id, { tripId: trip.id, status: "none", maxUsed: 0, excessDays: 0 }); continue; }
    const safeRule = sanitizeRule(rule);
    const { maxUsed, excessDays, firstOverDate, firstWarningDate } = simulate(safeRule, trips, { id: trip.id, ruleId: rule.id, region: trip.region, start: trip.start, end: trip.end }, false);
    const status = firstOverDate ? "over" : firstWarningDate ? "warning" : "ok";
    statuses.set(trip.id, { tripId: trip.id, status, maxUsed, excessDays, firstOverDate, firstWarningDate });
  }
  return statuses;
}

/** One destination of a planned itinerary: where (a rule, or none for a country without a limit) and for how many days. */
export type ItineraryLeg = { ruleId?: string; country: string; days: number };
export type LegStatus = "safe" | "warning" | "over" | "affects" | "conflict" | "none";
export type LegPlan = {
  rule?: Rule;
  country: string;
  start: string;
  end: string;
  days: number;
  /** Longest stay possible from this leg's start, given saved trips and the legs before it (null without a rule). */
  maxDays: number | null;
  lastSafeDate: string | null;
  simulation: TripSimulation | null;
  conflict?: Trip;
  status: LegStatus;
};

/** Trip fields for a leg under `rule` (region "other" and no ruleId for a country without a limit). */
function legTrip(rule: Rule | undefined, id: string, country: string, start: string, end: string): Trip {
  return { id, ...(rule ? { ruleId: rule.id } : {}), region: rule ? rule.region : "other", country, start, end };
}

/**
 * Lays out an itinerary starting on `start`: each leg begins on the day the previous one ends (the travel day counts for
 * both places) and lasts `days` days. Each leg is judged like the next stop of a real trip: against saved trips (later ones
 * protected) and the legs before it, so a problem shows on the leg that causes it. Its longest possible stay uses the same
 * inputs. Conflicts are checked against saved trips and every other leg.
 */
export function planItinerary(rules: Rule[], trips: Trip[], start: string, legs: ItineraryLeg[]): LegPlan[] {
  const laidOut: { rule?: Rule; country: string; start: string; end: string; days: number }[] = [];
  let legStart = start;
  for (const leg of legs) {
    const days = Math.max(1, Math.floor(leg.days) || 1);
    const rule = leg.ruleId ? rules.find((item) => item.id === leg.ruleId) : undefined;
    const end = addDays(legStart, days - 1);
    laidOut.push({ rule, country: leg.country, start: legStart, end, days });
    legStart = end;
  }
  const asTrips = laidOut.map((leg, index) => legTrip(leg.rule, "leg-" + index, leg.country, leg.start, leg.end));
  return laidOut.map((leg, index) => {
    const others = trips.concat(asTrips.filter((_, other) => other !== index));
    const conflict = findConflicts(others, asTrips[index]).otherRegion[0];
    if (!leg.rule) return { ...leg, maxDays: null, lastSafeDate: null, simulation: null, conflict, status: conflict ? "conflict" : "none" };
    const forecast = maxSafeStay(leg.rule, trips.concat(asTrips.slice(0, index)), leg.rule.region, leg.start);
    const simulation = simulateTrip(leg.rule, trips.concat(asTrips.slice(0, index)), { ruleId: leg.rule.id, region: leg.rule.region, start: leg.start, end: leg.end });
    const status: LegStatus = conflict ? "conflict" : simulation.firstOverDate ? "over" : !simulation.safe ? "affects" : simulation.firstWarningDate ? "warning" : "safe";
    return { ...leg, maxDays: forecast.daysAvailable, lastSafeDate: forecast.lastSafeDate, simulation, conflict, status };
  });
}

/** The saved trips an itinerary becomes. */
export function itineraryTrips(plan: LegPlan[], idPrefix: string): Trip[] {
  return plan.map((leg, index) => legTrip(leg.rule, idPrefix + "-" + index, leg.country.trim() || leg.rule?.label || "Outro", leg.start, leg.end));
}
