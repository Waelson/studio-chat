import "dotenv/config";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const chatBodySchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
});

function parseAllowedModels(): string[] {
  const raw = process.env.ALLOWED_MODELS?.trim();
  if (!raw) {
    return ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-5.4"];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isModelAllowed(model: string, allowed: string[]): boolean {
  return allowed.includes(model);
}

function agentBaseUrl(): string {
  const raw = process.env.AGENT_URL?.trim() ?? "http://127.0.0.1:8001";
  return raw.replace(/\/$/, "");
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin:
    process.env.CORS_ORIGIN === "*"
      ? true
      : (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  methods: ["GET", "POST", "OPTIONS"],
});

app.get("/api/health", async () => {
  const base = agentBaseUrl();
  let agentReachable = false;
  let agentError: string | undefined;
  try {
    const r = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentReachable = r.ok;
    if (!r.ok) {
      agentError = `HTTP ${r.status}`;
    }
  } catch (err: unknown) {
    agentError = err instanceof Error ? err.message : String(err);
  }
  return {
    ok: true,
    agent: {
      url: base,
      reachable: agentReachable,
      ...(agentError ? { error: agentError } : {}),
    },
  };
});

app.get("/api/models", async () => {
  const models = parseAllowedModels();
  return { models };
});

app.get<{
  Params: { fileId: string };
}>("/api/files/:fileId", async (request, reply) => {
  const { fileId } = request.params;
  const url = `${agentBaseUrl()}/api/files/${encodeURIComponent(fileId)}`;
  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    request.log.error({ err, url }, "agent file fetch failed");
    return reply.status(503).send({
      error:
        "Agente indisponível. Inicie o serviço Python (apps/agent) e defina AGENT_URL se necessário.",
      detail,
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return reply.status(upstream.status).send(text || `HTTP ${upstream.status}`);
  }

  const ct = upstream.headers.get("content-type") ?? "application/pdf";
  const cd = upstream.headers.get("content-disposition");
  reply.header("Content-Type", ct);
  if (cd) {
    reply.header("Content-Disposition", cd);
  }

  const webBody = upstream.body;
  if (!webBody) {
    return reply.status(502).send({ error: "Resposta do agente sem corpo." });
  }

  return reply.send(
    Readable.fromWeb(webBody as import("stream/web").ReadableStream),
  );
});

app.post("/api/chat", async (request, reply) => {
  const parsed = chatBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Requisição inválida.",
      details: parsed.error.flatten(),
    });
  }

  const { model, messages } = parsed.data;
  const allowed = parseAllowedModels();
  if (!isModelAllowed(model, allowed)) {
    return reply.status(400).send({
      error: "Modelo não permitido",
      allowed,
    });
  }

  const abortController = new AbortController();
  const agentUrl = `${agentBaseUrl()}/api/chat`;

  let upstream: Response;
  try {
    upstream = await fetch(agentUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
      signal: abortController.signal,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    request.log.error({ err, agentUrl }, "agent fetch failed");
    return reply.status(503).send({
      error:
        "Agente indisponível. Inicie o serviço Python (apps/agent) e defina AGENT_URL se necessário.",
      detail,
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let payload: unknown = { error: text || `HTTP ${upstream.status}` };
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      /* mantém texto */
    }
    return reply.status(upstream.status).send(payload);
  }

  const webBody = upstream.body;
  if (!webBody) {
    return reply.status(502).send({ error: "Resposta do agente sem corpo." });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const streamOut = reply.raw;
  streamOut.on("close", () => {
    abortController.abort();
  });

  const nodeReadable = Readable.fromWeb(
    webBody as import("stream/web").ReadableStream,
  );

  try {
    await pipeline(nodeReadable, streamOut);
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      return;
    }
    request.log.error({ err }, "chat proxy pipeline error");
    if (!streamOut.writableEnded) {
      streamOut.destroy();
    }
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Servidor em http://${host}:${port} (proxy SSE → ${agentBaseUrl()})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
