export type Region = "brazil" | "italy" | "schengen" | "other";
export type Trip = { id: string; ruleId?: string; region: Region; country: string; start: string; end: string; notes?: string };
/**
 * "rolling": at most `limit` days in any `windowDays` consecutive days (e.g. 90 in 180).
 * "calendar-year": at most `limit` days per calendar year (`leapYearLimit` in leap years), reset on 1 January;
 * `windowDays` is unused.
 */
export type RuleKind = "rolling" | "calendar-year";
export type Rule = { id: string; label: string; countryCode: string; region: Region; limit: number; windowDays: number; warningAt: number; kind?: RuleKind; leapYearLimit?: number };
/** `version` marks the data format; states without it are migrated by normalizeState. */
export type TrackerState = { version?: number; trips: Trip[]; rules: Rule[] };
export type RuleStatus = { rule: Rule; asOf: string; used: number; limit: number; remaining: number; windowStart: string; status: "ok" | "warning" | "over" };
