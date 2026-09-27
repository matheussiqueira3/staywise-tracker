import { normalizeState } from "./share";
import type { TrackerState } from "./types";

/** What the server stores: the state plus a revision that increases on every accepted write. */
export type StoredState = { revision: number; state: TrackerState };
export type WriteRequest = { state: TrackerState; baseRevision: number };
export type WriteResult = { ok: true; next: StoredState } | { ok: false; current: StoredState };
/** Client-side bookkeeping: the server revision the local copy is based on, and whether it has unsynced edits. */
export type LocalSyncMeta = { revision: number | null; dirty: boolean };

function validRevision(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }

/** Reads a stored value. Values written before revisions existed are a bare state and count as revision 0. */
export function parseStored(value: unknown): StoredState | null {
  if (typeof value === "string") {
    try { return parseStored(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const item = value as { revision?: unknown; state?: unknown };
  if ("state" in item) {
    const state = normalizeState(item.state);
    return state && validRevision(item.revision) ? { revision: item.revision, state } : null;
  }
  const legacy = normalizeState(value);
  return legacy ? { revision: 0, state: legacy } : null;
}

export function parseWriteRequest(value: unknown): WriteRequest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { state?: unknown; baseRevision?: unknown };
  const state = normalizeState(item.state);
  return state && validRevision(item.baseRevision) ? { state, baseRevision: item.baseRevision } : null;
}

/** Accepts a write only when it is based on the current revision, so a stale device cannot overwrite newer data. */
export function resolveWrite(current: StoredState | null, request: WriteRequest): WriteResult {
  const currentRevision = current?.revision ?? 0;
  if (current && request.baseRevision !== currentRevision) return { ok: false, current };
  return { ok: true, next: { revision: currentRevision + 1, state: request.state } };
}

export function parseLocalMeta(value: string | null): LocalSyncMeta | null {
  if (!value) return null;
  try {
    const item = JSON.parse(value) as { revision?: unknown; dirty?: unknown };
    return { revision: validRevision(item.revision) ? item.revision : null, dirty: item.dirty === true };
  } catch { return null; }
}

export type Hydration = { state: TrackerState; revision: number; push: boolean; discardedLocal: TrackerState | null };

/**
 * Decides which copy wins when the server responds. Unsynced local edits are kept and pushed only when
 * the server has not changed since they were made; otherwise the server wins and the local copy is returned
 * so the caller can keep it as a backup.
 */
export function chooseHydration(server: StoredState, local: TrackerState | null, meta: LocalSyncMeta | null): Hydration {
  if (local && meta?.dirty) {
    if (meta.revision === server.revision) return { state: local, revision: server.revision, push: true, discardedLocal: null };
    return { state: server.state, revision: server.revision, push: false, discardedLocal: local };
  }
  return { state: server.state, revision: server.revision, push: false, discardedLocal: null };
}
