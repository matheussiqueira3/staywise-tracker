"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { CATALOG_RULES, DEFAULT_RULES, currentTrip, describeRule, displayCountry, itineraryFromTrips, findConflicts, formatDate, formatFullDate, inclusiveDays, isBuiltInRule, isoToday, maxSafeStay, parseRuleNumbers, ruleForTrip, usageLabel, simulateTrip, statusFor, tripStatuses, upcomingTrips } from "@/lib/rules";
import { createCustomRule } from "@/data/catalog";
import type { RuleNumbers, RuleNumbersInput, TripStatus } from "@/lib/rules";
import { STATE_VERSION, decodeState, encodeState } from "@/lib/share";
import { chooseHydration, parseLocalMeta, parseStored, type LocalSyncMeta } from "@/lib/sync";
import type { Rule, TrackerState, Trip } from "@/lib/types";
import { ItineraryPlanner } from "@/components/itinerary-planner";
import { CalendarPlanner, NO_RULE, NO_RULE_LABEL, TripStatusBadge, defaultCountry, ruleFields, ruleForChoice } from "@/components/calendar-planner";
import "./planner.css";
import "./undo.css";
import "./annual-planner.css";

type Tab = "calendar" | "trips" | "more";
const TABS = [["calendar", "Calendário", "□"], ["trips", "Viagens", "▦"], ["more", "Mais", "☷"]] as const;
type ToastState = { message: string; tone?: "warning"; undo?: { label: string; action: () => void } };
type SyncStatus = "loading" | "saving" | "saved" | "offline";
const EMPTY_STATE: TrackerState = { version: STATE_VERSION, trips: [], rules: DEFAULT_RULES };
const LOCAL_STATE_KEY = "staywise-state-v2";
const LOCAL_META_KEY = "staywise-sync-v1";
const LOCAL_BACKUP_KEY = "staywise-state-conflict-backup";
const SAVE_DELAY_MS = 400;

function storageGet(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function storageSet(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* storage unavailable: keep working in memory */ } }
function writeMeta(meta: LocalSyncMeta) { storageSet(LOCAL_META_KEY, JSON.stringify(meta)); }
function requestHeaders(json = false): HeadersInit { return json ? { "content-type": "application/json" } : {}; }
function shortDate(value: string) { return formatDate(value, { day: "2-digit", month: "short" }); }
function plural(count: number, one: string, many: string) { return count + " " + (count === 1 ? one : many); }
function newTripId() { return "trip-" + Date.now(); }

// Today's local date, known only on the client: the server snapshot is null so prerendered HTML never bakes in a
// build-time date, and returning to the page (or focusing it) re-reads the clock so an app left open overnight rolls over.
function subscribeToday(onChange: () => void) {
  const onVisible = () => { if (document.visibilityState === "visible") onChange(); };
  let midnightTimer = 0;
  // Also roll over at local midnight while the page stays visible and focused.
  const scheduleMidnight = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    midnightTimer = window.setTimeout(() => { onChange(); scheduleMidnight(); }, nextMidnight.getTime() - now.getTime());
  };
  scheduleMidnight();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onChange);
  return () => { window.clearTimeout(midnightTimer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onChange); };
}
function getClientToday(): string | null { return isoToday(); }
function getServerToday(): string | null { return null; }
function useToday(): string | null { return useSyncExternalStore(subscribeToday, getClientToday, getServerToday); }

function TripRow({ trip, status, onClick }: { trip: Trip; status?: TripStatus; onClick: () => void }) {
  const count = inclusiveDays(trip.start, trip.end);
  return <button className="trip-row" onClick={onClick}><span className={"region-marker " + trip.region} /><span className="trip-dates"><strong>{formatDate(trip.start, { day: "2-digit", month: "short" })} — {formatDate(trip.end, { day: "2-digit", month: "short", year: "numeric" })}</strong><small>{displayCountry(trip.country)} · {count} {count === 1 ? "dia" : "dias"}</small></span><TripStatusBadge status={status} /><span className="row-chevron">→</span></button>;
}
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="empty-state"><div className="empty-icon">□</div><h3>Nenhuma viagem planejada</h3><p>Registre uma entrada e uma saída para começar a acompanhar seus dias.</p><button className="button primary" onClick={onAdd}>＋ Adicionar viagem</button></div>; }

function NowCard({ trip, rules, trips, status, onOpen }: { trip: Trip; rules: Rule[]; trips: Trip[]; status?: TripStatus; onOpen: () => void }) {
  const rule = ruleForTrip(rules, trip);
  const forecast = rule ? maxSafeStay(rule, trips.filter((item) => item.id !== trip.id), rule.region, trip.start) : null;
  const lastSafe = forecast?.lastSafeDate;
  const blocking = forecast?.limitedBy === "later-trip" ? forecast.blockingTrip : undefined;
  // The trip's own verdict decides whether it exceeds; later trips it pushes over come from the simulation.
  const ownOver = status?.status === "over";
  const simulation = rule ? simulateTrip(rule, trips, { id: trip.id, ruleId: rule.id, region: trip.region, start: trip.start, end: trip.end }) : null;
  const affected = simulation?.affectedTrips[0];
  const worsened = affected ? undefined : simulation?.worsenedTrips[0];
  const danger = ownOver || Boolean(affected || worsened);
  return <button className={"next-trip-card now " + (danger ? "danger" : "")} onClick={onOpen}>
    <div className="trip-header"><strong>Agora em {displayCountry(trip.country)}</strong><small>saída planejada {shortDate(trip.end)}</small></div>
    {rule && lastSafe && <div className="trip-dates">Pode ficar até <b>{formatFullDate(lastSafe)}</b></div>}
    {rule && !lastSafe && <div className="trip-dates">{blocking ? "Sem dias seguros por causa de uma viagem futura" : "Sem dias disponíveis em " + rule.label}</div>}
    {blocking && <small className="now-limit-reason">Limitado pela viagem de {shortDate(blocking.trip.start)} — {shortDate(blocking.trip.end)} ({displayCountry(blocking.trip.country)}).</small>}
    {!rule && <div className="trip-dates">Sem regra de limite para este país</div>}
    {ownOver && <div className="trip-alert danger"><strong>⚠ A saída planejada excede o limite em {plural(status?.excessDays ?? 0, "dia", "dias")}</strong></div>}
    {!ownOver && affected && <div className="trip-alert danger"><strong>⚠ A saída planejada faz a viagem de {shortDate(affected.trip.start)} — {shortDate(affected.trip.end)} ({displayCountry(affected.trip.country)}) exceder em {plural(affected.excessDays, "dia", "dias")}</strong><small>Esta estadia está dentro do limite; o problema é a viagem futura.</small></div>}
    {!ownOver && worsened && <div className="trip-alert danger"><strong>⚠ A viagem de {shortDate(worsened.trip.start)} — {shortDate(worsened.trip.end)} ({displayCountry(worsened.trip.country)}) já excede o limite; a saída planejada piora em {plural(worsened.excessDays, "dia", "dias")}</strong><small>Esta estadia está dentro do limite; o problema é a viagem futura.</small></div>}
  </button>;
}

function NextTripCard({ trip, rules, trips, onOpen }: { trip: Trip; rules: Rule[]; trips: Trip[]; onOpen: () => void }) {
  const rule = ruleForTrip(rules, trip);
  const simulation = rule ? simulateTrip(rule, trips, { id: trip.id, ruleId: rule.id, region: trip.region, start: trip.start, end: trip.end }) : null;
  return <button className="next-trip-card" onClick={onOpen}>
    <div className="trip-header"><strong>Próxima: {displayCountry(trip.country)}</strong><small>{plural(inclusiveDays(trip.start, trip.end), "dia", "dias")}</small></div>
    <div className="trip-dates">{shortDate(trip.start)} — {formatDate(trip.end, { day: "2-digit", month: "short", year: "numeric" })}</div>
    {simulation?.firstOverDate && <div className="trip-alert danger"><strong>⚠ Excede o limite em {plural(simulation.excessDays, "dia", "dias")}</strong><small>Último dia permitido: {shortDate(simulation.lastSafeDate || trip.end)}</small></div>}
    {simulation && !simulation.firstOverDate && simulation.firstWarningDate && <div className="trip-alert warning"><strong>Perto do limite</strong><small>Pico de {rule ? usageLabel(rule, simulation.maxUsed, simulation.maxUsedDate) : simulation.maxUsed}.</small></div>}
    {simulation && !simulation.firstOverDate && !simulation.firstWarningDate && <div className="trip-alert safe"><strong>Dentro do limite</strong><small>Pico de {rule ? usageLabel(rule, simulation.maxUsed, simulation.maxUsedDate) : simulation.maxUsed}.</small></div>}
  </button>;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [state, setState] = useState<TrackerState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [editing, setEditing] = useState<Trip | null | false>(false);
  // Itinerary planner: a new plan, or the saved plan ahead loaded for editing.
  const [planning, setPlanning] = useState<false | "new" | "edit">(false);
  // A new plan started from a calendar day ("Planejar a partir deste dia").
  const [planFrom, setPlanFrom] = useState<{ date: string; ruleId?: string } | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<{ date: string } | undefined>(undefined);
  const toastTimer = useRef<number | null>(null);
  // Sync bookkeeping: the server revision local data is based on, the last state known to match the server,
  // the newest state, and a chain that sends saves one at a time so revisions never race each other.
  const revisionRef = useRef<number | null>(null);
  const baselineRef = useRef<TrackerState>(EMPTY_STATE);
  const latestRef = useRef<TrackerState>(EMPTY_STATE);
  const canSyncRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Null during prerender and hydration; everything date-dependent waits for the client value.
  const today = useToday();

  function notify(message: string, undo?: ToastState["undo"], tone?: ToastState["tone"]) { if (toastTimer.current) window.clearTimeout(toastTimer.current); setToast({ message, undo, tone }); toastTimer.current = window.setTimeout(() => setToast(null), 6000); }

  // Sends the newest state. Never aborted mid-flight: an accepted write must always record its new revision.
  async function pushLatest() {
    const snapshot = latestRef.current;
    if (snapshot === baselineRef.current || !canSyncRef.current) return;
    setSyncStatus("saving");
    try {
      const response = await fetch("/api/state", { method: "POST", headers: requestHeaders(true), body: JSON.stringify({ state: snapshot, baseRevision: revisionRef.current ?? 0 }) });
      if (response.status === 409) {
        const server = parseStored(await response.json());
        if (!server) throw new Error("invalid conflict payload");
        storageSet(LOCAL_BACKUP_KEY, encodeState(latestRef.current));
        revisionRef.current = server.revision;
        baselineRef.current = server.state;
        writeMeta({ revision: server.revision, dirty: false });
        setState(server.state);
        setSyncStatus("saved");
        notify("Os dados mudaram em outro dispositivo. A versão mais recente foi carregada e sua alteração ficou guardada como cópia local.", undefined, "warning");
        return;
      }
      if (!response.ok) throw new Error("save failed");
      const payload = await response.json() as { revision?: number };
      if (typeof payload.revision !== "number") throw new Error("invalid save payload");
      revisionRef.current = payload.revision;
      baselineRef.current = snapshot;
      writeMeta({ revision: payload.revision, dirty: latestRef.current !== snapshot });
      setSyncStatus(latestRef.current === snapshot ? "saved" : "saving");
    } catch {
      setSyncStatus("offline");
    }
  }

  const pushLatestRef = useRef(pushLatest);
  useEffect(() => { pushLatestRef.current = pushLatest; });

  useEffect(() => {
    let active = true;
    const localValue = storageGet(LOCAL_STATE_KEY);
    const local = localValue ? decodeState(localValue) : null;
    function fallBackToLocal(status: SyncStatus) {
      const shared = window.location.hash ? decodeState(window.location.hash.slice(1)) : null;
      const next = shared || local;
      if (next) { baselineRef.current = next; setState(next); }
      setSyncStatus(status);
    }
    async function loadState() {
      try {
        const response = await fetch("/api/state", { cache: "no-store", headers: requestHeaders() });
        if (!active) return;
        if (!response.ok) throw new Error("state unavailable");
        const payload: unknown = await response.json();
        const server = parseStored(payload);
        if (!server) throw new Error("invalid state");
        if (!active) return;
        const decision = chooseHydration(server, local, parseLocalMeta(storageGet(LOCAL_META_KEY)));
        revisionRef.current = decision.revision;
        canSyncRef.current = true;
        baselineRef.current = decision.push ? server.state : decision.state;
        if (decision.discardedLocal) {
          storageSet(LOCAL_BACKUP_KEY, encodeState(decision.discardedLocal));
          writeMeta({ revision: decision.revision, dirty: false });
          notify("Havia alterações locais antigas. A versão do servidor foi mantida e uma cópia local foi guardada.", undefined, "warning");
        }
        setState(decision.state);
        setSyncStatus("saved");
      } catch {
        if (active) fallBackToLocal("offline");
      } finally {
        if (active) setHydrated(true);
      }
    }
    void loadState();
    return () => { active = false; };
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [tab]);
  useEffect(() => {
    if (editing === false) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setEditing(false); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button:not([disabled]), [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusTimer = window.setTimeout(() => document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(), 0);
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKey); };
  }, [editing]);

  useEffect(() => {
    if (!hydrated) return;
    latestRef.current = state;
    storageSet(LOCAL_STATE_KEY, encodeState(state));
    if (state === baselineRef.current) return;
    writeMeta({ revision: revisionRef.current, dirty: true });
    if (!canSyncRef.current) return;
    const timer = window.setTimeout(() => { saveChainRef.current = saveChainRef.current.then(() => pushLatestRef.current()); }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  const statuses = useMemo(() => today ? state.rules.map((rule) => statusFor(rule, state.trips, today)) : [], [state, today]);
  const trips = useMemo(() => state.trips.slice().sort((a, b) => b.start.localeCompare(a.start)), [state.trips]);
  // Shown on the other tabs only: on the calendar tab the per-rule status cards already show these numbers.
  const risk = statuses.find((item) => item.status === "over") || statuses.find((item) => item.status === "warning");
  const nowTrip = useMemo(() => today ? currentTrip(state.trips, today) : undefined, [state.trips, today]);
  const nextTrip = useMemo(() => today ? upcomingTrips(state.trips, today)[0] : undefined, [state.trips, today]);
  const tripStatus = useMemo(() => tripStatuses(state.rules, state.trips), [state.rules, state.trips]);
  const futureOverTrip = useMemo(() => today ? upcomingTrips(state.trips, today).find((trip) => tripStatus.get(trip.id)?.status === "over") : undefined, [state.trips, today, tripStatus]);
  const futureOverExcess = futureOverTrip ? tripStatus.get(futureOverTrip.id)?.excessDays || 0 : 0;
  const ahead = useMemo(() => today ? itineraryFromTrips(state.rules, state.trips, today) : null, [state.rules, state.trips, today]);

  async function share() { const encoded = encodeState(state); window.history.replaceState(null, "", "#" + encoded); const url = window.location.origin + window.location.pathname + "#" + encoded; try { await navigator.clipboard?.writeText(url); notify("Link copiado — ele contém todos os seus dados"); } catch { notify("Link criado — copie o endereço da barra do navegador"); } }
  function exportBackup() { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })); link.download = "staywise-backup.json"; link.click(); notify("Backup exportado"); }
  function saveTrip(trip: Trip): boolean {
    const conflicts = findConflicts(state.trips, trip);
    const geoConflict = conflicts.otherRegion[0];
    if (geoConflict) { notify("Conflito: o período se sobrepõe a " + displayCountry(geoConflict.country) + " (" + shortDate(geoConflict.start) + " — " + shortDate(geoConflict.end) + ")", undefined, "warning"); return false; }
    const previousTrip = state.trips.find((item) => item.id === trip.id);
    setState((current) => ({ ...current, trips: previousTrip ? current.trips.map((item) => item.id === trip.id ? trip : item) : current.trips.concat(trip) }));
    setEditing(false);
    // Undo reverts only this trip, so edits made after it are kept.
    const undo = () => setState((current) => ({ ...current, trips: previousTrip ? current.trips.map((item) => item.id === trip.id ? previousTrip : item) : current.trips.filter((item) => item.id !== trip.id) }));
    notify(conflicts.sameRegion.length > 0 ? "Viagem salva — há sobreposição com outro período do mesmo país ou regime" : "Viagem salva", { label: "Desfazer", action: undo });
    return true;
  }
  // An itinerary becomes one trip per destination (replacing the trips it was loaded from), undone together, and the
  // calendar shows where it starts.
  function saveItinerary(newTrips: Trip[], replaces: string[]) {
    if (newTrips.length === 0) return;
    const ids = new Set(newTrips.map((trip) => trip.id));
    const replaced = state.trips.filter((trip) => replaces.includes(trip.id));
    setState((current) => ({ ...current, trips: current.trips.filter((trip) => !replaces.includes(trip.id)).concat(newTrips) }));
    setPlanning(false);
    setTab("calendar");
    setCalendarFocus({ date: newTrips[0].start });
    notify((replaced.length ? "Itinerário atualizado · " : "Itinerário salvo · ") + plural(newTrips.length, "viagem", "viagens") + " no calendário", { label: "Desfazer", action: () => setState((current) => ({ ...current, trips: current.trips.filter((trip) => !ids.has(trip.id)).concat(replaced.filter((trip) => !current.trips.some((item) => item.id === trip.id))) })) });
  }
  function removeTrip(id: string) {
    const removed = state.trips.find((trip) => trip.id === id);
    if (!removed) return;
    setState((current) => ({ ...current, trips: current.trips.filter((trip) => trip.id !== id) }));
    setEditing(false);
    notify("Viagem removida", { label: "Desfazer", action: () => setState((current) => current.trips.some((trip) => trip.id === id) ? current : { ...current, trips: current.trips.concat(removed) }) });
  }
  const syncLabel = syncStatus === "loading" ? "Carregando" : syncStatus === "saving" ? "Salvando" : syncStatus === "saved" ? "Salvo" : "Modo local — não sincronizado";
  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">S</span><span>staywise</span></div><div className="topbar-actions"><span className={"sync-label sync-" + syncStatus}><i className="sync-dot" />{syncLabel}</span><button className="icon-button" aria-label="Copiar link com os dados" title="Copiar link com os dados" onClick={share}>↗</button></div></header><main className="content-wrap"><section className="welcome"><div><p className="eyebrow">CALCULADORA DE PERMANÊNCIA</p><h1>Olá, Andrew.</h1><p className="welcome-copy">Planeje quanto tempo ficar em cada lugar. O Staywise calcula o máximo de cada destino.</p></div><div className="today-chip" aria-busy={!today}>{today ? formatFullDate(today) : "Carregando data…"}</div></section><button className="plan-cta" onClick={() => { setPlanFrom(null); setPlanning("new"); }} disabled={!today}><span className="plan-cta-icon" aria-hidden="true">✈︎</span><span><strong>Planejar viagem</strong><small>Quanto tempo posso ficar em cada lugar?</small></span><b aria-hidden="true">→</b></button>{ahead && <button className="text-button plan-edit" onClick={() => setPlanning("edit")}>Editar o plano à frente →</button>}{nowTrip && <NowCard trip={nowTrip} rules={state.rules} trips={state.trips} status={tripStatus.get(nowTrip.id)} onOpen={() => setEditing(nowTrip)} />}{nextTrip && <NextTripCard trip={nextTrip} rules={state.rules} trips={state.trips} onOpen={() => setEditing(nextTrip)} />}{futureOverTrip && <button className="alert-banner over" onClick={() => setEditing(futureOverTrip)}><span className="alert-icon">!</span><span><strong>Viagem de {formatFullDate(futureOverTrip.start)} ({displayCountry(futureOverTrip.country)}) excede em {plural(futureOverExcess, "dia", "dias")}</strong><small>Toque para revisar as datas.</small></span><b>→</b></button>}{risk && tab !== "calendar" && <button className={"alert-banner " + risk.status} onClick={() => setTab("calendar")}><span className="alert-icon">!</span><span><strong>{risk.rule.label}: {risk.status === "over" ? "limite ultrapassado" : "perto do limite"}</strong><small>{risk.used} de {risk.limit} dias usados.</small></span><b>→</b></button>}<div className="tab-panel">{TABS.map(([id, label, icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} className={"tab " + (tab === id ? "active" : "")} onClick={() => setTab(id)}><span className="tab-icon">{icon}</span>{label}</button>)}</div>{!today && tab !== "more" && <p className="planner-hint" role="status">Carregando…</p>}{today && tab === "calendar" && <CalendarPlanner key={hydrated ? "ready" : "loading"} trips={trips} rules={state.rules} today={today} tripStatus={tripStatus} focus={calendarFocus} onOpen={setEditing} onPlanFrom={(date, ruleId) => { setPlanFrom({ date, ruleId }); setPlanning("new"); }} />}{today && tab === "trips" && <TripsView trips={trips} today={today} tripStatus={tripStatus} onOpen={setEditing} onGoCalendar={() => setPlanning("new")} onEditPlan={ahead ? () => setPlanning("edit") : undefined} />}{tab === "more" && <Settings state={state} onChange={setState} onShare={share} onExport={exportBackup} onNotify={notify} />}</main><nav className="bottom-nav">{TABS.map(([id, label, icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav>{planning && today && <ItineraryPlanner key={planning + (planFrom?.date ?? "")} rules={state.rules} trips={planning === "edit" && ahead ? state.trips.filter((trip) => !ahead.tripIds.includes(trip.id)) : state.trips} today={today} initial={planning === "edit" && ahead ? ahead : undefined} startAt={planning === "new" ? planFrom ?? undefined : undefined} onClose={() => setPlanning(false)} onSave={saveItinerary} />}{editing !== false && today && <TripModal trip={editing} rules={state.rules} today={today} onClose={() => setEditing(false)} onSave={saveTrip} onDelete={editing ? removeTrip : undefined} trips={state.trips} />}{toast && <div className="toast" role="status"><span>{toast.tone === "warning" ? "! " : "✓ "}{toast.message}</span>{toast.undo && <button className="toast-undo" onClick={() => { toast.undo?.action(); setToast(null); }}>Desfazer</button>}</div>}</div>;
}

function TripsView({ trips, today, tripStatus, onOpen, onGoCalendar, onEditPlan }: { trips: Trip[]; today: string; tripStatus: Map<string, TripStatus>; onOpen: (trip: Trip) => void; onGoCalendar: () => void; onEditPlan?: () => void }) {
  const upcoming = trips.filter((t) => t.end >= today).slice().reverse();
  const past = trips.filter((t) => t.end < today);
  return <div className="view-stack">
    <div className="section-heading"><div><p className="eyebrow">VIAGENS</p><h2>Seus períodos</h2></div><div className="section-actions">{onEditPlan && <button className="button secondary" onClick={onEditPlan}>Editar itinerário</button>}<button className="button primary" onClick={onGoCalendar}>＋ Novo</button></div></div>
    {upcoming.length > 0 && <section><div className="section-heading small"><h3>Atuais e próximas</h3></div><div className="trip-list">{upcoming.map((trip) => <TripRow key={trip.id} trip={trip} status={tripStatus.get(trip.id)} onClick={() => onOpen(trip)} />)}</div></section>}
    {past.length > 0 && <section><div className="section-heading small"><h3>Passadas</h3></div><div className="trip-list">{past.map((trip) => <TripRow key={trip.id} trip={trip} status={tripStatus.get(trip.id)} onClick={() => onOpen(trip)} />)}</div></section>}
    {trips.length === 0 && <EmptyState onAdd={onGoCalendar} />}
  </div>;
}

function RuleEditor({ rule, onSave }: { rule: Rule; onSave: (numbers: RuleNumbers) => void }) {
  const builtIn = isBuiltInRule(rule);
  const [draft, setDraft] = useState<RuleNumbersInput>({ limit: String(rule.limit), windowDays: String(rule.windowDays), warningAt: String(rule.warningAt) });
  const parsed = parseRuleNumbers(draft);
  const changed = draft.limit.trim() !== String(rule.limit) || draft.windowDays.trim() !== String(rule.windowDays) || draft.warningAt.trim() !== String(rule.warningAt);
  const field = (key: keyof RuleNumbersInput, label: string) => <label><span>{label}</span><input aria-label={rule.label + " " + label.toLowerCase()} type="number" inputMode="numeric" min={key === "limit" ? 1 : 0} step="1" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  return <div className="rule-setting">
    <div><strong>{rule.label}</strong><span>{builtIn ? describeRule(rule) + " · valores do catálogo" : rule.countryCode + " · " + describeRule(rule)}</span></div>
    <div className="setting-inputs">
      {!builtIn && field("limit", "Limite")}
      {!builtIn && field("windowDays", "Janela")}
      {field("warningAt", "Alerta")}
      <button className="button secondary rule-save" disabled={!changed || !parsed.ok} onClick={() => parsed.ok && onSave(parsed.value)}>Salvar</button>
    </div>
    {changed && !parsed.ok && <p className="field-error" role="status">{parsed.error}</p>}
  </div>;
}

function Settings({ state, onChange, onShare, onExport, onNotify }: { state: TrackerState; onChange: Dispatch<SetStateAction<TrackerState>>; onShare: () => void; onExport: () => void; onNotify: (message: string, undo?: ToastState["undo"]) => void }) {
  const [draft, setDraft] = useState({ label: "", countryCode: "", limit: "", windowDays: "", warningAt: "" });
  const [ruleError, setRuleError] = useState("");
  function addRule() {
    const parsed = parseRuleNumbers(draft);
    if (!draft.label.trim() || !draft.countryCode.trim()) { setRuleError("Preencha o nome e o código."); return; }
    if (!parsed.ok) { setRuleError(parsed.error); return; }
    onChange((current) => ({ ...current, rules: current.rules.concat(createCustomRule({ label: draft.label.trim(), countryCode: draft.countryCode.trim().toUpperCase(), ...parsed.value })) }));
    setDraft({ label: "", countryCode: "", limit: "", windowDays: "", warningAt: "" });
    setRuleError("");
  }
  // Every change to a rule re-evaluates all trips, so it is saved explicitly and can be undone.
  function updateRule(id: string, numbers: RuleNumbers) {
    const previous = state.rules.find((rule) => rule.id === id);
    if (!previous) return;
    const restore = { limit: previous.limit, windowDays: previous.windowDays, warningAt: previous.warningAt };
    onChange((current) => ({ ...current, rules: current.rules.map((rule) => rule.id === id ? { ...rule, ...numbers } : rule) }));
    onNotify("Regra " + previous.label + " atualizada", { label: "Desfazer", action: () => onChange((current) => ({ ...current, rules: current.rules.map((rule) => rule.id === id ? { ...rule, ...restore } : rule) })) });
  }
  return <div className="view-stack"><div className="section-heading"><div><p className="eyebrow">OPÇÕES</p><h2>Regras e workspace</h2></div></div><section className="settings-section"><div className="settings-heading"><h3>Regras de permanência</h3><p>Regras do catálogo (Itália, Brasil, Schengen) têm limites fixos; ajuste só o ponto de alerta. Regras que você criou podem ser editadas por completo.</p></div>{state.rules.map((rule) => {
    return <RuleEditor key={rule.id + "|" + rule.limit + "|" + rule.windowDays + "|" + rule.warningAt} rule={rule} onSave={(numbers) => updateRule(rule.id, isBuiltInRule(rule) ? { limit: rule.limit, windowDays: rule.windowDays, warningAt: numbers.warningAt } : numbers)} />;
  })}</section>{CATALOG_RULES.some((item) => !state.rules.some((rule) => rule.id === item.id)) && <section className="settings-section"><div className="settings-heading"><h3>Regras do catálogo</h3><p>Regras prontas que não estão no seu workspace.</p></div><div className="settings-actions">{CATALOG_RULES.filter((item) => !state.rules.some((rule) => rule.id === item.id)).map((item) => <button key={item.id} className="button secondary" onClick={() => onChange((current) => current.rules.some((rule) => rule.id === item.id) ? current : { ...current, rules: current.rules.concat(item) })}>＋ {item.label} · {describeRule(item)}</button>)}</div></section>}<section className="settings-section"><div className="settings-heading"><h3>Adicionar país ou regime</h3><p>Cadastre os valores que se aplicam ao seu caso antes de calcular uma permanência.</p></div><div className="setting-inputs custom-rule-form"><label><span>Nome</span><input value={draft.label} placeholder="Ex.: Reino Unido" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><label><span>Código</span><input value={draft.countryCode} placeholder="GB" onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })} /></label><label><span>Limite</span><input type="number" inputMode="numeric" min="1" step="1" value={draft.limit} onChange={(event) => setDraft({ ...draft, limit: event.target.value })} /></label><label><span>Janela</span><input type="number" inputMode="numeric" min="1" step="1" value={draft.windowDays} onChange={(event) => setDraft({ ...draft, windowDays: event.target.value })} /></label><label><span>Alerta</span><input type="number" inputMode="numeric" min="0" step="1" value={draft.warningAt} onChange={(event) => setDraft({ ...draft, warningAt: event.target.value })} /></label><button className="button secondary" onClick={addRule}>＋ Adicionar regra</button>{ruleError && <p className="field-error" role="alert">{ruleError}</p>}</div></section><section className="settings-section"><div className="settings-heading"><h3>Compartilhar ou guardar</h3><p>O link leva uma cópia de todas as viagens e regras. Quem tiver o link vê esses dados — não é um link privado.</p></div><div className="settings-actions"><button className="button secondary" onClick={onShare}>↗ Copiar link com os dados</button><button className="button secondary" onClick={onExport}>↓ Guardar backup</button></div></section><section className="legal-note"><strong>Sobre o cálculo</strong><p>O app conta dias de presença registrados: entrada e saída contam, e o dia de viagem conta para os dois países. Cada país é contado numa janela móvel: em qualquer dia, a Itália olha os últimos 180 dias (máximo 90) e o Brasil os últimos 360 (máximo 180). A residência fiscal também depende de fatos que não são dias — domicílio, registro na anagrafe/AIRE, intenção de permanecer — e deve ser confirmada com um contador.</p></section></div>;
}

function TripModal({ trip, rules, trips, today, onClose, onSave, onDelete }: { trip: Trip | null; rules: Rule[]; trips: Trip[]; today: string; onClose: () => void; onSave: (trip: Trip) => boolean; onDelete?: (id: string) => void }) {
  const [ruleChoice, setRuleChoice] = useState(() => trip ? ruleForTrip(rules, trip)?.id ?? NO_RULE : rules[0]?.id ?? NO_RULE);
  const rule = ruleForChoice(rules, ruleChoice);
  const selectedRuleId = rule?.id ?? NO_RULE;
  const [country, setCountry] = useState(() => trip?.country || defaultCountry(ruleForChoice(rules, ruleChoice)));
  const [start, setStart] = useState(trip?.start || today);
  const [end, setEnd] = useState(trip?.end || today);
  const [notes, setNotes] = useState(trip?.notes || "");
  const invalid = !start || !end || end < start;
  const candidate = { id: trip?.id, ...ruleFields(rule), start, end };
  const geoConflict = invalid ? undefined : findConflicts(trips, candidate).otherRegion[0];
  const simulation = rule && !invalid ? simulateTrip(rule, trips, candidate) : null;
  // Unsafe plans that are not over yet need a second click; past trips are records and save at once.
  const candidateKey = selectedRuleId + "|" + start + "|" + end;
  const needsConfirm = Boolean(simulation && !simulation.safe && end >= today);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const confirming = needsConfirm && confirmedFor === candidateKey;
  function save() {
    if (needsConfirm && !confirming) { setConfirmedFor(candidateKey); return; }
    onSave({ id: trip?.id || newTripId(), ...ruleFields(rule), country: country.trim() || rule?.label || "Outro", start, end, notes });
  }
  function choose(value: string) {
    setRuleChoice(value);
    setCountry(defaultCountry(ruleForChoice(rules, value)));
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="trip-title"><div className="modal-header"><div><p className="eyebrow">{trip ? "EDITAR VIAGEM" : "NOVA VIAGEM"}</p><h2 id="trip-title">{trip ? "Datas da viagem" : "Registrar viagem"}</h2></div><button className="circle-button" onClick={onClose} aria-label="Fechar">×</button></div><div className="modal-fields"><div className="field-group"><label htmlFor="trip-rule">País ou regime</label><select id="trip-rule" value={selectedRuleId} onChange={(event) => choose(event.target.value)}>{rules.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value={NO_RULE}>{NO_RULE_LABEL}</option></select></div><div className="field-group"><label htmlFor="trip-country">País</label><input id="trip-country" value={country} onChange={(event) => setCountry(event.target.value)} /></div><div className="date-fields"><div className="field-group"><label htmlFor="trip-start">Entrada</label><input id="trip-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div><div className="field-group"><label htmlFor="trip-end">Saída</label><input id="trip-end" type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div></div><div className="field-group"><label htmlFor="trip-notes">Observação <span>(opcional)</span></label><textarea id="trip-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: visita à família" rows={3} /></div>{invalid && <p className="field-error" role="alert">A saída precisa ser igual ou posterior à entrada.</p>}{geoConflict && <p className="field-error" role="alert">Conflito: sobrepõe-se ao período em {displayCountry(geoConflict.country)} ({shortDate(geoConflict.start)} — {shortDate(geoConflict.end)}).</p>}{simulation && !geoConflict && <p className={"field-forecast " + (simulation.safe ? "safe" : "danger")} role="status">{simulation.firstOverDate ? "Excede o limite de " + rule?.limit + " dias em " + plural(simulation.excessDays, "dia", "dias") + " a partir de " + formatFullDate(simulation.firstOverDate) + "." : simulation.affectedTrips.length > 0 ? "Afeta viagem futura." : simulation.worsenedTrips.length > 0 ? "Piora viagem futura." : "Dentro do limite: pico de " + simulation.maxUsed + " de " + rule?.limit + " dias."}{simulation.affectedTrips.map((item) => " A viagem de " + shortDate(item.trip.start) + " (" + displayCountry(item.trip.country) + ") passaria a exceder em " + plural(item.excessDays, "dia", "dias") + ".").join("")}{simulation.worsenedTrips.map((item) => " Sua viagem de " + shortDate(item.trip.start) + " — " + shortDate(item.trip.end) + " (" + displayCountry(item.trip.country) + ") já excede o limite; este plano piora em " + plural(item.excessDays, "dia", "dias") + ".").join("")}</p>}</div><div className="modal-actions">{onDelete && trip && <button className="text-button danger-text" onClick={() => onDelete(trip.id)}>Excluir</button>}<span /><button className="button secondary" onClick={onClose}>Cancelar</button><button className={"button primary" + (confirming ? " danger" : "")} disabled={invalid || !!geoConflict} onClick={save}>{confirming ? "Salvar mesmo assim" : "Salvar viagem"}</button></div></section></div>;
}
