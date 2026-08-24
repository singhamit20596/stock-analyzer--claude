"""A single JSON-returning call, against whichever model has a key.

Gemini is preferred because its free tier covers this app's usage; Anthropic is
used when its key is the one present. Neither SDK is imported: both are plain
REST calls over `httpx`, which is already a dependency. That is deliberate —
the venv lives on an iCloud path where importing a large package from cold has
been measured at eleven minutes, and a news button should not be able to hang
on a package load.

`available()` reports which provider will be used, so the UI can say what it is
running on rather than failing at the click.
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

import httpx

TIMEOUT = 120.0

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
# Overridable, because model names move. If this one is gone, the code asks the
# API which models exist rather than failing.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_NEWS_MODEL", "claude-opus-5")
ANTHROPIC_VERSION = "2023-06-01"

_resolved_gemini_model: Optional[str] = None


def gemini_key() -> str:
    return (os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY") or "").strip()


def anthropic_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def available() -> Optional[str]:
    """"gemini", "anthropic", or None when nothing is configured."""
    if gemini_key():
        return "gemini"
    if anthropic_key():
        return "anthropic"
    return None


def extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Parse a model's JSON, tolerating a ```json fence or stray commentary."""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    start, end = candidate.find("{"), candidate.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(candidate[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _gemini_models(key: str) -> List[str]:
    try:
        response = httpx.get(f"{GEMINI_ENDPOINT}/models?key={key}", timeout=30.0)
        if response.status_code != 200:
            return []
        return [m.get("name", "").split("/")[-1]
                for m in response.json().get("models", [])
                if "generateContent" in (m.get("supportedGenerationMethods") or [])]
    except Exception:
        return []


def _pick_gemini_model(key: str) -> str:
    """The configured model, or the newest flash-class one the key can use."""
    global _resolved_gemini_model
    if _resolved_gemini_model:
        return _resolved_gemini_model

    names = _gemini_models(key)
    if not names or GEMINI_MODEL in names:
        _resolved_gemini_model = GEMINI_MODEL
        return GEMINI_MODEL

    # Flash is the free tier's workhorse; fall back to anything usable.
    flash = sorted((n for n in names if "flash" in n and "thinking" not in n),
                   reverse=True)
    _resolved_gemini_model = flash[0] if flash else names[0]
    return _resolved_gemini_model


def _call_gemini(system: str, prompt: str, key: str) -> str:
    model = _pick_gemini_model(key)
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            # Ask for JSON directly rather than hoping for it.
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 8192,
        },
    }
    response = httpx.post(f"{GEMINI_ENDPOINT}/models/{model}:generateContent?key={key}",
                          json=body, timeout=TIMEOUT)
    if response.status_code == 429:
        raise RuntimeError(
            "Gemini's free tier is rate-limited right now. Wait a minute and try again.")
    if response.status_code != 200:
        detail = (response.json().get("error", {}).get("message")
                  if response.headers.get("content-type", "").startswith("application/json")
                  else response.text[:200])
        raise RuntimeError(f"Gemini refused the request ({response.status_code}): {detail}")

    candidates = response.json().get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned nothing to read.")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts)


def _call_anthropic(system: str, prompt: str, key: str) -> str:
    response = httpx.post(
        ANTHROPIC_ENDPOINT,
        headers={"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION,
                 "content-type": "application/json"},
        json={"model": ANTHROPIC_MODEL, "max_tokens": 8000, "system": system,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Anthropic refused the request ({response.status_code}).")
    return "".join(b.get("text", "") for b in response.json().get("content", []))


def ask_for_json(system: str, prompt: str) -> Dict[str, Any]:
    """Run the prompt against the configured provider and parse its JSON."""
    provider = available()
    if provider is None:
        raise RuntimeError(
            "No model key configured. Set GEMINI_API_KEY (free from "
            "aistudio.google.com) or ANTHROPIC_API_KEY before starting the server.")

    text = (_call_gemini(system, prompt, gemini_key()) if provider == "gemini"
            else _call_anthropic(system, prompt, anthropic_key()))

    parsed = extract_json(text)
    if parsed is None:
        raise RuntimeError(f"{provider.title()} did not return readable JSON.")
    parsed["_provider"] = provider
    return parsed
