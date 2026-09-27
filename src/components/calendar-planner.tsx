"use client";

import { useState } from "react";
import { addDays, formatDate, inclusiveDays, isoToday, maxSafeStay, statusForDate } from "@/lib/rules";
import type { MaxSafeStay } from "@/lib/rules";
import type { Rule, RuleStatus, Trip } from "@/lib/types";

type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; onOpen: (trip: Trip) => void; onSave: (trip: Trip) => void };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); }
function monthKey(value: string) { return value.slice(0, 7) + "-01"; }
function nextMonth(value: string) { const date = new Date(value + "T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 10); }
function monthsInRange(start: string, end: string) { const months: string[] = []; for (let month = monthKey(start); month <= monthKey(end); month = nextMonth(month)) months.push(month); return months; }

function ForecastCard({ forecast, rule }: { forecast: MaxSafeStay | null; rule: Rule | undefined }) {
  if (!forecast) return null;
  if (!forecast.lastSafeDate) return <div className="forecast-card danger"><strong>Sem disponibilidade</strong><small>Todos os dias disponíveis já foram usados na janela móvel.</small></div>;
  const days = forecast.daysAvailable;
  return <div className="forecast-card safe">
    <div className="forecast-line"><strong>{rule?.label || "Regra selecionada"}</strong></div>
    <div className="forecast-line"><strong>Você pode ficar até</strong><strong className="forecast-date">{formatDate(forecast.lastSafeDate, { day: "2-digit", month: "short", year: "numeric" })}</strong></div>
    <div className="forecast-line"><strong>{days} {days === 1 ? "dia" : "dias"} disponíveis</strong></div>
    <div className="forecast-line small"><span>Entrada</span><span>{formatDate(forecast.start, { day: "2-digit", month: "short" })}</span></div>
  </div>;
}

function SelectionSummary({ status, days, start }: { status: RuleStatus; days: number; start: string | null }) {
  if (!start) return null;
  const safe = status.status !== "over";
  return <div className={"planner-guidance " + (safe ? "safe" : "danger")}><strong>{days} {days === 1 ? "dia" : "dias"}</strong><small>{safe ? status.remaining + " dias disponíveis na janela." : "Excede o limite."}</small></div>;
}

export function CalendarPlanner({ trips, rules, onOpen, onSave }: CalendarPlannerProps) {
  const [ruleId, setRuleId] = useState(rules[0]?.id || "");
  const [country, setCountry] = useState("Brazil");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [jumpMonth, setJumpMonth] = useState(monthKey(isoToday()));
  const activeRule = rules.find((item) => item.id === ruleId) || rules[0];
  const region = activeRule?.region || "other";
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const anchorDate = selectedEnd || selectedStart || isoToday();
  const windowStart = addDays(anchorDate, -((activeRule?.windowDays || 1) - 1));
  const windowEnd = anchorDate;
  const rollingMonths = monthsInRange(addDays(jumpMonth, -183), addDays(jumpMonth, 548));
  const previewTrip = selectedStart && selectedEnd && activeRule ? { id: "calendar-preview", ruleId: activeRule.id, region, country, start: selectedStart, end: selectedEnd } : null;
  const status = activeRule ? statusForDate(activeRule, previewTrip ? trips.concat(previewTrip) : trips, anchorDate) : null;
  const selectedDays = selectedStart && selectedEnd ? inclusiveDays(selectedStart, selectedEnd) : selectedStart ? 1 : 0;
  const today = isoToday();
  const tripForDay = (date: string) => trips.find((trip) => trip.start <= date && trip.end >= date);
  const isSelected = (date: string) => Boolean(selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd);
  const isInWindow = (date: string) => date >= windowStart && date <= windowEnd;
  const forecast = start && !end && activeRule ? maxSafeStay(activeRule, trips, region, start) : null;

  function chooseDay(date: string) {
    if (!start) { setStart(date); setEnd(null); return; }
    if (start && !end) { if (date === start) { setStart(null); setEnd(null); return; } setEnd(date); return; }
    setStart(date); setEnd(null);
  }

  function clearSelection() { setStart(null); setEnd(null); }
  function chooseRule(value: Rule) { setRuleId(value.id); setCountry(value.label); clearSelection(); }
  function jumpToMonth(value: string) { setJumpMonth(value); requestAnimationFrame(() => document.getElementById("month-" + value.slice(0, 7))?.scrollIntoView({ behavior: "auto", block: "start" })); }
  function saveSelection() { if (!selectedStart || !selectedEnd || !activeRule) return; onSave({ id: "trip-" + Date.now(), ruleId: activeRule.id, region, country, start: selectedStart, end: selectedEnd }); clearSelection(); }

  if (!activeRule) return <div className="planner-guidance danger"><strong>Nenhuma regra configurada</strong><small>Adicione uma regra em Mais antes de calcular uma permanência.</small></div>;

  return <div className="planner-shell">
    <div className="planner-toolbar">
      <div className="planner-region">
        <span className="planner-label">País ou regime</span>
        <div className="segmented" role="group" aria-label="País ou regime">
          {rules.map((rule) => <button key={rule.id} aria-pressed={rule.id === activeRule.id} className={(rule.id === activeRule.id ? "selected " : "") + "region-option " + rule.region} onClick={() => chooseRule(rule)}>{rule.label}</button>)}
        </div>
      </div>
      {activeRule.region === "other" && <div className="country-input"><label htmlFor="country-name">País</label><input id="country-name" placeholder="Nome do país" value={country} onChange={(e) => setCountry(e.target.value)} /></div>}
      {start && <button className="button secondary planner-clear" onClick={clearSelection}>Limpar</button>}
    </div>
    <div className="region-status-cards">
      {rules.map((rule) => { const cardStatus = statusForDate(rule, trips, today); return <div className="status-card" key={rule.id}>
        <div className="status-header">{rule.label}</div>
        <div className="status-numbers"><strong>{cardStatus.used}<small> / {rule.limit}</small></strong></div>
        <div className="status-label">{cardStatus.remaining + " disponíveis"}</div>
      </div>; })}
    </div>
    {start && <ForecastCard forecast={forecast} rule={activeRule} />}
    {selectedStart && selectedEnd && status && <SelectionSummary status={status} days={selectedDays} start={start} />}
    <div className="month-jump-row">
      <label htmlFor="month-jump">Navegar</label>
      <input type="month" id="month-jump" value={jumpMonth.slice(0, 7)} onChange={(e) => jumpToMonth(e.target.value + "-01")} />
    </div>
    <section className="annual-calendar" aria-label="Calendário de viagens">
      {rollingMonths.map((month) => {
        const date = new Date(month + "T12:00:00Z");
        return <MonthCalendar key={month} year={date.getUTCFullYear()} month={date.getUTCMonth()} rangeStart={addDays(jumpMonth, -183)} rangeEnd={addDays(jumpMonth, 548)} today={today} trips={trips} selectedRule={activeRule} selectedStart={selectedStart} selectedEnd={selectedEnd} isSelected={isSelected} isInWindow={isInWindow} tripForDay={tripForDay} onDay={(date, trip) => { if (trip) onOpen(trip); else chooseDay(date); }} />;
      })}
    </section>
    <div className="planner-footer">
      <div>
        <span className="planner-label">Período</span>
        <strong>{selectedStart && selectedEnd ? formatDate(selectedStart, { day: "2-digit", month: "short" }) + " — " + formatDate(selectedEnd, { day: "2-digit", month: "short" }) : "—"}</strong>
      </div>
      <button className="button primary" onClick={saveSelection} disabled={!selectedStart || !selectedEnd}>Salvar</button>
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
            <small>{trip.country} · {inclusiveDays(trip.start, trip.end)} dias</small>
          </span>
          <span className="row-chevron">→</span>
        </button>)}
      </div>
    </section>}
  </div>;
}

function MonthCalendar({ year, month, rangeStart, rangeEnd, today, trips, selectedRule, selectedStart, selectedEnd, isSelected, isInWindow, tripForDay, onDay }: { year: number; month: number; rangeStart: string; rangeEnd: string; today: string; trips: Trip[]; selectedRule: Rule; selectedStart: string | null; selectedEnd: string | null; isSelected: (date: string) => boolean; isInWindow: (date: string) => boolean; tripForDay: (date: string) => Trip | undefined; onDay: (date: string, trip?: Trip) => void }) {
  const first = new Date(Date.UTC(year, month, 1));
  const numberOfDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + numberOfDays }, (_, index) => index < offset ? null : index - offset + 1);
  return <section id={"month-" + keyFor(year, month, 1).slice(0, 7)} className="year-month"><div className="year-month-header"><h3>{monthTitle(year, month)}</h3><span>{trips.some((trip) => trip.start.slice(0, 7) === keyFor(year, month, 1).slice(0, 7)) ? "com registros" : ""}</span></div><div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div><div className="year-month-grid">{cells.map((day, index) => { const date = day ? keyFor(year, month, day) : ""; const visible = Boolean(date && date >= rangeStart && date <= rangeEnd); const trip = visible ? tripForDay(date) : undefined; const selected = visible ? isSelected(date) : false; const inWindow = visible ? isInWindow(date) : false; const startMark = visible && selectedStart === date; const endMark = visible && selectedEnd === date; const conflict = Boolean(selected && trip && trip.ruleId !== selectedRule.id); const regionName = trip?.country || "regra desconhecida"; const stateLabel = [formatDate(date || today, { day: "numeric", month: "long", year: "numeric" }), trip ? "período registrado em " + regionName : "", selected ? "selecionado para " + selectedRule.label : "", conflict ? "sobreposição com outro período" : ""].filter(Boolean).join("; "); const classes = "annual-day" + (trip ? " has-trip " + trip.region : "") + (inWindow ? " in-window" : "") + (selected ? " selected-range selected-" + selectedRule.region : "") + (startMark ? " selected-start" : "") + (endMark ? " selected-end" : "") + (conflict ? " overlap-conflict" : "") + (date === today ? " today" : ""); return visible ? <button key={index} className={classes} aria-label={stateLabel} aria-pressed={selected} onClick={() => onDay(date, trip)}>{day}<span className="day-dot" />{conflict && <span className="conflict-mark" aria-hidden="true">!</span>}</button> : <span key={index} className="annual-day empty" aria-hidden="true" />; })}</div></section>;
}
