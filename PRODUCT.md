# Staywise — Product Definition

## Core Question

> “Given where I've been and where I want to go, how long can I stay in each region, and when do conflicts occur?”

## Primary Flow

1. Choose region (Brazil / Schengen)
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
- Persist to personal workspace (no shared state).

## What This App Does NOT Do

- Provide legal or tax advice.
- Integrate with airlines, immigration, or tax systems.
- Suggest travel.
- Use AI.
- Support multiple users.
- Render a fixed calendar horizon.

## Data Model

```ts
type Trip = {
  id: string;
  region: “BR” | “SCHENGEN”;
  start: string;   // ISO date
  end: string;     // ISO date
  notes?: string;
};

type Rule = {
  region: “BR” | “SCHENGEN”;
  limit: number;           // Brazil 180, Schengen 90 days
  windowDays: number;      // rolling window: Brazil 360, Schengen 180 days
};

type Status = {
  used: number;
  available: number;
  warningDays: number;
};
```

## Success

The app answers “can I stay?” and “until when?” in one interaction after entry selection.
