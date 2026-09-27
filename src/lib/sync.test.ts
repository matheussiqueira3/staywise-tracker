import assert from "node:assert/strict";
import test from "node:test";
import { seedState } from "@/data/seed";
import { DEFAULT_RULES } from "./rules";
import { MAX_WRITE_BYTES, chooseHydration, parseLocalMeta, parseStored, parseWriteBody, parseWriteRequest, readStored, resolveWrite } from "./sync";
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

test("readStored: valor ausente é vazio; valor que não passa na validação é inválido, nunca vazio", () => {
  assert.deepEqual(readStored(null), { kind: "empty" });
  assert.deepEqual(readStored(undefined), { kind: "empty" });
  assert.equal(readStored({ revision: 2, state: stateA }).kind, "ok");
  assert.equal(readStored({ revision: 2, state: { trips: [], rules: [{ id: "x" }] } }).kind, "invalid");
  assert.equal(readStored("{corrompido").kind, "invalid");
  assert.equal(readStored({ revision: 2, state: { ...stateA, trips: [{ ...stateA.trips[0], ruleId: "missing" }] } }).kind, "invalid");
});

test("parseStored/parseWriteRequest: estado com regra customizada e viagem 'Outro' sem regra faz o ciclo completo", () => {
  const custom = { id: "custom-th-1", label: "Tailândia", countryCode: "TH", region: "other" as const, limit: 60, windowDays: 180, warningAt: 45 };
  const state: TrackerState = {
    rules: [...DEFAULT_RULES, custom],
    trips: [
      { id: "t", ruleId: custom.id, region: "other", country: "Tailândia", start: "2026-03-01", end: "2026-03-10" },
      { id: "o", region: "other", country: "Peru", start: "2026-04-01", end: "2026-04-10" },
    ],
  };
  const stored = parseStored(JSON.stringify({ revision: 3, state }));
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), { revision: 3, state });
  const write = parseWriteBody(null, JSON.stringify({ state, baseRevision: 3 }));
  assert.equal(write.ok, true);
  if (write.ok) assert.deepEqual(JSON.parse(JSON.stringify(write.write.state)), state);
});

test("parseWriteBody: 413 acima do limite, 400 para JSON ou estado inválido", () => {
  const body = JSON.stringify({ state: stateA, baseRevision: 1 });
  assert.equal(parseWriteBody(String(body.length), body).ok, true);
  assert.deepEqual(parseWriteBody(String(MAX_WRITE_BYTES + 1), body), { ok: false, status: 413 });
  const huge = JSON.stringify({ state: { ...stateA, trips: [{ ...stateA.trips[0], notes: "x".repeat(MAX_WRITE_BYTES) }] }, baseRevision: 1 });
  assert.deepEqual(parseWriteBody(null, huge), { ok: false, status: 413 }); // content-length absent or wrong: the body itself is measured
  assert.deepEqual(parseWriteBody("10", huge), { ok: false, status: 413 });
  const multibyte = JSON.stringify({ state: { ...stateA, trips: [{ ...stateA.trips[0], notes: "ç".repeat(MAX_WRITE_BYTES / 2) }] }, baseRevision: 1 });
  assert.deepEqual(parseWriteBody(null, multibyte), { ok: false, status: 413 }); // counted in UTF-8 bytes, not characters
  assert.deepEqual(parseWriteBody(null, "{"), { ok: false, status: 400 });
  assert.deepEqual(parseWriteBody(null, JSON.stringify(stateA)), { ok: false, status: 400 });
});

test("seed passa pela validação sem mudanças", () => {
  const stored = parseStored({ revision: 1, state: seedState });
  assert(stored);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.state)), JSON.parse(JSON.stringify(seedState)));
});
