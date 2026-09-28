"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, dailyCounts, formatDate, itineraryTrips, planItinerary, ruleForTrip, usageLabel } from "@/lib/rules";
import { MonthCalendar, type DayState } from "@/components/calendar-planner";
import type { ItineraryLeg, LegPlan } from "@/lib/rules";
import type { Rule, Trip } from "@/lib/types";

type Props = { rules: Rule[]; trips: Trip[]; today: string; onClose: () => void; onSave: (trips: Trip[]) => void };
const NO_RULE = "none";
const DEFAULT_DAYS = 30;

function shortDate(value: string) { return formatDate(value, { day: "2-digit", month: "short" }); }
function longDate(value: string) { return formatDate(value, { day: "2-digit", month: "short", year: "numeric" }); }
function plural(count: number, one: string, many: string) { return count + " " + (count === 1 ? one : many); }
function countryFor(rule?: Rule) { return !rule ? "" : rule.region === "brazil" ? "Brazil" : rule.region === "italy" || rule.region === "schengen" ? "Italy" : rule.label; }

/** Leg under `ruleId` sized to the longest stay possible after `legs` (or a default when the place has no limit). */
function nextLeg(rules: Rule[], trips: Trip[], start: string, legs: ItineraryLeg[], ruleId: string | undefined): ItineraryLeg {
  const rule = rules.find((item) => item.id === ruleId);
  const leg = { ruleId: rule?.id, country: countryFor(rule), days: 1 };
  const maxDays = planItinerary(rules, trips, start, legs.concat(leg))[legs.length].maxDays;
  return { ...leg, days: maxDays === null ? DEFAULT_DAYS : Math.max(1, maxDays) };
}

function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  for (let year = Number(start.slice(0, 4)), month = Number(start.slice(5, 7)); months.length < 24; month++) {
    if (month > 12) { month = 1; year++; }
    const key = year + "-" + String(month).padStart(2, "0") + "-01";
    if (key > end) break;
    months.push(key);
  }
  return months;
}

/** The itinerary drawn on month calendars: each day in its country's color with that day's count, red when over. */
function ItineraryCalendar({ rules, trips, plan, today }: { rules: Rule[]; trips: Trip[]; plan: LegPlan[]; today: string }) {
  const states = useMemo(() => {
    const planned = itineraryTrips(plan, "preview");
    const all = trips.concat(planned);
    const from = plan[0].start.slice(0, 8) + "01";
    const to = plan[plan.length - 1].end;
    const counts = new Map(rules.map((rule) => [rule.id, dailyCounts(rule, all, from, to)]));
    const result = new Map<string, DayState>();
    for (const trip of planned.concat(trips)) {
      const rule = ruleForTrip(rules, trip);
      for (let date = trip.start > from ? trip.start : from; date <= trip.end && date <= to; date = addDays(date, 1)) {
        if (result.has(date)) continue;
        const count = rule ? counts.get(rule.id)?.get(date) : undefined;
        result.set(date, { trip, count: count && rule ? { ...count, warningAt: rule.warningAt } : undefined });
      }
    }
    return result;
  }, [rules, trips, plan]);
  const months = monthsBetween(plan[0].start.slice(0, 8) + "01", plan[plan.length - 1].end);
  return <div className="itinerary-months annual-calendar">
    {months.map((month) => <MonthCalendar key={month} month={month} today={today} dayStates={states} selectedRegion="other" selectedLabel="" tripLabel={(trip) => ruleForTrip(rules, trip)?.label ?? trip.country} conflictIds={new Set()} selectedStart={null} selectedEnd={null} onDay={() => undefined} />)}
  </div>;
}

function Verdict({ leg }: { leg: LegPlan }) {
  const max = leg.maxDays !== null ? plural(leg.maxDays, "dia", "dias") : "";
  if (leg.status === "conflict" && leg.conflict) return <p className="leg-verdict danger" role="status">Conflito com {leg.conflict.country} ({shortDate(leg.conflict.start)} — {shortDate(leg.conflict.end)}). Mude a data de saída ou os dias anteriores.</p>;
  if (leg.status === "none") return <p className="leg-verdict neutral" role="status">Sem limite de dias para {leg.country || "este lugar"}. O período só evita sobreposição.</p>;
  if (!leg.rule || !leg.simulation) return null;
  if (leg.maxDays === 0) return <p className="leg-verdict danger" role="status">Sem dias disponíveis em {leg.rule.label} a partir de {shortDate(leg.start)}. Chegue mais tarde ou fique menos antes.</p>;
  if (leg.status === "over") return <p className="leg-verdict danger" role="status">Excede em {plural(leg.simulation.excessDays, "dia", "dias")}. O máximo aqui é {max} (até {shortDate(leg.lastSafeDate!)}).</p>;
  if (leg.status === "affects") {
    const later = leg.simulation.affectedTrips[0] ?? leg.simulation.worsenedTrips[0];
    return <p className="leg-verdict danger" role="status">Faz a viagem de {later ? shortDate(later.trip.start) + " (" + later.trip.country + ")" : "depois"} passar do limite. O máximo aqui é {max}.</p>;
  }
  return <p className={"leg-verdict " + (leg.status === "warning" ? "warning" : "safe")} role="status">✓ Dentro do limite · pico de {usageLabel(leg.rule, leg.simulation.maxUsed, leg.simulation.maxUsedDate)}.</p>;
}

/**
 * Plan a trip as a sequence of destinations: each starts on the day the previous one ends and shows at once the longest
 * possible stay there. All numbers come from planItinerary.
 */
export function ItineraryPlanner({ rules, trips, today, onClose, onSave }: Props) {
  const lastEnd = trips.reduce((latest, trip) => trip.end > latest ? trip.end : latest, "");
  const [start, setStart] = useState(lastEnd >= today ? addDays(lastEnd, 1) : today);
  const [legs, setLegs] = useState<ItineraryLeg[]>(() => {
    // Start with the place the last saved trip was not in: the usual next stop.
    const last = trips.slice().sort((a, b) => b.end.localeCompare(a.end))[0];
    const lastRule = last ? ruleForTrip(rules, last) : undefined;
    const first = rules.find((rule) => rule.id !== lastRule?.id) ?? rules[0];
    return [nextLeg(rules, trips, lastEnd >= today ? addDays(lastEnd, 1) : today, [], first?.id)];
  });
  const [confirming, setConfirming] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : today;
  const plan = useMemo(() => planItinerary(rules, trips, validStart, legs), [rules, trips, validStart, legs]);
  const blocked = plan.some((leg) => leg.status === "conflict");
  const risky = plan.some((leg) => leg.status === "over" || leg.status === "affects");
  const finalDay = plan.length ? plan[plan.length - 1].end : validStart;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  function update(index: number, change: Partial<ItineraryLeg>) { setConfirming(false); setLegs((current) => current.map((leg, other) => other === index ? { ...leg, ...change } : leg)); }
  function setDays(index: number, days: number) { update(index, { days: Math.max(1, Math.min(999, Math.floor(days) || 1)) }); }
  function chooseRule(index: number, ruleId: string) {
    const rule = rules.find((item) => item.id === ruleId);
    update(index, { ruleId: rule?.id, country: countryFor(rule) });
  }
  function addLeg() {
    setConfirming(false);
    const previous = legs[legs.length - 1];
    const next = rules.find((rule) => rule.id !== previous?.ruleId) ?? rules[0];
    setLegs((current) => current.concat(nextLeg(rules, trips, validStart, current, next?.id)));
  }
  function removeLeg(index: number) { setConfirming(false); setLegs((current) => current.filter((_, other) => other !== index)); }
  function save() {
    if (blocked) return;
    if (risky && !confirming) { setConfirming(true); return; }
    onSave(itineraryTrips(plan, "trip-" + Date.now()));
  }

  return <div className="modal-backdrop itinerary-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className="modal itinerary-sheet" role="dialog" aria-modal="true" aria-labelledby="itinerary-title">
      <div className="modal-header">
        <div><p className="eyebrow">PLANEJAR VIAGEM</p><h2 id="itinerary-title">Quanto tempo posso ficar em cada lugar?</h2></div>
        <button className="circle-button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <p className="itinerary-intro">Monte os destinos na ordem. Cada um começa no dia em que o anterior termina e já vem com o máximo possível — ajuste os dias e veja na hora se cabe.</p>
      <label className="itinerary-start"><span>Começa em</span><input type="date" value={start} onChange={(event) => { setConfirming(false); setStart(event.target.value); }} /></label>

      {plan.length > 1 && <div className="itinerary-timeline" aria-hidden="true">
        {plan.map((leg, index) => <span key={index} className={"timeline-part " + (leg.rule?.region ?? "other") + (leg.status === "over" || leg.status === "affects" || leg.status === "conflict" ? " danger" : "")} style={{ flexGrow: leg.days }}>{leg.rule?.label ?? (leg.country || "Outro")} · {leg.days}</span>)}
      </div>}

      <ol className="leg-list">
        {plan.map((leg, index) => {
          const input = legs[index];
          const sliderMax = Math.max(leg.maxDays ?? 0, input.days, 30) + 30;
          return <li key={index} className={"leg-card " + leg.status}>
            <div className="leg-head">
              <span className="leg-index">{index + 1}</span>
              <div className="segmented rule-picker" role="group" aria-label={"Destino " + (index + 1)}>
                {rules.map((rule) => <button key={rule.id} aria-pressed={input.ruleId === rule.id} className={(input.ruleId === rule.id ? "selected " : "") + "region-option " + rule.region} onClick={() => chooseRule(index, rule.id)}>{rule.label}</button>)}
                <button aria-pressed={!input.ruleId} className={(!input.ruleId ? "selected " : "") + "region-option other"} onClick={() => chooseRule(index, NO_RULE)}>Outro</button>
              </div>
              {legs.length > 1 && <button className="circle-button leg-remove" onClick={() => removeLeg(index)} aria-label={"Remover destino " + (index + 1)}>×</button>}
            </div>
            {!input.ruleId && <label className="leg-country"><span>País</span><input value={input.country} placeholder="Ex: Bahamas" onChange={(event) => update(index, { country: event.target.value })} /></label>}
            <div className="leg-dates"><strong>{shortDate(leg.start)} → {longDate(leg.end)}</strong></div>
            <div className="leg-stepper">
              <button className="circle-button" onClick={() => setDays(index, input.days - 1)} aria-label="Um dia a menos">−</button>
              <label><input type="number" inputMode="numeric" min="1" value={input.days} onChange={(event) => setDays(index, Number(event.target.value))} aria-label={"Dias no destino " + (index + 1)} /><span>{input.days === 1 ? "dia" : "dias"}</span></label>
              <button className="circle-button" onClick={() => setDays(index, input.days + 1)} aria-label="Um dia a mais">+</button>
            </div>
            <input className="leg-slider" type="range" min="1" max={sliderMax} value={Math.min(input.days, sliderMax)} onChange={(event) => setDays(index, Number(event.target.value))} aria-label={"Ajustar dias no destino " + (index + 1)} />
            {leg.maxDays !== null && leg.maxDays > 0 && <div className="leg-max"><span>Máximo possível: <strong>{plural(leg.maxDays, "dia", "dias")}</strong> (até {shortDate(leg.lastSafeDate!)})</span>{input.days !== leg.maxDays && <button className="text-button" onClick={() => setDays(index, leg.maxDays!)}>Usar máximo</button>}</div>}
            <Verdict leg={leg} />
          </li>;
        })}
      </ol>
      <button className="button secondary itinerary-add" onClick={addLeg}>＋ Adicionar destino</button>
      <details className="itinerary-preview">
        <summary>Ver no calendário</summary>
        <p>Cada dia mostra a conta daquele dia: quantos dias no país dentro da janela (Itália 180, Brasil 360). Vermelho passa do limite.</p>
        <ItineraryCalendar rules={rules} trips={trips} plan={plan} today={today} />
      </details>

      <div className="itinerary-footer">
        <div><span className="planner-label">Itinerário</span><strong>{shortDate(validStart)} → {longDate(finalDay)} · {plural(plan.length, "destino", "destinos")}</strong>{blocked ? <small className="footer-verdict danger">Resolva o conflito para salvar</small> : risky ? <small className="footer-verdict danger">Há destino acima do limite</small> : <small className="footer-verdict safe">Tudo dentro do limite</small>}</div>
        <button className={"button primary" + (confirming ? " danger" : "")} disabled={blocked} onClick={save}>{confirming ? "Salvar mesmo assim" : "Salvar no calendário"}</button>
      </div>
    </section>
  </div>;
}
