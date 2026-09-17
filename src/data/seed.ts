import importedTrips from "./imported-trips.json";
import { DEFAULT_RULES } from "@/lib/rules";
import type { TrackerState, Trip } from "@/lib/types";
export const seedState: TrackerState = { trips: importedTrips.map((trip) => ({ ...trip, region: trip.region as Trip["region"] })), rules: DEFAULT_RULES };
