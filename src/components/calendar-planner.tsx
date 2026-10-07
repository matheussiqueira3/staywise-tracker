"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, countedRuns, dailyCounts, dayOverview, displayCountry, formatDate, isCalendarYear, ruleForTrip, statusFor, yearBudget } from "@/lib/rules";
import type { Projection, TripStatus } from "@/lib/rules";
import type { Rule, Trip } from "@/lib/types";

/**
 * The calendar only shows: counts on stay days and, for a tapped day, the count and projection of every country.
 * Creating and editing plans happens in the planner (`onPlanFrom`) or the trip form (`onOpen`).
 * `focus`: a date to bring into view (a new object each time, e.g. after saving an itinerary).
 */
type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; today: string; tripStatus: Map<string, TripStatus>; focus?: { date: string }; onOpen: (trip: Trip) => void; onPlanFrom: (date: string, ruleId?: string) => void };
/**
 * What a calendar day shows. `count`: days in the counting window ending that day, under the rule of the stay on it.
 * `inWindow` / `inspected`: the window behind an inspected day ("Ver a conta").
 */
export type DayState = { trip?: Trip; tripOver?: boolean; count?: { used: number; limit: number; warningAt: number }; inWindow?: boolean; inspected?: boolean };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
/** Picker value for a rule-less trip: recorded only to block overlapping dates, never counted toward a limit. */
export const NO_RULE = "none";
export const NO_RULE_LABEL = "Outro (sem regra)";
const MONTH_STEP = 12;

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); return title.charAt(0).toUpperCase() + title.slice(1); }
function monthKey(value: string) { return value.slice(0, 7) + "-01"; }
function shiftMonth(value: string, amount: number) { const date = new Date(value + "T12:00:00Z"); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 10); }
function monthsBetween(start: string, end: string) { const months: string[] = []; for (let month = monthKey(start); month <= monthKey(end); month = shiftMonth(month, 1)) months.push(month); return months; }
function shortDate(value: string) { return formatDate(value, { day: "2-digit", month: "short" }); }
/** Start of a counting window: with the year when it is not the year of the day it ends on. */
function windowStartDate(start: string, end: string) { return start.slice(0, 4) === end.slice(0, 4) ? shortDate(start) : longDate(start); }
function longDate(value: string) { return formatDate(value, { day: "2-digit", month: "short", year: "numeric" }); }
function plural(count: number, one: string, many: string) { return count + " " + (count === 1 ? one : many); }
/** Default country typed for a rule: built-in regions keep their usual country, custom rules use their own name. */
export function defaultCountry(rule?: Rule) { return !rule ? "" : rule.region === "brazil" ? "Brazil" : rule.region === "italy" || rule.region === "schengen" ? "Italy" : rule.label; }
/** Rule picked by a picker value; an unknown id (e.g. a rule gone after a reload) falls back to the first rule. */
export function ruleForChoice(rules: Rule[], choice: string): Rule | undefined { return choice === NO_RULE ? undefined : rules.find((rule) => rule.id === choice) || rules[0]; }
/** Trip fields that say which rule it counts toward; a rule-less trip is region "other" without a ruleId. */
export function ruleFields(rule?: Rule): Pick<Trip, "ruleId" | "region"> { return rule ? { ruleId: rule.id, region: rule.region } : { region: "other" }; }

/** Badge with a saved trip's own verdict; nothing when it is within the limit or has no rule. */
export function TripStatusBadge({ status }: { status?: TripStatus }) {
  if (status?.status === "over") return <span className="trip-badge over">Excede {plural(status.excessDays, "dia", "dias")}</span>;
  if (status?.status === "warning") return <span className="trip-badge warning">Perto do limite</span>;
  return null;
}


/** Plain-language explanation of how a rule counts, with today's numbers and when the counted days stop counting. */
export function HowItWorks({ rule, trips, today }: { rule: Rule; trips: Trip[]; today: string }) {
  const status = statusFor(rule, trips, today);
  const runs = countedRuns(rule, trips, today);
  const calendar = isCalendarYear(rule);
  return <details className="how-it-works">
    <summary>Como a conta de {rule.label} funciona</summary>
    <ol>
      <li>{calendar ? "Em cada dia, o app soma os dias em " + rule.label + " desde 1º de janeiro." : "Em cada dia, o app olha para trás " + rule.windowDays + " dias, incluindo o próprio dia, e soma os dias em " + rule.label + "."} Entrada, saída e dia de viagem contam como dias inteiros.</li>
      <li>O máximo é {status.limit} dias: chegar a {status.limit} é permitido, {status.limit + 1} passa do limite.</li>
      <li>Hoje: de {longDate(status.windowStart)} até {longDate(today)} são <strong>{plural(status.used, "dia", "dias")}</strong>, então restam <strong>{status.remaining}</strong>.</li>
      {runs.length > 0 && <li>{calendar ? "Os dias deste ano saem da conta em 1º de janeiro:" : "Cada dia sai da conta " + rule.windowDays + " dias depois:"}<ul>{runs.map((run) => <li key={run.start}>{run.start === run.end ? shortDate(run.start) : shortDate(run.start) + " — " + shortDate(run.end)} ({plural(run.days, "dia", "dias")}) → {run.leavesFrom === run.leavesUntil ? "sai em " + longDate(run.leavesFrom) : "saem entre " + shortDate(run.leavesFrom) + " e " + longDate(run.leavesUntil)}</li>)}</ul></li>}
      <li>Para planejar, toque no dia de entrada: o app mostra o último dia em que a conta fica em {status.limit} ou menos, contando também as viagens já planejadas.</li>
    </ol>
  </details>;
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
    <div className="status-header">{rule.label} · últimos {rule.windowDays} dias</div>
    <div className="status-numbers"><strong>{status.used}<small> / {status.limit}</small></strong></div>
    <div className="status-label">{left(status.remaining, status.status === "over")} hoje</div>
    <div className="status-next">Conta de {windowStartDate(status.windowStart, today)} até hoje</div>
  </div>;
}


/** One country's line in the day panel: its count that day and the projection of a stay from that day. */
function ProjectionLine({ rule, used, limit, projection, active, onSelect }: { rule: Rule; used: number; limit: number; projection: Projection; active: boolean; onSelect: () => void }) {
  const answer = projection.days === null ? "sem limite contínuo por esta regra"
    : projection.lastSafeDate ? "pode ficar até " + shortDate(projection.lastSafeDate) + " (" + plural(projection.days, "dia", "dias") + ")"
    : projection.returnsOn ? "sem dias livres · voltam em " + shortDate(projection.returnsOn) : "sem dias livres nos próximos 2 anos";
  const unavailable = projection.days === 0;
  return <button className={"day-rule" + (active ? " active" : "") + (unavailable ? " none" : "")} aria-pressed={active} onClick={onSelect}>
    <span className="day-rule-name">{rule.label}</span>
    <span className="day-rule-count">{used}/{limit} na conta</span>
    <span className="day-rule-answer">{answer}</span>
  </button>;
}

export function CalendarPlanner({ trips, rules, today, tripStatus, focus, onOpen, onPlanFrom }: CalendarPlannerProps) {
  const [firstMonth, setFirstMonth] = useState(monthKey(today));
  const [lastMonth, setLastMonth] = useState(shiftMonth(monthKey(today), 17));
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  // The tapped day, and the country whose counting window is underlined behind it.
  const [selected, setSelected] = useState<string | null>(null);
  const [windowRuleId, setWindowRuleId] = useState<string | null>(null);
  const months = monthsBetween(firstMonth, lastMonth);
  const overview = useMemo(() => selected ? dayOverview(rules, trips, selected) : null, [rules, trips, selected]);
  const windowRule = rules.find((item) => item.id === windowRuleId) ?? (selected ? defaultWindowRule(selected) : undefined);
  const windowStatus = selected && windowRule ? statusFor(windowRule, trips, selected) : null;

  const dayStates = useMemo(() => {
    const states = new Map<string, DayState>();
    const rangeStart = firstMonth;
    const rangeEnd = addDays(shiftMonth(lastMonth, 1), -1);
    const counts = new Map(rules.map((item) => [item.id, dailyCounts(item, trips, rangeStart, rangeEnd)]));
    for (const trip of trips) {
      if (trip.end < rangeStart || trip.start > rangeEnd) continue;
      const status = tripStatus.get(trip.id);
      const overFrom = status?.status === "over" ? status.firstOverDate : undefined;
      const tripRule = ruleForTrip(rules, trip);
      for (let date = trip.start > rangeStart ? trip.start : rangeStart; date <= trip.end && date <= rangeEnd; date = addDays(date, 1)) {
        if (states.has(date)) continue;
        const count = tripRule ? counts.get(tripRule.id)?.get(date) : undefined;
        states.set(date, { trip, tripOver: Boolean(overFrom && date >= overFrom), count: count && tripRule ? { ...count, warningAt: tripRule.warningAt } : undefined });
      }
    }
    if (selected && windowStatus) {
      for (let date = windowStatus.windowStart > rangeStart ? windowStatus.windowStart : rangeStart; date <= selected && date <= rangeEnd; date = addDays(date, 1)) states.set(date, { ...states.get(date), inWindow: true });
      states.set(selected, { ...states.get(selected), inspected: true });
    }
    return states;
  }, [trips, rules, tripStatus, firstMonth, lastMonth, selected, windowStatus]);

  useEffect(() => {
    if (!scrollTarget) return;
    document.getElementById("month-" + scrollTarget.slice(0, 7))?.scrollIntoView({ behavior: "auto", block: "start" });
    setScrollTarget(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [scrollTarget]);
  useEffect(() => { if (focus) showMonth(focus.date); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  function showMonth(value: string) {
    const target = monthKey(value);
    if (target < firstMonth) setFirstMonth(target);
    if (target > lastMonth) setLastMonth(target);
    setScrollTarget(target);
  }
  /** Country whose window a day shows by default: the stay on that day, else the latest stay before it. */
  function defaultWindowRule(date: string): Rule | undefined {
    const stays = trips.filter((trip) => trip.start <= date && ruleForTrip(rules, trip)).sort((a, b) => b.start.localeCompare(a.start));
    return (stays[0] ? ruleForTrip(rules, stays[0]) : undefined) ?? rules[0];
  }
  /** Shows the day's panel and underlines the whole counting window behind it (earlier months are added above). */
  function selectDay(date: string, ruleId?: string) {
    setSelected(date);
    if (ruleId !== undefined) setWindowRuleId(ruleId); else setWindowRuleId(null);
    const rule = rules.find((item) => item.id === ruleId) ?? defaultWindowRule(date);
    if (!rule) return;
    const windowMonth = monthKey(statusFor(rule, trips, date).windowStart);
    if (windowMonth < firstMonth) setFirstMonth(windowMonth);
  }

  return <div className="planner-shell">
    <div className="region-status-cards">
      {rules.map((item) => <BudgetCard key={item.id} rule={item} trips={trips} today={today} active={item.id === windowRule?.id} />)}
    </div>
    <p className="planner-hint">Toque em qualquer dia para ver a conta de cada país e até quando dá para ficar chegando nele. O número nos dias de estadia é a conta daquele dia.</p>
    <div className="month-jump-row">
      <label htmlFor="month-jump">Ir para</label>
      <input type="month" id="month-jump" value={firstMonth.slice(0, 7)} onChange={(event) => event.target.value && showMonth(event.target.value + "-01")} />
      <button className="text-button" onClick={() => showMonth(today)}>Hoje</button>
      <button className="text-button" onClick={() => { const target = shiftMonth(firstMonth, -MONTH_STEP); setFirstMonth(target); setScrollTarget(firstMonth); }}>Meses anteriores</button>
    </div>
    <section className="annual-calendar" aria-label="Calendário de viagens">
      {months.map((month) => <MonthCalendar key={month} month={month} today={today} resetLabel={windowRule && isCalendarYear(windowRule) && month.slice(5, 7) === "01" ? windowRule.label + ": contagem zera" : undefined} dayStates={dayStates} tripLabel={(trip) => ruleForTrip(rules, trip)?.label ?? displayCountry(trip.country)} selected={selected} onDay={(date) => selectDay(date)} />)}
    </section>
    <button className="button secondary month-more" onClick={() => setLastMonth(shiftMonth(lastMonth, MONTH_STEP))}>Ver mais meses</button>
    {overview && <div className="planner-footer is-planning day-panel" role="region" aria-label={"Dia " + longDate(overview.date)}>
      <div className="day-panel-head">
        <div><span className="planner-label">{overview.stay ? "Em " + (overview.stayRule?.label ?? displayCountry(overview.stay.country)) : "Sem viagem registrada"}</span><strong>{longDate(overview.date)}</strong></div>
        <button className="circle-button" onClick={() => setSelected(null)} aria-label="Fechar o dia">×</button>
      </div>
      <div className="day-rules">{overview.rules.map((item) => <ProjectionLine key={item.rule.id} rule={item.rule} used={item.count.used} limit={item.count.limit} projection={item.projection} active={item.rule.id === windowRule?.id} onSelect={() => selectDay(overview.date, item.rule.id)} />)}</div>
      {windowStatus && windowRule && <small className="day-window">Sublinhado: {isCalendarYear(windowRule) ? "os dias de " + overview.date.slice(0, 4) : "os " + windowRule.windowDays + " dias"} que contam para {windowRule.label} neste dia ({windowStartDate(windowStatus.windowStart, overview.date)} – {shortDate(overview.date)}).</small>}
      <div className="footer-actions">
        {overview.stay && <button className="button secondary" onClick={() => onOpen(overview.stay!)}>Editar viagem</button>}
        <button className="button primary" onClick={() => onPlanFrom(overview.date, windowRule?.id)}>Planejar a partir deste dia</button>
      </div>
    </div>}
  </div>;
}

export function MonthCalendar({ month, today, resetLabel, dayStates, tripLabel, selected, onDay }: { month: string; today: string; resetLabel?: string; dayStates: Map<string, DayState>; tripLabel: (trip: Trip) => string; selected?: string | null; onDay?: (date: string) => void }) {
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
    const tripName = trip ? tripLabel(trip) : "";
    const label = [
      formatDate(date, { day: "numeric", month: "long", year: "numeric" }),
      trip ? "período registrado em " + tripName : "",
      state?.tripOver ? "viagem acima do limite" : "",
      state?.count ? state.count.used + " de " + state.count.limit + " dias na conta" : "",
      state?.inWindow ? "dentro da janela da conta" : "",
    ].filter(Boolean).join("; ");
    const countLevel = state?.count ? (state.count.used > state.count.limit ? "over" : state.count.used >= state.count.warningAt ? "warning" : "ok") : "";
    const classes = "annual-day"
      + (trip ? " has-trip " + trip.region : "")
      + (state?.tripOver ? " trip-over" : "")
      + (countLevel === "over" ? " count-over" : "")
      + (state?.inWindow ? " in-window" : "")
      + (state?.inspected ? " inspected" : "")
      + (date === today ? " today" : "");
    if (!onDay) return <span key={index} className={classes} aria-label={label}>{day}{state?.count ? <span className={"day-count " + countLevel} aria-hidden="true">{state.count.used}</span> : <span className="day-dot" />}</span>;
    return <button key={index} className={classes} aria-label={label} aria-pressed={selected === date} onClick={() => onDay(date)}>{day}{state?.count ? <span className={"day-count " + countLevel} aria-hidden="true">{state.count.used}</span> : <span className="day-dot" />}</button>;
  });
  return <section id={"month-" + month.slice(0, 7)} className="year-month">
    <div className="year-month-header"><h3>{monthTitle(year, monthIndex)}</h3>{resetLabel ? <span className="year-reset">{resetLabel}</span> : <span>{hasTrips ? "com registros" : ""}</span>}</div>
    <div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div>
    <div className="year-month-grid">{days}</div>
  </section>;
}
