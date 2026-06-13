# 🌿 EcoMind — Autonomous Green AI Orchestrator

EcoMind is a 4-agent system that autonomously routes LLM queries to the most energy-efficient model based on query complexity and real-time grid energy status.

---

## 🏗️ Architecture

```
User Query
    │
    ▼
Agent 1: Complexity Scorer   → Scores prompt 1-10
    │
    ▼
Agent 2: Grid Monitor        → Reads renewable energy status
    │
    ▼
Agent 3: Prompt Compressor   → Removes filler + checks cache
    │
    ▼
Agent 4: Smart Router        → Routes to Flash / Pro / Queue
```

### Model Routing Logic
| Score | Grid   | Model Selected        |
|-------|--------|-----------------------|
| 1–6   | Any    | gemini-2.0-flash      |
| 7–10  | Green  | gemini-2.0-pro        |
| 7–10  | Dirty  | **Queued** (no API call) |
| 7–10  | Dirty + Urgent | gemini-2.0-pro (bypass) |

---

## 📁 Folder Structure

```
hackarena-hackathon/
├── backend/
│   ├── main.py           # FastAPI server with 4 agents
│   └── requirements.txt  # Python dependencies
└── frontend/
    ├── index.html        # Vite root HTML
    ├── vite.config.js    # Vite config + dev proxy
    ├── package.json      # npm dependencies
    └── src/
        ├── App.jsx       # Full React dashboard
        ├── main.jsx      # Vite entry point
        └── index.css     # Dark green theme
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- Free Gemini API key from [aistudio.google.com](https://aistudio.google.com)

---

### 1. Set Your Gemini API Key

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY = "your-api-key-here"
```

**Windows (persistent):**
```powershell
[System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your-api-key-here", "User")
```

**macOS / Linux:**
```bash
export GEMINI_API_KEY="your-api-key-here"
```

---

### 2. Start the Backend

```powershell
cd backend
pip install fastapi uvicorn google-genai
python main.py
```

The API will be live at **http://localhost:8000**

Check it with: http://localhost:8000/health

---

### 3. Start the Frontend

In a new terminal:

```powershell
cd frontend
npm install
npm run dev
```

The dashboard will open at **http://localhost:3000**

> **Note:** This project uses **Vite** (not Create React App) for fast startup and minimal dependencies.

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/query` | Run all 4 agents on a prompt |
| GET | `/stats` | Get global stats (no recalc) |
| POST | `/grid/toggle` | Toggle Solar ↔ Coal grid |
| POST | `/reset` | Reset all stats |
| GET | `/health` | Health check + API key status |

### POST /query Example
```json
// Request
{ "prompt": "Build a FastAPI microservice with JWT auth", "is_urgent": false }

// Response
{
  "original_prompt": "Build a FastAPI microservice with JWT auth",
  "compressed_prompt": "Build a FastAPI microservice with JWT auth",
  "complexity_score": 9,
  "grid_status": { "renewable_percent": 75, "status": "Solar" },
  "model_selected": "pro",
  "llm_response": "...",
  "cost_saved": 0.02,
  "carbon_saved_grams": 0.0,
  "cache_hit": false,
  "queued": false
}
```

---

## 🧪 Demo Scenarios

### Simple Query → Flash Model
```
"What is 2 plus 2?"
"Who invented electricity?"
```

### Complex Query + Green Grid → Pro Model
1. Ensure grid shows 🟢 Solar
2. Send: `"Build a FastAPI microservice with JWT auth"`

### Complex Query + Dirty Grid → Queued
1. Click **Grid Toggle** → switch to 🔴 Coal
2. Send same complex query
3. See orange queue message (no Gemini API called!)

### Cache Hit Demo
1. Send any query
2. Send the exact same query again
3. See ⚡ CACHE HIT badge

### Urgent Override
1. Switch to 🔴 Dirty Grid
2. Enable **🚨 Urgent Task** toggle
3. Send complex query → bypasses queue, uses Pro

---

## 💰 Carbon Savings Math

| Model | Cost/query | CO₂/query |
|-------|-----------|-----------|
| Baseline | $0.02 | 0.5g |
| Flash | $0.00 | 0.01g |
| Pro | $0.00 | 0.5g |
| Queued | $0.00 | 0.0g |

`savings = baseline - actual`

---

## 🔑 Notes

- **No API key?** The backend runs in mock mode (returns placeholder responses)
- **gemini-2.0-pro** falls back to `gemini-2.0-flash-thinking-exp` on free tier
- Cache is in-memory — cleared on server restart or `/reset`
- CORS is open (`*`) for local development

---

## 📦 Dependencies

### Backend
- `fastapi` — REST API framework
- `uvicorn` — ASGI server  
- `google-genai` — Gemini API client (new SDK v2.x)
- `pydantic` — Data validation

### Frontend
- `react` + `react-dom` — UI framework
- `recharts` — Charts library
- `vite` — Fast dev server & bundler
- `@vitejs/plugin-react` — React plugin for Vite
