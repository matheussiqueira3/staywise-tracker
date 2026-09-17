"use client";

import { useState } from "react";
import { addDays, formatDate, inclusiveDays, isoToday, statusForDate } from "@/lib/rules";
import type { Rule, RuleStatus, Region, Trip } from "@/lib/types";

type CalendarPlannerProps = { trips: Trip[]; rules: Rule[]; onOpen: (trip: Trip) => void; onSave: (trip: Trip) => void };
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function keyFor(year: number, month: number, day: number) { return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function monthTitle(year: number, month: number) { return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1))); }

function SelectionSummary({ status, days, start, end, planning }: { status: RuleStatus; days: number; start: string | null; end: string | null; planning: boolean }) {
  if (!planning) return <div className="planner-guidance idle"><span className="guidance-step">1</span><p><strong>Escolha uma data para começar</strong><small>Veja o ano inteiro e toque na entrada e depois na saída.</small></p></div>;
  if (!start) return <div className="planner-guidance"><span className="guidance-step active">1</span><p><strong>Comece pela entrada</strong><small>Toque em qualquer dia do ano para marcar o início.</small></p></div>;
  if (!end) return <div className="planner-guidance"><span className="guidance-step active">2</span><p><strong>Agora escolha a saída</strong><small>Você pode mudar de mês sem perder a primeira data.</small></p></div>;
  const safe = status.status !== "over" && status.remaining > 0;
  return <div className={"planner-guidance complete " + (safe ? "safe" : "danger")}><span className="guidance-step">{safe ? "✓" : "!"}</span><p><strong>{days} {days === 1 ? "dia selecionado" : "dias selecionados"}</strong><small>{safe ? status.remaining + " dias disponíveis na janela móvel." : "A seleção ultrapassa a janela móvel. Você pode salvar e ajustar depois."}</small></p></div>;
}

export function CalendarPlanner({ trips, rules, onOpen, onSave }: CalendarPlannerProps) {
  const [year, setYear] = useState(new Date(isoToday() + "T12:00:00Z").getUTCFullYear());
  const [region, setRegion] = useState<Region>("brazil");
  const [country, setCountry] = useState("Brazil");
  const [planning, setPlanning] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const activeRule = rules.find((item) => item.region === region) || rules[0];
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const anchorDate = selectedEnd || selectedStart || isoToday();
  const windowStart = addDays(anchorDate, -(activeRule.windowDays - 1));
  const windowEnd = anchorDate;
  const previewTrip = selectedStart && selectedEnd ? { id: "calendar-preview", region, country, start: selectedStart, end: selectedEnd } : null;
  const status = statusForDate(activeRule, previewTrip ? trips.concat(previewTrip) : trips, anchorDate);
  const selectedDays = selectedStart && selectedEnd ? inclusiveDays(selectedStart, selectedEnd) : selectedStart ? 1 : 0;
  const today = isoToday();
  const tripForDay = (date: string) => trips.find((trip) => trip.start <= date && trip.end >= date);
  const isSelected = (date: string) => Boolean(selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd);
  const isInWindow = (date: string) => date >= windowStart && date <= windowEnd;
  function chooseDay(date: string) { if (!start || (start && end)) { setStart(date); setEnd(null); return; } setEnd(date); }
  function startPlanning(date?: string) { setPlanning(true); if (date) chooseDay(date); }
  function clearSelection() { setStart(null); setEnd(null); setPlanning(false); }
  function chooseRegion(value: Region, defaultCountry: string) { setRegion(value); setCountry(defaultCountry); clearSelection(); }
  function saveSelection() { if (!selectedStart || !selectedEnd) return; onSave({ id: "trip-" + Date.now(), region, country, start: selectedStart, end: selectedEnd }); clearSelection(); }

  return <div className="planner-shell">
    <div className="planner-toolbar"><div className="planner-region"><span className="planner-label">Planejar em</span><div className="segmented"><button className={region === "brazil" ? "selected" : ""} onClick={() => chooseRegion("brazil", "Brazil")}>Brasil</button><button className={region === "schengen" ? "selected" : ""} onClick={() => chooseRegion("schengen", "Italy")}>Schengen</button></div></div><div className="year-switcher" aria-label="Escolher ano"><button className="circle-button" aria-label="Ano anterior" onClick={() => setYear((value) => value - 1)}>‹</button><strong>{year}</strong><button className="circle-button" aria-label="Próximo ano" onClick={() => setYear((value) => value + 1)}>›</button></div><button className={"button " + (planning ? "secondary" : "primary") + " planner-clear"} onClick={() => planning ? clearSelection() : startPlanning()}>{planning ? (start && end ? "Recomeçar" : "Cancelar") : "Planejar viagem"}</button></div>
    <div className="calculation-strip"><div><span className="planner-label">Janela móvel</span><strong>{activeRule.windowDays} dias</strong><small>{formatDate(windowStart, { day: "2-digit", month: "short", year: "numeric" })} — {formatDate(windowEnd, { day: "2-digit", month: "short", year: "numeric" })}</small></div><div className={"calculation-score " + status.status}><strong>{status.used}<small> / {activeRule.limit}</small></strong><span>{status.remaining > 0 ? status.remaining + " dias restantes" : status.status === "over" ? "limite ultrapassado" : "limite atingido"}</span></div></div>
    <SelectionSummary status={status} days={selectedDays} start={start} end={end} planning={planning} />
    <section className="annual-calendar" aria-label={"Calendário anual de " + year}>{Array.from({ length: 12 }, (_, month) => <MonthCalendar key={month} year={year} month={month} today={today} trips={trips} selectedStart={selectedStart} selectedEnd={selectedEnd} isSelected={isSelected} isInWindow={isInWindow} tripForDay={tripForDay} onDay={(date, trip) => { if (!planning && trip) onOpen(trip); else if (!planning) startPlanning(date); else chooseDay(date); }} />)}</section>
    <div className="calendar-legend"><span><i className="legend-dot rolling" />Janela de cálculo</span><span><i className="legend-dot selected-legend" />Sua seleção</span><span><i className="legend-dot brazil" />Brasil</span><span><i className="legend-dot schengen" />Schengen</span></div>
    <div className="planner-footer"><div><span className="planner-label">Período escolhido</span><strong>{selectedStart && selectedEnd ? formatDate(selectedStart, { day: "2-digit", month: "short", year: "numeric" }) + " — " + formatDate(selectedEnd, { day: "2-digit", month: "short", year: "numeric" }) : "Selecione duas datas"}</strong></div><button className="button primary" onClick={saveSelection} disabled={!planning || !selectedStart || !selectedEnd}>Salvar viagem</button></div>
    <div className="planner-help"><strong>Como usar:</strong> toque em uma entrada e depois em uma saída. A faixa verde/azul mostra a janela móvel usada no cálculo; os períodos existentes podem ser tocados para editar.</div>
    <section className="list-section planner-existing"><div className="section-heading small"><div><p className="eyebrow">PERÍODOS REGISTRADOS</p><h2>Toque para editar</h2></div><span className="count-label">{trips.length} períodos</span></div><div className="trip-list">{trips.slice(0, 6).map((trip) => <button className="trip-row" key={trip.id} onClick={() => onOpen(trip)}><span className={"region-marker " + trip.region} /><span className="trip-dates"><strong>{formatDate(trip.start)} — {formatDate(trip.end)}</strong><small>{trip.country} · {inclusiveDays(trip.start, trip.end)} dias</small></span><span className="row-chevron">→</span></button>)}</div></section>
  </div>;
}

function MonthCalendar({ year, month, today, trips, selectedStart, selectedEnd, isSelected, isInWindow, tripForDay, onDay }: { year: number; month: number; today: string; trips: Trip[]; selectedStart: string | null; selectedEnd: string | null; isSelected: (date: string) => boolean; isInWindow: (date: string) => boolean; tripForDay: (date: string) => Trip | undefined; onDay: (date: string, trip?: Trip) => void }) {
  const first = new Date(Date.UTC(year, month, 1));
  const numberOfDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + numberOfDays }, (_, index) => index < offset ? null : index - offset + 1);
  return <section className="year-month"><div className="year-month-header"><h3>{monthTitle(year, month)}</h3><span>{trips.some((trip) => trip.start.slice(0, 7) === keyFor(year, month, 1).slice(0, 7)) ? "com registros" : ""}</span></div><div className="year-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div><div className="year-month-grid">{cells.map((day, index) => { const date = day ? keyFor(year, month, day) : ""; const trip = date ? tripForDay(date) : undefined; const selected = date ? isSelected(date) : false; const inWindow = date ? isInWindow(date) : false; const startMark = date && selectedStart === date; const endMark = date && selectedEnd === date; const classes = "annual-day" + (trip ? " has-trip " + trip.region : "") + (inWindow ? " in-window" : "") + (selected ? " selected-range" : "") + (startMark ? " selected-start" : "") + (endMark ? " selected-end" : "") + (date === today ? " today" : ""); return day ? <button key={index} className={classes} aria-label={formatDate(date, { day: "numeric", month: "long", year: "numeric" })} aria-pressed={selected} onClick={() => onDay(date, trip)}>{day}<span className="day-dot" /></button> : <span key={index} className="annual-day empty" aria-hidden="true" />; })}</div></section>;
}
