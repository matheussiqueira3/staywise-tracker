"use client";

import { useState } from "react";
import { addDays, formatDate, inclusiveDays, isoToday, statusForDate } from "@/lib/rules";
import type { Rule, RuleStatus, Region, Trip } from "@/lib/types";

type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; onOpen: (trip: Trip) => void; onSave: (trip: Trip) => void };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); }
function monthKey(value: string) { return value.slice(0, 7) + "-01"; }
function nextMonth(value: string) { const date = new Date(value + "T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 10); }
function monthsInRange(start: string, end: string) { const months: string[] = []; for (let month = monthKey(start); month <= monthKey(end); month = nextMonth(month)) months.push(month); return months; }

function SelectionSummary({ status, days, start }: { status: RuleStatus; days: number; start: string | null }) {
  if (!start) return null;
  const safe = status.status !== "over" && status.remaining > 0;
  return <div className={"planner-guidance " + (safe ? "safe" : "danger")}><strong>{days} {days === 1 ? "dia" : "dias"}</strong><small>{safe ? status.remaining + " dias disponíveis na janela." : "Excede o limite."}</small></div>;
}

export function CalendarPlanner({ trips, rules, onOpen, onSave }: CalendarPlannerProps) {
  const [region, setRegion] = useState<Region>("brazil");
  const [country, setCountry] = useState("Brazil");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [jumpMonth, setJumpMonth] = useState(monthKey(isoToday()));
  const activeRule = rules.find((item) => item.region === region) || rules[0];
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const anchorDate = selectedEnd || selectedStart || isoToday();
  const windowStart = addDays(anchorDate, -(activeRule.windowDays - 1));
  const windowEnd = anchorDate;
  const rollingMonths = monthsInRange(addDays(isoToday(), -180), addDays(isoToday(), 548));
  const previewTrip = selectedStart && selectedEnd ? { id: "calendar-preview", region, country, start: selectedStart, end: selectedEnd } : null;
  const status = statusForDate(activeRule, previewTrip ? trips.concat(previewTrip) : trips, anchorDate);
  const selectedDays = selectedStart && selectedEnd ? inclusiveDays(selectedStart, selectedEnd) : selectedStart ? 1 : 0;
  const today = isoToday();
  const tripForDay = (date: string) => trips.find((trip) => trip.start <= date && trip.end >= date);
  const isSelected = (date: string) => Boolean(selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd);
  const isInWindow = (date: string) => date >= windowStart && date <= windowEnd;

  function chooseDay(date: string) {
    if (!start) { setStart(date); setEnd(null); return; }
    if (start && !end) { if (date === start) { setStart(null); setEnd(null); return; } setEnd(date); return; }
    setStart(date); setEnd(null);
  }

  function clearSelection() { setStart(null); setEnd(null); }
  function chooseRegion(value: Region, defaultCountry: string) { setRegion(value); setCountry(defaultCountry); clearSelection(); }
  function jumpToMonth(value: string) { setJumpMonth(value); document.getElementById("month-" + value.slice(0, 7))?.scrollIntoView({ behavior: "auto", block: "start" }); }
  function saveSelection() { if (!selectedStart || !selectedEnd) return; onSave({ id: "trip-" + Date.now(), region, country, start: selectedStart, end: selectedEnd }); clearSelection(); }

  return <div className="planner-shell">
    <div className="planner-toolbar">
      <div className="planner-region">
        <span className="planner-label">Região</span>
        <div className="segmented" role="group" aria-label="Região">
          <button aria-pressed={region === "brazil"} className={(region === "brazil" ? "selected " : "") + "region-option brazil"} onClick={() => chooseRegion("brazil", "Brazil")}>Brasil</button>
          <button aria-pressed={region === "schengen"} className={(region === "schengen" ? "selected " : "") + "region-option schengen"} onClick={() => chooseRegion("schengen", "Italy")}>Schengen</button>
        </div>
      </div>
      {start && <button className="button secondary planner-clear" onClick={clearSelection}>Limpar</button>}
    </div>
    <div className="calculation-strip">
      <div>
        <span className="planner-label">{region === "brazil" ? "Brasil" : "Schengen"}</span>
        <strong>{activeRule.windowDays} dias de janela</strong>
        <small>{formatDate(windowStart, { day: "2-digit", month: "short", year: "numeric" })} — {formatDate(windowEnd, { day: "2-digit", month: "short", year: "numeric" })}</small>
      </div>
      <div className={"calculation-score " + status.status}>
        <strong>{status.used}<small> / {activeRule.limit}</small></strong>
        <span>{status.remaining > 0 ? status.remaining + " dias" : "limite"}</span>
      </div>
    </div>
    <SelectionSummary status={status} days={selectedDays} start={start} />
    <div className="month-jump-row">
      <label htmlFor="month-jump">Navegar</label>
      <input type="month" id="month-jump" value={jumpMonth.slice(0, 7)} onChange={(e) => jumpToMonth(e.target.value + "-01")} />
    </div>
    <section className="annual-calendar" aria-label="Calendário de viagens">
      {rollingMonths.map((month) => {
        const date = new Date(month + "T12:00:00Z");
        return <MonthCalendar key={month} year={date.getUTCFullYear()} month={date.getUTCMonth()} rangeStart={addDays(isoToday(), -180)} rangeEnd={addDays(isoToday(), 548)} today={today} trips={trips} selectedRegion={region} selectedStart={selectedStart} selectedEnd={selectedEnd} isSelected={isSelected} isInWindow={isInWindow} tripForDay={tripForDay} onDay={(date, trip) => { if (trip) onOpen(trip); else chooseDay(date); }} />;
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

function MonthCalendar({ year, month, rangeStart, rangeEnd, today, trips, selectedRegion, selectedStart, selectedEnd, isSelected, isInWindow, tripForDay, onDay }: { year: number; month: number; rangeStart: string; rangeEnd: string; today: string; trips: Trip[]; selectedRegion: Region; selectedStart: string | null; selectedEnd: string | null; isSelected: (date: string) => boolean; isInWindow: (date: string) => boolean; tripForDay: (date: string) => Trip | undefined; onDay: (date: string, trip?: Trip) => void }) {
  const first = new Date(Date.UTC(year, month, 1));
  const numberOfDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + numberOfDays }, (_, index) => index < offset ? null : index - offset + 1);
  return <section id={"month-" + keyFor(year, month, 1).slice(0, 7)} className="year-month"><div className="year-month-header"><h3>{monthTitle(year, month)}</h3><span>{trips.some((trip) => trip.start.slice(0, 7) === keyFor(year, month, 1).slice(0, 7)) ? "com registros" : ""}</span></div><div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div><div className="year-month-grid">{cells.map((day, index) => { const date = day ? keyFor(year, month, day) : ""; const visible = Boolean(date && date >= rangeStart && date <= rangeEnd); const trip = visible ? tripForDay(date) : undefined; const selected = visible ? isSelected(date) : false; const inWindow = visible ? isInWindow(date) : false; const startMark = visible && selectedStart === date; const endMark = visible && selectedEnd === date; const conflict = Boolean(selected && trip && trip.region !== selectedRegion); const regionName = trip?.region === "brazil" ? "Brasil" : trip?.region === "schengen" ? "Schengen" : trip?.country; const stateLabel = [formatDate(date || today, { day: "numeric", month: "long", year: "numeric" }), trip ? "período registrado em " + regionName : "", selected ? "selecionado para " + (selectedRegion === "brazil" ? "Brasil" : "Schengen") : "", conflict ? "sobreposição com outro período" : ""].filter(Boolean).join("; "); const classes = "annual-day" + (trip ? " has-trip " + trip.region : "") + (inWindow ? " in-window" : "") + (selected ? " selected-range selected-" + selectedRegion : "") + (startMark ? " selected-start" : "") + (endMark ? " selected-end" : "") + (conflict ? " overlap-conflict" : "") + (date === today ? " today" : ""); return visible ? <button key={index} className={classes} aria-label={stateLabel} aria-pressed={selected} onClick={() => onDay(date, trip)}>{day}<span className="day-dot" />{conflict && <span className="conflict-mark" aria-hidden="true">!</span>}</button> : <span key={index} className="annual-day empty" aria-hidden="true" />; })}</div></section>;
}
