"""API FastAPI do agente LangGraph com streaming SSE."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import UUID

from dotenv import load_dotenv

# Carrega apps/agent/.env antes de imports do projeto. Guardamos a chave aqui para o
# handler não depender de um segundo lookup (e para passar explicitamente ao ChatOpenAI).
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_FILE)
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()

# Usa o logger do Uvicorn para as linhas aparecerem no terminal por omissão.
_agent_log = logging.getLogger("uvicorn.error")

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel, Field

from src.pdf_tool import GENERATED_DIR, gerar_pdf
from src.sse_stream import agent_to_sse_lines
from src.weather_tool import previsao_tempo

app = FastAPI(title="Studio Chat Agent", version="1.0.0")


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, list):
        msg = str(detail)
    else:
        msg = str(detail)
    return JSONResponse({"error": msg}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def _validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        {"error": "Requisição inválida.", "details": exc.errors()},
        status_code=422,
    )

_cors = os.getenv("AGENT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
if _cors.strip() == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors.split(",") if o.strip()],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    model: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(min_length=1)


def _to_lc_messages(msgs: list[ChatMessage]) -> list[BaseMessage]:
    out: list[BaseMessage] = []
    for m in msgs:
        if m.role == "user":
            out.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            out.append(AIMessage(content=m.content))
        else:
            out.append(SystemMessage(content=m.content))
    return out


def _build_agent(model_name: str, api_key: str):
    llm = ChatOpenAI(
        model=model_name,
        api_key=api_key,
        streaming=True,
        temperature=0.2,
    )
    return create_react_agent(llm, [previsao_tempo, gerar_pdf])


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "service": "agent"}


@app.get("/api/files/{file_id}")
async def download_pdf(file_id: str) -> FileResponse:
    """Serve um PDF gerado por `gerar_pdf` (identificador UUID)."""
    try:
        UUID(file_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Ficheiro não encontrado.")
    pdf_path = GENERATED_DIR / f"{file_id}.pdf"
    meta_path = GENERATED_DIR / f"{file_id}.meta.json"
    if not pdf_path.is_file():
        raise HTTPException(status_code=404, detail="Ficheiro não encontrado.")
    filename = "documento.pdf"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(meta, dict) and isinstance(meta.get("filename"), str):
                filename = meta["filename"]
        except (OSError, json.JSONDecodeError):
            pass
    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=filename,
    )


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request) -> StreamingResponse:
    # Só corre se o pedido chegar ao FastAPI (validação Pydantic já passou).
    _agent_log.info(
        "agent: POST /api/chat recebido (model=%s, msgs=%d)",
        body.model,
        len(body.messages),
    )
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY não configurada no agente.",
        )

    lc_messages = _to_lc_messages(body.messages)
    graph = _build_agent(body.model, OPENAI_API_KEY)
    payload = {"messages": lc_messages}

    async def event_stream():
        try:
            async for line in agent_to_sse_lines(graph, payload):
                if await request.is_disconnected():
                    break
                yield line.encode("utf-8")
            if not await request.is_disconnected():
                done = json.dumps({"type": "done"}, ensure_ascii=False)
                yield f"data: {done}\n\n".encode("utf-8")
        except Exception as e:  # noqa: BLE001
            msg = json.dumps(
                {"type": "error", "message": str(e)},
                ensure_ascii=False,
            )
            yield f"data: {msg}\n\n".encode("utf-8")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
