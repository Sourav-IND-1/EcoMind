"""
EcoMind — Autonomous Green AI Orchestrator
FastAPI Backend with 4 Agents
Uses: google-genai (new SDK)
"""

import os
import re
import time
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ecomind")

# ─────────────────────────────────────────────────────────────────────────────
# Gemini Setup — new google.genai SDK
# ─────────────────────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
gemini_client = None

if GEMINI_API_KEY:
    try:
        from google import genai
        from google.genai import types as genai_types
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info("Gemini client initialised (google.genai SDK)")
    except ImportError:
        logger.warning("google-genai not installed; trying legacy google.generativeai")
        try:
            import google.generativeai as genai_legacy
            genai_legacy.configure(api_key=GEMINI_API_KEY)
            gemini_client = "legacy"
            logger.info("Using legacy google.generativeai")
        except Exception as e:
            logger.error(f"Could not initialise any Gemini SDK: {e}")
else:
    logger.warning("GEMINI_API_KEY not set — running in MOCK mode.")

# Model names
FLASH_MODEL = "gemini-2.0-flash"
PRO_MODEL   = "gemini-1.5-pro"   # available on free tier

# ─────────────────────────────────────────────────────────────────────────────
# Global State  (NEVER reset inside route functions except /reset)
# ─────────────────────────────────────────────────────────────────────────────
state: dict = {
    "grid":                    {"renewable_percent": 75, "status": "Solar"},
    "total_queries":           0,
    "total_cost_saved":        0.0,
    "total_carbon_saved_grams": 0.0,
    "cache_hits":              0,
    "model_breakdown":         {"flash": 0, "pro": 0, "queued": 0},
    "query_history":           [],
}

# In-memory prompt cache: compressed_prompt → llm_response
prompt_cache: dict[str, str] = {}

# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="EcoMind API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    prompt: str
    is_urgent: bool = False


class QueryResponse(BaseModel):
    original_prompt: str
    compressed_prompt: str
    complexity_score: int
    grid_status: dict
    model_selected: str
    llm_response: str
    cost_saved: float
    carbon_saved_grams: float
    cache_hit: bool
    queued: bool


# ─────────────────────────────────────────────────────────────────────────────
# AGENT 1 — Complexity Scorer
# ─────────────────────────────────────────────────────────────────────────────
def agent_complexity_scorer(prompt: str) -> int:
    """Score prompt complexity 1-10."""
    score = 1

    # Length component (up to +4)
    word_count = len(prompt.split())
    if word_count > 80:
        score += 4
    elif word_count > 50:
        score += 3
    elif word_count > 25:
        score += 2
    elif word_count > 10:
        score += 1

    # High-complexity keywords (+1 each, max +4)
    high_keywords = [
        "build", "create", "design", "explain", "compare",
        "analyze", "analyse", "implement", "develop", "architect",
        "generate", "write", "debug", "optimize",
    ]
    prompt_lower = prompt.lower()
    kw_hits = sum(1 for kw in high_keywords if kw in prompt_lower)
    score += min(kw_hits, 4)

    # Simple question patterns (−2 penalty)
    simple_patterns = [
        r"\bwhat is\b", r"\bwho is\b", r"\bwhen is\b",
        r"\bwhere is\b", r"\bhow many\b", r"\bwhat are\b",
        r"\bwhat\b.{0,20}\?$",
    ]
    if any(re.search(p, prompt_lower) for p in simple_patterns):
        score -= 2

    return max(1, min(10, score))


# ─────────────────────────────────────────────────────────────────────────────
# AGENT 2 — Grid Monitor
# ─────────────────────────────────────────────────────────────────────────────
def agent_grid_monitor() -> dict:
    """Read current grid status from global state."""
    return state["grid"].copy()


def is_green_grid(grid: dict) -> bool:
    return grid["renewable_percent"] > 50


# ─────────────────────────────────────────────────────────────────────────────
# AGENT 3 — Prompt Compressor
# ─────────────────────────────────────────────────────────────────────────────
FILLER_PATTERNS = [
    r"\bplease\b",
    r"\bcan you\b",
    r"\bcould you\b",
    r"\bcould you possibly\b",
    r"\bi was wondering\b",
    r"\bwould you mind\b",
    r"\bhey\b",
    r"\bthanks\b",
    r"\bthank you\b",
    r"\bkindly\b",
    r"\bjust\b",
    r"\bbasically\b",
    r"\bactually\b",
]


def agent_prompt_compressor(prompt: str) -> tuple[str, bool]:
    """
    Remove filler words and check cache.
    Returns (compressed_prompt, cache_hit).
    """
    compressed = prompt.strip()
    for pattern in FILLER_PATTERNS:
        compressed = re.sub(pattern, "", compressed, flags=re.IGNORECASE)

    # Collapse extra whitespace / punctuation artefacts
    compressed = re.sub(r"\s{2,}", " ", compressed).strip(" ,?!.")
    if not compressed:
        compressed = prompt.strip()

    cache_hit = compressed in prompt_cache
    return compressed, cache_hit


# ─────────────────────────────────────────────────────────────────────────────
# AGENT 4 — Smart Router
# ─────────────────────────────────────────────────────────────────────────────
BASELINE_COST   = 0.02
BASELINE_CARBON = 0.5
MODEL_COSTS     = {"flash": 0.0, "pro": 0.0, "queued": 0.0}
MODEL_CARBON    = {"flash": 0.01, "pro": 0.5, "queued": 0.0}


def agent_smart_router(
    score: int, grid: dict, compressed_prompt: str, is_urgent: bool
) -> dict:
    """Route query to the appropriate model."""
    green = is_green_grid(grid)

    # ── Routing decision ──────────────────────────────────────────────────────
    if score <= 6:
        selected = "flash"
    elif score >= 7 and green:
        selected = "pro"
    elif score >= 7 and not green and is_urgent:
        selected = "pro"   # urgent → bypass queue
    else:
        # score >= 7, dirty grid, not urgent → QUEUE
        return {
            "queued":             True,
            "model_selected":     "queued",
            "llm_response":       (
                "[Queued] This high-compute task is scheduled to run when "
                "renewable energy is above 50%. No Gemini API call made."
            ),
            "cost_saved":         BASELINE_COST - MODEL_COSTS["queued"],
            "carbon_saved_grams": BASELINE_CARBON - MODEL_CARBON["queued"],
        }

    # ── Call Gemini ───────────────────────────────────────────────────────────
    llm_response = _call_gemini(selected, compressed_prompt)
    return {
        "queued":             False,
        "model_selected":     selected,
        "llm_response":       llm_response,
        "cost_saved":         BASELINE_COST - MODEL_COSTS[selected],
        "carbon_saved_grams": BASELINE_CARBON - MODEL_CARBON[selected],
    }


MOCK_RESPONSES = {
    "what is 2 plus 2": "2 + 2 is 4.",
    "who invented electricity": (
        "Electricity wasn't 'invented' by a single person, but rather discovered and harnessed over time. "
        "Key contributors include Benjamin Franklin (proving lightning is electrical) and Michael Faraday "
        "(inventing the electric motor and generator)."
    ),
    "fastapi microservice with jwt": (
        "Here is a basic FastAPI microservice with JWT authentication:\n\n"
        "```python\n"
        "from fastapi import FastAPI, Depends, HTTPException\n"
        "from fastapi.security import OAuth2PasswordBearer\n"
        "import jwt\n\n"
        "app = FastAPI()\n"
        "oauth2_scheme = OAuth2PasswordBearer(tokenUrl='token')\n\n"
        "@app.get('/secure')\n"
        "def read_secure_data(token: str = Depends(oauth2_scheme)):\n"
        "    try:\n"
        "        payload = jwt.decode(token, 'SECRET_KEY', algorithms=['HS256'])\n"
        "        return {'status': 'success', 'user': payload.get('sub')}\n"
        "    except jwt.PyJWTError:\n"
        "        raise HTTPException(status_code=401, detail='Invalid token')\n"
        "```"
    ),
    "react component with useeffect": (
        "Here is a simple React component utilizing the useEffect hook to fetch data:\n\n"
        "```jsx\n"
        "import React, { useState, useEffect } from 'react';\n\n"
        "export default function DataFetcher() {\n"
        "  const [data, setData] = useState(null);\n\n"
        "  useEffect(() => {\n"
        "    fetch('https://api.example.com/data')\n"
        "      .then(res => res.json())\n"
        "      .then(data => setData(data));\n"
        "  }, []);\n\n"
        "  return (\n"
        "    <div>\n"
        "      {data ? <pre>{JSON.stringify(data)}</pre> : 'Loading...'}\n"
        "    </div>\n"
        "  );\n"
        "}\n"
        "```"
    )
}


def _get_mock_response(model_name: str, prompt: str) -> str:
    prompt_lower = prompt.lower()
    for key, val in MOCK_RESPONSES.items():
        if key in prompt_lower:
            return val
            
    # Generic fallback response
    return (
        f"This is a simulated response from {model_name} for your query:\n"
        f"\"{prompt}\"\n\n"
        f"The Autonomous Green AI Orchestrator successfully analyzed this query, scored its complexity, "
        f"monitored the grid energy status, and routed it to the optimal model ({model_name}) to minimize carbon footprint."
    )


def _call_gemini(model_key: str, prompt: str) -> str:
    """Call Gemini API with error handling. Supports new + legacy SDK."""
    model_name = FLASH_MODEL if model_key == "flash" else PRO_MODEL

    if not GEMINI_API_KEY or gemini_client is None:
        mock_resp = _get_mock_response(model_name, prompt)
        return f"{mock_resp}\n\n[Mode: Local Simulation (No API key set)]"

    try:
        if gemini_client == "legacy":
            # ── Legacy SDK path ───────────────────────────────────────────────
            import google.generativeai as genai_legacy
            model_obj = genai_legacy.GenerativeModel(model_name)
            resp = model_obj.generate_content(
                prompt,
                generation_config={"max_output_tokens": 300},
            )
            return resp.text

        else:
            # ── New SDK path (google.genai) ───────────────────────────────────
            from google.genai import types as genai_types
            resp = gemini_client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=300,
                ),
            )
            return resp.text

    except Exception as e:
        err = str(e)
        logger.error(f"Gemini API error ({model_name}): {err}")

        # Identify common errors
        is_429 = "429" in err or "RESOURCE_EXHAUSTED" in err
        is_400 = "400" in err
        is_auth = "invalid api key" in err.lower() or "api_key_invalid" in err.lower()

        # Generate a friendly warning label
        err_msg = ""
        if is_429:
            err_msg = "⏳ Rate limit reached (free tier quota exceeded)."
        elif is_auth or is_400:
            err_msg = "🔑 API Key issue (invalid or missing permissions)."
        else:
            err_msg = "🔌 API / Network connection issue."

        # Try fallback to flash if pro failed and it wasn't a general API rate limit/auth block
        if model_key == "pro" and not (is_429 or is_auth):
            try:
                logger.info("Falling back to flash model…")
                return _call_gemini("flash", prompt) + "\n\n[Note: Used flash fallback]"
            except Exception:
                pass

        # Return a simulated response, but clearly prefix it so they know it fell back
        mock_resp = _get_mock_response(model_name, prompt)
        return (
            f"{mock_resp}\n\n"
            f"⚠️ {err_msg} Fell back to a high-fidelity simulated response to keep your demo running."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _update_state(route_result: dict, cache_hit: bool) -> None:
    """Update global state after every query."""
    state["total_queries"] += 1
    state["total_cost_saved"] = round(
        state["total_cost_saved"] + route_result["cost_saved"], 6
    )
    state["total_carbon_saved_grams"] = round(
        state["total_carbon_saved_grams"] + route_result["carbon_saved_grams"], 6
    )
    if cache_hit:
        state["cache_hits"] += 1

    model_key = route_result["model_selected"]
    state["model_breakdown"][model_key] = (
        state["model_breakdown"].get(model_key, 0) + 1
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/query", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    """Run all 4 agents in sequence and return result."""
    original_prompt = request.prompt.strip()
    is_urgent       = request.is_urgent

    # Agent 1 — Complexity
    score = agent_complexity_scorer(original_prompt)

    # Agent 2 — Grid
    grid = agent_grid_monitor()

    # Agent 3 — Compress + Cache check
    compressed, cache_hit = agent_prompt_compressor(original_prompt)

    if cache_hit:
        # Return cached response immediately — no Gemini call
        cached_response = prompt_cache[compressed]
        result = {
            "original_prompt":     original_prompt,
            "compressed_prompt":   compressed,
            "complexity_score":    score,
            "grid_status":         grid,
            "model_selected":      "flash",
            "llm_response":        cached_response,
            "cost_saved":          BASELINE_COST,
            "carbon_saved_grams":  BASELINE_CARBON - MODEL_CARBON["flash"],
            "cache_hit":           True,
            "queued":              False,
        }
        _update_state(
            {"model_selected": "flash",
             "cost_saved":    BASELINE_COST,
             "carbon_saved_grams": BASELINE_CARBON - MODEL_CARBON["flash"]},
            cache_hit=True,
        )
        state["query_history"].append({**result, "timestamp": time.time()})
        state["query_history"] = state["query_history"][-20:]
        return result

    # Agent 4 — Smart Router
    route_result = agent_smart_router(score, grid, compressed, is_urgent)

    # Cache if we got a real response
    if not route_result["queued"]:
        prompt_cache[compressed] = route_result["llm_response"]

    result = {
        "original_prompt":    original_prompt,
        "compressed_prompt":  compressed,
        "complexity_score":   score,
        "grid_status":        grid,
        "model_selected":     route_result["model_selected"],
        "llm_response":       route_result["llm_response"],
        "cost_saved":         route_result["cost_saved"],
        "carbon_saved_grams": route_result["carbon_saved_grams"],
        "cache_hit":          False,
        "queued":             route_result["queued"],
    }

    _update_state(route_result, cache_hit=False)
    state["query_history"].append({**result, "timestamp": time.time()})
    state["query_history"] = state["query_history"][-20:]

    return result


@app.get("/stats")
async def get_stats():
    """Return global stats — reads from state only."""
    return {
        "total_queries":            state["total_queries"],
        "total_cost_saved":         state["total_cost_saved"],
        "total_carbon_saved_grams": state["total_carbon_saved_grams"],
        "cache_hits":               state["cache_hits"],
        "model_breakdown":          state["model_breakdown"].copy(),
        "query_history":            state["query_history"][-10:],
    }


@app.post("/grid/toggle")
async def toggle_grid():
    """Toggle grid between Solar (green) and Coal (dirty)."""
    if state["grid"]["renewable_percent"] > 50:
        state["grid"] = {"renewable_percent": 20, "status": "Coal"}
    else:
        state["grid"] = {"renewable_percent": 75, "status": "Solar"}
    logger.info(f"Grid toggled to: {state['grid']}")
    return {"grid": state["grid"]}


@app.post("/reset")
async def reset_stats():
    """Reset all global stats AND cache."""
    state["total_queries"]            = 0
    state["total_cost_saved"]         = 0.0
    state["total_carbon_saved_grams"] = 0.0
    state["cache_hits"]               = 0
    state["model_breakdown"]          = {"flash": 0, "pro": 0, "queued": 0}
    state["query_history"]            = []
    prompt_cache.clear()
    return {"message": "Stats reset successfully"}


@app.get("/health")
async def health():
    sdk_info = "none"
    if gemini_client == "legacy":
        sdk_info = "google.generativeai (legacy)"
    elif gemini_client is not None:
        sdk_info = "google.genai (new)"
    return {
        "status":      "ok",
        "api_key_set": bool(GEMINI_API_KEY),
        "sdk":         sdk_info,
        "flash_model": FLASH_MODEL,
        "pro_model":   PRO_MODEL,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
