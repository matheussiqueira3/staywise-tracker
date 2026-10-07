"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_RULE_DAYS, addDays, dailyCounts, displayCountry, formatDate, inclusiveDays, itineraryTrips, planItinerary, ruleForTrip, usageLabel } from "@/lib/rules";
import { HowItWorks, MonthCalendar, type DayState } from "@/components/calendar-planner";
import type { ItineraryLeg, LegPlan } from "@/lib/rules";
import type { Rule, Trip } from "@/lib/types";

/** `initial`: an itinerary loaded from saved trips (`tripIds`), which saving replaces; `trips` must not include them. */
type Props = { rules: Rule[]; trips: Trip[]; today: string; initial?: { start: string; legs: ItineraryLeg[]; tripIds: string[] }; startAt?: { date: string; ruleId?: string }; onClose: () => void; onSave: (trips: Trip[], replaces: string[]) => void };
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
    {months.map((month) => <MonthCalendar key={month} month={month} today={today} dayStates={states} tripLabel={(trip) => ruleForTrip(rules, trip)?.label ?? displayCountry(trip.country)} />)}
  </div>;
}

/** When a leg does not fit: the first arrival date that works, and two ways to arrive then. */
function FitsFrom({ leg, previous, onStayLonger, onInsertStop }: { leg: LegPlan; previous?: LegPlan; onStayLonger: (date: string) => void; onInsertStop: (date: string) => void }) {
  if (leg.fitsFrom === undefined || !leg.rule) return null;
  if (leg.fitsFrom === null) return <p className="leg-fits">Nenhuma data nos próximos 2 anos comporta {plural(leg.days, "dia", "dias")} seguidos em {leg.rule.label}.</p>;
  const date = leg.fitsFrom;
  return <div className="leg-fits">
    <p>Para ficar {plural(leg.days, "dia", "dias")} em {leg.rule.label}, chegue a partir de <strong>{longDate(date)}</strong> — os dias antigos já terão saído da conta.</p>
    <div className="leg-fits-actions">
      <button className="button secondary" onClick={() => onStayLonger(date)}>{previous ? "Ficar mais em " + (previous.rule?.label ?? (displayCountry(previous.country) || "Outro")) + " até " + shortDate(date) : "Começar em " + shortDate(date)}</button>
      <button className="button secondary" onClick={() => onInsertStop(date)}>＋ Outro lugar até {shortDate(date)}</button>
    </div>
  </div>;
}

/** Number of days: the field can be cleared and retyped; only whole numbers from 1 change the plan. */
function DaysInput({ value, label, onChange }: { value: number; label: string; onChange: (days: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input type="number" inputMode="numeric" min="1" max={MAX_RULE_DAYS} value={draft ?? String(value)} aria-label={label} onBlur={() => setDraft(null)} onChange={(event) => {
    setDraft(event.target.value);
    const days = Number(event.target.value);
    if (Number.isInteger(days) && days >= 1 && days <= MAX_RULE_DAYS) onChange(days);
  }} />;
}

/** The projection for the next move: arriving elsewhere on this leg's last day (the travel day), how long each place allows. */
function NextStep({ leg }: { leg: LegPlan }) {
  const others = leg.next.filter((item) => item.rule.id !== leg.rule?.id);
  if (others.length === 0) return null;
  return <p className="leg-next"><span>Ao sair, em {shortDate(leg.end)}:</span> {others.map((item) => <strong key={item.rule.id} className={item.days === 0 ? "none" : ""}>{item.rule.label} {item.days === null ? "sem limite contínuo" : item.lastSafeDate ? plural(item.days, "dia", "dias") + " (até " + shortDate(item.lastSafeDate) + ")" : item.returnsOn ? "só a partir de " + shortDate(item.returnsOn) : "sem dias"}</strong>)}</p>;
}

function Verdict({ leg }: { leg: LegPlan }) {
  const max = leg.maxDays !== null ? plural(leg.maxDays, "dia", "dias") : "";
  if (leg.status === "conflict" && leg.conflict) return <p className="leg-verdict danger" role="status">Conflito com {displayCountry(leg.conflict.country)} ({shortDate(leg.conflict.start)} — {shortDate(leg.conflict.end)}), já salva. Mude a data de início ou os dias dos destinos anteriores.</p>;
  if (leg.status === "none") return <p className="leg-verdict neutral" role="status">Sem limite de dias para {displayCountry(leg.country) || "este lugar"}. O período só evita sobreposição.</p>;
  if (!leg.rule || !leg.simulation) return null;
  if (leg.maxDays === 0) return <p className="leg-verdict danger" role="status">Sem dias disponíveis em {leg.rule.label} a partir de {longDate(leg.start)}{leg.fitsFrom ? "" : ". Chegue mais tarde ou fique menos antes"}.</p>;
  if (leg.status === "over") return <p className="leg-verdict danger" role="status">Excede em {plural(leg.simulation.excessDays, "dia", "dias")}. O máximo aqui é {max} (até {shortDate(leg.lastSafeDate!)}).</p>;
  if (leg.status === "affects") {
    const later = leg.simulation.affectedTrips[0] ?? leg.simulation.worsenedTrips[0];
    return <p className="leg-verdict danger" role="status">Faz a viagem de {later ? shortDate(later.trip.start) + " (" + displayCountry(later.trip.country) + ")" : "depois"} passar do limite. O máximo aqui é {max}.</p>;
  }
  return <p className={"leg-verdict " + (leg.status === "warning" ? "warning" : "safe")} role="status">✓ Dentro do limite{leg.status === "warning" ? ", perto do máximo" : ""} · pico de {usageLabel(leg.rule, leg.simulation.maxUsed, leg.simulation.maxUsedDate)}.</p>;
}

/**
 * Plan a trip as a sequence of destinations: each starts on the day the previous one ends and shows at once the longest
 * possible stay there. All numbers come from planItinerary.
 */
export function ItineraryPlanner({ rules, trips, today, initial, startAt, onClose, onSave }: Props) {
  // A new plan starts where the saved ones end, in the other place: on the travel day itself, which counts for both.
  const [defaults] = useState(() => {
    const last = trips.filter((trip) => trip.end >= today).sort((a, b) => b.end.localeCompare(a.end))[0];
    const lastRule = last ? ruleForTrip(rules, last) : undefined;
    const first = (startAt?.ruleId ? rules.find((rule) => rule.id === startAt.ruleId) : undefined) ?? rules.find((rule) => rule.id !== lastRule?.id) ?? rules[0];
    const from = startAt?.date ?? (last ? last.end : today);
    return { start: from, leg: nextLeg(rules, trips, from, [], first?.id) };
  });
  const [start, setStart] = useState(initial?.start ?? defaults.start);
  const [legs, setLegs] = useState<ItineraryLeg[]>(initial?.legs ?? [defaults.leg]);
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
    // The page behind the sheet must not scroll while planning.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus(); };
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
  /** Arrive at leg `index` on `date` by staying longer in the leg before it (or starting later, for the first leg). */
  function stayLonger(index: number, date: string) {
    const extra = inclusiveDays(plan[index].start, date) - 1;
    if (index === 0) { setConfirming(false); setStart(date); return; }
    update(index - 1, { days: legs[index - 1].days + extra });
  }
  /** Arrive at leg `index` on `date` through a stop without a day limit (e.g. home in the Bahamas). */
  function insertStop(index: number, date: string) {
    setConfirming(false);
    const stop = { country: "Bahamas", days: inclusiveDays(plan[index].start, date) };
    setLegs((current) => current.slice(0, index).concat(stop, current.slice(index)));
  }
  function removeLeg(index: number) { setConfirming(false); setLegs((current) => current.filter((_, other) => other !== index)); }
  function save() {
    if (blocked) return;
    if (risky && !confirming) { setConfirming(true); return; }
    onSave(itineraryTrips(plan, "trip-" + Date.now()), initial?.tripIds ?? []);
  }

  return <div className="modal-backdrop itinerary-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className="modal itinerary-sheet" role="dialog" aria-modal="true" aria-labelledby="itinerary-title">
      <div className="modal-header">
        <div><p className="eyebrow">{initial ? "EDITAR ITINERÁRIO" : "PLANEJAR VIAGEM"}</p><h2 id="itinerary-title">Quanto tempo posso ficar em cada lugar?</h2></div>
        <button className="circle-button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <p className="itinerary-intro">{initial ? "Este é o seu plano à frente. Ajuste os dias; ao salvar, ele substitui as viagens originais." : "Monte os destinos na ordem. Cada um começa no dia em que o anterior termina (o dia da viagem conta nos dois) e já vem com o máximo possível — ajuste os dias e veja na hora se cabe."}</p>
      <label className="itinerary-start"><span>Começa em</span><input type="date" value={start} onChange={(event) => { setConfirming(false); setStart(event.target.value); }} /></label>

      {plan.length > 1 && <div className="itinerary-timeline" aria-hidden="true">
        {plan.map((leg, index) => <span key={index} className={"timeline-part " + (leg.rule?.region ?? "other") + (leg.status === "over" || leg.status === "affects" || leg.status === "conflict" ? " danger" : "")} style={{ flexGrow: leg.days }}>{leg.rule?.label ?? (displayCountry(leg.country) || "Outro")} · {leg.days}</span>)}
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
              <label><DaysInput value={input.days} label={"Dias no destino " + (index + 1)} onChange={(days) => setDays(index, days)} /><span>{input.days === 1 ? "dia" : "dias"}</span></label>
              <button className="circle-button" onClick={() => setDays(index, input.days + 1)} aria-label="Um dia a mais">+</button>
            </div>
            <input className="leg-slider" type="range" min="1" max={sliderMax} value={Math.min(input.days, sliderMax)} onChange={(event) => setDays(index, Number(event.target.value))} aria-label={"Ajustar dias no destino " + (index + 1)} />
            {leg.maxDays !== null && leg.maxDays > 0 && <div className="leg-max"><span>Máximo possível: <strong>{plural(leg.maxDays, "dia", "dias")}</strong> (até {shortDate(leg.lastSafeDate!)})</span>{input.days !== leg.maxDays && <button className="text-button" onClick={() => setDays(index, leg.maxDays!)}>Usar máximo</button>}</div>}
            <Verdict leg={leg} />
            <FitsFrom leg={leg} previous={plan[index - 1]} onStayLonger={(date) => stayLonger(index, date)} onInsertStop={(date) => insertStop(index, date)} />
            <NextStep leg={leg} />
          </li>;
        })}
      </ol>
      <button className="button secondary itinerary-add" onClick={addLeg}>＋ Adicionar destino</button>
      <details className="itinerary-preview">
        <summary>Como a conta funciona</summary>
        {rules.filter((rule) => legs.some((leg) => leg.ruleId === rule.id)).map((rule) => <HowItWorks key={rule.id} rule={rule} trips={trips} today={today} />)}
      </details>
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
