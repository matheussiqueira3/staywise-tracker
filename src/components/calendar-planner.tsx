"use client";

import { useState } from "react";
import { formatDate, inclusiveDays, isoToday, statusForDate } from "@/lib/rules";
import type { Rule, RuleStatus, Region, Trip } from "@/lib/types";

type CalendarPlannerProps = {
  trips: Trip[];
  rules: Rule[];
  onOpen: (trip: Trip) => void;
  onSave: (trip: Trip) => void;
};

function keyFor(year: number, month: number, day: number) {
  return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function SelectionSummary({ status, days, start, end, planning }: { status: RuleStatus; days: number; start: string | null; end: string | null; planning: boolean }) {
  if (!planning) {
    return <div className="planner-guidance idle"><span className="guidance-step">1</span><p><strong>Toque em uma data para planejar</strong><small>O calendário mostra seus períodos e calcula o próximo automaticamente.</small></p></div>;
  }
  if (!start) {
    return <div className="planner-guidance"><span className="guidance-step active">1</span><p><strong>Comece pelo primeiro dia</strong><small>Toque em uma data no calendário para marcar sua entrada.</small></p></div>;
  }
  if (!end) {
    return <div className="planner-guidance"><span className="guidance-step active">2</span><p><strong>Agora escolha a saída</strong><small>Toque no último dia. A faixa da viagem aparece automaticamente.</small></p></div>;
  }
  const safe = status.status !== "over" && status.remaining > 0;
  return <div className={"planner-guidance complete " + (safe ? "safe" : "danger")}><span className="guidance-step">{safe ? "✓" : "!"}</span><p><strong>{days} {days === 1 ? "dia selecionado" : "dias selecionados"}</strong><small>{safe ? status.remaining + " dias ainda disponíveis na regra de " + status.rule.label + "." : "Essa seleção ultrapassa a regra de " + status.rule.label + "."}</small></p></div>;
}

export function CalendarPlanner({ trips, rules, onOpen, onSave }: CalendarPlannerProps) {
  const [month, setMonth] = useState(new Date(isoToday() + "T12:00:00Z"));
  const [region, setRegion] = useState<Region>("brazil");
  const [country, setCountry] = useState("Brazil");
  const [planning, setPlanning] = useState(false);
  const activeRule = rules.find((item) => item.region === region) || rules[0];
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const numberOfDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + numberOfDays }, (_, index) => index < offset ? null : index - offset + 1);
  const selectedStart = start && end && start > end ? end : start;
  const selectedEnd = start && end && start > end ? start : end;
  const previewTrip = selectedStart && selectedEnd ? { id: "calendar-preview", region, country, start: selectedStart, end: selectedEnd } : null;
  const status = statusForDate(activeRule, previewTrip ? trips.concat(previewTrip) : trips, selectedEnd || selectedStart || isoToday());
  const selectedDays = selectedStart && selectedEnd ? inclusiveDays(selectedStart, selectedEnd) : selectedStart ? 1 : 0;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(first);

  const tripForDay = (date: string) => trips.find((trip) => trip.start <= date && trip.end >= date);
  const isSelected = (date: string) => Boolean(selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd);

  function chooseDay(date: string) {
    if (!start || (start && end)) {
      setStart(date);
      setEnd(null);
      return;
    }
    setEnd(date);
  }

  function startPlanning(date?: string) {
    setPlanning(true);
    if (date) chooseDay(date);
  }

  function clearSelection() {
    setStart(null);
    setEnd(null);
    setPlanning(false);
  }

  function saveSelection() {
    if (!selectedStart || !selectedEnd) return;
    onSave({ id: "trip-" + Date.now(), region, country, start: selectedStart, end: selectedEnd });
    clearSelection();
  }

  return <div className="planner-shell">
    <div className="planner-toolbar">
      <div className="planner-region">
        <span className="planner-label">Planejar em</span>
        <div className="segmented">
          <button className={region === "brazil" ? "selected" : ""} onClick={() => { setRegion("brazil"); setCountry("Brazil"); clearSelection(); }}>Brasil</button>
          <button className={region === "schengen" ? "selected" : ""} onClick={() => { setRegion("schengen"); setCountry("Italy"); clearSelection(); }}>Schengen</button>
        </div>
      </div>
      <button className={"button " + (planning ? "secondary" : "primary") + " planner-clear"} onClick={() => planning ? clearSelection() : startPlanning()}>{planning ? "Cancelar" : "Planejar viagem"}</button>
    </div>
    <SelectionSummary status={status} days={selectedDays} start={start} end={end} planning={planning} />
    <section className="calendar-card planner-calendar">
      <div className="calendar-header"><button className="circle-button" aria-label="Mês anterior" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex - 1, 1)))}>‹</button><h3>{monthLabel}</h3><button className="circle-button" aria-label="Próximo mês" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex + 1, 1)))}>›</button></div>
      <div className="weekday-row">{["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid planner-grid">{cells.map((day, index) => {
        const date = day ? keyFor(year, monthIndex, day) : "";
        const existingTrip = date ? tripForDay(date) : undefined;
        const selected = date ? isSelected(date) : false;
        const startMark = date && selectedStart === date;
        const endMark = date && selectedEnd === date;
        const className = "calendar-day planner-day " + (existingTrip ? "has-trip " + existingTrip.region : "") + (selected ? " selected-range" : "") + (startMark ? " selected-start" : "") + (endMark ? " selected-end" : "");
        return <button key={index} disabled={!day} aria-label={date ? formatDate(date, { day: "numeric", month: "long", year: "numeric" }) : undefined} className={className} onClick={() => { if (!date) return; if (!planning && existingTrip) { onOpen(existingTrip); return; } if (!planning) startPlanning(date); else chooseDay(date); }}>{day}<span className="day-dot" /></button>;
      })}</div>
      <div className="calendar-legend"><span><i className="legend-dot selected-legend" />Sua seleção</span><span><i className="legend-dot brazil" />Brasil</span><span><i className="legend-dot schengen" />Schengen</span></div>
    </section>
    <div className="planner-footer">
      <div><span className="planner-label">Período escolhido</span><strong>{selectedStart && selectedEnd ? formatDate(selectedStart) + " — " + formatDate(selectedEnd) : "Selecione duas datas"}</strong></div>
      <button className="button primary" onClick={saveSelection} disabled={!planning || !selectedStart || !selectedEnd}>Salvar viagem</button>
    </div>
    <div className="planner-help"><strong>Como funciona:</strong> uma data começa a viagem, a segunda termina. As duas datas contam.</div>
    <section className="list-section planner-existing"><div className="section-heading small"><div><p className="eyebrow">PERÍODOS REGISTRADOS</p><h2>Toque para editar</h2></div><span className="count-label">{trips.length} períodos</span></div><div className="trip-list">{trips.slice(0, 6).map((trip) => <button className="trip-row" key={trip.id} onClick={() => onOpen(trip)}><span className={"region-marker " + trip.region} /><span className="trip-dates"><strong>{formatDate(trip.start)} — {formatDate(trip.end)}</strong><small>{trip.country} · {inclusiveDays(trip.start, trip.end)} dias</small></span><span className="row-chevron">→</span></button>)}</div></section>
  </div>;
}
