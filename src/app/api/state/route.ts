import { Redis } from "@upstash/redis";
import { seedState } from "@/data/seed";
import { normalizeState } from "@/lib/share";
import type { TrackerState } from "@/lib/types";

const STATE_KEY = "staywise:shared-state:v1";
const MAX_PAYLOAD_BYTES = 512_000;

function getRedis() {
  return Redis.fromEnv();
}

function normalizeStored(value: unknown): TrackerState | null {
  if (typeof value === "string") {
    try { return normalizeState(JSON.parse(value)); } catch { return null; }
  }
  return normalizeState(value);
}

export async function GET() {
  try {
    const redis = getRedis();
    const raw = await redis.get<unknown>(STATE_KEY);
    const stored = normalizeStored(raw);
    if (raw !== null && !stored) return Response.json({ error: "O workspace compartilhado contém dados inválidos." }, { status: 500 });
    if (stored) return Response.json({ state: stored, source: "shared", semantics: "last-write-wins" });
    await redis.set(STATE_KEY, seedState);
    return Response.json({ state: seedState, source: "seed" });
  } catch {
    return Response.json({ error: "O armazenamento compartilhado está indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_PAYLOAD_BYTES) return Response.json({ error: "Estado muito grande." }, { status: 413 });
    const body = await request.json();
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) return Response.json({ error: "Estado muito grande." }, { status: 413 });
    const state = normalizeState(body);
    if (!state) return Response.json({ error: "Estado inválido." }, { status: 400 });
    await getRedis().set(STATE_KEY, state);
    return Response.json({ state, saved: true, semantics: "last-write-wins" });
  } catch {
    return Response.json({ error: "Não foi possível salvar no armazenamento compartilhado." }, { status: 503 });
  }
}
