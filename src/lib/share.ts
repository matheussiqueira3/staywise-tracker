import type { TrackerState } from "./types";
function encode(value: string): string { return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode(value: string): string { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); return decodeURIComponent(escape(atob(padded))); }
export function encodeState(state: TrackerState): string { return encode(JSON.stringify(state)); }
export function decodeState(value: string): TrackerState | null { try { const parsed = JSON.parse(decode(value)) as TrackerState; return Array.isArray(parsed.trips) && Array.isArray(parsed.rules) ? parsed : null; } catch { return null; } }
