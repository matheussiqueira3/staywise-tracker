import { Redis } from "@upstash/redis";
import { seedState } from "@/data/seed";
import { normalizeState } from "@/lib/share";
import type { TrackerState } from "@/lib/types";

const STATE_KEY = "staywise:shared-state:v1";

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
    const stored = normalizeStored(await redis.get<unknown>(STATE_KEY));
    if (stored) return Response.json({ state: stored, source: "shared" });
    await redis.set(STATE_KEY, seedState);
    return Response.json({ state: seedState, source: "seed" });
  } catch {
    return Response.json({ error: "O armazenamento compartilhado está indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const state = normalizeState(body);
    if (!state) return Response.json({ error: "Estado inválido." }, { status: 400 });
    await getRedis().set(STATE_KEY, state);
    return Response.json({ state, saved: true });
  } catch {
    return Response.json({ error: "Não foi possível salvar no armazenamento compartilhado." }, { status: 503 });
  }
}
