import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Bot,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { ChatMarkdown } from "./components/ChatMarkdown";
import { readChatSseStream, type ChatSseEvent } from "./lib/sse";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
};

/** IDs únicos para chaves React. `randomUUID` não existe em HTTP na LAN (só em contexto seguro). */
function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { models: string[] };
        if (cancelled) return;
        setModels(data.models);
        setModel((m) => m || data.models[0] || "");
        setModelsError(null);
      } catch {
        if (!cancelled) {
          setModelsError("Não foi possível carregar os modelos.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const appendAssistantDelta = useCallback((assistantId: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: m.content + delta }
          : m,
      ),
    );
  }, []);

  const finishAssistant = useCallback((assistantId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, streaming: false } : m,
      ),
    );
  }, []);

  const handleSseEvent = useCallback(
    (ev: ChatSseEvent, assistantId: string) => {
      if (ev.type === "content") {
        appendAssistantDelta(assistantId, ev.delta);
      } else if (ev.type === "done") {
        finishAssistant(assistantId);
      } else if (ev.type === "error") {
        setError(ev.message);
        finishAssistant(assistantId);
      }
    },
    [appendAssistantDelta, finishAssistant],
  );

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending || !model) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setError(null);
    setInput("");
    setSending(true);

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
    };
    const assistantId = uid();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    const history = [...messages, userMsg];
    setMessages([...history, assistantPlaceholder]);

    const apiMessages = [...history].map(({ role, content }) => ({
      role,
      content,
    }));

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: apiMessages }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          typeof errBody === "object" &&
          errBody &&
          "error" in errBody &&
          typeof (errBody as { error: unknown }).error === "string"
            ? (errBody as { error: string }).error
            : `Erro ${res.status}`;
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      await readChatSseStream(
        res.body,
        (e) => handleSseEvent(e, assistantId),
        ac.signal,
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } else {
        setError(e instanceof Error ? e.message : "Falha na rede");
        finishAssistant(assistantId);
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.streaming
            ? { ...m, streaming: false }
            : m,
        ),
      );
      setSending(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div
      className={
        theme === "dark"
          ? "font-sans flex min-h-dvh w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-zinc-950 text-zinc-100"
          : "font-sans flex min-h-dvh w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-zinc-50 text-zinc-900"
      }
    >
      <header
        className={
          theme === "dark"
            ? "sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md"
            : "sticky top-0 z-10 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md"
        }
      >
        <div className="mx-auto flex min-w-0 max-w-3xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 shrink items-center gap-2">
            <div
              className={
                theme === "dark"
                  ? "flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/20"
                  : "flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-md"
              }
            >
              <Sparkles className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">Chat</h1>
              <p
                className={
                  theme === "dark"
                    ? "text-xs text-zinc-500"
                    : "text-xs text-zinc-500"
                }
              >
                Chat com streaming
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="relative max-w-[min(12rem,42vw)] sm:max-w-none">
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!!modelsError || models.length === 0}
                className={
                  theme === "dark"
                    ? "h-9 appearance-none rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 pr-8 pl-3 text-xs font-medium text-zinc-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    : "h-9 appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-8 pl-3 text-xs font-medium text-zinc-800 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                }
                aria-label="Modelo OpenAI"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                aria-hidden
              />
            </div>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className={
                theme === "dark"
                  ? "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800"
                  : "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100"
              }
              aria-label={theme === "dark" ? "Tema claro" : "Tema escuro"}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col overflow-x-hidden px-3 pb-28 pt-6 sm:px-4">
        {modelsError && (
          <div
            className={
              theme === "dark"
                ? "mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                : "mb-4 rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            }
            role="alert"
          >
            {modelsError}
          </div>
        )}

        {messages.length === 0 && !modelsError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 py-12 text-center">
            <div
              className={
                theme === "dark"
                  ? "rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-8"
                  : "rounded-2xl border border-zinc-200 bg-white px-6 py-8 shadow-sm"
              }
            >
              <p className="text-lg font-medium tracking-tight">
                Como posso ajudar hoje?
              </p>
              <p
                className={
                  theme === "dark"
                    ? "mt-2 max-w-sm text-sm text-zinc-400"
                    : "mt-2 max-w-sm text-sm text-zinc-600"
                }
              >
                Escolha um modelo no topo e escreva uma mensagem. A resposta
                aparece em tempo real via SSE.
              </p>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4" aria-live="polite">
          {messages.map((m) => (
            <article
              key={m.id}
              className={
                m.role === "user"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div
                className={
                  m.role === "user"
                    ? theme === "dark"
                      ? "flex max-w-[85%] gap-3 rounded-2xl rounded-br-md border border-violet-500/20 bg-violet-600/15 px-4 py-3"
                      : "flex max-w-[85%] gap-3 rounded-2xl rounded-br-md border border-violet-200 bg-violet-50 px-4 py-3"
                    : theme === "dark"
                      ? "flex max-w-[85%] gap-3 rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900/80 px-4 py-3"
                      : "flex max-w-[85%] gap-3 rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-4 py-3 shadow-sm"
                }
              >
                <div
                  className={
                    m.role === "user"
                      ? theme === "dark"
                        ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300"
                        : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
                      : theme === "dark"
                        ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300"
                        : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"
                  }
                  aria-hidden
                >
                  {m.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p
                    className={
                      theme === "dark"
                        ? "mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500"
                        : "mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500"
                    }
                  >
                    {m.role === "user" ? "Você" : "Assistente"}
                  </p>
                  {m.role === "assistant" ? (
                    <div className="min-w-0">
                      <ChatMarkdown content={m.content} theme={theme} />
                      {m.streaming && (
                        <span
                          className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-sm bg-violet-500 align-[-2px]"
                          aria-hidden
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      className={
                        theme === "dark"
                          ? "whitespace-pre-wrap text-sm leading-relaxed text-zinc-200"
                          : "whitespace-pre-wrap text-sm leading-relaxed text-zinc-800"
                      }
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        <div ref={bottomRef} />
      </main>

      {error && (
        <div
          className={
            theme === "dark"
              ? "fixed bottom-24 left-1/2 z-20 max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-red-500/30 bg-red-950/90 px-4 py-2 text-center text-sm text-red-200 shadow-lg backdrop-blur"
              : "fixed bottom-24 left-1/2 z-20 max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-900 shadow-lg"
          }
          role="alert"
        >
          {error}
        </div>
      )}

      <footer
        className={
          theme === "dark"
            ? "fixed bottom-0 left-0 right-0 z-10 w-full max-w-full min-w-0 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur-md"
            : "fixed bottom-0 left-0 right-0 z-10 w-full max-w-full min-w-0 border-t border-zinc-200/80 bg-white/95 backdrop-blur-md"
        }
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="mx-auto w-full min-w-0 max-w-3xl px-3 pt-3 sm:px-4">
          <div
            className={
              theme === "dark"
                ? "flex min-w-0 items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-2 shadow-inner"
                : "flex min-w-0 items-end gap-2 rounded-2xl border border-zinc-300 bg-zinc-50 p-2 shadow-inner"
            }
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                modelsError
                  ? "Configure o servidor para enviar mensagens…"
                  : "Mensagem…"
              }
              disabled={sending || !!modelsError || !model}
              className={
                theme === "dark"
                  ? "max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-base leading-snug text-zinc-100 placeholder:text-zinc-600 outline-none sm:text-sm"
                  : "max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-base leading-snug text-zinc-900 placeholder:text-zinc-400 outline-none sm:text-sm"
              }
              aria-label="Mensagem"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={
                sending || !input.trim() || !!modelsError || !model
              }
              className={
                theme === "dark"
                  ? "mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                  : "mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              }
              aria-label="Enviar"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
