"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, earliestEntryFor, findConflicts, formatDate, inclusiveDays, maxSafeStay, ruleForRegion, simulateTrip, statusFor } from "@/lib/rules";
import type { AffectedTrip, MaxSafeStay, TripSimulation, TripStatus } from "@/lib/rules";
import type { Region, Rule, Trip } from "@/lib/types";

type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; today: string; initialRegion: Region; tripStatus: Map<string, TripStatus>; onOpen: (trip: Trip) => void; onSave: (trip: Trip) => boolean };
/** `tripOver`: the day belongs to a saved trip that is over the limit on/after its first over day. */
type DayState = { trip?: Trip; tripOver?: boolean; forecast?: "safe" | "warning" | "last" | "over" | "blocked" };
type DayChoice = { date: string; trip: Trip };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const REGIONS: Array<[Region, string, string]> = [["brazil", "Brasil", "Brazil"], ["schengen", "Schengen", "Italy"], ["other", "Outro", "Other"]];
const MONTH_STEP = 12;
const OVER_PREVIEW_DAYS = 14;

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); }
function monthKey(value: string) { return value.slice(0, 7) + "-01"; }
function shiftMonth(value: string, amount: number) { const date = new Date(value + "T12:00:00Z"); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 10); }
function monthsBetween(start: string, end: string) { const months: string[] = []; for (let month = monthKey(start); month <= monthKey(end); month = shiftMonth(month, 1)) months.push(month); return months; }
function shortDate(value: string) { return formatDate(value, { day: "2-digit", month: "short" }); }
function longDate(value: string) { return formatDate(value, { day: "2-digit", month: "short", year: "numeric" }); }
function plural(count: number, one: string, many: string) { return count + " " + (count === 1 ? one : many); }
function regionLabel(region: Region, country: string) { return region === "brazil" ? "Brasil" : region === "schengen" ? "Schengen" : country || "Outro"; }

/** Badge with a saved trip's own verdict; nothing when it is within the limit or has no rule. */
export function TripStatusBadge({ status }: { status?: TripStatus }) {
  if (status?.status === "over") return <span className="trip-badge over">Excede {plural(status.excessDays, "dia", "dias")}</span>;
  if (status?.status === "warning") return <span className="trip-badge warning">Perto do limite</span>;
  return null;
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
    {forecast.limitedBy !== "later-trip" && <small>Todos os {rule.limit} dias da janela de {rule.windowDays} já estão em uso.</small>}
  </div>;
  return <div className="forecast-card safe" role="status">
    <span className="forecast-region">{rule.label} · entrada {shortDate(forecast.start)}</span>
    <strong>Pode ficar até <span className="forecast-date">{longDate(forecast.lastSafeDate)}</span></strong>
    <small>{plural(forecast.daysAvailable, "dia disponível", "dias disponíveis")}. Toque no dia de saída.</small>
    {forecast.firstWarningDate && <small className="forecast-warning-line">Entra na zona de alerta em {longDate(forecast.firstWarningDate)} ({rule.warningAt} de {rule.limit} dias).</small>}
    <LimitReason forecast={forecast} />
  </div>;
}

function SelectionSummary({ days, end, simulation, forecast, conflict, rule, onAdjust }: { days: number; end: string; simulation: TripSimulation | null; forecast: MaxSafeStay | null; conflict?: Trip; rule?: Rule; onAdjust: (date: string) => void }) {
  if (conflict) return <div className="forecast-card danger" role="alert"><strong>Conflito de datas</strong><small>Você já tem um período em {conflict.country} entre {shortDate(conflict.start)} e {longDate(conflict.end)}. Uma pessoa não pode estar em duas regiões no mesmo dia.</small></div>;
  if (!rule || !simulation) return <div className="forecast-card neutral" role="status"><strong>{plural(days, "dia", "dias")}</strong><small>Sem regra de limite para esta região. O período é registrado, mas não conta para Brasil nem Schengen.</small></div>;
  const lastSafe = forecast?.lastSafeDate;
  const worsened = simulation.worsenedTrips.length > 0 ? <WorsenedLines items={simulation.worsenedTrips} /> : null;
  const adjust = lastSafe && simulation.firstOverDate ? <button className="button secondary forecast-action" onClick={() => onAdjust(lastSafe)}>Ajustar saída para {shortDate(lastSafe)}</button> : null;
  const affected = simulation.affectedTrips.map((item) => <small key={item.trip.id} className="forecast-affected">Sua viagem de {shortDate(item.trip.start)} — {shortDate(item.trip.end)} ({item.trip.country}) passaria a exceder em {plural(item.excessDays, "dia", "dias")} a partir de {longDate(item.firstOverDate)}.</small>);
  if (simulation.firstOverDate) return <div className="forecast-card danger" role="alert">
    <strong>{plural(days, "dia", "dias")} · excede em {plural(simulation.excessDays, "dia", "dias")}</strong>
    <small>O limite de {rule.limit} dias é ultrapassado em {longDate(simulation.firstOverDate)}.{lastSafe ? " Último dia seguro: " + longDate(lastSafe) + "." : ""}</small>
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
    <small>Pico de {simulation.maxUsed} de {rule.limit} dias na janela.{slack > 0 && lastSafe ? " Ainda sobrariam " + plural(slack, "dia", "dias") + " (até " + shortDate(lastSafe) + ")." : " Você sai exatamente no último dia seguro."}</small>
  </div>;
}

function EarliestEntry({ rule, trips, today, onApply }: { rule: Rule; trips: Trip[]; today: string; onApply: (start: string, end: string) => void }) {
  const [length, setLength] = useState("");
  const [fromInput, setFromInput] = useState(today);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromInput) ? fromInput : today;
  const days = Math.floor(Number(length));
  const valid = length !== "" && days >= 1;
  const result = useMemo(() => valid ? earliestEntryFor(rule, trips, days, from) : null, [valid, rule, trips, days, from]);
  return <div className="earliest-entry">
    <label htmlFor="earliest-length">Quero ficar</label>
    <input id="earliest-length" type="number" inputMode="numeric" min="1" max={rule.limit} placeholder="30" value={length} onChange={(event) => setLength(event.target.value)} />
    <span>dias em {rule.label}</span>
    <span className="earliest-from"><label htmlFor="earliest-from">a partir de</label><input id="earliest-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} /></span>
    {valid && <p role="status">{days > rule.limit ? "Acima do limite de " + rule.limit + " dias." : result ? <>Primeira entrada possível em ou após {longDate(from)}: <strong>{longDate(result.start)}</strong> <button className="text-button" onClick={() => onApply(result.start, result.end)}>Ver no calendário</button></> : "Nenhuma data possível nos 2 anos a partir de " + longDate(from) + "."}</p>}
  </div>;
}

function DayChoiceSheet({ choice, onEdit, onStart, onClose }: { choice: DayChoice; onEdit: () => void; onStart: () => void; onClose: () => void }) {
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
        <button className="button primary" onClick={onStart}>Começar entrada aqui</button>
        <button className="button secondary" onClick={onClose}>Cancelar</button>
      </div>
    </section>
  </div>;
}

export function CalendarPlanner({ trips, rules, today, initialRegion, tripStatus, onOpen, onSave }: CalendarPlannerProps) {
  const [region, setRegion] = useState<Region>(initialRegion);
  const [country, setCountry] = useState(REGIONS.find(([value]) => value === initialRegion)?.[2] || "Brazil");
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
  const rule = ruleForRegion(rules, region);
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const candidate = selectedStart && selectedEnd ? { region, start: selectedStart, end: selectedEnd } : null;
  const forecast = useMemo(() => rule && selectedStart ? maxSafeStay(rule, trips, region, selectedStart) : null, [rule, trips, region, selectedStart]);
  const simulation = useMemo(() => rule && candidate ? simulateTrip(rule, trips, candidate) : null, [rule, trips, candidate?.region, candidate?.start, candidate?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflict = candidate ? findConflicts(trips, candidate).otherRegion[0] : undefined;
  const statuses = useMemo(() => rules.map((item) => statusFor(item, trips, today)), [rules, trips, today]);
  const months = monthsBetween(firstMonth, lastMonth);
  const selectedDays = candidate ? inclusiveDays(candidate.start, candidate.end) : 0;
  const candidateKey = candidate ? region + "|" + candidate.start + "|" + candidate.end : null;
  // Unsafe plans that are not over yet need a second click; past trips are records and save at once.
  const needsConfirm = Boolean(candidate && simulation && !simulation.safe && candidate.end >= today);
  const confirming = needsConfirm && confirmed !== null && confirmed.key === candidateKey && confirmed.trips === trips && confirmed.rules === rules;
  // Short verdict repeated in the sticky footer, so the answer stays visible while scrolling the calendar.
  const verdict = conflict ? { tone: "danger", text: "Conflito com " + conflict.country }
    : simulation ? (simulation.firstOverDate ? { tone: "danger", text: "Excede em " + plural(simulation.excessDays, "dia", "dias") }
      : simulation.affectedTrips.length > 0 ? { tone: "danger", text: "Afeta viagem futura" }
      : simulation.worsenedTrips.length > 0 ? { tone: "danger", text: "Piora viagem futura" }
      : { tone: simulation.firstWarningDate ? "warning" : "safe", text: "Dentro do limite" })
    : start && !end && forecast ? (forecast.lastSafeDate ? { tone: "safe", text: "Pode ficar até " + shortDate(forecast.lastSafeDate) } : { tone: "danger", text: "Sem dias disponíveis" })
    : null;

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
  function startAtChosenDay() {
    if (!choice) return;
    // Plan in the tapped trip's region, so extending or replanning it does not start as a cross-region conflict.
    const { trip } = choice;
    setChoice(null);
    setConfirmed(null);
    setRegion(trip.region);
    setCountry(trip.country || REGIONS.find(([value]) => value === trip.region)?.[2] || "Other");
    setStart(choice.date);
    setEnd(null);
  }
  function clearSelection() { setStart(null); setEnd(null); setConfirmedFor(null); }
  function chooseRegion(value: Region, defaultCountry: string) { setRegion(value); setCountry(defaultCountry); clearSelection(); }
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
    if (onSave({ id: "trip-" + Date.now(), region, country: country.trim() || regionLabel(region, country), start: candidate.start, end: candidate.end })) clearSelection();
  }

  return <div className="planner-shell">
    <div className="planner-toolbar">
      <div className="planner-region">
        <span className="planner-label">Região</span>
        <div className="segmented three" role="group" aria-label="Região">
          {REGIONS.map(([value, label, defaultCountry]) => <button key={value} aria-pressed={region === value} className={(region === value ? "selected " : "") + "region-option " + value} onClick={() => chooseRegion(value, defaultCountry)}>{label}</button>)}
        </div>
      </div>
      {region === "other" && <div className="country-input"><label htmlFor="country-name">País/Cidade</label><input id="country-name" placeholder="Ex: Tailândia" value={country} onChange={(event) => setCountry(event.target.value)} /></div>}
      {start && <button className="button secondary planner-clear" onClick={clearSelection}>Limpar</button>}
    </div>
    <div className="region-status-cards">
      {statuses.map((status) => <div key={status.rule.id} className={"status-card " + status.status + (status.rule.region === region ? " active" : "")}>
        <div className="status-header">{status.rule.label} · hoje</div>
        <div className="status-numbers"><strong>{status.used}<small> / {status.rule.limit}</small></strong></div>
        <div className="status-label">{status.status === "over" ? "acima do limite" : status.remaining > 0 ? plural(status.remaining, "dia disponível", "dias disponíveis") : "limite atingido"}</div>
      </div>)}
    </div>
    {rule ? <EarliestEntry key={rule.id} rule={rule} trips={trips} today={today} onApply={applySelection} /> : !start && <div className="forecast-card neutral"><strong>Sem regra de limite</strong><small>Períodos em outros países são registrados para evitar sobreposição, mas não contam para Brasil nem Schengen.</small></div>}
    {!start && rule && <p className="planner-hint">Toque no dia de entrada para ver até quando pode ficar.</p>}
    {start && !end && forecast && rule && <ForecastCard forecast={forecast} rule={rule} />}
    {start && !end && !rule && <div className="forecast-card neutral" role="status"><strong>Entrada em {shortDate(start)}</strong><small>Toque no dia de saída.</small></div>}
    {candidate && <SelectionSummary days={selectedDays} end={candidate.end} simulation={simulation} forecast={forecast} conflict={conflict} rule={rule} onAdjust={adjustEnd} />}
    <div className="month-jump-row">
      <label htmlFor="month-jump">Ir para</label>
      <input type="month" id="month-jump" value={firstMonth.slice(0, 7)} onChange={(event) => event.target.value && showMonth(event.target.value + "-01")} />
      <button className="text-button" onClick={() => showMonth(today)}>Hoje</button>
    </div>
    <button className="button secondary month-more" onClick={() => { const target = shiftMonth(firstMonth, -MONTH_STEP); setFirstMonth(target); setScrollTarget(firstMonth); }}>Ver meses anteriores</button>
    <section className="annual-calendar" aria-label="Calendário de viagens">
      {months.map((month) => <MonthCalendar key={month} month={month} today={today} dayStates={dayStates} selectedRegion={region} selectedLabel={regionLabel(region, country)} selectedStart={selectedStart} selectedEnd={selectedEnd} onDay={onDay} />)}
    </section>
    <button className="button secondary month-more" onClick={() => setLastMonth(shiftMonth(lastMonth, MONTH_STEP))}>Ver mais meses</button>
    <div className={"planner-footer" + (start ? " is-planning" : "")}>
      <div>
        <span className="planner-label">Período</span>
        <strong>{candidate ? shortDate(candidate.start) + " — " + shortDate(candidate.end) + " · " + plural(selectedDays, "dia", "dias") : start ? "Entrada " + shortDate(start) + " — escolha a saída" : "—"}</strong>
        {verdict && <small className={"footer-verdict " + verdict.tone} role="status">{verdict.text}</small>}
      </div>
      <button className={"button primary" + (confirming ? " danger" : "")} onClick={saveSelection} disabled={!candidate || Boolean(conflict)}>{confirming ? "Salvar mesmo assim" : "Salvar"}</button>
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
    {choice && <DayChoiceSheet choice={choice} onEdit={editChosenTrip} onStart={startAtChosenDay} onClose={closeChoice} />}
  </div>;
}

function MonthCalendar({ month, today, dayStates, selectedRegion, selectedLabel, selectedStart, selectedEnd, onDay }: { month: string; today: string; dayStates: Map<string, DayState>; selectedRegion: Region; selectedLabel: string; selectedStart: string | null; selectedEnd: string | null; onDay: (date: string, trip?: Trip) => void }) {
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
    const conflict = Boolean(selected && trip && trip.region !== selectedRegion);
    const tripName = trip ? regionLabel(trip.region, trip.country) : "";
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
    <div className="year-month-header"><h3>{monthTitle(year, monthIndex)}</h3><span>{hasTrips ? "com registros" : ""}</span></div>
    <div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div>
    <div className="year-month-grid">{days}</div>
  </section>;
}
