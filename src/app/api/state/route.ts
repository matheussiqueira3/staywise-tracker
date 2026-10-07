import { Redis } from "@upstash/redis";
import { seedState } from "@/data/seed";
import { parseWriteBody, readStored, resolveWrite, type StoredState } from "@/lib/sync";

const STATE_KEY = "staywise:shared-state:v1";
const INVALID_STORED = "O workspace contém dados inválidos.";

const ATOMIC_WRITE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local expected = tonumber(ARGV[1])
if not current then
  if expected ~= 0 then return 0 end
  redis.call("SET", KEYS[1], ARGV[2])
  return 1
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= "table" or type(decoded.revision) ~= "number" then return -1 end
if decoded.revision ~= expected then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`;

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
    const result = resolveWrite(read.kind === "ok" ? read.stored : null, body.write);
    if (!result.ok) return Response.json({ error: "Os dados mudaram em outro dispositivo.", ...result.current }, { status: 409 });

    // The comparison and SET must be one Redis command. Two devices may both pass the read above; EVAL lets only the
    // writer whose base revision still matches commit. Upstash exposes EVAL directly in @upstash/redis.
    const committed = Number(await redis.eval(ATOMIC_WRITE_SCRIPT, [STATE_KEY], [body.write.baseRevision, JSON.stringify(result.next)]));
    if (committed === -1) return Response.json({ error: INVALID_STORED }, { status: 500 });
    if (committed !== 1) {
      const current = readStored(await redis.get<unknown>(STATE_KEY));
      if (current.kind === "invalid") return Response.json({ error: INVALID_STORED }, { status: 500 });
      if (current.kind === "ok") return Response.json({ error: "Os dados mudaram em outro dispositivo.", ...current.stored }, { status: 409 });
      return Response.json({ error: "Os dados mudaram em outro dispositivo." }, { status: 409 });
    }
    return Response.json({ revision: result.next.revision, saved: true });
  } catch {
    return Response.json({ error: "Não foi possível salvar." }, { status: 503 });
  }
}
