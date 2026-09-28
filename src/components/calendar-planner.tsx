"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, earliestEntryFor, findConflicts, formatDate, inclusiveDays, isCalendarYear, limitOn, limitPhrase, maxSafeStay, maxStayLength, ruleForTrip, simulateTrip, statusFor, usageLabel, yearBudget } from "@/lib/rules";
import type { AffectedTrip, MaxSafeStay, TripSimulation, TripStatus } from "@/lib/rules";
import type { Region, Rule, Trip } from "@/lib/types";

type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; today: string; initialRuleId: string; tripStatus: Map<string, TripStatus>; onOpen: (trip: Trip) => void; onSave: (trip: Trip) => boolean };
/** `tripOver`: the day belongs to a saved trip that is over the limit on/after its first over day. */
type DayState = { trip?: Trip; tripOver?: boolean; forecast?: "safe" | "warning" | "last" | "over" | "blocked" };
type DayChoice = { date: string; trip: Trip };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
/** Picker value for a rule-less trip: recorded only to block overlapping dates, never counted toward a limit. */
export const NO_RULE = "none";
export const NO_RULE_LABEL = "Outro (sem regra)";
const MONTH_STEP = 12;
const OVER_PREVIEW_DAYS = 14;

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); return title.charAt(0).toUpperCase() + title.slice(1); }
function monthKey(value: string) { return value.slice(0, 7) + "-01"; }
function shiftMonth(value: string, amount: number) { const date = new Date(value + "T12:00:00Z"); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 10); }
function monthsBetween(start: string, end: string) { const months: string[] = []; for (let month = monthKey(start); month <= monthKey(end); month = shiftMonth(month, 1)) months.push(month); return months; }
function shortDate(value: string) { return formatDate(value, { day: "2-digit", month: "short" }); }
function longDate(value: string) { return formatDate(value, { day: "2-digit", month: "short", year: "numeric" }); }
function plural(count: number, one: string, many: string) { return count + " " + (count === 1 ? one : many); }
/** Default country typed for a rule: built-in regions keep their usual country, custom rules use their own name. */
export function defaultCountry(rule?: Rule) { return !rule ? "" : rule.region === "brazil" ? "Brazil" : rule.region === "italy" || rule.region === "schengen" ? "Italy" : rule.label; }
/** Rule picked by a picker value; an unknown id (e.g. a rule gone after a reload) falls back to the first rule. */
export function ruleForChoice(rules: Rule[], choice: string): Rule | undefined { return choice === NO_RULE ? undefined : rules.find((rule) => rule.id === choice) || rules[0]; }
/** Trip fields that say which rule it counts toward; a rule-less trip is region "other" without a ruleId. */
export function ruleFields(rule?: Rule): Pick<Trip, "ruleId" | "region"> { return rule ? { ruleId: rule.id, region: rule.region } : { region: "other" }; }
function placeLabel(rule: Rule | undefined, country: string) { return rule && rule.region !== "other" ? rule.label : country.trim() || rule?.label || "Outro"; }

/** Badge with a saved trip's own verdict; nothing when it is within the limit or has no rule. */
export function TripStatusBadge({ status }: { status?: TripStatus }) {
  if (status?.status === "over") return <span className="trip-badge over">Excede {plural(status.excessDays, "dia", "dias")}</span>;
  if (status?.status === "warning") return <span className="trip-badge warning">Perto do limite</span>;
  return null;
}

/**
 * Days left under one rule. A calendar-year rule shows this year and next, counting planned trips too, since what matters
 * is the year's total; a rolling rule shows today's window.
 */
function BudgetCard({ rule, trips, today, active }: { rule: Rule; trips: Trip[]; today: string; active: boolean }) {
  const tone = (used: number, limit: number) => used > limit ? "over" : used > 0 && used >= rule.warningAt ? "warning" : "ok";
  const left = (remaining: number, over: boolean) => over ? "acima do limite" : remaining > 0 ? plural(remaining, "dia disponível", "dias disponíveis") : "limite atingido";
  if (isCalendarYear(rule)) {
    const year = Number(today.slice(0, 4));
    const current = yearBudget(rule, trips, year);
    const next = yearBudget(rule, trips, year + 1);
    return <div className={"status-card " + tone(current.used, current.limit) + (active ? " active" : "")}>
      <div className="status-header">{rule.label} · {year}</div>
      <div className="status-numbers"><strong>{current.used}<small> / {current.limit}</small></strong></div>
      <div className="status-label">{left(current.remaining, current.over)}</div>
      <div className="status-next">{year + 1}: {next.over ? "acima do limite" : plural(next.remaining, "dia disponível", "dias disponíveis")}</div>
    </div>;
  }
  const status = statusFor(rule, trips, today);
  return <div className={"status-card " + status.status + (active ? " active" : "")}>
    <div className="status-header">{rule.label} · hoje</div>
    <div className="status-numbers"><strong>{status.used}<small> / {status.limit}</small></strong></div>
    <div className="status-label">{left(status.remaining, status.status === "over")}</div>
    <div className="status-next">{rule.limit} a cada {rule.windowDays} dias</div>
  </div>;
}

function LimitReason({ forecast }: { forecast: MaxSafeStay }) {
  if (forecast.limitedBy !== "later-trip" || !forecast.blockingTrip) return null;
  const blocking = forecast.blockingTrip;
  return <small>Limitado pela viagem de {shortDate(blocking.trip.start)} — {shortDate(blocking.trip.end)} ({blocking.trip.country}), que passaria a exceder ou excederia ainda mais o limite.</small>;
}

function WorsenedLines({ items }: { items: AffectedTrip[] }) {
  return <>{items.map((item) => <small key={item.trip.id} className="forecast-affected">Sua viagem de {shortDate(item.trip.start)} — {longDate(item.trip.end)} ({item.trip.country}) já excede o limite; este plano piora em {plural(item.excessDays, "dia", "dias")}.</small>)}</>;
}

function ForecastCard({ forecast, rule }: { forecast: MaxSafeStay; rule: Rule }) {
  if (!forecast.lastSafeDate) return <div className="forecast-card danger" role="status">
    <span className="forecast-region">{rule.label}</span>
    <strong>Sem dias disponíveis nesta entrada</strong>
    <LimitReason forecast={forecast} />
    {forecast.limitedBy !== "later-trip" && <small>{isCalendarYear(rule) ? "Todos os " + limitOn(rule, forecast.start) + " dias de " + forecast.start.slice(0, 4) + " já estão em uso." : "Todos os " + rule.limit + " dias da janela de " + rule.windowDays + " já estão em uso."}</small>}
  </div>;
  return <div className="forecast-card safe" role="status">
    <span className="forecast-region">{rule.label} · entrada {shortDate(forecast.start)}</span>
    <strong>Pode ficar até <span className="forecast-date">{longDate(forecast.lastSafeDate)}</span></strong>
    <small>{plural(forecast.daysAvailable, "dia disponível", "dias disponíveis")}. Toque no dia de saída.</small>
    {forecast.firstWarningDate && <small className="forecast-warning-line">Entra na zona de alerta em {longDate(forecast.firstWarningDate)} ({rule.warningAt} de {limitOn(rule, forecast.firstWarningDate)} dias).</small>}
    <LimitReason forecast={forecast} />
  </div>;
}

function SelectionSummary({ days, end, simulation, forecast, conflict, rule, onAdjust }: { days: number; end: string; simulation: TripSimulation | null; forecast: MaxSafeStay | null; conflict?: Trip; rule?: Rule; onAdjust: (date: string) => void }) {
  if (conflict) return <div className="forecast-card danger" role="alert"><strong>Conflito de datas</strong><small>Você já tem um período em {conflict.country} entre {shortDate(conflict.start)} e {longDate(conflict.end)}. Uma pessoa não pode estar em dois lugares no mesmo dia.</small></div>;
  if (!rule || !simulation) return <div className="forecast-card neutral" role="status"><strong>{plural(days, "dia", "dias")}</strong><small>Sem regra de limite para este país. O período é registrado para evitar sobreposição, mas não conta para nenhum limite.</small></div>;
  const lastSafe = forecast?.lastSafeDate;
  const worsened = simulation.worsenedTrips.length > 0 ? <WorsenedLines items={simulation.worsenedTrips} /> : null;
  const adjust = lastSafe && simulation.firstOverDate ? <button className="button secondary forecast-action" onClick={() => onAdjust(lastSafe)}>Ajustar saída para {shortDate(lastSafe)}</button> : null;
  const affected = simulation.affectedTrips.map((item) => <small key={item.trip.id} className="forecast-affected">Sua viagem de {shortDate(item.trip.start)} — {shortDate(item.trip.end)} ({item.trip.country}) passaria a exceder em {plural(item.excessDays, "dia", "dias")} a partir de {longDate(item.firstOverDate)}.</small>);
  if (simulation.firstOverDate) return <div className="forecast-card danger" role="alert">
    <strong>{plural(days, "dia", "dias")} · excede em {plural(simulation.excessDays, "dia", "dias")}</strong>
    <small>O {limitPhrase(rule, simulation.firstOverDate)} é ultrapassado em {longDate(simulation.firstOverDate)}.{lastSafe ? " Último dia seguro: " + longDate(lastSafe) + "." : ""}</small>
    {affected}
    {worsened}
    {adjust}
  </div>;
  if (affected.length > 0 || worsened) return <div className="forecast-card danger" role="alert">
    <strong>{plural(days, "dia", "dias")} · {affected.length > 0 ? "afeta viagens futuras" : "piora viagem futura"}</strong>
    {affected}
    {worsened}
    {lastSafe && lastSafe < end && <button className="button secondary forecast-action" onClick={() => onAdjust(lastSafe)}>Ajustar saída para {shortDate(lastSafe)}</button>}
  </div>;
  const slack = lastSafe && lastSafe > end ? inclusiveDays(end, lastSafe) - 1 : 0;
  return <div className={"forecast-card " + (simulation.firstWarningDate ? "warning" : "safe")} role="status">
    <strong>{plural(days, "dia", "dias")} · dentro do limite</strong>
    <small>Pico de {usageLabel(rule, simulation.maxUsed, simulation.maxUsedDate)}.{slack > 0 && lastSafe ? " Ainda sobrariam " + plural(slack, "dia", "dias") + " (até " + shortDate(lastSafe) + ")." : " Você sai exatamente no último dia seguro."}</small>
  </div>;
}

function EarliestEntry({ rule, trips, today, onApply }: { rule: Rule; trips: Trip[]; today: string; onApply: (start: string, end: string) => void }) {
  const [length, setLength] = useState("");
  const [fromInput, setFromInput] = useState(today);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromInput) ? fromInput : today;
  const days = Math.floor(Number(length));
  const valid = length !== "" && days >= 1;
  const result = useMemo(() => valid ? earliestEntryFor(rule, trips, days, from) : null, [valid, rule, trips, days, from]);
  return <details className="earliest-entry">
    <summary>Quando posso ficar N dias em {rule.label}?</summary>
    <div className="earliest-body">
    <label htmlFor="earliest-length">Quero ficar</label>
    <input id="earliest-length" type="number" inputMode="numeric" min="1" max={maxStayLength(rule)} placeholder="30" value={length} onChange={(event) => setLength(event.target.value)} />
    <span>dias em {rule.label}</span>
    <span className="earliest-from"><label htmlFor="earliest-from">a partir de</label><input id="earliest-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} /></span>
    {valid && <p role="status">{days > maxStayLength(rule) ? "Acima do máximo de " + maxStayLength(rule) + " dias." : result ? <>Primeira entrada possível em ou após {longDate(from)}: <strong>{longDate(result.start)}</strong> <button className="text-button" onClick={() => onApply(result.start, result.end)}>Ver no calendário</button></> : "Nenhuma data possível nos 2 anos a partir de " + longDate(from) + "."}</p>}
    </div>
  </details>;
}

function DayChoiceSheet({ choice, startLabel, onEdit, onStart, onClose }: { choice: DayChoice; startLabel: string; onEdit: () => void; onStart: () => void; onClose: () => void }) {
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const buttons = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("button"));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  const { date, trip } = choice;
  return <div className="choice-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className="choice-sheet" role="dialog" aria-modal="true" aria-labelledby="day-choice-title" aria-describedby="day-choice-detail">
      <p className="eyebrow">{formatDate(date, { day: "numeric", month: "long", year: "numeric" })}</p>
      <h3 id="day-choice-title">Este dia já tem uma viagem</h3>
      <p id="day-choice-detail" className="choice-detail">{trip.country} · {shortDate(trip.start)} — {longDate(trip.end)}</p>
      <div className="choice-actions">
        <button className="button secondary" onClick={onEdit}>Editar viagem</button>
        <button className="button primary" onClick={onStart}>{startLabel}</button>
        <button className="button secondary" onClick={onClose}>Cancelar</button>
      </div>
    </section>
  </div>;
}

export function CalendarPlanner({ trips, rules, today, initialRuleId, tripStatus, onOpen, onSave }: CalendarPlannerProps) {
  const [ruleChoice, setRuleChoice] = useState(initialRuleId);
  const [country, setCountry] = useState(() => defaultCountry(ruleForChoice(rules, initialRuleId)));
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [firstMonth, setFirstMonth] = useState(monthKey(today));
  const [lastMonth, setLastMonth] = useState(shiftMonth(monthKey(today), 17));
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [choice, setChoice] = useState<DayChoice | null>(null);
  // Candidate the user already confirmed once despite the warning; any selection change clears it, and it only
  // counts for the saved trips and rules it was given against, so a change there (e.g. after "Editar viagem") re-asks.
  const [confirmed, setConfirmed] = useState<{ key: string; trips: Trip[]; rules: Rule[] } | null>(null);
  const setConfirmedFor = (key: string | null) => setConfirmed(key ? { key, trips, rules } : null);
  const rule = ruleForChoice(rules, ruleChoice);
  const selectedRuleId = rule?.id ?? NO_RULE;
  const { ruleId, region } = ruleFields(rule);
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const candidate = selectedStart && selectedEnd ? { ruleId, region, start: selectedStart, end: selectedEnd } : null;
  const forecast = useMemo(() => rule && selectedStart ? maxSafeStay(rule, trips, rule.region, selectedStart) : null, [rule, trips, selectedStart]);
  const simulation = useMemo(() => rule && candidate ? simulateTrip(rule, trips, candidate) : null, [rule, trips, candidate?.ruleId, candidate?.region, candidate?.start, candidate?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saved trips of another rule overlapping the selection (or the entry day alone, while the exit is still open).
  const overlapping = useMemo(() => selectedStart ? findConflicts(trips, { ruleId, region, start: selectedStart, end: selectedEnd ?? selectedStart }).otherRegion : [], [trips, ruleId, region, selectedStart, selectedEnd]);
  const conflictIds = useMemo(() => new Set(overlapping.map((trip) => trip.id)), [overlapping]);
  const conflict = candidate ? overlapping[0] : undefined;
  const months = monthsBetween(firstMonth, lastMonth);
  const selectedDays = candidate ? inclusiveDays(candidate.start, candidate.end) : 0;
  const candidateKey = candidate ? selectedRuleId + "|" + candidate.start + "|" + candidate.end : null;
  // Unsafe plans that are not over yet need a second click; past trips are records and save at once.
  const needsConfirm = Boolean(candidate && simulation && !simulation.safe && candidate.end >= today);
  const confirming = needsConfirm && confirmed !== null && confirmed.key === candidateKey && confirmed.trips === trips && confirmed.rules === rules;
  // Short verdict repeated in the sticky footer, so the answer stays visible while scrolling the calendar.
  // It carries the full answer (why, and the one-tap fix) because the detailed card above can be scrolled out of view.
  const lastSafe = forecast?.lastSafeDate;
  const firstAffected = simulation?.affectedTrips[0] ?? simulation?.worsenedTrips[0];
  const blocking = forecast?.limitedBy === "later-trip" ? forecast.blockingTrip?.trip : undefined;
  const verdict: { tone: string; text: string; detail?: string } | null = conflict ? { tone: "danger", text: "Conflito com " + conflict.country }
    : simulation ? (simulation.firstOverDate ? { tone: "danger", text: (rule && isCalendarYear(rule) ? simulation.firstOverDate.slice(0, 4) + ": excede" : "Excede") + " em " + plural(simulation.excessDays, "dia", "dias"), detail: "Passa do limite em " + shortDate(simulation.firstOverDate) + (lastSafe ? " · último dia seguro " + shortDate(lastSafe) : "") }
      : simulation.affectedTrips.length > 0 ? { tone: "danger", text: "Afeta viagem futura", detail: firstAffected ? "A viagem de " + shortDate(firstAffected.trip.start) + " (" + firstAffected.trip.country + ") passaria a exceder em " + plural(firstAffected.excessDays, "dia", "dias") : undefined }
      : simulation.worsenedTrips.length > 0 ? { tone: "danger", text: "Piora viagem futura", detail: firstAffected ? "A viagem de " + shortDate(firstAffected.trip.start) + " (" + firstAffected.trip.country + ") já excede; piora em " + plural(firstAffected.excessDays, "dia", "dias") : undefined }
      : { tone: simulation.firstWarningDate ? "warning" : "safe", text: "Dentro do limite", detail: rule ? "Pico de " + usageLabel(rule, simulation.maxUsed, simulation.maxUsedDate) : undefined })
    : start && !end && forecast ? (lastSafe ? { tone: "safe", text: "Pode ficar até " + shortDate(lastSafe), detail: plural(forecast.daysAvailable, "dia disponível", "dias disponíveis") + (blocking ? " · limitado pela viagem de " + shortDate(blocking.start) : "") } : { tone: "danger", text: "Sem dias disponíveis", detail: blocking ? "Limitado pela viagem de " + shortDate(blocking.start) + " (" + blocking.country + ")" : rule ? (isCalendarYear(rule) ? "Todos os " + limitOn(rule, start) + " dias de " + start.slice(0, 4) + " já estão em uso" : "Todos os " + rule.limit + " dias da janela de " + rule.windowDays + " já estão em uso") : undefined })
    : null;
  const adjustTo = !conflict && candidate && simulation && !simulation.safe && lastSafe && lastSafe >= candidate.start && lastSafe < candidate.end ? lastSafe : null;

  const dayStates = useMemo(() => {
    const states = new Map<string, DayState>();
    const rangeStart = firstMonth;
    const rangeEnd = addDays(shiftMonth(lastMonth, 1), -1);
    for (const trip of trips) {
      if (trip.end < rangeStart || trip.start > rangeEnd) continue;
      const status = tripStatus.get(trip.id);
      const overFrom = status?.status === "over" ? status.firstOverDate : undefined;
      for (let date = trip.start > rangeStart ? trip.start : rangeStart; date <= trip.end && date <= rangeEnd; date = addDays(date, 1)) if (!states.has(date)) states.set(date, { trip, tripOver: Boolean(overFrom && date >= overFrom) });
    }
    if (forecast) {
      const mark = (date: string, value: DayState["forecast"]) => states.set(date, { ...states.get(date), forecast: value });
      const warningFrom = forecast.firstWarningDate;
      if (forecast.lastSafeDate) for (let date = forecast.start; date <= forecast.lastSafeDate; date = addDays(date, 1)) mark(date, date === forecast.lastSafeDate ? "last" : warningFrom && date >= warningFrom ? "warning" : "safe");
      // Past the last safe day: "over" when this stay itself exceeds, "blocked" when only a later saved trip would.
      const beyond = forecast.limitedBy === "later-trip" ? "blocked" : "over";
      if (forecast.firstOverDate) for (let offset = 0; offset < OVER_PREVIEW_DAYS; offset++) mark(addDays(forecast.firstOverDate, offset), beyond);
    }
    return states;
  }, [trips, tripStatus, forecast, firstMonth, lastMonth]);

  useEffect(() => {
    if (!scrollTarget) return;
    document.getElementById("month-" + scrollTarget.slice(0, 7))?.scrollIntoView({ behavior: "auto", block: "start" });
    setScrollTarget(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [scrollTarget]);

  function chooseDay(date: string) {
    setConfirmedFor(null);
    if (!start || end) { setStart(date); setEnd(null); return; }
    if (date === start) { setStart(null); setEnd(null); return; }
    setEnd(date);
  }
  function onDay(date: string, trip?: Trip) {
    // While picking an exit, every day is selectable; otherwise a day with a saved trip asks what to do.
    if (start && !end) chooseDay(date);
    else if (trip) setChoice({ date, trip });
    else chooseDay(date);
  }
  const closeChoice = useCallback(() => setChoice(null), []);
  function editChosenTrip() { if (!choice) return; setChoice(null); setConfirmed(null); onOpen(choice.trip); }
  // The last day of a stay elsewhere is a travel day: a new stay in the selected country can start on it (the day counts for
  // both). Any other day of a saved trip starts under that trip's rule, so extending or replanning it is not a conflict.
  const switchesCountry = Boolean(choice && (ruleForTrip(rules, choice.trip)?.id ?? NO_RULE) !== selectedRuleId && choice.date === choice.trip.end && choice.trip.start < choice.trip.end);
  function startAtChosenDay() {
    if (!choice) return;
    const { trip } = choice;
    setChoice(null);
    setConfirmed(null);
    if (!switchesCountry) {
      const tripRule = ruleForTrip(rules, trip);
      setRuleChoice(tripRule?.id ?? NO_RULE);
      setCountry(trip.country || defaultCountry(tripRule));
    }
    setStart(choice.date);
    setEnd(null);
  }
  function clearSelection() { setStart(null); setEnd(null); setConfirmedFor(null); }
  function chooseRule(value?: Rule) { setRuleChoice(value?.id ?? NO_RULE); setCountry(defaultCountry(value)); clearSelection(); }
  function showMonth(value: string) {
    const target = monthKey(value);
    if (target < firstMonth) setFirstMonth(target);
    if (target > lastMonth) setLastMonth(target);
    setScrollTarget(target);
  }
  function applySelection(nextStart: string, nextEnd: string) { setConfirmedFor(null); setStart(nextStart); setEnd(nextEnd); showMonth(nextStart); }
  function adjustEnd(date: string) { setConfirmedFor(null); setEnd(date); }
  function saveSelection() {
    if (!candidate) return;
    if (needsConfirm && !confirming) { setConfirmedFor(candidateKey); return; }
    if (onSave({ id: "trip-" + Date.now(), ...ruleFields(rule), country: country.trim() || placeLabel(rule, country), start: candidate.start, end: candidate.end })) clearSelection();
  }

  return <div className="planner-shell">
    <div className="planner-toolbar">
      <div className="planner-region">
        <span className="planner-label">País ou regime</span>
        <div className="segmented rule-picker" role="group" aria-label="País ou regime">
          {rules.map((item) => <button key={item.id} aria-pressed={selectedRuleId === item.id} className={(selectedRuleId === item.id ? "selected " : "") + "region-option " + item.region} onClick={() => chooseRule(item)}>{item.label}</button>)}
          <button aria-pressed={!rule} className={(!rule ? "selected " : "") + "region-option other"} onClick={() => chooseRule(undefined)}>{NO_RULE_LABEL}</button>
        </div>
      </div>
      {region === "other" && <div className="country-input"><label htmlFor="country-name">País</label><input id="country-name" placeholder="Ex: Bahamas" value={country} onChange={(event) => setCountry(event.target.value)} /></div>}
      {start && <button className="button secondary planner-clear" onClick={clearSelection}>Limpar</button>}
    </div>
    <div className="region-status-cards">
      {rules.map((item) => <BudgetCard key={item.id} rule={item} trips={trips} today={today} active={item.id === selectedRuleId} />)}
    </div>
    {rule ? <EarliestEntry key={rule.id} rule={rule} trips={trips} today={today} onApply={applySelection} /> : !start && <div className="forecast-card neutral"><strong>Sem regra de limite</strong><small>Períodos sem regra são registrados para evitar sobreposição, mas não contam para nenhum limite.</small></div>}
    {!start && rule && <p className="planner-hint">Toque no dia de entrada para ver até quando pode ficar.</p>}
    {start && !end && forecast && rule && <ForecastCard forecast={forecast} rule={rule} />}
    {start && !end && !rule && <div className="forecast-card neutral" role="status"><strong>Entrada em {shortDate(start)}</strong><small>Toque no dia de saída.</small></div>}
    {candidate && <SelectionSummary days={selectedDays} end={candidate.end} simulation={simulation} forecast={forecast} conflict={conflict} rule={rule} onAdjust={adjustEnd} />}
    <div className="month-jump-row">
      <label htmlFor="month-jump">Ir para</label>
      <input type="month" id="month-jump" value={firstMonth.slice(0, 7)} onChange={(event) => event.target.value && showMonth(event.target.value + "-01")} />
      <button className="text-button" onClick={() => showMonth(today)}>Hoje</button>
      <button className="text-button" onClick={() => { const target = shiftMonth(firstMonth, -MONTH_STEP); setFirstMonth(target); setScrollTarget(firstMonth); }}>Meses anteriores</button>
    </div>
    <section className="annual-calendar" aria-label="Calendário de viagens">
      {months.map((month) => <MonthCalendar key={month} month={month} today={today} resetLabel={rule && isCalendarYear(rule) && month.slice(5, 7) === "01" ? rule.label + ": contagem zera" : undefined} dayStates={dayStates} selectedRegion={region} selectedLabel={placeLabel(rule, country)} tripLabel={(trip) => placeLabel(ruleForTrip(rules, trip), trip.country)} conflictIds={conflictIds} selectedStart={selectedStart} selectedEnd={selectedEnd} onDay={onDay} />)}
    </section>
    <button className="button secondary month-more" onClick={() => setLastMonth(shiftMonth(lastMonth, MONTH_STEP))}>Ver mais meses</button>
    <div className={"planner-footer" + (start ? " is-planning" : "")}>
      <div>
        <span className="planner-label">Período</span>
        <strong>{candidate ? shortDate(candidate.start) + " — " + shortDate(candidate.end) + " · " + plural(selectedDays, "dia", "dias") : start ? "Entrada " + shortDate(start) + " — escolha a saída" : "—"}</strong>
        {verdict && <small className={"footer-verdict " + verdict.tone} role="status">{verdict.text}{verdict.detail && <span className="footer-detail">{verdict.detail}</span>}</small>}
      </div>
      <div className="footer-actions">
        {adjustTo && <button className="button secondary" onClick={() => adjustEnd(adjustTo)}>Sair em {shortDate(adjustTo)}</button>}
        <button className={"button primary" + (confirming ? " danger" : "")} onClick={saveSelection} disabled={!candidate || Boolean(conflict)}>{confirming ? "Salvar mesmo assim" : "Salvar"}</button>
      </div>
    </div>
    {trips.length > 0 && <section className="list-section planner-existing">
      <div className="section-heading small">
        <h2>Viagens</h2>
        <span className="count-label">{trips.length}</span>
      </div>
      <div className="trip-list">
        {trips.slice(0, 6).map((trip) => <button className="trip-row" key={trip.id} onClick={() => onOpen(trip)}>
          <span className={"region-marker " + trip.region} />
          <span className="trip-dates">
            <strong>{formatDate(trip.start)} — {formatDate(trip.end)}</strong>
            <small>{trip.country} · {plural(inclusiveDays(trip.start, trip.end), "dia", "dias")}</small>
          </span>
          <TripStatusBadge status={tripStatus.get(trip.id)} />
          <span className="row-chevron">→</span>
        </button>)}
      </div>
    </section>}
    {choice && <DayChoiceSheet choice={choice} startLabel={switchesCountry ? "Entrar em " + placeLabel(rule, country) + " neste dia" : "Começar entrada aqui"} onEdit={editChosenTrip} onStart={startAtChosenDay} onClose={closeChoice} />}
  </div>;
}

function MonthCalendar({ month, today, resetLabel, dayStates, selectedRegion, selectedLabel, tripLabel, conflictIds, selectedStart, selectedEnd, onDay }: { month: string; today: string; resetLabel?: string; dayStates: Map<string, DayState>; selectedRegion: Region; selectedLabel: string; tripLabel: (trip: Trip) => string; conflictIds: Set<string>; selectedStart: string | null; selectedEnd: string | null; onDay: (date: string, trip?: Trip) => void }) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const numberOfDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + numberOfDays }, (_, index) => index < offset ? null : index - offset + 1);
  let hasTrips = false;
  const days = cells.map((day, index) => {
    if (!day) return <span key={index} className="annual-day empty" aria-hidden="true" />;
    const date = keyFor(year, monthIndex, day);
    const state = dayStates.get(date);
    const trip = state?.trip;
    if (trip) hasTrips = true;
    const selected = Boolean(selectedStart && (selectedEnd ? date >= selectedStart && date <= selectedEnd : date === selectedStart));
    const conflict = Boolean(selected && trip && conflictIds.has(trip.id));
    const tripName = trip ? tripLabel(trip) : "";
    const label = [
      formatDate(date, { day: "numeric", month: "long", year: "numeric" }),
      trip ? "período registrado em " + tripName : "",
      selected ? "selecionado para " + selectedLabel : "",
      state?.forecast === "last" ? "último dia seguro" : state?.forecast === "warning" ? "zona de alerta" : state?.forecast === "over" ? "acima do limite" : state?.forecast === "blocked" ? "limite por viagem futura" : "",
      state?.tripOver ? "viagem acima do limite" : "",
      conflict ? "sobreposição com outro período" : "",
    ].filter(Boolean).join("; ");
    const classes = "annual-day"
      + (trip ? " has-trip " + trip.region : "")
      + (state?.tripOver ? " trip-over" : "")
      + (state?.forecast ? " forecast-" + state.forecast : "")
      + (selected ? " selected-range selected-" + selectedRegion : "")
      + (selectedStart === date ? " selected-start" : "")
      + (selectedEnd === date ? " selected-end" : "")
      + (conflict ? " overlap-conflict" : "")
      + (date === today ? " today" : "");
    return <button key={index} className={classes} aria-label={label} aria-pressed={selected} onClick={() => onDay(date, trip)}>{day}<span className="day-dot" />{conflict && <span className="conflict-mark" aria-hidden="true">!</span>}</button>;
  });
  return <section id={"month-" + month.slice(0, 7)} className="year-month">
    <div className="year-month-header"><h3>{monthTitle(year, monthIndex)}</h3>{resetLabel ? <span className="year-reset">{resetLabel}</span> : <span>{hasTrips ? "com registros" : ""}</span>}</div>
    <div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div>
    <div className="year-month-grid">{days}</div>
  </section>;
}
