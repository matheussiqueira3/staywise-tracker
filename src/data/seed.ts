import importedTrips from "./imported-trips.json";
import { DEFAULT_RULES } from "@/lib/rules";
import type { TrackerState } from "@/lib/types";
export const seedState: TrackerState = { trips: importedTrips.map((trip) => ({ ...trip, region: trip.region as "brazil" })), rules: DEFAULT_RULES };
