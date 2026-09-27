# Staywise — Product Definition

## Core Question

> “Given where I've been and where I want to go, how long can I stay under this country's rule, and when does the scenario exceed the limit?”

## Primary Flow

1. Choose a country or regime from the rule catalog
2. Choose entry date
3. Staywise automatically calculates:
   - Last safe day
   - Available days
   - First day over limit
4. User selects exit date
5. Save trip

## Design Principles

- **Mobile first.** No desktop-only UX.
- **No explicit planning mode.** Selection is immediate.
- **Calendar browsing is unbounded.** Navigate freely to any month; mathematical window remains bounded (180/360 days).
- **Business logic is separate.** `src/lib` contains all calculations; UI never re-derives stay status.
- **Exactly at limit is allowed.** Only `> limit` is over; `== limit` is OK.
- **Evaluate every day.** Not just entry + exit.

## What This App Does

- Track trips by date range and region.
- Show rolling availability (days remaining in window).
- Flag conflicts before saving.
- Persist to the current shared workspace, with an explicit last-write-wins warning.

## What This App Does NOT Do

- Provide legal or tax advice.
- Integrate with airlines, immigration, or tax systems.
- Suggest travel.
- Use AI.
- Provide personal accounts or confidential storage.
- Render a fixed calendar horizon.

## Data Model

```ts
type Trip = {
  id: string;
  ruleId: string;
  region: “brazil” | “schengen” | “other”;
  start: string;   // ISO date
  end: string;     // ISO date
  notes?: string;
};

type Rule = {
  id: string;
  label: string;
  countryCode: string;
  limit: number;
  windowDays: number;
  warningAt: number;
};

type Status = {
  used: number;
  available: number;
  warningDays: number;
};
```

## Success

The app answers “can I stay?” and “until when?” in one interaction after country and entry selection. Scenario planning is the primary flow; saved history exists to make future calculations accurate.
