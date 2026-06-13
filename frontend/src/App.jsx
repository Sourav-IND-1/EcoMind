import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

// In production, VITE_API_URL must point to your deployed Railway backend URL
// In development, falls back to localhost:8000
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ─────────────────────────────────────────────────────────────────────────────
// Helper — animated number counter
// ─────────────────────────────────────────────────────────────────────────────
function useAnimatedValue(target, decimals = 0) {
  const [displayed, setDisplayed] = useState(target);
  useEffect(() => {
    const start = displayed;
    const diff = target - start;
    if (diff === 0) return;
    const steps = 30;
    let step = 0;
    const id = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(+(start + diff * eased).toFixed(decimals));
      if (step >= steps) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return displayed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, decimals = 0, prefix = '', suffix = '' }) {
  const animated = useAnimatedValue(value, decimals);
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{prefix}{animated}{suffix}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Complexity Bar
// ─────────────────────────────────────────────────────────────────────────────
function ComplexityBar({ score }) {
  const pct = (score / 10) * 100;
  let color = '#22C55E';
  if (score >= 7) color = '#F87171';
  else if (score >= 4) color = '#FACC15';
  return (
    <div className="complexity-row">
      <span className="complexity-label">Complexity</span>
      <div className="complexity-bar-wrap">
        <div
          className="complexity-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="complexity-score-text" style={{ color }}>{score}/10</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Badge
// ─────────────────────────────────────────────────────────────────────────────
function ModelBadge({ model }) {
  if (model === 'flash')  return <span className="badge badge-flash">⚡ Flash</span>;
  if (model === 'pro')    return <span className="badge badge-pro">🧠 Pro</span>;
  if (model === 'queued') return <span className="badge badge-queued">⏳ Queued</span>;
  return <span className="badge badge-miss">{model}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid Status Badge
// ─────────────────────────────────────────────────────────────────────────────
function GridBadge({ grid }) {
  const isGreen = grid?.renewable_percent > 50;
  return (
    <span className={`badge badge-${isGreen ? 'solar' : 'coal'}`}>
      {isGreen ? '🟢' : '🔴'} {grid?.status || 'Unknown'} ({grid?.renewable_percent}%)
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Tooltip for charts
// ─────────────────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0D2B17', border: '1px solid #1A4D2A',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: '#86EFAC', fontWeight: 700, marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // ── State ────────────────────────────────────────────────────────────────
  const [prompt, setPrompt]       = useState('');
  const [isUrgent, setIsUrgent]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [stats, setStats]         = useState({
    total_queries: 0,
    total_cost_saved: 0,
    total_carbon_saved_grams: 0,
    cache_hits: 0,
    model_breakdown: { flash: 0, pro: 0, queued: 0 },
    query_history: [],
  });
  const [grid, setGrid]           = useState({ renewable_percent: 75, status: 'Solar' });
  const [gridLoading, setGridLoading] = useState(false);
  const [activeAgents, setActiveAgents] = useState([]);

  // ── Poll stats every 2s ──────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (res.ok) setStats(await res.json());
    } catch { /* backend not ready */ }
  }, []);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 2000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // ── Send Query ────────────────────────────────────────────────────────────
  const sendQuery = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    // Animate agent pipeline
    const agents = ['Scorer', 'Grid Monitor', 'Compressor', 'Router'];
    for (let i = 0; i < agents.length; i++) {
      await new Promise(r => setTimeout(r, 200));
      setActiveAgents(agents.slice(0, i + 1));
    }

    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), is_urgent: isUrgent }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
      setGrid(data.grid_status);
      await fetchStats();
    } catch (e) {
      setError(e.message || 'Failed to connect to backend. Make sure it\'s running on port 8000.');
    } finally {
      setLoading(false);
      setActiveAgents([]);
    }
  };

  // ── Toggle Grid ───────────────────────────────────────────────────────────
  const toggleGrid = async () => {
    setGridLoading(true);
    try {
      const res = await fetch(`${API_BASE}/grid/toggle`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setGrid(data.grid);
      }
    } catch (e) {
      setError('Could not toggle grid.');
    } finally {
      setGridLoading(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetStats = async () => {
    try {
      await fetch(`${API_BASE}/reset`, { method: 'POST' });
      setResult(null);
      await fetchStats();
    } catch (e) {
      setError('Could not reset stats.');
    }
  };

  // ── Chart data ────────────────────────────────────────────────────────────
  const modelBarData = [
    { name: 'Flash',  count: stats.model_breakdown?.flash  || 0, fill: '#38BDF8' },
    { name: 'Pro',    count: stats.model_breakdown?.pro    || 0, fill: '#A78BFA' },
    { name: 'Queued', count: stats.model_breakdown?.queued || 0, fill: '#FB923C' },
  ];

  const carbonLineData = (stats.query_history || []).slice(-10).map((q, i) => ({
    query: `Q${i + 1}`,
    carbon: +(q.carbon_saved_grams || 0).toFixed(3),
    cost: +(q.cost_saved || 0).toFixed(4),
  }));

  const isGreenGrid = grid.renewable_percent > 50;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div className="logo-ring">🌿</div>
          <div className="brand-text">
            <h1>EcoMind</h1>
            <p>Autonomous Green AI Orchestrator</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="header-badge">
            <div className="dot" />
            4-Agent Pipeline
          </div>
          <button
            className="btn-secondary"
            onClick={resetStats}
            style={{ fontSize: 12, padding: '7px 14px' }}
          >
            🔄 Reset Stats
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <StatCard
          icon="💰" label="Total Cost Saved" color="green"
          value={stats.total_cost_saved} decimals={4} prefix="$"
          sub="vs. baseline $0.02/query"
        />
        <StatCard
          icon="🌍" label="CO₂ Saved" color="green"
          value={stats.total_carbon_saved_grams} decimals={3} suffix="g"
          sub="grams of CO₂ avoided"
        />
        <StatCard
          icon="⚡" label="Cache Hits" color="blue"
          value={stats.cache_hits} decimals={0}
          sub="instant cached responses"
        />
        <StatCard
          icon="📊" label="Total Queries" color="white"
          value={stats.total_queries} decimals={0}
          sub="processed by pipeline"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 12, padding: '14px 18px', color: '#F87171',
          fontSize: 13, fontWeight: 600, marginBottom: 20, display: 'flex', gap: 8,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Main Grid: Query + Grid Control */}
      <div className="main-grid">
        {/* Query Input */}
        <div className="card">
          <div className="card-title">🤖 Query Input</div>

          {/* Agent pipeline indicator */}
          <div className="agent-pipeline">
            {['1. Complexity Scorer', '2. Grid Monitor', '3. Compressor', '4. Smart Router'].map((label, i) => {
              const shortLabel = label.split('. ')[1];
              const isActive = activeAgents.length > i;
              return (
                <React.Fragment key={label}>
                  <div className={`agent-step ${isActive ? 'active' : ''}`}>
                    {isActive ? '✓' : `${i + 1}`} {shortLabel}
                  </div>
                  {i < 3 && <span className="agent-arrow">→</span>}
                </React.Fragment>
              );
            })}
          </div>

          <textarea
            id="query-input"
            className="query-textarea"
            placeholder="Type your query… e.g. 'Build a FastAPI microservice with JWT auth' or 'What is 2+2?'"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) sendQuery(); }}
          />

          <div className="input-row">
            <label
              className="toggle-wrap"
              htmlFor="urgent-toggle"
              onClick={() => setIsUrgent(p => !p)}
            >
              <div className={`toggle-switch ${isUrgent ? 'active' : ''}`}>
                <div className="toggle-knob" />
              </div>
              <span className="toggle-label">
                {isUrgent ? '🚨 Urgent Task' : '⏱ Normal Task'}
              </span>
            </label>

            <div style={{ flex: 1 }} />

            <button
              id="send-query-btn"
              className="btn-primary"
              onClick={sendQuery}
              disabled={loading || !prompt.trim()}
            >
              {loading ? <div className="spinner" /> : '⚡'}
              {loading ? 'Processing...' : 'Send Query'}
            </button>
          </div>

          {/* Sample Queries */}
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 3 }}>Try:</span>
            {[
              'What is 2 plus 2?',
              'Who invented electricity?',
              'Build a FastAPI microservice with JWT auth',
              'Create a React component with useEffect',
            ].map(sample => (
              <button
                key={sample}
                onClick={() => setPrompt(sample)}
                style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 100, padding: '3px 10px', fontSize: 11,
                  color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {sample.length > 30 ? sample.slice(0, 30) + '…' : sample}
              </button>
            ))}
          </div>
        </div>

        {/* Grid Control */}
        <div className="card">
          <div className="card-title">⚡ Grid Control Panel</div>

          <div className="grid-status-display">
            <div>
              <div className="grid-percent" style={{ color: isGreenGrid ? 'var(--green-primary)' : 'var(--red-accent)' }}>
                {grid.renewable_percent}%
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                Renewable Energy
              </div>
            </div>
            <div className="grid-indicator" style={{ color: isGreenGrid ? 'var(--green-primary)' : 'var(--red-accent)' }}>
              <div className={`grid-dot ${isGreenGrid ? 'green' : 'red'}`} />
              {isGreenGrid ? 'Clean Grid' : 'Dirty Grid'}
            </div>
          </div>

          {/* Renewable bar */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              height: 12, background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 100, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${grid.renewable_percent}%`,
                background: isGreenGrid
                  ? 'linear-gradient(90deg, #16A34A, #22C55E)'
                  : 'linear-gradient(90deg, #DC2626, #F87171)',
                borderRadius: 100,
                transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0%</span><span>50% threshold</span><span>100%</span>
            </div>
          </div>

          {/* Energy source info */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20,
          }}>
            {[
              { label: 'Source', value: grid.status, icon: isGreenGrid ? '☀️' : '🏭' },
              { label: 'LLM Status', value: isGreenGrid ? 'Pro Enabled' : 'Pro Blocked', icon: isGreenGrid ? '✅' : '🚫' },
              { label: 'Routing', value: isGreenGrid ? 'Unrestricted' : 'Conservative', icon: '🔀' },
              { label: 'Queue', value: isGreenGrid ? 'Empty' : 'Active', icon: '📋' },
            ].map(item => (
              <div key={item.label} style={{
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 3 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {item.icon} {item.value}
                </div>
              </div>
            ))}
          </div>

          <button
            id="grid-toggle-btn"
            className={`btn-grid-toggle ${isGreenGrid ? 'green' : 'dirty'}`}
            onClick={toggleGrid}
            disabled={gridLoading}
          >
            {gridLoading
              ? '⏳ Toggling...'
              : isGreenGrid
                ? '🟢 Green Grid (75% Solar) — Click to Switch'
                : '🔴 Dirty Grid (20% Coal) — Click to Switch'}
          </button>
        </div>
      </div>

      {/* Query Result */}
      {result && (
        <div className="result-card">
          <div className="result-header">
            <div className="card-title" style={{ margin: 0 }}>📋 Query Result</div>
            <div className="result-badges">
              <ModelBadge model={result.model_selected} />
              <GridBadge grid={result.grid_status} />
              <span className={`badge ${result.cache_hit ? 'badge-hit' : 'badge-miss'}`}>
                {result.cache_hit ? '⚡ CACHE HIT' : '○ CACHE MISS'}
              </span>
              {result.queued && <span className="badge badge-queued">🚫 API Skipped</span>}
            </div>
          </div>

          {/* Prompt Comparison */}
          <div className="prompt-compare">
            <div className="prompt-box">
              <div className="prompt-box-label">Original Prompt</div>
              <div className="prompt-box-text">{result.original_prompt}</div>
            </div>
            <div className="prompt-box">
              <div className="prompt-box-label">✂️ Compressed (Agent 3)</div>
              <div className="prompt-box-text" style={{ color: 'var(--green-text)' }}>
                {result.compressed_prompt}
              </div>
            </div>
          </div>

          {/* Complexity Bar */}
          <ComplexityBar score={result.complexity_score} />

          {/* Savings */}
          <div className="savings-row">
            <div className="saving-chip">
              <div className="saving-chip-label">💰 Cost Saved</div>
              <div className="saving-chip-value">${result.cost_saved.toFixed(4)}</div>
            </div>
            <div className="saving-chip">
              <div className="saving-chip-label">🌍 CO₂ Saved</div>
              <div className="saving-chip-value">{result.carbon_saved_grams.toFixed(3)}g</div>
            </div>
            <div className="saving-chip">
              <div className="saving-chip-label">🤖 Model</div>
              <div className="saving-chip-value" style={{ fontSize: 14, textTransform: 'capitalize' }}>
                {result.model_selected}
              </div>
            </div>
          </div>

          {/* LLM Response */}
          {result.queued ? (
            <div className="queued-warning">
              <span style={{ fontSize: 20 }}>⏳</span>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Task Queued for Green Energy Window</div>
                {result.llm_response}
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 600, marginBottom: 8 }}>
                🤖 LLM Response {result.cache_hit && '(from cache)'}
              </div>
              <div className="llm-response">{result.llm_response}</div>
            </>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-container">
          <div className="card-title">📊 Model Usage Breakdown</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={modelBarData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#1A4D2A" />
              <XAxis dataKey="name" tick={{ fill: '#4B7A5A', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4B7A5A', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Queries" radius={[6, 6, 0, 0]}>
                {modelBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <div className="card-title">📈 Carbon Saved per Query (last 10)</div>
          {carbonLineData.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📉</div>
              <p>Send queries to see carbon savings chart</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={carbonLineData} margin={{ top: 8, right: 16, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="#1A4D2A" />
                <XAxis dataKey="query" tick={{ fill: '#4B7A5A', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#4B7A5A', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#4B7A5A' }} />
                <Line
                  type="monotone" dataKey="carbon" name="CO₂ Saved (g)"
                  stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Model Breakdown Colored Bar chart — fix */}
      <div style={{ marginBottom: 24, display: 'none' }} />

      {/* Bottom bar */}
      <div className="bottom-bar">
        <div className="bottom-bar-info">
          EcoMind v1.0 — 4-Agent Green AI Orchestrator · Backend: localhost:8000
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className={`badge ${isGreenGrid ? 'badge-solar' : 'badge-coal'}`}>
            {isGreenGrid ? '🟢' : '🔴'} {grid.status} Grid
          </div>
          <div className="badge badge-flash">
            ⚡ {stats.model_breakdown?.flash || 0} Flash
          </div>
          <div className="badge badge-pro">
            🧠 {stats.model_breakdown?.pro || 0} Pro
          </div>
          <div className="badge badge-queued">
            ⏳ {stats.model_breakdown?.queued || 0} Queued
          </div>
        </div>
      </div>
    </div>
  );
}
