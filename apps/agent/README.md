# Agente Python (LangGraph + FastAPI)

Serviço que expõe `POST /api/chat` com **SSE** (`text/event-stream`), compatível com o frontend Studio Chat.

- **LangGraph** `create_react_agent` com **ChatOpenAI** em streaming.
- Ferramenta **`previsao_tempo`**: dados via [Open-Meteo](https://open-meteo.com/) (sem chave).

## Arranque rápido

```bash
cd apps/agent
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Defina OPENAI_API_KEY em .env

PYTHONPATH=. uvicorn src.main:app --reload --host 0.0.0.0 --port 8001
```

O Node (`apps/server`) encaminha o `/api/chat` para `http://127.0.0.1:8001` por defeito (`AGENT_URL`).
