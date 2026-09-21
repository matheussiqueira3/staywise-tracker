import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES, addDays, analyzeTrip, daysInWindow, inclusiveDays, maxSafeStay, statusFor } from "./rules";
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

test("analyzeTrip: 89/90 é permitido", () => {
  const asOf = "2026-09-18";
  const schengenTrip = trip("schengen1", "schengen", addDays(asOf, -88), asOf);
  const result = statusFor(schengen, [schengenTrip], asOf);
  assert.equal(result.used, 89);
  assert.equal(result.status, "warning");
});

test("analyzeTrip: 90/90 é permitido, limite atingido", () => {
  const asOf = "2026-09-18";
  const schengenTrip = trip("schengen1", "schengen", addDays(asOf, -89), asOf);
  const result = statusFor(schengen, [schengenTrip], asOf);
  assert.equal(result.used, 90);
  assert.equal(result.status, "warning"); // 90 >= warningAt (75) mas 90 <= limit (90)
});

test("analyzeTrip: 91/90 excedido", () => {
  const asOf = "2026-09-18";
  const schengenTrip = trip("schengen1", "schengen", addDays(asOf, -90), asOf);
  const result = statusFor(schengen, [schengenTrip], asOf);
  assert.equal(result.used, 91);
  assert.equal(result.status, "over");
});

test("analyzeTrip: primeiro dia acima do limite", () => {
  const asOf = "2026-09-18";
  const baseDate = addDays(asOf, -89);
  const analysis = analyzeTrip(schengen, [], "schengen", baseDate, addDays(baseDate, 90));
  assert.equal(analysis.firstOverDate, addDays(baseDate, 90));
  assert.equal(analysis.lastSafeDate, addDays(baseDate, 89));
});

test("analyzeTrip: excesso ocorrendo no meio da viagem", () => {
  const asOf = "2026-09-18";
  const baseDate = addDays(asOf, -89);
  const tripEnd = addDays(baseDate, 120); // viagem muito longa
  const analysis = analyzeTrip(schengen, [], "schengen", baseDate, tripEnd);
  assert.equal(analysis.safe, false);
  assert(analysis.firstOverDate);
  assert(analysis.lastSafeDate);
});

test("analyzeTrip: saída voltando a ficar abaixo não esconde excesso", () => {
  const asOf = "2026-09-18";
  // viagem de 95 dias que depois reduz para 85: primeira análise vê 95 dias (over), não muda
  const baseDate = addDays(asOf, -89);
  const analysis = analyzeTrip(schengen, [], "schengen", baseDate, addDays(baseDate, 90));
  assert.equal(analysis.safe, false);
  assert.equal(analysis.firstOverDate, addDays(baseDate, 90));
});

test("analyzeTrip: overlapping não duplica dias", () => {
  const asOf = "2026-09-18";
  const trip1 = trip("trip1", "schengen", addDays(asOf, -40), addDays(asOf, -20)); // 21 dias
  const trip2 = trip("trip2", "schengen", addDays(asOf, -30), asOf); // 31 dias, overlap -30 a -20 = 11 dias
  const window = daysInWindow([trip1, trip2], "schengen", addDays(asOf, -179), asOf);
  assert.equal(window, 41); // 21 + 31 - 11 = 41
});

test("analyzeTrip: dias antigos saem corretamente da rolling window", () => {
  const asOf = "2026-09-18";
  const windowStart = addDays(asOf, -179);
  const outside = trip("outside", "schengen", addDays(asOf, -180), addDays(asOf, -180));
  const inside = trip("inside", "schengen", addDays(asOf, -178), asOf);
  assert.equal(daysInWindow([outside], "schengen", windowStart, asOf), 0);
  assert.equal(daysInWindow([inside], "schengen", windowStart, asOf), 179);
});

test("maxSafeStay: encontra o último dia permitido", () => {
  const asOf = "2026-09-18";
  const baseDate = asOf;
  const existingTrip = trip("existing", "schengen", addDays(asOf, -45), addDays(asOf, -5)); // 41 dias usados há pouco
  const result = maxSafeStay(schengen, [existingTrip], "schengen", baseDate);

  assert(result.lastSafeDate);
  assert(result.daysAvailable > 0);
  assert.equal(result.start, baseDate);
});

test("maxSafeStay: sem disponibilidade", () => {
  const asOf = "2026-09-18";
  const existingTrip = trip("existing", "schengen", addDays(asOf, -89), asOf); // exato no limite 90 dias
  const result = maxSafeStay(schengen, [existingTrip], "schengen", addDays(asOf, 1));

  assert.equal(result.daysAvailable, 0);
  assert.equal(result.lastSafeDate, null);
});

test("maxSafeStay: entrada em um dia com 0 disponibilidade", () => {
  const asOf = "2026-09-18";
  const fullTrip = trip("full", "schengen", addDays(asOf, -89), asOf);
  const result = maxSafeStay(schengen, [fullTrip], "schengen", addDays(asOf, 1));

  assert.equal(result.daysAvailable, 0);
});

test("maxSafeStay: viagem de um único dia", () => {
  const asOf = "2026-09-18";
  const result = maxSafeStay(schengen, [], "schengen", asOf);

  assert(result.lastSafeDate);
  assert.equal(result.daysAvailable, 90);
  assert.equal(result.start, asOf);
});

test("maxSafeStay: datas invertidas", () => {
  const result = analyzeTrip(schengen, [], "schengen", "2026-09-20", "2026-09-10");
  assert.equal(result.safe, true);
  assert.equal(result.maxUsed, 0);
});
