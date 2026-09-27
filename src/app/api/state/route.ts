import { Redis } from "@upstash/redis";
import { seedState } from "@/data/seed";
import { parseStored, parseWriteRequest, resolveWrite, type StoredState } from "@/lib/sync";

const STATE_KEY = "staywise:shared-state:v1";

function getRedis() {
  return Redis.fromEnv();
}

export async function GET() {
  try {
    const redis = getRedis();
    const stored = parseStored(await redis.get<unknown>(STATE_KEY));
    if (stored) return Response.json(stored);
    const seeded: StoredState = { revision: 1, state: seedState };
    await redis.set(STATE_KEY, seeded);
    return Response.json(seeded);
  } catch {
    return Response.json({ error: "O armazenamento está indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Estado inválido." }, { status: 400 }); }
  const write = parseWriteRequest(body);
  if (!write) return Response.json({ error: "Estado inválido." }, { status: 400 });
  try {
    const redis = getRedis();
    // Read-compare-write is not atomic; acceptable for a single-person workspace, where two devices
    // saving within the same few milliseconds is the only way to lose the check.
    const result = resolveWrite(parseStored(await redis.get<unknown>(STATE_KEY)), write);
    if (!result.ok) return Response.json({ error: "Os dados mudaram em outro dispositivo.", ...result.current }, { status: 409 });
    await redis.set(STATE_KEY, result.next);
    return Response.json({ revision: result.next.revision, saved: true });
  } catch {
    return Response.json({ error: "Não foi possível salvar." }, { status: 503 });
  }
}
