export type Region = "brazil" | "schengen" | "other";
export type Trip = { id: string; ruleId?: string; region: Region; country: string; start: string; end: string; notes?: string };
export type Rule = { id: string; label: string; countryCode: string; region: Region; limit: number; windowDays: number; warningAt: number };
export type TrackerState = { trips: Trip[]; rules: Rule[] };
export type RuleStatus = { rule: Rule; asOf: string; used: number; remaining: number; windowStart: string; status: "ok" | "warning" | "over" };
