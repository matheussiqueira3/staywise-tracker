import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES, addDays, analyzeTrip, daysInWindow, inclusiveDays, maxSafeStay, statusFor } from "./rules";
import { normalizeState } from "./share";
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

  assert.equal(daysInWindow([first, overlapping], schengen, addDays(asOf, -179), asOf), 90);
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
  const window = daysInWindow([trip1, trip2], schengen, addDays(asOf, -179), asOf);
  assert.equal(window, 41); // 21 + 31 - 11 = 41
});

test("analyzeTrip: dias antigos saem corretamente da rolling window", () => {
  const asOf = "2026-09-18";
  const windowStart = addDays(asOf, -179);
  const outside = trip("outside", "schengen", addDays(asOf, -180), addDays(asOf, -180));
  const inside = trip("inside", "schengen", addDays(asOf, -178), asOf);
  assert.equal(daysInWindow([outside], schengen, windowStart, asOf), 0);
  assert.equal(daysInWindow([inside], schengen, windowStart, asOf), 179);
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

test("regra com warning zero não alerta um histórico vazio", () => {
  assert.equal(statusFor({ ...schengen, warningAt: 0 }, [], "2026-09-18").status, "ok");
});

test("regra customizada não soma viagens de outra regra", () => {
  const custom = { ...schengen, id: "custom-thailand", label: "Tailândia", countryCode: "TH", region: "other" as const };
  const schengenTrip = trip("schengen", "schengen", "2026-09-01", "2026-09-18");
  const customTrip: Trip = { ...schengenTrip, id: "custom", ruleId: custom.id, region: "other", country: "Thailand" };
  assert.equal(statusFor(custom, [schengenTrip, customTrip], "2026-09-18").used, 18);
});

test("maxSafeStay suporta janela maior que 366 dias", () => {
  const longRule = { ...brazil, id: "long", windowDays: 800, limit: 700 };
  const result = maxSafeStay(longRule, [], "other", "2026-09-18");
  assert.equal(result.daysAvailable, 700);
});

test("estado preserva regras customizadas e rejeita viagens sem regra", () => {
  const custom = { id: "custom-th", label: "Tailândia", countryCode: "TH", region: "other" as const, limit: 60, windowDays: 180, warningAt: 45 };
  const valid = normalizeState({ rules: [...DEFAULT_RULES, custom], trips: [{ id: "t", ruleId: custom.id, region: "other", country: "Tailândia", start: "2026-09-01", end: "2026-09-02" }] });
  assert.equal(valid?.rules.some((rule) => rule.id === custom.id), true);
  assert.equal(valid?.trips[0]?.ruleId, custom.id);
  assert.equal(normalizeState({ rules: DEFAULT_RULES, trips: [{ id: "bad", ruleId: "missing", region: "other", country: "X", start: "2026-09-01", end: "2026-09-02" }] }), null);
});

// Acceptance test scenarios
test("acceptance: 75/90 usados, entrada amanhã", () => {
  const asOf = "2026-09-18";
  const existing = trip("existing", "schengen", addDays(asOf, -74), asOf); // 75 dias
  const status = statusFor(schengen, [existing], asOf);
  assert.equal(status.used, 75);
  assert.equal(status.remaining, 15);
  const nextEntry = addDays(asOf, 1);
  const forecast = maxSafeStay(schengen, [existing], "schengen", nextEntry);
  assert.equal(forecast.daysAvailable, 15);
});

test("acceptance: seleciona 16º dia, marca como over", () => {
  const asOf = "2026-09-18";
  const baseDate = addDays(asOf, -89);
  const existing = trip("existing", "schengen", baseDate, asOf); // 90 dias, no limit
  const analysis = analyzeTrip(schengen, [existing], "schengen", baseDate, addDays(baseDate, 90));
  assert(analysis.firstOverDate);
  assert.equal(analysis.lastSafeDate, addDays(baseDate, 89));
});

test("acceptance: período antigo sai da janela durante viagem", () => {
  const asOf = "2026-09-18";
  const future = addDays(asOf, 90);
  const oldTrip = trip("old", "schengen", addDays(future, -200), addDays(future, -190)); // antes da janela de 180
  const status1 = statusFor(schengen, [oldTrip], future);
  assert.equal(status1.used, 0);
});

test("acceptance: navegar para 2031", () => {
  const futureMont = "2031-01-15";
  const days = inclusiveDays(futureMont, futureMont);
  assert.equal(days, 1);
});

test("acceptance: navegar para 2023", () => {
  const pastMonth = "2023-06-15";
  const days = inclusiveDays(pastMonth, pastMonth);
  assert.equal(days, 1);
});

test("acceptance: overlap geográfico bloqueado", () => {
  const brazil1 = trip("br1", "brazil", "2026-09-10", "2026-09-20");
  const schengen1 = trip("sch1", "schengen", "2026-09-15", "2026-09-25");
  assert(brazil1.start <= schengen1.end && brazil1.end >= schengen1.start);
});

test("migra regras legadas sem código de país", () => {
  const state = normalizeState({
    trips: [{ id: "legacy", region: "brazil", country: "Brazil", start: "2026-01-01", end: "2026-01-02" }],
    rules: [
      { id: "brazil", label: "Brasil", region: "brazil", limit: 180, windowDays: 360, warningAt: 150 },
      { id: "schengen", label: "Schengen", region: "schengen", limit: 90, windowDays: 180, warningAt: 75 },
    ],
  });
  assert.equal(state?.rules.find((rule) => rule.id === "brazil")?.countryCode, "BR");
  assert.equal(state?.trips[0]?.ruleId, "brazil");
});

test("preserva viagem legada de outro país sem misturá-la a regras customizadas", () => {
  const state = normalizeState({
    trips: [{ id: "legacy", region: "other", country: "Unknown", start: "2026-01-01", end: "2026-01-02" }],
    rules: [...DEFAULT_RULES, { id: "custom-th", label: "Tailândia", countryCode: "TH", region: "other", limit: 60, windowDays: 180, warningAt: 45 }],
  });
  assert.equal(state?.trips[0]?.ruleId, "legacy-other");
  const custom = state?.rules.find((rule) => rule.id === "custom-th");
  assert(custom);
  assert.equal(statusFor(custom, state?.trips || [], "2026-01-02").used, 0);
});
