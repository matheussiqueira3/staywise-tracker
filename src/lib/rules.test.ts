import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_RULES, DEFAULT_RULES, addDays, countedRuns, dailyCounts, itineraryTrips, planItinerary, describeRule, limitOn, statusWithStay, yearBudget, analyzeTrip, currentTrip, daysInWindow, earliestEntryFor, findConflicts, formatDate, formatFullDate, inclusiveDays, isBuiltInRule, isoToday, maxSafeStay, parseDate, parseRuleNumbers, ruleForTrip, simulateTrip, statusFor, tripMatchesRule, tripStatuses, upcomingTrips } from "./rules";
import { STATE_VERSION, decodeState, encodeState, normalizeState } from "./share";
import { seedState } from "@/data/seed";
import type { Rule } from "./types";
import type { Trip } from "./types";

const brazil = DEFAULT_RULES[0];
const schengen = CATALOG_RULES.find((rule) => rule.id === "schengen")!;
const italy = CATALOG_RULES.find((rule) => rule.id === "italy")!;
const thailand: Rule = { id: "custom-th", label: "Tailândia", countryCode: "TH", region: "other", limit: 60, windowDays: 180, warningAt: 45 };
const japan: Rule = { id: "custom-jp", label: "Japão", countryCode: "JP", region: "other", limit: 90, windowDays: 180, warningAt: 75 };

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

test("acceptance: navegar para 2031 calcula normalmente", () => {
  const entry = "2031-01-15";
  const forecast = maxSafeStay(schengen, [trip("old", "schengen", "2030-11-01", "2030-11-30")], "schengen", entry);
  assert.equal(forecast.daysAvailable, 60);
  assert.equal(forecast.lastSafeDate, addDays(entry, 59));
});

test("acceptance: navegar para 2023 conta o histórico", () => {
  const status = statusFor(schengen, [trip("past", "schengen", "2023-06-01", "2023-06-15")], "2023-06-15");
  assert.equal(status.used, 15);
  assert.equal(status.remaining, 75);
});

test("acceptance: overlap geográfico bloqueado", () => {
  const brazil1 = trip("br1", "brazil", "2026-09-10", "2026-09-20");
  const conflicts = findConflicts([brazil1], trip("sch1", "schengen", "2026-09-15", "2026-09-25"));
  assert.deepEqual(conflicts.otherRegion.map((item) => item.id), ["br1"]);
  assert.equal(conflicts.sameRegion.length, 0);
});

test("findConflicts: dias adjacentes não conflitam; mesma região é listada à parte; a própria viagem é ignorada", () => {
  const brazil1 = trip("br1", "brazil", "2026-09-10", "2026-09-20");
  assert.equal(findConflicts([brazil1], trip("sch1", "schengen", "2026-09-21", "2026-09-25")).otherRegion.length, 0);
  assert.deepEqual(findConflicts([brazil1], trip("br2", "brazil", "2026-09-20", "2026-09-22")).sameRegion.map((item) => item.id), ["br1"]);
  assert.equal(findConflicts([brazil1], { ...brazil1, region: "schengen" }).otherRegion.length, 0);
});

// Regression: saving a trip that is safe on its own days used to silently push a saved later trip over the limit.
test("simulateTrip: aponta viagem futura que passa a exceder", () => {
  const later = trip("later", "schengen", "2027-03-01", "2027-03-30");
  const result = simulateTrip(schengen, [later], trip("new", "schengen", "2026-12-28", "2027-02-28"));
  assert.equal(result.firstOverDate, undefined);
  assert.equal(result.safe, false);
  assert.equal(result.affectedTrips.length, 1);
  assert.equal(result.affectedTrips[0].trip.id, "later");
  assert.equal(result.affectedTrips[0].firstOverDate, "2027-03-28");
  assert.equal(result.affectedTrips[0].excessDays, 3);
});

test("simulateTrip: exatamente no limite é seguro, inclusive para viagens futuras", () => {
  const later = trip("later", "schengen", "2027-03-01", "2027-03-30");
  const result = simulateTrip(schengen, [later], trip("new", "schengen", "2026-12-31", "2027-02-28"));
  assert.equal(result.maxUsed, 60);
  assert.equal(result.safe, true);
  assert.equal(result.affectedTrips.length, 0);
  const exact = simulateTrip(schengen, [], trip("exact", "schengen", "2027-01-01", addDays("2027-01-01", 89)));
  assert.equal(exact.maxUsed, 90);
  assert.equal(exact.safe, true);
  assert.equal(exact.excessDays, 0);
});

test("simulateTrip: editar uma viagem não conta a versão antiga dela", () => {
  const saved = trip("saved", "schengen", "2027-01-01", "2027-03-31");
  const edited = simulateTrip(schengen, [saved], { ...saved, end: "2027-03-30" });
  assert.equal(edited.maxUsed, 89);
  assert.equal(edited.safe, true);
});

test("simulateTrip: viagem futura que já excede sozinha é agravada, não afetada, e a nova viagem não é segura", () => {
  const alreadyOver = trip("over", "schengen", "2027-06-01", "2027-09-30"); // 122 dias: pior dia 90 + 32 sem a nova
  const result = simulateTrip(schengen, [alreadyOver], trip("new", "schengen", "2027-05-01", "2027-05-05"));
  assert.equal(result.firstOverDate, undefined);
  assert.equal(result.affectedTrips.length, 0);
  assert.equal(result.worsenedTrips.length, 1);
  assert.equal(result.worsenedTrips[0].trip.id, "over");
  assert.equal(result.worsenedTrips[0].excessDays, 5); // pior dia passa de 122 para 127 na janela de 180
  assert.equal(result.worsenedTrips[0].firstOverDate, "2027-08-25"); // 86 dias da viagem + 5 da nova = 91
  assert.equal(result.safe, false);
});

test("simulateTrip: viagem já excedida cujo pior dia não piora não é listada", () => {
  const alreadyOver = trip("over", "schengen", "2027-06-01", "2027-09-30");
  // Sai da janela de 180 dias antes do pior dia (2027-09-30) e antes de qualquer dia acima de 90.
  const result = simulateTrip(schengen, [alreadyOver], trip("new", "schengen", "2026-12-01", "2026-12-05"));
  assert.equal(result.worsenedTrips.length, 0);
  assert.equal(result.affectedTrips.length, 0);
  assert.equal(result.safe, true);
});

test("maxSafeStay: para antes de agravar uma viagem futura que já excede", () => {
  const alreadyOver = trip("over", "schengen", "2027-06-01", "2027-09-30");
  const blocked = maxSafeStay(schengen, [alreadyOver], "schengen", "2027-04-01");
  assert.equal(blocked.limitedBy, "later-trip");
  assert.equal(blocked.lastSafeDate, null); // um único dia já soma ao dia 2027-08-29 (90 -> 91) e aos dias já excedidos
  assert.equal(blocked.daysAvailable, 0);
  assert.equal(blocked.firstOverDate, "2027-04-01");
  assert.equal(blocked.blockingTrip?.trip.id, "over");
  assert.equal(blocked.blockingTrip?.firstOverDate, "2027-08-29");
  assert.equal(blocked.blockingTrip?.excessDays, 1);
  const oneDay = simulateTrip(schengen, [alreadyOver], trip("c", "schengen", "2027-04-01", "2027-04-01"));
  assert.equal(oneDay.safe, false);
  assert.deepEqual(oneDay.worsenedTrips.map((item) => [item.trip.id, item.firstOverDate, item.excessDays]), [["over", "2027-08-29", 1]]);

  const early = maxSafeStay(schengen, [alreadyOver], "schengen", "2027-02-01");
  assert.equal(early.limitedBy, "later-trip");
  assert.equal(early.lastSafeDate, "2027-03-02");
  assert.equal(early.firstOverDate, "2027-03-03");
  assert.equal(simulateTrip(schengen, [alreadyOver], trip("c", "schengen", "2027-02-01", "2027-03-02")).safe, true);
  assert.equal(simulateTrip(schengen, [alreadyOver], trip("c", "schengen", "2027-02-01", "2027-03-03")).safe, false);
});

// Regression (M1): "already over" is judged on the whole saved trip, not only on the days the candidate reaches.
test("simulateTrip: viagem futura que já excede fora do alcance da nova é agravada, não afetada", () => {
  const long = trip("long", "schengen", "2027-04-10", "2027-07-18"); // 100 dias: excede sozinha (pior dia 100 em 2027-07-18)
  assert.equal(tripStatuses(CATALOG_RULES, [long]).get("long")?.excessDays, 10);
  const result = simulateTrip(schengen, [long], trip("new", "schengen", "2027-01-01", "2027-01-10"));
  assert.equal(result.firstOverDate, undefined);
  assert.equal(result.affectedTrips.length, 0);
  // 2027-06-29: 10 dias da nova + 81 da viagem = 91 (sem a nova, 81). Cada dia soma no máximo 1 dia acima do limite.
  assert.deepEqual(result.worsenedTrips.map((item) => [item.trip.id, item.firstOverDate, item.excessDays]), [["long", "2027-06-29", 1]]);
  assert.equal(result.safe, false);
  const forecast = maxSafeStay(schengen, [long], "schengen", "2027-01-01");
  assert.equal(forecast.limitedBy, "later-trip");
  assert.equal(forecast.lastSafeDate, "2027-01-09");
  assert.equal(forecast.firstOverDate, "2027-01-10");
  assert.deepEqual([forecast.blockingTrip?.trip.id, forecast.blockingTrip?.firstOverDate, forecast.blockingTrip?.excessDays], ["long", "2027-06-29", 1]);
  assert.equal(simulateTrip(schengen, [long], trip("c", "schengen", "2027-01-01", "2027-01-09")).safe, true);
});

test("simulateTrip: excessDays de viagem agravada é o máximo de dias acrescentados acima do limite", () => {
  const long = trip("long", "schengen", "2027-05-01", addDays("2027-05-01", 159)); // 160 dias
  const result = simulateTrip(schengen, [long], trip("new", "schengen", "2027-03-22", "2027-03-31"));
  assert.equal(result.affectedTrips.length, 0);
  // 2027-07-20: 81º dia da viagem + 10 da nova = 91. De 2027-07-29 em diante cada dia recebe os 10 dias da nova acima do limite.
  assert.deepEqual(result.worsenedTrips.map((item) => [item.trip.id, item.firstOverDate, item.excessDays]), [["long", "2027-07-20", 10]]);
  assert.equal(result.safe, false);
});

test("maxSafeStay: firstWarningDate é o primeiro dia da estadia em alerta", () => {
  const forecast = maxSafeStay(schengen, [], "schengen", "2027-01-01");
  assert.equal(forecast.firstWarningDate, addDays("2027-01-01", 74)); // 75º dia = warningAt
  const short = maxSafeStay(schengen, [trip("later", "schengen", "2027-03-01", "2027-05-29")], "schengen", "2026-11-01");
  assert.equal(short.limitedBy, "later-trip");
  assert.equal(short.firstWarningDate, undefined);
  const existing = trip("existing", "schengen", "2026-06-21", "2026-09-03"); // 75 dias
  assert.equal(maxSafeStay(schengen, [existing], "schengen", "2026-09-04").firstWarningDate, "2026-09-04");
});

test("isoToday usa a data local, não a UTC", () => {
  assert.equal(isoToday(new Date(2026, 8, 26, 23, 30)), "2026-09-26");
  assert.equal(isoToday(new Date(2026, 8, 27, 0, 30)), "2026-09-27");
  assert.equal(isoToday(new Date(2027, 0, 1, 1, 30)), "2027-01-01");
  assert.match(isoToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("tripStatuses: ok, warning, over e none", () => {
  const rules = CATALOG_RULES;
  const trips = [
    trip("ok", "schengen", "2026-01-01", "2026-01-10"),
    trip("exact", "schengen", "2027-01-01", addDays("2027-01-01", 89)), // exatamente 90: alerta, não excesso
    trip("over", "schengen", "2028-01-01", addDays("2028-01-01", 91)), // 92 dias
    { ...trip("other", "other", "2026-03-01", "2026-03-05"), country: "Japan" },
    trip("inverted", "brazil", "2026-05-10", "2026-05-01"),
  ];
  const statuses = tripStatuses(rules, trips);
  assert.equal(statuses.size, 5);
  assert.deepEqual(statuses.get("ok"), { tripId: "ok", status: "ok", maxUsed: 10, excessDays: 0, firstOverDate: undefined, firstWarningDate: undefined });
  const exact = statuses.get("exact");
  assert.equal(exact?.status, "warning");
  assert.equal(exact?.maxUsed, 90);
  assert.equal(exact?.excessDays, 0);
  assert.equal(exact?.firstOverDate, undefined);
  assert.equal(exact?.firstWarningDate, addDays("2027-01-01", 74));
  const over = statuses.get("over");
  assert.equal(over?.status, "over");
  assert.equal(over?.maxUsed, 92);
  assert.equal(over?.excessDays, 2);
  assert.equal(over?.firstOverDate, addDays("2028-01-01", 90));
  assert.deepEqual(statuses.get("other"), { tripId: "other", status: "none", maxUsed: 0, excessDays: 0 });
  assert.equal(statuses.get("inverted")?.status, "none");
  assert.equal(tripStatuses([], [trips[0]]).get("ok")?.status, "none");
});

test("tripStatuses: conta viagens anteriores e não duplica sobreposições", () => {
  const first = trip("first", "schengen", "2027-01-01", "2027-02-14"); // 45 dias
  const overlap = trip("overlap", "schengen", "2027-02-01", "2027-03-02"); // sobrepõe 14 dias, 16 novos
  const later = trip("later", "schengen", "2027-03-10", "2027-04-08"); // 30 dias
  const statuses = tripStatuses(CATALOG_RULES, [first, overlap, later]);
  assert.equal(statuses.get("first")?.maxUsed, 45);
  assert.equal(statuses.get("overlap")?.maxUsed, 61);
  assert.equal(statuses.get("later")?.maxUsed, 91);
  assert.equal(statuses.get("later")?.status, "over");
  assert.equal(statuses.get("later")?.firstOverDate, "2027-04-08");
  assert.equal(statuses.get("overlap")?.status, "ok");
  assert.equal(tripStatuses(CATALOG_RULES, [first, overlap, { ...later, end: "2027-04-07" }]).get("later")?.status, "warning");
});

test("tripStatuses: 100 viagens em poucos milissegundos, igual à contagem dia a dia", () => {
  const random = seededRandom(7);
  const trips: Trip[] = Array.from({ length: 100 }, (_, index) => {
    const start = addDays("2020-01-01", Math.floor(random() * 3000));
    return trip("p" + index, random() < 0.5 ? "schengen" : "brazil", start, addDays(start, Math.floor(random() * 30)));
  });
  const began = performance.now();
  const statuses = tripStatuses(CATALOG_RULES, trips);
  const elapsed = performance.now() - began;
  assert(elapsed < 200, "tripStatuses took " + elapsed.toFixed(1) + " ms");
  for (const saved of trips.slice(0, 10)) {
    const rule = saved.region === "brazil" ? brazil : schengen;
    let maxUsed = 0;
    for (let day = saved.start; day <= saved.end; day = addDays(day, 1)) maxUsed = Math.max(maxUsed, statusFor(rule, trips, day).used);
    assert.equal(statuses.get(saved.id)?.maxUsed, maxUsed, saved.id);
  }
});

test("simulateTrip: outra região não afeta a regra", () => {
  const result = simulateTrip(schengen, [trip("later", "schengen", "2027-03-01", "2027-05-30")], trip("br", "brazil", "2027-01-01", "2027-02-27"));
  assert.equal(result.maxUsed, 0);
  assert.equal(result.affectedTrips.length, 0);
});

test("maxSafeStay: para antes de empurrar uma viagem futura acima do limite", () => {
  const later = trip("later", "schengen", "2027-03-01", "2027-03-30");
  const forecast = maxSafeStay(schengen, [later], "schengen", "2026-12-28");
  assert.equal(forecast.limitedBy, "later-trip");
  assert.equal(forecast.lastSafeDate, "2027-02-25"); // 60 dias + 30 em março = 90
  assert.equal(forecast.daysAvailable, 60);
  assert.equal(forecast.firstOverDate, "2027-02-26");
  assert.equal(forecast.blockingTrip?.trip.id, "later");
  assert.equal(simulateTrip(schengen, [later], trip("check", "schengen", "2026-12-28", "2027-02-25")).safe, true);
  assert.equal(simulateTrip(schengen, [later], trip("check", "schengen", "2026-12-28", "2027-02-26")).safe, false);
});

test("maxSafeStay: sem viagens futuras o limite é a própria regra", () => {
  const forecast = maxSafeStay(schengen, [], "schengen", "2027-01-01");
  assert.equal(forecast.limitedBy, "limit");
  assert.equal(forecast.firstOverDate, addDays("2027-01-01", 90));
});

test("earliestEntryFor: primeira entrada que comporta a estadia inteira", () => {
  const full = trip("full", "schengen", "2026-07-01", "2026-09-28"); // 90 dias
  const result = earliestEntryFor(schengen, [full], 30, "2026-10-01");
  assert(result);
  assert.equal(simulateTrip(schengen, [full], { region: "schengen", ...result }).safe, true);
  assert.equal(simulateTrip(schengen, [full], { region: "schengen", start: addDays(result.start, -1), end: addDays(result.end, -1) }).safe, false);
  assert.equal(inclusiveDays(result.start, result.end), 30);
});

test("earliestEntryFor: pula datas em outra região e recusa estadias acima do limite", () => {
  const brazil1 = trip("br", "brazil", "2027-01-01", "2027-01-31");
  assert.equal(earliestEntryFor(schengen, [brazil1], 10, "2027-01-01")?.start, "2027-02-01");
  assert.equal(earliestEntryFor(schengen, [], 91, "2027-01-01"), null);
  assert.equal(earliestEntryFor(schengen, [], 0, "2027-01-01"), null);
});

// Regression (browser QA): days already booked in the same region add no new days, but they are not a new stay.
test("earliestEntryFor: nunca sugere datas sobrepostas a uma viagem salva", () => {
  const portugal = trip("pt", "schengen", "2027-09-01", "2027-12-10"); // 101 dias
  const result = earliestEntryFor(schengen, [portugal], 30, "2027-06-01");
  assert(result);
  assert.equal(inclusiveDays(result.start, result.end), 30);
  assert.equal(result.end < portugal.start || result.start > portugal.end, true, `sugestão ${result.start}..${result.end}`);
  assert.deepEqual(findConflicts([portugal], { region: "schengen", ...result }), { otherRegion: [], sameRegion: [] });
  assert.equal(simulateTrip(schengen, [portugal], { region: "schengen", ...result }).safe, true);
});

// Regression (L2): keys are parsed at 12:00Z, so they must be formatted in UTC or UTC+12..+14 shows the next day.
test("formatDate mostra o mesmo dia em qualquer fuso horário", () => {
  assert.equal(formatDate("2026-03-28", { day: "numeric" }), "28");
  assert.equal(formatDate("2026-12-31", { year: "numeric" }), "2026");
  assert.match(formatDate("2026-03-28"), /^28 /);
  assert.match(formatFullDate("2026-12-31"), /^31 de dezembro de 2026$/);
  assert.equal(formatDate("2026-03-28", { day: "numeric", timeZone: "Pacific/Kiritimati" }), "28");
});

test("currentTrip e upcomingTrips ordenam corretamente", () => {
  const trips = [trip("c", "brazil", "2027-05-01", "2027-05-10"), trip("now", "brazil", "2026-09-01", "2026-09-30"), trip("b", "schengen", "2026-11-01", "2026-11-10")];
  assert.equal(currentTrip(trips, "2026-09-15")?.id, "now");
  assert.deepEqual(upcomingTrips(trips, "2026-09-15").map((item) => item.id), ["b", "c"]);
  assert.equal(currentTrip(trips, "2026-10-15"), undefined);
});

// Reference implementation: the original day-by-day algorithm, kept to prove the fast engine returns identical results.
function referenceAnalyze(rule: Rule, trips: Trip[], region: Trip["region"], start: string, end: string) {
  let maxUsed = 0; let maxUsedDate = start; let firstWarningDate: string | undefined; let firstOverDate: string | undefined;
  if (start > end) return { safe: true, maxUsed: 0, maxUsedDate: start, firstWarningDate, firstOverDate, lastSafeDate: undefined };
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const status = statusFor(rule, [...trips, { id: "ref", ruleId: region === rule.region ? rule.id : undefined, region, country: "", start, end: day }], day);
    if (status.used > maxUsed) { maxUsed = status.used; maxUsedDate = day; }
    if (status.status === "warning" && !firstWarningDate) firstWarningDate = day;
    if (status.status === "over" && !firstOverDate) firstOverDate = day;
  }
  return { safe: !firstOverDate, firstWarningDate, firstOverDate, lastSafeDate: firstOverDate ? addDays(firstOverDate, -1) : undefined, maxUsed, maxUsedDate };
}

function seededRandom(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

// Reference for saved trips the candidate reaches, straight from the definition: occupancy per day number, window sums.
// A day of a saved trip after the candidate's exit (and within its window's reach) is impacted when it is over the
// limit with the candidate and the candidate adds to it. "Already over" is judged on every day of the saved trip.
function referenceLaterImpacts(rule: Rule, trips: Trip[], start: string, end: string) {
  const dayNumber = (value: string) => Math.round(parseDate(value).getTime() / 86400000);
  const occupancy = (list: Trip[]) => {
    const days = new Set<number>();
    for (const item of list) if (tripMatchesRule(item, rule) && item.start <= item.end) for (let day = dayNumber(item.start); day <= dayNumber(item.end); day++) days.add(day);
    return days;
  };
  const without = occupancy(trips);
  const withNew = occupancy([...trips, { ...trip("new", rule.region, start, end), ruleId: rule.id }]);
  // Calendar-year rules count back to 1 January of the day's year and allow one more day in leap years.
  const calendar = rule.kind === "calendar-year";
  const yearOf = (day: number) => new Date(day * 86400000 - 43200000).getUTCFullYear(); // dayNumber rounds noon UTC up
  const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limitFor = (day: number) => calendar && leap(yearOf(day)) ? rule.leapYearLimit ?? rule.limit : rule.limit;
  const usedOn = (days: Set<number>, day: number) => {
    let count = 0;
    if (calendar) { for (let back = day; yearOf(back) === yearOf(day); back--) if (days.has(back)) count++; return count; }
    for (let back = 0; back < rule.windowDays; back++) if (days.has(day - back)) count++;
    return count;
  };
  const exit = dayNumber(end);
  const reach = calendar ? dayNumber(yearOf(exit) + "-12-31") : exit + rule.windowDays - 1;
  const affected = new Map<string, [string, number]>();
  const worsened = new Map<string, [string, number]>();
  let overOnlyOutOfReach = 0; // worsened trips that are within the limit on every day the candidate reaches
  for (const saved of trips) {
    if (!tripMatchesRule(saved, rule) || saved.start > saved.end) continue;
    const first = dayNumber(saved.start);
    const last = dayNumber(saved.end);
    if (last <= exit || first > reach) continue;
    let alreadyOver = false;
    for (let day = first; day <= last && !alreadyOver; day++) alreadyOver = usedOn(without, day) > limitFor(day);
    let firstImpacted: string | undefined;
    let excess = 0;
    let overInReach = false;
    for (let day = Math.max(first, exit + 1); day <= Math.min(last, reach); day++) {
      const usedWith = usedOn(withNew, day);
      const usedWithout = usedOn(without, day);
      overInReach ||= usedWithout > limitFor(day);
      if (usedWith <= limitFor(day) || usedWith <= usedWithout) continue;
      firstImpacted ??= addDays(end, day - exit);
      excess = Math.max(excess, alreadyOver ? usedWith - Math.max(usedWithout, limitFor(day)) : usedWith - limitFor(day));
    }
    if (firstImpacted) (alreadyOver ? worsened : affected).set(saved.id, [firstImpacted, excess]);
    if (firstImpacted && alreadyOver && !overInReach) overOnlyOutOfReach++;
  }
  return { affected, worsened, overOnlyOutOfReach };
}

test("motor rápido: equivalente ao algoritmo original em 300 cenários aleatórios", () => {
  const random = seededRandom(42);
  const pick = (max: number) => Math.floor(random() * max);
  let affectedRuns = 0;
  let worsenedRuns = 0;
  let overOnlyOutOfReach = 0;
  for (let run = 0; run < 300; run++) {
    const rule = run % 3 === 0 ? schengen : run % 3 === 1 ? { ...brazil, limit: 60 + pick(120), warningAt: 40 } : { ...schengen, limit: 30 + pick(150), windowDays: 90 + pick(400), warningAt: 20 };
    // Long saved trips (up to 160 days) make trips that are over on days the candidate's window never reaches.
    const trips: Trip[] = Array.from({ length: pick(8) }, (_, index) => {
      const start = addDays("2026-01-01", pick(700));
      return trip("t" + index, random() < 0.8 ? rule.region : "other", start, addDays(start, random() < 0.4 ? pick(160) : pick(40)));
    });
    const start = addDays("2026-06-01", pick(400));
    const end = addDays(start, pick(120));
    const fast = analyzeTrip(rule, trips, rule.region, start, end);
    assert.deepEqual(fast, referenceAnalyze(rule, trips, rule.region, start, end), "analyzeTrip run " + run);

    const place = rule.region === "other" ? { region: rule.region, ruleId: rule.id } : { region: rule.region };
    const simulation = simulateTrip(rule, trips, { ...place, start, end });
    const expected = referenceLaterImpacts(rule, trips, start, end);
    const toMap = (items: typeof simulation.affectedTrips) => new Map(items.map((item): [string, [string, number]] => [item.trip.id, [item.firstOverDate, item.excessDays]]));
    assert.deepEqual(toMap(simulation.affectedTrips), expected.affected, "affected trips run " + run);
    assert.deepEqual(toMap(simulation.worsenedTrips), expected.worsened, "worsened trips run " + run);
    assert.equal(simulation.safe, !simulation.firstOverDate && expected.affected.size === 0 && expected.worsened.size === 0, "safe run " + run);
    if (expected.affected.size) affectedRuns++;
    if (expected.worsened.size) worsenedRuns++;
    overOnlyOutOfReach += expected.overOnlyOutOfReach;

    const forecast = maxSafeStay(rule, trips, rule.region, start);
    if (forecast.lastSafeDate) assert.equal(simulateTrip(rule, trips, { ...place, start, end: forecast.lastSafeDate }).safe, true, "last safe date is safe, run " + run);
    if (forecast.firstOverDate) assert.equal(simulateTrip(rule, trips, { ...place, start, end: forecast.firstOverDate }).safe, false, "first over date is unsafe, run " + run);
    if (forecast.blockingTrip) {
      const blocked = simulateTrip(rule, trips, { ...place, start, end: forecast.firstOverDate! });
      assert.deepEqual([...blocked.affectedTrips, ...blocked.worsenedTrips].find((item) => item.trip.id === forecast.blockingTrip!.trip.id), forecast.blockingTrip, "blocking trip matches simulateTrip, run " + run);
    }
  }
  assert(affectedRuns >= 10 && worsenedRuns >= 10 && overOnlyOutOfReach >= 1, `scenarios cover both lists (affected ${affectedRuns}, worsened ${worsenedRuns}, over only out of reach ${overOnlyOutOfReach})`);
});

test("motor rápido: regra customizada equivale ao algoritmo original em 150 cenários aleatórios", () => {
  const random = seededRandom(1234);
  const pick = (max: number) => Math.floor(random() * max);
  let impactedRuns = 0;
  for (let run = 0; run < 150; run++) {
    const rule: Rule = { ...thailand, limit: 30 + pick(90), windowDays: 90 + pick(300), warningAt: 20 };
    // Mix of trips under the rule, under another custom rule, rule-less "other" trips and built-in trips; only the first count.
    const trips: Trip[] = Array.from({ length: pick(8) }, (_, index) => {
      const start = addDays("2026-01-01", pick(700));
      const saved = trip("t" + index, "other", start, addDays(start, random() < 0.4 ? pick(160) : pick(40)));
      const kind = random();
      return kind < 0.7 ? { ...saved, ruleId: rule.id } : kind < 0.8 ? { ...saved, ruleId: japan.id } : kind < 0.9 ? saved : { ...saved, region: "schengen" };
    });
    const start = addDays("2026-06-01", pick(400));
    const end = addDays(start, pick(120));
    assert.deepEqual(analyzeTrip(rule, trips, "other", start, end), referenceAnalyze(rule, trips, "other", start, end), "analyzeTrip run " + run);
    const candidate = { region: "other" as const, ruleId: rule.id };
    const simulation = simulateTrip(rule, trips, { ...candidate, start, end });
    const expected = referenceLaterImpacts(rule, trips, start, end);
    const toMap = (items: typeof simulation.affectedTrips) => new Map(items.map((item): [string, [string, number]] => [item.trip.id, [item.firstOverDate, item.excessDays]]));
    assert.deepEqual(toMap(simulation.affectedTrips), expected.affected, "affected trips run " + run);
    assert.deepEqual(toMap(simulation.worsenedTrips), expected.worsened, "worsened trips run " + run);
    if (expected.affected.size || expected.worsened.size) impactedRuns++;
    const forecast = maxSafeStay(rule, trips, rule.region, start);
    if (forecast.lastSafeDate) assert.equal(simulateTrip(rule, trips, { ...candidate, start, end: forecast.lastSafeDate }).safe, true, "last safe date is safe, run " + run);
    if (forecast.firstOverDate) assert.equal(simulateTrip(rule, trips, { ...candidate, start, end: forecast.firstOverDate }).safe, false, "first over date is unsafe, run " + run);
  }
  assert(impactedRuns >= 10, "scenarios with later-trip impacts: " + impactedRuns);
});

// Country catalog: custom rules, rule matching and state normalization.
test("regra com warning zero não alerta um histórico vazio", () => {
  const rule = { ...schengen, warningAt: 0 };
  assert.equal(statusFor(rule, [], "2026-09-18").status, "ok");
  assert.equal(statusFor(rule, [trip("one", "schengen", "2026-09-18", "2026-09-18")], "2026-09-18").status, "warning");
  assert.equal(maxSafeStay(rule, [], "brazil", "2026-09-18").firstWarningDate, undefined);
  assert.equal(tripStatuses([rule], [trip("s", "schengen", "2026-09-01", "2026-09-02")]).get("s")?.status, "warning");
});

test("regra customizada não soma viagens de outra regra", () => {
  const schengenTrip = trip("schengen", "schengen", "2026-09-01", "2026-09-18");
  const customTrip: Trip = { ...schengenTrip, id: "custom", ruleId: thailand.id, region: "other", country: "Tailândia" };
  assert.equal(statusFor(thailand, [schengenTrip, customTrip], "2026-09-18").used, 18);
  assert.equal(statusFor(schengen, [customTrip], "2026-09-18").used, 0);
  assert.equal(daysInWindow([schengenTrip, customTrip], thailand, "2026-09-01", "2026-09-18"), 18);
});

test("maxSafeStay suporta janela maior que 366 dias", () => {
  const longRule = { ...thailand, id: "long", windowDays: 800, limit: 700 };
  const began = performance.now();
  const result = maxSafeStay(longRule, [], longRule.region, "2026-09-18");
  const elapsed = performance.now() - began;
  assert.equal(result.daysAvailable, 700);
  assert.equal(result.limitedBy, "limit");
  assert.equal(result.firstOverDate, addDays("2026-09-18", 700));
  assert(elapsed < 50, "maxSafeStay took " + elapsed.toFixed(1) + " ms");
  // Built-in rule stretched the same way.
  assert.equal(maxSafeStay({ ...brazil, windowDays: 800, limit: 700 }, [], "brazil", "2026-09-18").daysAvailable, 700);
  // A window no longer than the limit never goes over on its own: the search stops after one year.
  assert.equal(maxSafeStay({ ...brazil, windowDays: 100, limit: 100 }, [], "brazil", "2026-09-18").daysAvailable, 367);
});

test("maxSafeStay: configurações absurdas continuam rápidas", () => {
  const began = performance.now();
  // Window and limit are capped at 3660 days (10 years); the worst case searches 3659 days over a 3660-day window.
  const result = maxSafeStay({ ...thailand, limit: 3659, windowDays: 1e9 }, [], "other", "2026-09-18");
  const elapsed = performance.now() - began;
  assert.equal(result.daysAvailable, 3659);
  assert.equal(statusFor({ ...thailand, limit: 1e9, windowDays: 1e9 }, [], "2026-09-18").rule.windowDays, 3660);
  assert(elapsed < 500, "maxSafeStay took " + elapsed.toFixed(1) + " ms");
});

test("simulateTrip, maxSafeStay e tripStatuses: regra customizada e regras nativas não se misturam", () => {
  const brazilTrip = trip("br", "brazil", "2027-01-01", "2027-03-31"); // 90 dias
  const thaiTrip: Trip = { id: "th", ruleId: thailand.id, region: "other", country: "Tailândia", start: "2027-04-01", end: "2027-05-30" }; // 60 dias
  const trips = [brazilTrip, thaiTrip];
  // Custom rule counts only its own trips.
  const thai = simulateTrip(thailand, trips, { region: "other", ruleId: thailand.id, start: "2027-06-01", end: "2027-06-01" });
  assert.equal(thai.maxUsed, 61);
  assert.equal(thai.safe, false);
  // Stays that do not count add nothing: maxUsed is only the saved thai days, exactly at the limit.
  for (const other of [{ region: "brazil" as const }, { region: "other" as const, ruleId: japan.id }]) {
    const result = simulateTrip(thailand, trips, { ...other, start: "2027-06-01", end: "2027-06-10" });
    assert.deepEqual([result.maxUsed, result.safe], [60, true]);
  }
  assert.equal(maxSafeStay(thailand, trips, thailand.region, "2027-06-01").daysAvailable, 0);
  assert.equal(maxSafeStay(thailand, [brazilTrip], thailand.region, "2027-06-01").daysAvailable, 60);
  // Built-in rules never count custom-rule trips, nor a candidate under a custom rule.
  assert.equal(simulateTrip(brazil, trips, { region: "brazil", start: "2027-06-01", end: "2027-06-01" }).maxUsed, 91);
  const thaiUnderBrazil = simulateTrip(brazil, trips, { region: "other", ruleId: thailand.id, start: "2027-06-01", end: "2027-06-10" });
  assert.deepEqual([thaiUnderBrazil.maxUsed, thaiUnderBrazil.safe], [90, true]);
  assert.equal(maxSafeStay(brazil, [thaiTrip], "brazil", "2027-04-01").daysAvailable, 180);
  // A stay outside the rule never counts toward it, so the rule never limits it (search stops after one year).
  assert.deepEqual([maxSafeStay(brazil, [brazilTrip], "other", "2027-04-01").limitedBy, maxSafeStay(brazil, [brazilTrip], "brazil", "2027-04-01").limitedBy], [undefined, "limit"]);
  // A thai stay right before the saved thai trip pushes it over; the Brazil trip is untouched.
  const before = simulateTrip(thailand, trips, { region: "other", ruleId: thailand.id, start: "2027-03-20", end: "2027-03-25" });
  assert.deepEqual(before.affectedTrips.map((item) => item.trip.id), ["th"]);
  const statuses = tripStatuses([...CATALOG_RULES, thailand], trips);
  assert.equal(statuses.get("br")?.maxUsed, 90);
  assert.equal(statuses.get("th")?.maxUsed, 60);
  assert.equal(statuses.get("th")?.status, "warning");
  assert.equal(tripStatuses(CATALOG_RULES, trips).get("th")?.status, "none");
});

test("viagem 'Outro' sem regra não conta para nenhuma regra", () => {
  const ruleless: Trip = { id: "o", region: "other", country: "Tailândia", start: "2027-01-01", end: "2027-03-31" };
  const rules = [...DEFAULT_RULES, thailand];
  assert.equal(ruleForTrip(rules, ruleless), undefined);
  for (const rule of rules) {
    assert.equal(tripMatchesRule(ruleless, rule), false, rule.id);
    assert.equal(statusFor(rule, [ruleless], "2027-03-31").used, 0, rule.id);
  }
  assert.equal(tripStatuses(rules, [ruleless]).get("o")?.status, "none");
  assert.equal(simulateTrip(thailand, [ruleless], { region: "other", ruleId: thailand.id, start: "2027-04-01", end: "2027-04-01" }).maxUsed, 1);
  // Legacy built-in trips without ruleId still count toward their region's rule.
  assert.equal(ruleForTrip(rules, trip("b", "brazil", "2027-01-01", "2027-01-02"))?.id, "brazil");
});

test("findConflicts: regra customizada e Brasil são lugares diferentes", () => {
  const brazilTrip = trip("br", "brazil", "2027-01-01", "2027-01-31");
  const thaiTrip: Trip = { id: "th", ruleId: thailand.id, region: "other", country: "Tailândia", start: "2027-01-20", end: "2027-02-10" };
  const ruleless: Trip = { id: "o", region: "other", country: "Peru", start: "2027-01-25", end: "2027-01-26" };
  const legacyBrazil = trip("br-old", "brazil", "2027-01-15", "2027-01-16");
  const thaiCandidate = { region: "other" as const, ruleId: thailand.id, start: "2027-01-10", end: "2027-01-30" };
  const conflicts = findConflicts([brazilTrip, thaiTrip, ruleless, legacyBrazil], thaiCandidate);
  assert.deepEqual(conflicts.otherRegion.map((item) => item.id), ["br", "o", "br-old"]);
  assert.deepEqual(conflicts.sameRegion.map((item) => item.id), ["th"]);
  const brazilCandidate = { region: "brazil" as const, ruleId: "brazil", start: "2027-01-10", end: "2027-01-30" };
  const fromBrazil = findConflicts([brazilTrip, thaiTrip, ruleless, legacyBrazil], brazilCandidate);
  assert.deepEqual(fromBrazil.sameRegion.map((item) => item.id), ["br", "br-old"]); // ruleId "brazil" and legacy region "brazil" are the same place
  assert.deepEqual(fromBrazil.otherRegion.map((item) => item.id), ["th", "o"]);
  assert.deepEqual(findConflicts([thaiTrip], { ...thaiCandidate, ruleId: japan.id }).otherRegion.map((item) => item.id), ["th"]);
  assert.deepEqual(findConflicts([ruleless], { region: "other", start: "2027-01-25", end: "2027-01-25" }).sameRegion.map((item) => item.id), ["o"]);
});

test("earliestEntryFor: regra customizada conta só as próprias viagens e não sobrepõe outras", () => {
  const thaiTrip: Trip = { id: "th", ruleId: thailand.id, region: "other", country: "Tailândia", start: "2027-01-01", end: "2027-03-01" }; // 60 dias
  const brazilTrip = trip("br", "brazil", "2027-03-02", "2027-03-31");
  const result = earliestEntryFor(thailand, [thaiTrip, brazilTrip], 30, "2027-03-02");
  assert(result);
  assert.equal(inclusiveDays(result.start, result.end), 30);
  const candidate = { region: "other" as const, ruleId: thailand.id, ...result };
  assert.equal(simulateTrip(thailand, [thaiTrip, brazilTrip], candidate).safe, true);
  assert.equal(simulateTrip(thailand, [thaiTrip, brazilTrip], { ...candidate, start: addDays(result.start, -1), end: addDays(result.end, -1) }).safe, false);
  assert.deepEqual(findConflicts([thaiTrip, brazilTrip], candidate), { otherRegion: [], sameRegion: [] });
  // Brazil days never block the thai rule: with only the Brazil trip, the first free day after it is the answer.
  assert.equal(earliestEntryFor(thailand, [brazilTrip], 30, "2027-03-02")?.start, "2027-04-01");
  assert.equal(earliestEntryFor(thailand, [], 61, "2027-03-02"), null);
});

test("estado preserva regras customizadas e rejeita viagens sem regra", () => {
  const valid = normalizeState({ rules: [...DEFAULT_RULES, thailand], trips: [{ id: "t", ruleId: thailand.id, region: "other", country: "Tailândia", start: "2026-09-01", end: "2026-09-02" }] });
  assert.equal(valid?.rules.some((rule) => rule.id === thailand.id), true);
  assert.equal(valid?.trips[0]?.ruleId, thailand.id);
  assert.equal(normalizeState({ rules: DEFAULT_RULES, trips: [{ id: "bad", ruleId: "missing", region: "other", country: "X", start: "2026-09-01", end: "2026-09-02" }] }), null);
  assert.equal(normalizeState({ rules: DEFAULT_RULES, trips: [{ id: "bad", ruleId: 7, region: "brazil", country: "X", start: "2026-09-01", end: "2026-09-02" }] }), null);
});

test("estado rejeita regras inválidas ou duplicadas e limita tamanhos", () => {
  assert.equal(normalizeState({ rules: [thailand, thailand], trips: [] }), null);
  assert.equal(normalizeState({ rules: [{ ...thailand, id: "" }], trips: [] }), null);
  assert.equal(normalizeState({ rules: [{ ...thailand, id: "x".repeat(101) }], trips: [] }), null);
  assert.equal(normalizeState({ rules: [{ ...thailand, region: "mars" }], trips: [] }), null);
  assert.equal(normalizeState({ rules: [{ id: "custom-x", label: "X", region: "other" }], trips: [] }), null); // custom rule without numbers
  const state = normalizeState({
    rules: [{ ...thailand, label: "  " + "L".repeat(200), countryCode: " th " }, { ...thailand, id: "custom-br", region: "brazil" }, { id: "brazil", label: "Brasil", region: "other" }],
    trips: [{ id: "n", ruleId: thailand.id, region: "other", country: "Tailândia", start: "2026-09-01", end: "2026-09-02", notes: "n".repeat(900) }],
  });
  assert(state);
  const custom = state.rules.find((rule) => rule.id === thailand.id);
  assert.equal(custom?.label.length, 80);
  assert.equal(custom?.countryCode, "TH");
  assert.equal(state.rules.find((rule) => rule.id === "custom-br")?.region, "other"); // custom rules always live in "other"
  assert.deepEqual(state.rules.find((rule) => rule.id === "brazil"), brazil); // built-in keeps its region and numbers
  assert.equal(state.trips[0].notes?.length, 500);
  assert.equal(decodeState("A".repeat(700_001)), null);
});

test("estado: viagem sob uma regra assume a região da regra", () => {
  const state = normalizeState({ rules: [...DEFAULT_RULES, thailand], trips: [{ id: "t", ruleId: thailand.id, region: "schengen", country: "Tailândia", start: "2026-09-01", end: "2026-09-02" }, { id: "b", ruleId: "brazil", region: "other", country: "Brazil", start: "2026-10-01", end: "2026-10-02" }] });
  assert.equal(state?.trips[0].region, "other");
  assert.equal(state?.trips[1].region, "brazil");
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
  // The old default Schengen rule no trip uses leaves the workspace; Italy joins it.
  assert.deepEqual(state?.rules.map((rule) => rule.id), ["brazil", "italy"]);
  // A Schengen stay outside Italy keeps the Schengen rule, with its catalog country code.
  const france = normalizeState({
    trips: [{ id: "fr", region: "schengen", country: "France", start: "2026-01-01", end: "2026-01-02" }],
    rules: [{ id: "schengen", label: "Schengen", region: "schengen", limit: 90, windowDays: 180, warningAt: 75 }],
  });
  assert.equal(france?.rules.find((rule) => rule.id === "schengen")?.countryCode, "SCHENGEN");
  assert.equal(france?.trips[0]?.ruleId, "schengen");
});

test("preserva viagem legada de outro país sem misturá-la a regras customizadas", () => {
  const state = normalizeState({
    // The country even matches the custom rule's label: it still stays rule-less rather than being silently assigned.
    trips: [{ id: "legacy", region: "other", country: "Tailândia", start: "2026-01-01", end: "2026-01-02" }],
    rules: [...DEFAULT_RULES, thailand],
  });
  assert(state);
  assert.equal(state.trips[0].ruleId, undefined);
  assert.equal("ruleId" in state.trips[0], false);
  assert.equal(state.rules.length, 3); // no "Outro (revisar)" placeholder rule
  const custom = state.rules.find((rule) => rule.id === thailand.id);
  assert(custom);
  assert.equal(statusFor(custom, state.trips, "2026-01-02").used, 0);
});

test("estado produzido pelo app sobrevive a normalizeState e ao link de compartilhamento sem mudanças", () => {
  const state = {
    version: STATE_VERSION,
    rules: [...DEFAULT_RULES, thailand],
    trips: [
      { id: "b", ruleId: "brazil", region: "brazil" as const, country: "Brazil", start: "2026-01-01", end: "2026-01-10" },
      { id: "s", ruleId: "italy", region: "italy" as const, country: "Italy", start: "2026-02-01", end: "2026-02-10", notes: "Roma" },
      { id: "t", ruleId: thailand.id, region: "other" as const, country: "Tailândia", start: "2026-03-01", end: "2026-03-10" },
      { id: "o", region: "other" as const, country: "Peru", start: "2026-04-01", end: "2026-04-10" }, // "Outro (sem regra)"
    ],
  };
  const once = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(JSON.parse(JSON.stringify(once)), state);
  assert.deepEqual(normalizeState(once), once);
  assert.deepEqual(decodeState(encodeState(state)), once);
  // Legacy built-in trips gain their ruleId once, then stay stable.
  // A legacy Schengen stay in Italy becomes an Italy stay once, then stays stable.
  const legacy = normalizeState({ rules: DEFAULT_RULES, trips: [{ id: "l", region: "schengen", country: "Italy", start: "2026-01-01", end: "2026-01-02" }] });
  assert.equal(legacy?.trips[0].ruleId, "italy");
  assert.equal(legacy?.trips[0].region, "italy");
  assert.deepEqual(normalizeState(legacy), legacy);
});

test("parseRuleNumbers rejeita valores incompletos em vez de ajustá-los", () => {
  assert.deepEqual(parseRuleNumbers({ limit: "90", windowDays: "180", warningAt: "75" }), { ok: true, value: { limit: 90, windowDays: 180, warningAt: 75 } });
  assert.deepEqual(parseRuleNumbers({ limit: " 60 ", windowDays: "180", warningAt: "" }), { ok: true, value: { limit: 60, windowDays: 180, warningAt: 0 } });
  // Exactly at the edges is allowed: window equal to the limit, alert equal to the limit.
  assert.equal(parseRuleNumbers({ limit: "90", windowDays: "90", warningAt: "90" }).ok, true);
  for (const input of [
    { limit: "", windowDays: "180", warningAt: "75" }, // campo apagado para redigitar
    { limit: "0", windowDays: "180", warningAt: "0" },
    { limit: "9.5", windowDays: "180", warningAt: "0" },
    { limit: "-1", windowDays: "180", warningAt: "0" },
    { limit: "90", windowDays: "89", warningAt: "0" }, // janela menor que o limite
    { limit: "90", windowDays: "180", warningAt: "91" },
    { limit: "90", windowDays: "99999", warningAt: "0" },
  ]) assert.equal(parseRuleNumbers(input).ok, false, JSON.stringify(input));
});

test("apenas regras do catálogo com região própria são embutidas", () => {
  assert.equal(isBuiltInRule(brazil), true);
  assert.equal(isBuiltInRule(schengen), true);
  assert.equal(isBuiltInRule(thailand), false);
});

// Calendar-year rules (not in the catalog; the engine supports them): at most 182 days per calendar year, 183 in leap years.
const italyCalendar: Rule = { ...italy, kind: "calendar-year", limit: 182, leapYearLimit: 183, windowDays: 365, warningAt: 150 };
function italyTrip(id: string, start: string, end: string): Trip { return { id, ruleId: "italy", region: "italy", country: "Italy", start, end }; }

test("Itália: 182 dias no ano são permitidos, o 183º excede; em ano bissexto o limite é 183", () => {
  assert.equal(limitOn(italyCalendar, "2026-06-01"), 182);
  assert.equal(limitOn(italyCalendar, "2028-06-01"), 183);
  assert.equal(describeRule(italyCalendar), "182 dias por ano civil (183 em ano bissexto)");
  assert.equal(analyzeTrip(italyCalendar, [], "italy", "2026-01-01", addDays("2026-01-01", 181)).safe, true); // 182 dias
  const over = analyzeTrip(italyCalendar, [], "italy", "2026-01-01", addDays("2026-01-01", 182)); // 183 dias
  assert.equal(over.firstOverDate, addDays("2026-01-01", 182));
  assert.equal(analyzeTrip(italyCalendar, [], "italy", "2028-01-01", addDays("2028-01-01", 182)).safe, true); // 183 dias, bissexto
  assert.equal(analyzeTrip(italyCalendar, [], "italy", "2028-01-01", addDays("2028-01-01", 183)).firstOverDate, addDays("2028-01-01", 183));
});

test("Itália: entrada em 1º de janeiro sem histórico pode ficar até 1º de julho", () => {
  assert.equal(maxSafeStay(italyCalendar, [], "italy", "2027-01-01").lastSafeDate, "2027-07-01");
  assert.equal(maxSafeStay(italyCalendar, [], "italy", "2027-01-01").daysAvailable, 182);
  assert.equal(maxSafeStay(italyCalendar, [], "italy", "2028-01-01").lastSafeDate, "2028-07-01"); // 183 dias no bissexto
});

test("Itália: a contagem zera em 1º de janeiro e uma estadia pode atravessar o ano", () => {
  const spring = italyTrip("spring", "2026-01-01", addDays("2026-01-01", 169)); // 170 dias em 2026
  // 12 dias restantes em 2026 (20–31 dez) e depois o orçamento inteiro de 2027.
  const crossing = maxSafeStay(italyCalendar, [spring], "italy", "2026-12-20");
  assert.equal(crossing.lastSafeDate, "2027-07-01");
  assert.equal(crossing.limitedBy, "limit");
  // Com 175 dias usados sobram 7: sai em 26 de dezembro.
  const tight = maxSafeStay(italyCalendar, [italyTrip("long", "2026-01-01", addDays("2026-01-01", 174))], "italy", "2026-12-20");
  assert.equal(tight.lastSafeDate, "2026-12-26");
  assert.equal(tight.firstOverDate, "2026-12-27");
  // Dias de anos anteriores não contam.
  assert.equal(statusFor(italyCalendar, [spring], "2027-01-05").used, 0);
  assert.equal(statusFor(italyCalendar, [spring, italyTrip("jan", "2027-01-01", "2027-01-05")], "2027-01-05").used, 5);
});

test("Itália: uma viagem no início do ano pode fazer uma viagem de outubro exceder, mas não afeta o ano seguinte", () => {
  const winter = italyTrip("winter", "2026-01-01", addDays("2026-01-01", 139)); // 140 dias
  const october = italyTrip("october", "2026-10-01", "2026-10-31"); // 31 dias: 171 no ano
  const nextYear = italyTrip("next", "2027-02-01", "2027-02-28");
  const simulation = simulateTrip(italyCalendar, [winter, october, nextYear], { region: "italy", ruleId: "italy", start: "2026-06-01", end: "2026-06-20" }); // +20 = 191
  assert.equal(simulation.firstOverDate, undefined); // a própria viagem fica em 160
  assert.deepEqual(simulation.affectedTrips.map((item) => [item.trip.id, item.firstOverDate, item.excessDays]), [["october", "2026-10-23", 9]]);
  assert.equal(simulation.safe, false);
  const forecast = maxSafeStay(italyCalendar, [winter, october, nextYear], "italy", "2026-06-01");
  assert.equal(forecast.limitedBy, "later-trip");
  assert.equal(forecast.lastSafeDate, "2026-06-11"); // 11 dias: 140 + 11 + 31 = 182
  assert.equal(yearBudget(italyCalendar, [winter, october, nextYear], 2026).remaining, 11);
  assert.deepEqual(yearBudget(italyCalendar, [winter, october], 2028), { year: 2028, used: 0, limit: 183, remaining: 183, over: false });
});

test("dia de viagem: termina um país e começa outro no mesmo dia, e o dia conta para os dois", () => {
  const brazilStay = { ...trip("br", "brazil", "2026-03-01", "2026-03-10"), ruleId: "brazil" };
  const italyStay = italyTrip("it", "2026-03-10", "2026-03-20");
  assert.deepEqual(findConflicts([brazilStay], italyStay).otherRegion, []);
  assert.equal(daysInWindow([brazilStay, italyStay], brazil, "2026-03-10", "2026-03-10"), 1);
  assert.equal(daysInWindow([brazilStay, italyStay], italyCalendar, "2026-03-10", "2026-03-10"), 1);
  // Mais de um dia em comum, ou um dia no meio de outra estadia, continua sendo conflito.
  assert.equal(findConflicts([brazilStay], italyTrip("x", "2026-03-09", "2026-03-20")).otherRegion.length, 1);
  assert.equal(findConflicts([brazilStay], italyTrip("y", "2026-03-05", "2026-03-05")).otherRegion.length, 1);
});

test("histórico importado: dias fora do Brasil viram Itália, contados em 90 a cada 180", () => {
  assert.equal(seedState.version, STATE_VERSION);
  assert.equal(seedState.trips.length, 19);
  assert.deepEqual([...new Set(seedState.trips.map((item) => item.ruleId))].sort(), ["brazil", "italy"]);
  assert.deepEqual(seedState.rules.map((rule) => [rule.id, rule.limit, rule.windowDays]), [["brazil", 180, 360], ["italy", 90, 180]]);
  assert.equal(describeRule(italy), "90 dias a cada 180");
  // Estadia na Itália a partir de 22 set 2026 (planilha): 75 dias nos últimos 180 na véspera; 6 out é o 90º dia, 7 out o 91º.
  const current = seedState.trips.find((item) => item.ruleId === "italy" && item.start === "2026-09-22")!;
  const others = seedState.trips.filter((item) => item.id !== current.id);
  assert.equal(statusFor(italy, others, "2026-09-21").used, 75);
  const forecast = maxSafeStay(italy, others, "italy", current.start);
  assert.equal(forecast.lastSafeDate, "2026-10-06");
  const over = statusWithStay(italy, others, { start: current.start, end: "2026-10-07" }, "2026-10-07");
  assert.deepEqual([over.used, over.windowStart, over.limit], [91, "2026-04-11", 90]);
});

test("motor rápido: regra de ano civil equivale ao algoritmo original em 200 cenários aleatórios", () => {
  const random = seededRandom(2028);
  const pick = (max: number) => Math.floor(random() * max);
  let impactedRuns = 0;
  let crossingRuns = 0;
  for (let run = 0; run < 200; run++) {
    const limit = 20 + pick(170);
    const rule: Rule = { ...italy, limit, leapYearLimit: limit + pick(2), warningAt: Math.min(limit, 15) };
    const trips: Trip[] = Array.from({ length: pick(9) }, (_, index) => {
      const start = addDays("2026-01-01", pick(1300)); // 2026–2029, com 2028 bissexto
      const saved = italyTrip("t" + index, start, addDays(start, random() < 0.4 ? pick(200) : pick(40)));
      return random() < 0.85 ? saved : { ...saved, ruleId: "brazil", region: "brazil" as const };
    });
    const start = addDays("2026-06-01", pick(900));
    const end = addDays(start, pick(150));
    if (start.slice(0, 4) !== end.slice(0, 4)) crossingRuns++;
    assert.deepEqual(analyzeTrip(rule, trips, "italy", start, end), referenceAnalyze(rule, trips, "italy", start, end), "analyzeTrip run " + run);
    const candidate = { region: "italy" as const, ruleId: rule.id };
    const simulation = simulateTrip(rule, trips, { ...candidate, start, end });
    const expected = referenceLaterImpacts(rule, trips, start, end);
    const toMap = (items: typeof simulation.affectedTrips) => new Map(items.map((item): [string, [string, number]] => [item.trip.id, [item.firstOverDate, item.excessDays]]));
    assert.deepEqual(toMap(simulation.affectedTrips), expected.affected, "affected trips run " + run);
    assert.deepEqual(toMap(simulation.worsenedTrips), expected.worsened, "worsened trips run " + run);
    if (expected.affected.size || expected.worsened.size) impactedRuns++;
    const forecast = maxSafeStay(rule, trips, "italy", start);
    if (forecast.lastSafeDate) assert.equal(simulateTrip(rule, trips, { ...candidate, start, end: forecast.lastSafeDate }).safe, true, "last safe date is safe, run " + run);
    if (forecast.firstOverDate) assert.equal(simulateTrip(rule, trips, { ...candidate, start, end: forecast.firstOverDate }).safe, false, "first over date is unsafe, run " + run);
  }
  assert(impactedRuns >= 10 && crossingRuns >= 20, `scenarios cover later-trip impacts (${impactedRuns}) and New Year crossings (${crossingRuns})`);
});

test("regra do catálogo usa os números do catálogo, não os gravados", () => {
  const state = normalizeState({ version: 2, trips: [], rules: [{ id: "italy", label: "Itália", countryCode: "IT", region: "italy", kind: "calendar-year", limit: 182, leapYearLimit: 183, windowDays: 365, warningAt: 150 }] });
  const stored = state?.rules.find((rule) => rule.id === "italy");
  assert.deepEqual(stored, { id: "italy", label: "Itália", countryCode: "IT", region: "italy", limit: 90, windowDays: 180, warningAt: 75 });
  // O alerta escolhido pelo usuário continua valendo quando cabe no limite.
  assert.equal(normalizeState({ version: 2, trips: [], rules: [{ ...stored, warningAt: 60 }] })?.rules.find((rule) => rule.id === "italy")?.warningAt, 60);
});

test("countedRuns: dias contados hoje e quando saem da conta", () => {
  const trips = [italyTrip("a", "2026-05-01", "2026-05-10"), italyTrip("b", "2026-05-11", "2026-05-12"), italyTrip("c", "2026-07-01", "2026-07-05"), italyTrip("old", "2025-01-01", "2025-01-31")];
  assert.deepEqual(countedRuns(italy, trips, "2026-09-28"), [
    { start: "2026-05-01", end: "2026-05-12", days: 12, leavesFrom: "2026-10-28", leavesUntil: "2026-11-08" },
    { start: "2026-07-01", end: "2026-07-05", days: 5, leavesFrom: "2026-12-28", leavesUntil: "2027-01-01" },
  ]);
  assert.equal(statusFor(italy, trips, "2026-10-28").used, 16); // 1º de maio saiu da conta
  // Ano civil: tudo sai em 1º de janeiro.
  assert.deepEqual(countedRuns(italyCalendar, trips, "2026-09-28").map((run) => run.leavesUntil), ["2027-01-01", "2027-01-01"]);
});

test("planItinerary: cada destino começa no último dia do anterior e mostra o máximo possível", () => {
  const plan = planItinerary(DEFAULT_RULES, [], "2027-01-01", [{ ruleId: "italy", country: "Italy", days: 30 }, { ruleId: "brazil", country: "Brazil", days: 60 }]);
  assert.deepEqual(plan.map((leg) => [leg.rule?.id, leg.start, leg.end, leg.days, leg.maxDays, leg.status]), [
    ["italy", "2027-01-01", "2027-01-30", 30, 90, "safe"],
    ["brazil", "2027-01-30", "2027-03-30", 60, 180, "safe"],
  ]);
  // O dia de viagem (30 jan) conta nos dois países e não é conflito.
  assert.equal(plan[1].conflict, undefined);
});

test("planItinerary: janela móvel entre destinos no mesmo país", () => {
  const legs = [{ ruleId: "italy", country: "Italy", days: 100 }, { ruleId: "brazil", country: "Brazil", days: 30 }, { ruleId: "italy", country: "Italy", days: 10 }];
  const over = planItinerary(DEFAULT_RULES, [], "2027-01-01", legs);
  assert.deepEqual([over[0].status, over[0].maxDays, over[0].lastSafeDate], ["over", 90, "2027-03-31"]);
  // Com 90 dias na Itália (1 jan – 31 mar) e 30 no Brasil, a volta à Itália em 29 abr não tem dias: eles só voltam 180 dias depois.
  const full = planItinerary(DEFAULT_RULES, [], "2027-01-01", [{ ...legs[0], days: 90 }, legs[1], legs[2]]);
  assert.deepEqual([full[0].status, full[2].start, full[2].maxDays, full[2].status], ["warning", "2027-04-29", 0, "over"]); // 90 de 90: permitido, em alerta
  // Voltando em 30 jun, 1º de janeiro já saiu da conta; a cada dia na Itália sai mais um dia de janeiro a março, então a
  // conta fica em 90 até 27 set (91 em 28 set): 90 dias possíveis.
  const later = planItinerary(DEFAULT_RULES, [], "2027-01-01", [{ ...legs[0], days: 90 }, { ...legs[1], days: 92 }, legs[2]]);
  assert.deepEqual([later[2].start, later[2].maxDays, later[2].lastSafeDate, later[2].status], ["2027-06-30", 90, "2027-09-27", "warning"]);
});

test("planItinerary: protege viagens salvas mais adiante, aceita destino sem regra e acusa conflito", () => {
  const saved = [italyTrip("saved", "2027-05-01", "2027-05-20")];
  const plan = planItinerary(DEFAULT_RULES, saved, "2027-01-01", [{ ruleId: "italy", country: "Italy", days: 90 }]);
  assert.equal(plan[0].status, "affects"); // 90 + 20 dias na mesma janela
  assert.equal(plan[0].maxDays, 70);
  const bahamas = planItinerary(DEFAULT_RULES, saved, "2027-01-01", [{ country: "Bahamas", days: 40 }, { ruleId: "italy", country: "Italy", days: 10 }]);
  assert.deepEqual([bahamas[0].status, bahamas[0].maxDays, bahamas[1].start], ["none", null, "2027-02-09"]);
  const clash = planItinerary(DEFAULT_RULES, [{ ...trip("br", "brazil", "2027-01-05", "2027-01-20"), ruleId: "brazil" }], "2027-01-01", [{ ruleId: "italy", country: "Italy", days: 10 }]);
  assert.equal(clash[0].status, "conflict");
});

test("itineraryTrips: o itinerário salvo tem as mesmas datas e o mesmo veredito", () => {
  const plan = planItinerary(DEFAULT_RULES, [], "2027-01-01", [{ ruleId: "italy", country: "Italy", days: 30 }, { country: "Bahamas", days: 5 }, { ruleId: "brazil", country: "", days: 20 }]);
  const saved = itineraryTrips(plan, "plan");
  assert.deepEqual(saved.map((item) => [item.id, item.ruleId, item.region, item.country, item.start, item.end]), [
    ["plan-0", "italy", "italy", "Italy", "2027-01-01", "2027-01-30"],
    ["plan-1", undefined, "other", "Bahamas", "2027-01-30", "2027-02-03"],
    ["plan-2", "brazil", "brazil", "Brasil", "2027-02-03", "2027-02-22"],
  ]);
  assert.deepEqual(saved.map((item) => tripStatuses(DEFAULT_RULES, saved).get(item.id)?.status), ["ok", "none", "ok"]);
});

test("dailyCounts: a contagem de cada dia é a mesma de statusFor", () => {
  const random = seededRandom(7);
  const pick = (max: number) => Math.floor(random() * max);
  for (const rule of [italy, brazil, italyCalendar]) {
    const trips: Trip[] = Array.from({ length: 6 }, (_, index) => {
      const start = addDays("2026-01-01", pick(500));
      return { ...trip("t" + index, rule.region, start, addDays(start, pick(60))), ruleId: rule.id };
    });
    const counts = dailyCounts(rule, trips, "2026-03-01", "2027-06-30");
    assert.equal(counts.size, inclusiveDays("2026-03-01", "2027-06-30"));
    for (let day = "2026-03-01"; day <= "2027-06-30"; day = addDays(day, 7)) {
      const status = statusFor(rule, trips, day);
      assert.deepEqual(counts.get(day), { used: status.used, limit: status.limit }, rule.id + " " + day);
    }
  }
});
