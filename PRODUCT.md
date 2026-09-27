# Staywise — Product Definition

## Core Question

> “Given where I've been and where I want to go, how long can I stay under this country's rule, and when does the scenario exceed the limit?”

## Primary Flow

1. Choose a country or regime from the rule catalog (Brasil, Schengen, or a custom rule)
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
- **Calendar browsing is unbounded.** Navigate freely to any month; mathematical window remains bounded by each rule (Brasil 360, Schengen 180 days).
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

## Data Model

```ts
type Trip = {
  id: string;
  ruleId?: string;   // rule it counts toward; absent for "Outro (sem regra)" trips
  region: "brazil" | "schengen" | "other";
  country: string;
  start: string;     // ISO date
  end: string;       // ISO date
  notes?: string;
};

type Rule = {
  id: string;
  label: string;
  countryCode: string;
  region: "brazil" | "schengen" | "other";   // custom rules use "other"
  limit: number;       // Brasil 180, Schengen 90 days
  windowDays: number;  // rolling window: Brasil 360, Schengen 180 days
  warningAt: number;
};
```

## Success

The app answers “can I stay?” and “until when?” in one interaction after country and entry selection. Scenario planning is the primary flow; saved history exists to make future calculations accurate.
