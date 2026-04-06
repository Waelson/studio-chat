"""Mapeia eventos do LangGraph para linhas SSE compatíveis com o frontend."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessageChunk, ToolMessage

from src.pdf_tool import GERAR_PDF_TOOL_NAME


def _chunk_text_delta(chunk: Any) -> str:
    if chunk is None:
        return ""
    content = getattr(chunk, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                if part.get("type") == "text":
                    parts.append(str(part.get("text", "")))
                elif "text" in part:
                    parts.append(str(part["text"]))
        return "".join(parts)
    return ""


def _tool_output_as_str(output: Any) -> str:
    if isinstance(output, ToolMessage):
        c = output.content
        return c if isinstance(c, str) else str(c)
    if isinstance(output, str):
        return output
    return str(output)


def _parse_pdf_tool_json(text: str) -> dict[str, str] | None:
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    fid = data.get("file_id")
    fn = data.get("filename")
    if not fid or not fn or data.get("error"):
        return None
    if not isinstance(fid, str) or not isinstance(fn, str):
        return None
    return {"file_id": fid, "filename": fn}


def _is_tool_only_chunk(chunk: Any) -> bool:
    """Evita enviar pedaços que são só tool calls ao cliente."""
    if isinstance(chunk, AIMessageChunk):
        tcc = getattr(chunk, "tool_call_chunks", None) or []
        if tcc:
            return True
        if getattr(chunk, "tool_calls", None):
            return True
    return False


async def agent_to_sse_lines(
    agent: Any,
    messages_payload: dict[str, Any],
) -> AsyncIterator[str]:
    """Emite linhas `data: {...}\\n\\n` com type content e, após gerar_pdf, type file."""
    async for event in agent.astream_events(
        messages_payload,
        version="v2",
        config={"recursion_limit": 25},
    ):
        ev_name = event.get("event")
        if ev_name == "on_tool_end":
            tool_name = str(event.get("name") or "")
            if tool_name != GERAR_PDF_TOOL_NAME and not tool_name.endswith(
                f".{GERAR_PDF_TOOL_NAME}",
            ):
                continue
            raw_out = event.get("data", {}).get("output")
            text = _tool_output_as_str(raw_out)
            parsed = _parse_pdf_tool_json(text)
            if not parsed:
                continue
            file_id = parsed["file_id"]
            filename = parsed["filename"]
            payload = json.dumps(
                {
                    "type": "file",
                    "url": f"/api/files/{file_id}",
                    "filename": filename,
                },
                ensure_ascii=False,
            )
            yield f"data: {payload}\n\n"
            continue

        if ev_name != "on_chat_model_stream":
            continue
        chunk = event.get("data", {}).get("chunk")
        if chunk is None or _is_tool_only_chunk(chunk):
            continue
        delta = _chunk_text_delta(chunk)
        if not delta:
            continue
        payload = json.dumps(
            {"type": "content", "delta": delta},
            ensure_ascii=False,
        )
        yield f"data: {payload}\n\n"
