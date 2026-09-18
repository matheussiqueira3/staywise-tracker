import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES, addDays, daysInWindow, inclusiveDays, statusFor } from "./rules";
import type { Trip } from "./types";

const brazil = DEFAULT_RULES[0];
const schengen = DEFAULT_RULES[1];

function trip(id: string, region: Trip["region"], start: string, end: string): Trip {
  return { id, region, country: region === "brazil" ? "Brazil" : "Italy", start, end };
}

test("conta entrada e saída como dias de permanência", () => {
  assert.equal(inclusiveDays("2026-09-10", "2026-09-10"), 1);
  assert.equal(inclusiveDays("2026-09-10", "2026-09-12"), 3);
});

test("Brasil usa exatamente os 360 dias terminando na data de referência", () => {
  const asOf = "2026-09-18";
  const inside = trip("inside", "brazil", addDays(asOf, -359), asOf);
  const outside = trip("outside", "brazil", addDays(asOf, -360), addDays(asOf, -360));

  assert.equal(statusFor(brazil, [inside], asOf).used, 360);
  assert.equal(statusFor(brazil, [outside], asOf).used, 0);
});

test("Schengen respeita 90 em 180 dias e não soma sobreposições", () => {
  const asOf = "2026-09-18";
  const first = trip("first", "schengen", addDays(asOf, -89), asOf);
  const overlapping = trip("overlap", "schengen", addDays(asOf, -20), addDays(asOf, 10));
  const outside = trip("outside", "schengen", addDays(asOf, -180), addDays(asOf, -180));

  assert.equal(daysInWindow([first, overlapping], "schengen", addDays(asOf, -179), asOf), 90);
  assert.equal(statusFor(schengen, [first, outside], asOf).used, 90);
  assert.equal(statusFor(schengen, [first], asOf).status, "warning");
  assert.equal(statusFor(schengen, [trip("over", "schengen", addDays(asOf, -90), asOf)], asOf).status, "over");
});

test("simulação futura calcula a janela na saída da viagem", () => {
  const asOf = "2026-09-18";
  const futureEnd = "2027-01-10";
  const planned = trip("planned", "brazil", "2027-01-01", futureEnd);
  const result = statusFor(brazil, [planned], futureEnd);

  assert.equal(result.asOf, futureEnd);
  assert.equal(result.windowStart, addDays(futureEnd, -359));
  assert.equal(result.used, 10);
  assert.equal(result.remaining, 170);
  assert.equal(asOf < futureEnd, true);
});

test("alerta nunca pode ficar acima do limite configurado", () => {
  const result = statusFor({ ...brazil, limit: 100, warningAt: 150 }, [], "2026-09-18");
  assert.equal(result.rule.warningAt, 100);
  assert.equal(result.status, "ok");
});
