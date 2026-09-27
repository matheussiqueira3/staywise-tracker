import type { Region, Rule, RuleStatus, Trip } from "./types";
export { DEFAULT_RULES } from "@/data/catalog";
export function parseDate(value: string): Date { return new Date(value + "T12:00:00Z"); }
export function toDateKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function addDays(value: string, amount: number): string { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return toDateKey(date); }
export function inclusiveDays(start: string, end: string): number { return Math.max(0, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1); }
export function overlaps(trip: Trip, start: string, end: string): boolean { return trip.start <= end && trip.end >= start; }
export function daysInWindow(trips: Trip[], rule: Rule, start: string, end: string): number {
  const occupied = new Set<string>();
  for (const trip of trips) {
    const matchesRule = trip.ruleId ? trip.ruleId === rule.id : rule.region !== "other" && trip.region === rule.region;
    if (!matchesRule || trip.start > trip.end || !overlaps(trip, start, end)) continue;
    const clippedStart = trip.start > start ? trip.start : start;
    const clippedEnd = trip.end < end ? trip.end : end;
    for (let date = clippedStart; date <= clippedEnd; date = addDays(date, 1)) occupied.add(date);
  }
  return occupied.size;
}
export function statusFor(rule: Rule, trips: Trip[], asOf: string): RuleStatus {
  const limit = Math.max(1, Math.floor(rule.limit) || 1);
  const safeRule = { ...rule, limit, windowDays: Math.max(1, Math.floor(rule.windowDays) || 1), warningAt: Math.min(limit, Math.max(0, Math.floor(rule.warningAt) || 0)) };
  const windowStart = addDays(asOf, -(safeRule.windowDays - 1));
  const used = daysInWindow(trips, safeRule, windowStart, asOf);
  const remaining = Math.max(0, safeRule.limit - used);
  return { rule: safeRule, asOf, used, remaining, windowStart, status: used > safeRule.limit ? "over" : used > 0 && used >= safeRule.warningAt ? "warning" : "ok" };
}
export function statusForDate(rule: Rule, trips: Trip[], date: string): RuleStatus { return statusFor(rule, trips, date); }
export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat("pt-BR", options || { day: "2-digit", month: "short" }).format(parseDate(value)); }
export function formatFullDate(value: string): string { return formatDate(value, { day: "2-digit", month: "long", year: "numeric" }); }
export function isoToday(): string { return toDateKey(new Date()); }

export type TripAnalysis = {
  safe: boolean;
  firstWarningDate?: string;
  firstOverDate?: string;
  lastSafeDate?: string;
  maxUsed: number;
  maxUsedDate: string;
};

export type MaxSafeStay = {
  start: string;
  lastSafeDate: string | null;
  daysAvailable: number;
  firstOverDate?: string;
};

export function analyzeTrip(rule: Rule, trips: Trip[], region: Region, tripStart: string, tripEnd: string): TripAnalysis {
  if (tripStart > tripEnd) return { safe: true, maxUsed: 0, maxUsedDate: tripStart };

  let maxUsed = 0;
  let maxUsedDate = tripStart;
  let firstWarningDate: string | undefined;
  let firstOverDate: string | undefined;

  for (let currentEnd = tripStart; currentEnd <= tripEnd; currentEnd = addDays(currentEnd, 1)) {
    const testTrip: Trip = { id: "analysis", ruleId: rule.id, region, country: "", start: tripStart, end: currentEnd };
    const testTrips = [...trips, testTrip];
    const status = statusFor(rule, testTrips, currentEnd);

    if (status.used > maxUsed) {
      maxUsed = status.used;
      maxUsedDate = currentEnd;
    }

    if (status.status === "warning" && !firstWarningDate) {
      firstWarningDate = currentEnd;
    }

    if (status.status === "over" && !firstOverDate) {
      firstOverDate = currentEnd;
    }
  }

  const lastSafeDate = firstOverDate ? addDays(firstOverDate, -1) : undefined;

  return {
    safe: !firstOverDate,
    firstWarningDate,
    firstOverDate,
    lastSafeDate,
    maxUsed,
    maxUsedDate,
  };
}

export function maxSafeStay(rule: Rule, trips: Trip[], region: Region, entryDate: string): MaxSafeStay {
  const limit = Math.max(1, Math.floor(rule.limit) || 1);
  let lastSafeDate: string | null = null;
  let firstOverDate: string | undefined;

  const horizon = Math.max(rule.windowDays + rule.limit, rule.windowDays * 2, 366);
  for (let day = 0; day <= horizon; day++) {
    const currentDate = addDays(entryDate, day);
    const testTrip: Trip = { id: "maxstay", ruleId: rule.id, region, country: "", start: entryDate, end: currentDate };
    const testTrips = [...trips, testTrip];
    const status = statusFor(rule, testTrips, currentDate);

    if (status.used <= limit) {
      lastSafeDate = currentDate;
    } else if (!firstOverDate) {
      firstOverDate = currentDate;
      break;
    }
  }

  const daysAvailable = lastSafeDate ? inclusiveDays(entryDate, lastSafeDate) : 0;

  return {
    start: entryDate,
    lastSafeDate,
    daysAvailable,
    firstOverDate,
  };
}
