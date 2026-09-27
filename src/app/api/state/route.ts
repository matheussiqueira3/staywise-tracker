import { Redis } from "@upstash/redis";
import { seedState } from "@/data/seed";
import { parseWriteBody, readStored, resolveWrite, type StoredState } from "@/lib/sync";

const STATE_KEY = "staywise:shared-state:v1";
const INVALID_STORED = "O workspace contém dados inválidos.";

function getRedis() {
  return Redis.fromEnv();
}

export async function GET() {
  try {
    const redis = getRedis();
    const read = readStored(await redis.get<unknown>(STATE_KEY));
    // Never reseed over a stored value that fails to parse: that would destroy data the user can still recover.
    if (read.kind === "invalid") return Response.json({ error: INVALID_STORED }, { status: 500 });
    if (read.kind === "ok") return Response.json(read.stored);
    const seeded: StoredState = { revision: 1, state: seedState };
    await redis.set(STATE_KEY, seeded);
    return Response.json(seeded);
  } catch {
    return Response.json({ error: "O armazenamento está indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let text: string;
  try { text = await request.text(); } catch { return Response.json({ error: "Estado inválido." }, { status: 400 }); }
  const body = parseWriteBody(request.headers.get("content-length"), text);
  if (!body.ok) return Response.json({ error: body.status === 413 ? "Estado muito grande." : "Estado inválido." }, { status: body.status });
  try {
    const redis = getRedis();
    const read = readStored(await redis.get<unknown>(STATE_KEY));
    // Same as GET: a write must not silently replace stored data that fails to parse.
    if (read.kind === "invalid") return Response.json({ error: INVALID_STORED }, { status: 500 });
    // Read-compare-write is not atomic; acceptable for a single-person workspace, where two devices
    // saving within the same few milliseconds is the only way to lose the check.
    const result = resolveWrite(read.kind === "ok" ? read.stored : null, body.write);
    if (!result.ok) return Response.json({ error: "Os dados mudaram em outro dispositivo.", ...result.current }, { status: 409 });
    await redis.set(STATE_KEY, result.next);
    return Response.json({ revision: result.next.revision, saved: true });
  } catch {
    return Response.json({ error: "Não foi possível salvar." }, { status: 503 });
  }
}
