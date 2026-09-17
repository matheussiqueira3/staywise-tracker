export type Region = "brazil" | "schengen" | "other";
export type Trip = { id: string; region: Region; country: string; start: string; end: string; notes?: string };
export type Rule = { id: "brazil" | "schengen"; label: string; region: Region; limit: number; windowDays: number; warningAt: number };
export type TrackerState = { trips: Trip[]; rules: Rule[] };
export type RuleStatus = { rule: Rule; asOf: string; used: number; remaining: number; windowStart: string; status: "ok" | "warning" | "over" };
