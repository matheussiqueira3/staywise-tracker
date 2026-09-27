import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES } from "./rules";
import { chooseHydration, parseLocalMeta, parseStored, parseWriteRequest, resolveWrite } from "./sync";
import type { TrackerState } from "./types";

const stateA: TrackerState = { rules: DEFAULT_RULES, trips: [{ id: "a", region: "brazil", country: "Brazil", start: "2026-01-01", end: "2026-01-10" }] };
const stateB: TrackerState = { rules: DEFAULT_RULES, trips: [{ id: "b", region: "schengen", country: "Italy", start: "2026-02-01", end: "2026-02-10" }] };

test("parseStored: lê o formato com revisão e o formato antigo como revisão 0", () => {
  assert.equal(parseStored({ revision: 4, state: stateA })?.revision, 4);
  assert.equal(parseStored(stateA)?.revision, 0);
  assert.equal(parseStored(JSON.stringify({ revision: 2, state: stateB }))?.state.trips[0].id, "b");
  assert.equal(parseStored({ revision: -1, state: stateA }), null);
  assert.equal(parseStored({ revision: 1, state: { trips: "x" } }), null);
  assert.equal(parseStored("not json"), null);
  assert.equal(parseStored(null), null);
});

test("parseWriteRequest: exige estado válido e revisão base", () => {
  assert.equal(parseWriteRequest({ state: stateA, baseRevision: 3 })?.baseRevision, 3);
  assert.equal(parseWriteRequest(stateA), null); // clientes antigos enviavam só o estado, sem revisão
  assert.equal(parseWriteRequest({ state: stateA, baseRevision: 1.5 }), null);
});

test("resolveWrite: aceita escrita baseada na revisão atual e recusa escrita desatualizada", () => {
  const current = { revision: 5, state: stateA };
  const accepted = resolveWrite(current, { state: stateB, baseRevision: 5 });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.deepEqual(accepted.next, { revision: 6, state: stateB });
  const rejected = resolveWrite(current, { state: stateB, baseRevision: 4 });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.current.state, stateA);
  const empty = resolveWrite(null, { state: stateB, baseRevision: 0 });
  assert.equal(empty.ok && empty.next.revision, 1);
});

test("chooseHydration: edições locais só vencem quando o servidor não mudou", () => {
  const server = { revision: 7, state: stateA };
  assert.deepEqual(chooseHydration(server, stateB, { revision: 7, dirty: true }), { state: stateB, revision: 7, push: true, discardedLocal: null });
  const conflict = chooseHydration(server, stateB, { revision: 6, dirty: true });
  assert.equal(conflict.state, stateA);
  assert.equal(conflict.push, false);
  assert.equal(conflict.discardedLocal, stateB);
  assert.equal(chooseHydration(server, stateB, { revision: 7, dirty: false }).state, stateA);
  assert.equal(chooseHydration(server, stateB, null).state, stateA);
  assert.equal(chooseHydration(server, null, { revision: 7, dirty: true }).state, stateA);
});

test("parseLocalMeta: tolera valores ausentes ou corrompidos", () => {
  assert.equal(parseLocalMeta(null), null);
  assert.equal(parseLocalMeta("{"), null);
  assert.deepEqual(parseLocalMeta('{"revision":3,"dirty":true}'), { revision: 3, dirty: true });
  assert.deepEqual(parseLocalMeta('{"revision":"x"}'), { revision: null, dirty: false });
});
