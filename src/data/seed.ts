import importedTrips from "./imported-trips.json";
import { normalizeState } from "@/lib/share";
import type { TrackerState } from "@/lib/types";
// The imported history goes through the same migration as stored data: built-in regions gain their rule ids and the
// spreadsheet's non-Brazil days, recorded as Italy, become Italy trips.
export const seedState: TrackerState = normalizeState({ trips: importedTrips, rules: [] })!;
