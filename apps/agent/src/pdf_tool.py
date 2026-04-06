"""Geração de PDF simples (texto) para download pelo utilizador."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Optional

from fpdf import FPDF
from langchain_core.tools import tool

# Nome registado na ferramenta LangChain (usado em sse_stream para eventos SSE).
GERAR_PDF_TOOL_NAME = "gerar_pdf"

_MAX_TEXT_CHARS = 50_000

# Diretório base: apps/agent/data/generated/
GENERATED_DIR = Path(__file__).resolve().parent.parent / "data" / "generated"


def _sanitize_filename(nome: Optional[str]) -> str:
    """Normaliza o nome do ficheiro para um único segmento seguro (apenas basename)."""
    if not nome or not str(nome).strip():
        return "documento.pdf"
    base = Path(nome.strip()).name
    if not base or base in (".", ".."):
        return "documento.pdf"
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", base)[:120]
    if not safe:
        return "documento.pdf"
    if not safe.lower().endswith(".pdf"):
        safe = f"{safe}.pdf"
    return safe


def _write_pdf(texto: str, pdf_path: Path) -> None:
    """Escreve um PDF com texto multilinha (UTF-8, Helvetica)."""
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    truncated = texto if len(texto) <= _MAX_TEXT_CHARS else texto[:_MAX_TEXT_CHARS]
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 8, truncated)
    pdf.output(str(pdf_path))


@tool
def gerar_pdf(texto: str, nome_ficheiro: Optional[str] = None) -> str:
    """Cria um ficheiro PDF com o texto indicado e disponibiliza-o para download.

    Usa quando o utilizador pedir explicitamente um PDF, documento em PDF,
    ou exportar texto para PDF. O argumento `texto` é o conteúdo completo do
    documento. Opcionalmente `nome_ficheiro` (ex.: relatorio.pdf).

    Após gerar, confirma ao utilizador que o PDF está pronto para descarregar.
    """
    if not texto or not str(texto).strip():
        return json.dumps(
            {"error": "texto vazio", "file_id": "", "filename": ""},
            ensure_ascii=False,
        )
    file_id = str(uuid.uuid4())
    safe_name = _sanitize_filename(nome_ficheiro)
    pdf_path = GENERATED_DIR / f"{file_id}.pdf"
    meta_path = GENERATED_DIR / f"{file_id}.meta.json"
    try:
        _write_pdf(texto.strip(), pdf_path)
    except Exception as e:  # noqa: BLE001
        return json.dumps(
            {"error": str(e), "file_id": "", "filename": ""},
            ensure_ascii=False,
        )
    meta_path.write_text(
        json.dumps({"filename": safe_name}, ensure_ascii=False),
        encoding="utf-8",
    )
    payload = {
        "file_id": file_id,
        "filename": safe_name,
    }
    return json.dumps(payload, ensure_ascii=False)
