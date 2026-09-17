import type { Region, Rule, RuleStatus, Trip } from "./types";

export const DEFAULT_RULES: Rule[] = [
  { id: "brazil", label: "Brasil", region: "brazil", limit: 180, windowDays: 360, warningAt: 150 },
  { id: "schengen", label: "Schengen", region: "schengen", limit: 90, windowDays: 180, warningAt: 75 },
];
export function parseDate(value: string): Date { return new Date(value + "T12:00:00Z"); }
export function toDateKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function addDays(value: string, amount: number): string { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return toDateKey(date); }
export function inclusiveDays(start: string, end: string): number { return Math.max(0, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1); }
export function overlaps(trip: Trip, start: string, end: string): boolean { return trip.start <= end && trip.end >= start; }
export function daysInWindow(trips: Trip[], region: Region, start: string, end: string): number {
  return trips.reduce((total, trip) => {
    if (trip.region !== region || !overlaps(trip, start, end)) return total;
    const clippedStart = trip.start > start ? trip.start : start;
    const clippedEnd = trip.end < end ? trip.end : end;
    return total + inclusiveDays(clippedStart, clippedEnd);
  }, 0);
}
export function statusFor(rule: Rule, trips: Trip[], asOf: string): RuleStatus {
  const windowStart = addDays(asOf, -(rule.windowDays - 1));
  const used = daysInWindow(trips, rule.region, windowStart, asOf);
  const remaining = Math.max(0, rule.limit - used);
  return { rule, asOf, used, remaining, windowStart, status: used > rule.limit ? "over" : used >= rule.warningAt ? "warning" : "ok" };
}
export function statusForDate(rule: Rule, trips: Trip[], date: string): RuleStatus { return statusFor(rule, trips, date); }
export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat("pt-BR", options || { day: "2-digit", month: "short" }).format(parseDate(value)); }
export function formatFullDate(value: string): string { return formatDate(value, { day: "2-digit", month: "long", year: "numeric" }); }
export function isoToday(): string { return toDateKey(new Date()); }
