# Staywise Agent Rules

Read `PRODUCT.md` first. These rules are permanent across all development phases.

## Mandatory Checks

Every commit must pass:

```bash
npm test
npm run lint
npm run build
```

## Core Rules

- **Mobile first.** No desktop-only UX.
- **Do not introduce explicit planning mode.** User interaction is entry → instant forecast → optional exit.
- **Calendar browsing has no fixed horizon.** Navigation is unbounded (infinite scroll or month picker).
- **The rolling-rule window remains mathematically bounded.** Calculation window is 180/360 days; display is not.
- **Business logic belongs in `src/lib`.** UI must never reproduce stay calculations.
- **UI must never reproduce stay calculations.** Call `src/lib/rules.ts` functions; do not embed logic.
- **Exactly at limit is allowed.** Only `> limit` is over; `== limit` is OK.
- **Evaluate every day of a proposed trip.** Not just entry and exit.
- **Do not add dependencies unless unavoidable.**
- **Do not refactor unrelated code.** Fix only what the current phase requires.
- **Read only files needed for the current task.** Do not inspect the whole repository.

## Scope Discipline

For each phase:

```
Objective: [one sentence]
Files: [exactly which files to touch]
Acceptance: [test + lint + build must pass]
Forbidden: [what not to do]
```

Do not:
- Rename unrelated files
- Update dependencies speculatively
- Rewrite working components
- Add design systems
- Introduce new abstractions

## Code Organization

```
src/
  app/
    layout.tsx
    page.tsx                 (home)
  components/
    calendar-planner.tsx     (UI for planning)
  lib/
    types.ts                 (Trip, Rule, Status, etc)
    rules.ts                 (statusFor, maxSafeStay, analyzeTrip)
    rules.test.ts            (all calculations)
    share.ts                 (import/export)
  data/
    seed.ts
  api/
    state/route.ts           (persistence)
```

## Testing Strategy

- Unit tests in `src/lib/rules.test.ts`.
- Acceptance scenarios (Fase 13).
- No mocked date/time; use explicit dates.
- Every rule change requires a test case.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
