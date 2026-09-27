import importedTrips from "./imported-trips.json";
import { DEFAULT_RULES } from "@/lib/rules";
import type { TrackerState, Trip } from "@/lib/types";
// Built-in region trips name their built-in rule (same id as the region); "other" trips stay rule-less.
export const seedState: TrackerState = { trips: importedTrips.map((trip) => ({ ...trip, ...(trip.region !== "other" ? { ruleId: trip.region } : {}), region: trip.region as Trip["region"] })), rules: DEFAULT_RULES };
