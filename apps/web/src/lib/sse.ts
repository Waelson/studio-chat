/** Eventos SSE emitidos pelo backend de chat. */
export type ChatSseEvent =
  | { type: "content"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "file"; url: string; filename: string };

/**
 * Lê um corpo `ReadableStream` no formato SSE (`data: ...`) e invoca `onEvent` por evento JSON parseável.
 */
export async function readChatSseStream(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!body) {
    throw new Error("Resposta sem corpo");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.startsWith("data: ")
            ? line.slice(6)
            : line.slice(5);
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as ChatSseEvent;
            onEvent(parsed);
          } catch {
            /* ignora linhas não JSON */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
