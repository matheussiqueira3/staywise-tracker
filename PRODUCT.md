# Staywise — Product Definition

## Core Question

> “Given where I've been and where I want to go, how long can I stay under this country's rule, and when does the scenario exceed the limit?”

## Primary Flow

1. Choose a country or regime from the rule catalog (Itália, Brasil, a custom rule, or optional Schengen)
2. Choose entry date
3. Staywise automatically calculates:
   - Last safe day
   - Available days
   - First day over limit (including saved later trips the stay would push over)
4. User selects exit date
5. Save trip

## Design Principles

- **Mobile first.** No desktop-only UX.
- **No explicit planning mode.** Selection is immediate.
- **Calendar browsing is unbounded.** Navigate freely to any month; the counting period remains bounded by each rule (Itália: the calendar year, reset on 1 January; Brasil 360 days; Schengen 180 days).
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

- **Itália** — resident from the 183rd day of presence in the calendar year (184th in leap years), fractions of a day counting as whole days (art. 2 TUIR, D.Lgs. 209/2023). The rule allows 182 days (183 in leap years).
- **Brasil** — 180 days in any 360, a conservative day budget chosen by the owner (the legal test for a Brazilian national is intent and the Declaração de Saída Definitiva, not a day count).
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
  limit: number;          // most days allowed: Itália 182, Brasil 180, Schengen 90
  leapYearLimit?: number; // calendar-year rules: most days allowed in a leap year (Itália 183)
  windowDays: number;     // rolling window: Brasil 360, Schengen 180 days (unused by calendar-year rules)
  warningAt: number;
};

type TrackerState = { version?: number; trips: Trip[]; rules: Rule[] };
```

## Success

The app answers “can I stay?” and “until when?” in one interaction after country and entry selection. Scenario planning is the primary flow; saved history exists to make future calculations accurate.
