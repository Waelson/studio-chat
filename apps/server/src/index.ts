import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import OpenAI from "openai";
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

const app = Fastify({ logger: true });

const openaiKey = process.env.OPENAI_API_KEY;
const openai = openaiKey
  ? new OpenAI({ apiKey: openaiKey })
  : null;

await app.register(cors, {
  origin:
    process.env.CORS_ORIGIN === "*"
      ? true
      : (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  methods: ["GET", "POST", "OPTIONS"],
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/models", async () => {
  const models = parseAllowedModels();
  return { models };
});

function writeSseChunk(
  raw: NodeJS.WritableStream,
  payload: Record<string, unknown>,
): void {
  raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.post("/api/chat", async (request, reply) => {
  if (!openai) {
    return reply.status(503).send({
      error: "OPENAI_API_KEY não configurada no servidor.",
    });
  }

  const parsed = chatBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Corpo inválido",
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

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const streamOut = reply.raw;

  // Fechar a *resposta* SSE indica que o cliente deixou de ler (tab, navegação, etc.).
  // Não usar `request.raw.on("close")`: em vários cenários (Node/Fastify) esse evento
  // dispara cedo demais e aborta o pedido à OpenAI com APIUserAbortError.
  streamOut.on("close", () => {
    abortController.abort();
  });

  try {
    const stream = await openai.chat.completions.create(
      {
        model,
        messages,
        stream: true,
      },
      { signal: abortController.signal },
    );

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        writeSseChunk(streamOut, { type: "content", delta });
      }
    }

    if (!abortController.signal.aborted) {
      writeSseChunk(streamOut, { type: "done" });
    }
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      // Cliente desligou-se ou cancelou; não é falha do serviço.
      return;
    }
    const message =
      err instanceof Error ? err.message : "Erro desconhecido ao contactar a OpenAI";
    writeSseChunk(streamOut, { type: "error", message });
    request.log.error({ err }, "chat stream error");
  } finally {
    if (!streamOut.writableEnded) {
      streamOut.end();
    }
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Servidor em http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
