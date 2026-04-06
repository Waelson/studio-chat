"""Ferramenta de previsão do tempo via Open-Meteo (sem chave de API)."""

from __future__ import annotations

import httpx
from langchain_core.tools import tool

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


async def _fetch_weather_text(cidade: str) -> str:
    cidade = cidade.strip()
    if not cidade:
        return "Informe o nome de uma cidade."

    async with httpx.AsyncClient(timeout=20.0) as client:
        geo = await client.get(GEOCODE_URL, params={"name": cidade, "count": 1})
        geo.raise_for_status()
        data = geo.json()
        results = data.get("results") or []
        if not results:
            return f'Não encontrei coordenadas para a cidade "{cidade}". Tente outro nome.'

        lat = results[0]["latitude"]
        lon = results[0]["longitude"]
        name = results[0].get("name", cidade)

        fc = await client.get(
            FORECAST_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                "hourly": "temperature_2m,precipitation_probability",
                "forecast_days": 2,
                "timezone": "auto",
            },
        )
        fc.raise_for_status()
        w = fc.json()
        cur = w.get("current", {})
        temp = cur.get("temperature_2m")
        hum = cur.get("relative_humidity_2m")
        code = cur.get("weather_code")
        wind = cur.get("wind_speed_10m")

        hourly = w.get("hourly", {})
        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        precip = hourly.get("precipitation_probability", [])
        linhas = [f"**{name}** (lat {lat:.2f}, lon {lon:.2f})"]
        if temp is not None:
            linhas.append(f"- Temperatura atual: **{temp:.1f} °C**")
        if hum is not None:
            linhas.append(f"- Umidade relativa: {hum}%")
        if wind is not None:
            linhas.append(f"- Vento (10 m): {wind} km/h")
        if code is not None:
            linhas.append(f"- Código meteorológico WMO: {code}")
        if times and temps:
            linhas.append("\nPróximas horas (amostra):")
            for i in range(min(6, len(times))):
                t = times[i]
                te = temps[i] if i < len(temps) else None
                pr = precip[i] if i < len(precip) else None
                extra = f", chuva {pr}%" if pr is not None else ""
                if te is not None:
                    linhas.append(f"  - {t}: {te:.1f} °C{extra}")
        return "\n".join(linhas)


@tool
async def previsao_tempo(cidade: str) -> str:
    """Retorna a previsão do tempo atual e próximas horas para uma cidade.

    Use quando o utilizador perguntar sobre tempo, clima, chuva ou temperatura
    numa localidade. O argumento é o nome da cidade (ex.: São Paulo, Lisboa, Paris).
    """
    try:
        return await _fetch_weather_text(cidade)
    except httpx.HTTPError as e:
        return f"Erro ao consultar o serviço meteorológico: {e!s}"
    except Exception as e:  # noqa: BLE001
        return f"Erro inesperado: {e!s}"
