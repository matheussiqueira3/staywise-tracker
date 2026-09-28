# Staywise — Product Definition

## Core Question

> “Given where I've been and where I want to go, how long can I stay under this country's rule, and when does the scenario exceed the limit?”

## Primary Flow

1. "Planejar viagem" (first on the calendar tab): "how long can I stay in each place?"
2. Build the itinerary as an ordered list of destinations (Itália, Brasil, or another country). Each starts on the day the previous one ends (the travel day counts for both) and opens at the longest stay possible there, counting saved trips and the earlier destinations in each rolling window.
3. Adjust the days (−/+, number, slider, "Usar máximo"); each destination shows at once whether it fits, why not, and its maximum.
4. Save: one trip per destination, undone together.
5. The calendar scrolls to the new trips and shows them.

The single-trip flow (country → tap entry day → last safe day → tap exit → save) stays on the calendar for quick checks.

## Design Principles

- **Mobile first.** No desktop-only UX.
- **No explicit planning mode.** Selection is immediate.
- **Calendar browsing is unbounded.** Navigate freely to any month; the counting period remains bounded by each rule (Itália 180 days; Brasil 360 days; Schengen 180 days).
- **Future first.** The main job is a calculator for the days ahead. Past trips are inputs that make future answers correct, not a dashboard.
- **Travel days count for both places.** Entry and exit days count; one trip may end on the day the next one (in another country) starts, and that day counts for both.
- **Business logic is separate.** `src/lib` contains all calculations; UI never re-derives stay status.
- **Exactly at limit is allowed.** Only `> limit` is over; `== limit` is OK.
- **Evaluate every day.** Not just entry + exit.

## What This App Does

- Track trips by date range and rule (country or regime).
- Show rolling availability (days remaining in window).
- Flag conflicts before saving, including saved later trips a new plan would push over.
- Persist to one public workspace for a single person (Andrew). There is no login; anyone with the app's address can view and edit it. Saves carry a revision and stale saves are refused, so one device cannot silently overwrite newer data.

## What This App Does NOT Do

- Provide legal or tax advice.
- Integrate with airlines, immigration, or tax systems.
- Suggest travel.
- Use AI.
- Provide personal accounts, access codes, or confidential storage.
- Render a fixed calendar horizon.

## The user and the rules

The workspace belongs to Andrew, a Brazilian and Italian citizen who is tax resident in the Bahamas. Visa limits do not apply to him; the question is **tax presence**:

- **Itália** — 90 days in any rolling 180, the owner's day budget (decided 2026-09-28).
- **Brasil** — 180 days in any rolling 360, the owner's day budget.
- The engine also supports calendar-year rules (e.g. Italy's statutory 183 days per calendar year); none is in the catalog today.
- The counting must be visible, on the calendar: every day of a stay shows its count (days in that country inside the window ending that day), amber near the limit and red above it; "Ver a conta de um dia" underlines the whole window behind a tapped day and gives its total; the itinerary planner draws the plan the same way before saving.
- **Schengen** (90 in 180) stays in the catalog for other passports, off by default.

Stored data carries a format `version`. Version 2 moved stays in Italy recorded under the old "schengen" region to the Italy rule.

## Data Model

```ts
type Trip = {
  id: string;
  ruleId?: string;   // rule it counts toward; absent for "Outro (sem regra)" trips
  region: "brazil" | "italy" | "schengen" | "other";
  country: string;
  start: string;     // ISO date
  end: string;       // ISO date
  notes?: string;
};

type Rule = {
  id: string;
  label: string;
  countryCode: string;
  region: "brazil" | "italy" | "schengen" | "other";   // custom rules use "other"
  kind?: "rolling" | "calendar-year";   // default "rolling"
  limit: number;          // most days allowed: Itália 90, Brasil 180, Schengen 90
  leapYearLimit?: number; // calendar-year rules: most days allowed in a leap year
  windowDays: number;     // rolling window: Itália 180, Brasil 360, Schengen 180 days (unused by calendar-year rules)
  warningAt: number;
};

type TrackerState = { version?: number; trips: Trip[]; rules: Rule[] };
```

## Success

The app answers “can I stay?” and “until when?” in one interaction after country and entry selection. Scenario planning is the primary flow; saved history exists to make future calculations accurate.
