import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { analyzeResponse } from './anthropic'
import './admin.css'

/* ── helpers ── */
const fmt = ts => new Date(ts).toLocaleString('es-PE', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
})
const avg = arr => arr.length ? (arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(1) : '—'

/* ================================================================
   LOGIN
   ================================================================ */
function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setLoading(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) setErr(error.message)
    setLoading(false)
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="eyebrow">Panel de Administración</div>
        <h1>Sala de Caso</h1>
        <p className="desc">Acceso exclusivo para docentes.</p>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div className="field"><label>Contraseña</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} required /></div>
          {err && <div className="error">{err}</div>}
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar →'}
          </button>
        </form>
      </div>
    </div>
  )
}

/* ================================================================
   DASHBOARD — lista de sesiones + crear nueva
   ================================================================ */
function Dashboard({ user, onSelectSession }) {
  const [cases, setCases] = useState([])
  const [sessions, setSessions] = useState([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ case_id: '', label: '' })

  useEffect(() => {
    supabase.from('cases').select('id,slug,title').then(({ data }) => setCases(data || []))
    loadSessions()
  }, [])

  const loadSessions = async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*, cases(title)')
      .order('created_at', { ascending: false })
    setSessions(data || [])
  }

  const createSession = async e => {
    e.preventDefault()
    if (!form.case_id || !form.label) return
    const { data, error } = await supabase.from('sessions').insert({
      case_id: form.case_id,
      label: form.label,
      status: 'waiting'
    }).select().single()
    if (!error && data) { setCreating(false); onSelectSession(data.id) }
  }

  const statusBadge = s => ({
    waiting: <span className="badge badge-wait">En espera</span>,
    active:  <span className="badge badge-active">En vivo</span>,
    closed:  <span className="badge badge-closed">Cerrada</span>
  }[s])

  return (
    <div className="shell">
      <div className="topbar-inner">
        <div className="brand-text">
          <div className="brand-title">Sala de Caso · Admin</div>
          <div className="brand-sub">{user.email}</div>
        </div>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Salir</button>
      </div>

      <div className="section-head">
        <h2>Sesiones de clase</h2>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Nueva sesión</button>
      </div>

      {creating && (
        <form className="create-form" onSubmit={createSession}>
          <div className="field">
            <label>Caso</label>
            <select value={form.case_id} onChange={e => setForm(f => ({ ...f, case_id: e.target.value }))} required>
              <option value="">— seleccionar —</option>
              {cases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Nombre de la sesión</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="Ej. UPC · Marketing Digital · 2025-07-10" required />
          </div>
          <div className="row-gap">
            <button className="btn-primary" type="submit">Crear</button>
            <button className="btn-ghost" type="button" onClick={() => setCreating(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="session-list">
        {sessions.length === 0 && <div className="empty">No hay sesiones todavía. Crea la primera.</div>}
        {sessions.map(s => (
          <div key={s.id} className="session-card" onClick={() => onSelectSession(s.id)}>
            <div className="session-head">
              <span className="session-label">{s.label}</span>
              {statusBadge(s.status)}
            </div>
            <div className="session-case">{s.cases?.title}</div>
            <div className="session-meta">{fmt(s.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================
   SESIÓN EN VIVO — control de pasturas + calificación
   ================================================================ */
function SessionControl({ sessionId, onBack }) {
  const [session, setSession] = useState(null)
  const [caseData, setCaseData] = useState(null)
  const [participants, setParticipants] = useState([])
  const [responses, setResponses] = useState([])
  const [activeTab, setActiveTab] = useState('control')  // 'control' | 'grade' | 'report'
  const [saving, setSaving] = useState({})
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState('')

  const load = useCallback(async () => {
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    setSession(sess)
    if (sess) {
      const { data: c } = await supabase.from('cases').select('*').eq('id', sess.case_id).single()
      setCaseData(c)
    }
    const { data: p } = await supabase.from('participants').select('*').eq('session_id', sessionId)
    setParticipants(p || [])
    const { data: r } = await supabase.from('responses').select('*, participants(display_name)')
      .eq('session_id', sessionId).order('created_at', { ascending: false })
    setResponses(r || [])
  }, [sessionId])

  useEffect(() => { load() }, [load])

  /* Realtime: escuchar cambios en responses y participants */
  useEffect(() => {
    const ch = supabase.channel(`admin-session-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses',
          filter: `session_id=eq.${sessionId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants',
          filter: `session_id=eq.${sessionId}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions',
          filter: `id=eq.${sessionId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [sessionId, load])

  const updateSession = async patch => {
    await supabase.from('sessions').update(patch).eq('id', sessionId)
    load()
  }

  const activatePasture = id => updateSession({ active_pasture: id, status: 'active' })
  const closePasture    = ()  => updateSession({ active_pasture: null })
  const showEpilogue    = ()  => updateSession({ show_epilogue: true, active_pasture: 'epilogue' })
  const closeSession    = ()  => updateSession({ status: 'closed', closed_at: new Date().toISOString() })
  const reopenSession   = ()  => updateSession({ status: 'active' })

  const saveGrade = async (responseId, grade, note) => {
    setSaving(s => ({ ...s, [responseId]: true }))
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('responses').update({
      grade, grade_note: note, graded_by: user.email, graded_at: new Date().toISOString()
    }).eq('id', responseId)
    await load()
    setSaving(s => ({ ...s, [responseId]: false }))
  }

  const analyzeAll = async () => {
    const pending = responses.filter(r => r.type !== 'oral' && r.content && !r.ai_label)
    if (!pending.length || !caseData) return
    setAnalyzingAll(true)
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i]
      setAnalyzeProgress(`${i + 1}/${pending.length}`)
      try {
        const result = await analyzeResponse({
          content: r.content,
          caseTitle: caseData.title,
          pastureLabel: r.pasture_label || '',
        })
        await supabase.from('responses').update({
          ai_probability: result.ai_probability,
          ai_label: result.ai_label,
          ai_reasoning: result.ai_reasoning,
          ai_suggested_grade: result.suggested_grade,
          ai_grade_justification: result.grade_justification,
          ai_analyzed_at: new Date().toISOString(),
        }).eq('id', r.id)
      } catch (err) {
        console.error(`Error analizando ${r.id}:`, err)
      }
    }
    setAnalyzingAll(false)
    setAnalyzeProgress('')
    load()
  }

  const exportCsv = () => {
    const rows = [['Alumno', 'Sección', 'Tipo', 'Respuesta', 'Nota', 'Comentario', 'Fecha']]
    responses.forEach(r => rows.push([
      r.participants?.display_name, r.pasture_label,
      r.type === 'oral' ? 'Oral' : 'Escrita',
      (r.content || '').replace(/\n/g, ' '),
      r.grade ?? '', r.grade_note || '', fmt(r.created_at)
    ]))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    a.download = `session-${sessionId.slice(0, 8)}.csv`
    a.click()
  }

  if (!session || !caseData) return <div className="loading">Cargando sesión…</div>

  const allPastures = [
    ...(caseData.pastures || []),
    ...(caseData.epilogue ? [{ id: 'epilogue', label: caseData.epilogue.label }] : [])
  ]
  const gradedCount  = responses.filter(r => r.grade != null).length
  const sessionUrl   = `${window.location.origin.replace('admin.', '')}?session=${sessionId}`

  return (
    <div className="shell">
      {/* ── Barra superior ── */}
      <div className="topbar-inner">
        <button className="btn-back" onClick={onBack}>← Sesiones</button>
        <div className="brand-text">
          <div className="brand-title">{session.label}</div>
          <div className="brand-sub">{caseData.title}</div>
        </div>
        <div className="row-gap">
          {session.status !== 'closed'
            ? <button className="btn-danger" onClick={closeSession}>Cerrar sesión</button>
            : <button className="btn-ghost" onClick={reopenSession}>Reabrir</button>}
          <button className="btn-ghost" onClick={exportCsv}>↓ CSV</button>
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>

      {/* ── Stats rápidas ── */}
      <div className="stats-row">
        <Stat label="Participantes" value={participants.length} />
        <Stat label="Respuestas"    value={responses.length} />
        <Stat label="Calificadas"   value={gradedCount} />
        <Stat label="Pendientes"    value={responses.length - gradedCount} />
        <Stat label="Promedio"
          value={avg(responses.filter(r => r.grade != null).map(r => r.grade))} />
        <div className="stat-chip url-chip">
          <div className="v mono" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
            {sessionUrl}
          </div>
          <div className="l">URL alumnos</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        {['control', 'grade', 'report'].map(t => (
          <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {{ control: '⚡ Control', grade: '★ Calificar', report: '📊 Reporte' }[t]}
          </button>
        ))}
      </div>

      {/* ── TAB: CONTROL ── */}
      {activeTab === 'control' && (
        <div className="control-grid">
          {/* Columna izquierda: pasturas */}
          <div>
            <div className="section-head"><h3>Pasturas del caso</h3></div>
            {allPastures.map((p, i) => {
              const isActive = session.active_pasture === p.id
              const count = responses.filter(r => r.pasture_id === p.id).length
              return (
                <div key={p.id} className={`pasture-row ${isActive ? 'pasture-active' : ''}`}>
                  <div className="pasture-meta">
                    <span className="pasture-num">{p.id === 'epilogue' ? '→' : `0${i + 1}`}</span>
                    <span className="pasture-label">{p.label}</span>
                    {count > 0 && <span className="badge-count">{count}</span>}
                  </div>
                  <div className="pasture-actions">
                    {isActive
                      ? <button className="btn-ghost btn-sm" onClick={closePasture}>Pausar</button>
                      : <button className="btn-primary btn-sm"
                          onClick={() => p.id === 'epilogue' ? showEpilogue() : activatePasture(p.id)}>
                          Activar
                        </button>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Columna derecha: feed en vivo */}
          <div>
            <div className="section-head">
              <h3>Feed en vivo</h3>
              <span className="live-dot" /> {responses.length} respuestas
            </div>
            <div className="live-feed">
              {responses.length === 0
                ? <div className="empty">Esperando respuestas…</div>
                : responses.slice(0, 30).map(r => (
                    <div key={r.id} className="feed-item">
                      <div className="feed-meta">
                        <strong>{r.participants?.display_name}</strong>
                        <span className={`tag tag-${r.type}`}>{r.type === 'oral' ? 'Oral' : 'Escrita'}</span>
                        <span className="feed-time">hace {timeAgo(r.created_at)}</span>
                      </div>
                      <div className="feed-pasture">{r.pasture_label}</div>
                      <div className="feed-text">{r.content}</div>
                      {r.grade != null && (
                        <div className="grade-badge">★ {r.grade}/5{r.grade_note ? ` · ${r.grade_note}` : ''}</div>
                      )}
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: CALIFICAR ── */}
      {activeTab === 'grade' && (
        <div>
          <div className="filter-row">
            <span className="filter-label">Filtrar:</span>
            {allPastures.map(p => (
              <button key={p.id} className="filter-btn"
                onClick={() => document.getElementById(`pasture-${p.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
                {p.label}
              </button>
            ))}
            <button className="btn-ai btn-sm" onClick={analyzeAll} disabled={analyzingAll} style={{ marginLeft: 'auto' }}>
              {analyzingAll ? `🤖 Analizando ${analyzeProgress}…` : '🤖 Analizar todos'}
            </button>
          </div>
          {allPastures.map(p => {
            const rs = responses.filter(r => r.pasture_id === p.id)
            if (rs.length === 0) return null
            return (
              <div key={p.id} id={`pasture-${p.id}`} className="grade-section">
                <h3 className="grade-section-title">{p.label}</h3>
                {rs.map(r => (
                  <ResponseCard key={r.id} response={r} onSave={saveGrade} saving={saving[r.id]} caseTitle={caseData.title} />
                ))}
              </div>
            )
          })}
          {responses.length === 0 && <div className="empty" style={{ padding: '48px' }}>No hay respuestas todavía.</div>}
        </div>
      )}

      {/* ── TAB: REPORTE ── */}
      {activeTab === 'report' && (
        <div>
          <div className="section-head"><h3>Participación por alumno</h3></div>
          <table className="report-table">
            <thead>
              <tr><th>Alumno</th><th>Respuestas</th><th>Calificadas</th><th>Promedio</th></tr>
            </thead>
            <tbody>
              {participants.map(p => {
                const rs = responses.filter(r => r.participant_id === p.id)
                const graded = rs.filter(r => r.grade != null)
                return (
                  <tr key={p.id}>
                    <td>{p.display_name}</td>
                    <td>{rs.length}</td>
                    <td>{graded.length}</td>
                    <td>{avg(graded.map(r => r.grade))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const AI_META = {
  humano:       { label: '✓ Humano',       cls: 'ai-humano' },
  sospechoso:   { label: '~ Sospechoso',   cls: 'ai-sospechoso' },
  ia_detectada: { label: '⚠ IA detectada', cls: 'ai-ia' },
}

/* ── ResponseCard: calificación + detección IA ── */
function ResponseCard({ response: r, onSave, saving, caseTitle }) {
  const [grade, setGrade]       = useState(r.grade ?? null)
  const [note, setNote]         = useState(r.grade_note ?? '')
  const [saved, setSaved]       = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState(
    r.ai_label ? {
      ai_probability:     r.ai_probability,
      ai_label:           r.ai_label,
      ai_reasoning:       r.ai_reasoning,
      suggested_grade:    r.ai_suggested_grade,
      grade_justification: r.ai_grade_justification,
    } : null
  )

  const save = async () => {
    if (grade == null) return
    await onSave(r.id, grade, note)
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  const analyze = async () => {
    if (!r.content || r.type === 'oral') return
    setAnalyzing(true)
    try {
      const result = await analyzeResponse({
        content: r.content,
        caseTitle: caseTitle || '',
        pastureLabel: r.pasture_label || '',
      })
      setAiResult(result)
      if (grade == null) setGrade(result.suggested_grade)
      await supabase.from('responses').update({
        ai_probability:          result.ai_probability,
        ai_label:                result.ai_label,
        ai_reasoning:            result.ai_reasoning,
        ai_suggested_grade:      result.suggested_grade,
        ai_grade_justification:  result.grade_justification,
        ai_analyzed_at:          new Date().toISOString(),
      }).eq('id', r.id)
    } catch (err) {
      alert(`Error al analizar: ${err.message}`)
    } finally {
      setAnalyzing(false)
    }
  }

  const meta = aiResult ? AI_META[aiResult.ai_label] : null

  return (
    <div className="response-card">
      <div className="response-top">
        <div className="response-who">
          <span className="avatar">{(r.participants?.display_name || '?')[0].toUpperCase()}</span>
          <div>
            <div className="response-name">{r.participants?.display_name}</div>
            <div className="response-sub">
              {fmt(r.created_at)} · <span className={`tag tag-${r.type}`}>{r.type === 'oral' ? 'Oral' : 'Escrita'}</span>
            </div>
          </div>
        </div>
        {meta && (
          <span className={`ai-badge ${meta.cls}`}>
            {meta.label} · {aiResult.ai_probability}%
          </span>
        )}
      </div>

      <div className="response-text">{r.content}</div>

      {r.type !== 'oral' && (
        <div className="ai-section">
          {aiResult ? (
            <div className="ai-detail">
              <span className="ai-reasoning">{aiResult.ai_reasoning}</span>
              <span className="ai-grade-hint">
                Nota sugerida: {aiResult.suggested_grade}★ — {aiResult.grade_justification}
              </span>
            </div>
          ) : (
            <button className="btn-ai btn-sm" onClick={analyze} disabled={analyzing}>
              {analyzing ? '🤖 Analizando…' : '🤖 Analizar con IA'}
            </button>
          )}
        </div>
      )}

      <div className="grade-row">
        <div className="stars">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} className={`star ${grade >= n ? 'star-on' : ''}`} onClick={() => setGrade(n)}>★</button>
          ))}
        </div>
        <input className="note-input" placeholder="Comentario (opcional)" value={note}
          onChange={e => setNote(e.target.value)} />
        <button className="btn-primary btn-sm" onClick={save} disabled={saving || grade == null}>
          {saving ? '…' : 'Guardar'}
        </button>
        {saved && <span className="saved-tick">✓</span>}
      </div>
    </div>
  )
}

/* ── Helpers visuales ── */
const Stat = ({ label, value }) => (
  <div className="stat-chip">
    <div className="v">{value}</div>
    <div className="l">{label}</div>
  </div>
)

const timeAgo = ts => {
  const m = Math.floor((Date.now() - new Date(ts)) / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h`
}

/* ================================================================
   ROOT
   ================================================================ */
export default function App() {
  const [user, setUser]           = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading">Cargando…</div>
  if (!user)   return <Login onLogin={setUser} />

  if (selectedSession)
    return <SessionControl sessionId={selectedSession} onBack={() => setSelectedSession(null)} />

  return <Dashboard user={user} onSelectSession={setSelectedSession} />
}
