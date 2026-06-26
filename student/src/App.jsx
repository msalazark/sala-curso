import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import './student.css'

/* ── helpers ── */
const fmt = ts => new Date(ts).toLocaleString('es-PE',
  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const avg = arr => arr.length
  ? (arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(1) : '—'

/* ── Lectura de la URL: ?session=uuid ── */
const getSessionId = () => new URLSearchParams(window.location.search).get('session')

/* ================================================================
   GATE — pantalla de registro
   ================================================================ */
function Gate({ sessionId, onJoin }) {
  const [session, setSession] = useState(null)
  const [name, setName]       = useState(
    () => localStorage.getItem(`sala-caso:name:${sessionId}`) || ''
  )
  const [err, setErr]   = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!sessionId) { setChecking(false); return }
    supabase.from('sessions').select('*, cases(title,subtitle)')
      .eq('id', sessionId).single()
      .then(({ data }) => { setSession(data); setChecking(false) })
  }, [sessionId])

  const join = async e => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setLoading(true); setErr('')
    // Upsert del participante (por si recarga la página)
    const { data: existing } = await supabase.from('participants')
      .select('id').eq('session_id', sessionId).eq('display_name', n).maybeSingle()
    let pid = existing?.id
    if (!pid) {
      const { data, error } = await supabase.from('participants')
        .insert({ session_id: sessionId, display_name: n }).select().single()
      if (error) { setErr('No se pudo registrar. ¿El nombre ya está en uso?'); setLoading(false); return }
      pid = data.id
    }
    localStorage.setItem(`sala-caso:name:${sessionId}`, n)
    localStorage.setItem(`sala-caso:pid:${sessionId}`, pid)
    onJoin({ participantId: pid, displayName: n })
    setLoading(false)
  }

  if (!sessionId)  return <NoSession />
  if (checking)    return <div className="loading">Verificando sesión…</div>
  if (!session)    return <NoSession />
  if (session.status === 'closed') return <ClosedSession session={session} />

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="eyebrow">{session.cases?.subtitle}</div>
        <h1>{session.cases?.title}</h1>
        <p className="desc">Bienvenido a la sesión <strong>{session.label}</strong>.
          Ingresa tu nombre para participar.</p>
        <form onSubmit={join}>
          <div className="field">
            <label>Tu nombre</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej. María Fernández" autoComplete="off" required />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Ingresando…' : 'Entrar a la sala →'}
          </button>
        </form>
      </div>
    </div>
  )
}

const NoSession = () => (
  <div className="gate">
    <div className="gate-card">
      <div className="eyebrow">Sala de Caso</div>
      <h1>Enlace inválido</h1>
      <p className="desc">Escanea el código QR de tu profesor para acceder a la sesión correcta.</p>
    </div>
  </div>
)

const ClosedSession = ({ session }) => (
  <div className="gate">
    <div className="gate-card">
      <div className="eyebrow">Sesión cerrada</div>
      <h1>{session.label}</h1>
      <p className="desc">La sesión ha finalizado. Consulta tus resultados con el profesor.</p>
    </div>
  </div>
)

/* ================================================================
   SALA — vista principal del estudiante
   ================================================================ */
function Sala({ sessionId, participantId, displayName }) {
  const [session, setSession]   = useState(null)
  const [caseData, setCaseData] = useState(null)
  const [responses, setResponses] = useState([])
  const [activeTab, setActiveTab] = useState('question') // 'question' | 'mine'

  const load = useCallback(async () => {
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    setSession(sess)
    if (sess && !caseData) {
      const { data: c } = await supabase.from('cases').select('*').eq('id', sess.case_id).single()
      setCaseData(c)
    }
    const { data: r } = await supabase.from('responses').select('*')
      .eq('session_id', sessionId).eq('participant_id', participantId)
      .order('created_at', { ascending: false })
    setResponses(r || [])
  }, [sessionId, participantId, caseData])

  useEffect(() => { load() }, [load])

  /* Realtime: cuando el admin cambia la pastura activa, se refresca automáticamente */
  useEffect(() => {
    const ch = supabase.channel(`student-session-${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions',
          filter: `id=eq.${sessionId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses',
          filter: `session_id=eq.${sessionId}` }, payload => {
            if (payload.new?.participant_id === participantId) load()
          })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [sessionId, participantId, load])

  if (!session || !caseData) return <div className="loading">Cargando sala…</div>

  const allPastures = [
    ...(caseData.pastures || []),
    ...(session.show_epilogue && caseData.epilogue
      ? [{ id: 'epilogue', label: caseData.epilogue.label, question: caseData.epilogue.closingQuestion,
           probes: [], minutes: 0, epilogueData: caseData.epilogue }]
      : [])
  ]
  const activePasture = allPastures.find(p => p.id === session.active_pasture)
  const myGraded      = responses.filter(r => r.grade != null)
  const myAvg         = avg(myGraded.map(r => r.grade))

  return (
    <div>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand-mark" />
          <div className="brand-text">
            <div className="brand-title">{caseData.title}</div>
            <div className="brand-sub">{session.label}</div>
          </div>
          <div className="who">
            <span className="avatar-sm">{displayName[0].toUpperCase()}</span>
            <span>{displayName}</span>
          </div>
        </div>
      </div>

      <div className="shell">
        {/* ── Tabs ── */}
        <div className="tabs">
          <button className={`tab ${activeTab === 'question' ? 'active' : ''}`}
            onClick={() => setActiveTab('question')}>
            {activePasture ? '⚡ Pregunta activa' : '⏳ En espera'}
          </button>
          <button className={`tab ${activeTab === 'mine' ? 'active' : ''}`}
            onClick={() => setActiveTab('mine')}>
            Mis respuestas
            {responses.length > 0 && <span className="tab-count">{responses.length}</span>}
          </button>
        </div>

        {/* ── TAB: PREGUNTA ACTIVA ── */}
        {activeTab === 'question' && (
          !activePasture
            ? <Waiting session={session} />
            : <ActiveQuestion
                pasture={activePasture}
                sessionId={sessionId}
                participantId={participantId}
                responses={responses}
                onSubmit={load}
              />
        )}

        {/* ── TAB: MIS RESPUESTAS ── */}
        {activeTab === 'mine' && (
          <div>
            <div className="score-banner">
              <div className="score-big">{myAvg}</div>
              <div className="score-label">Promedio</div>
              <div className="score-detail">
                {responses.length} respuestas · {myGraded.length} calificadas
              </div>
            </div>
            {responses.length === 0
              ? <div className="empty">Aún no tienes respuestas. Responde la pregunta activa.</div>
              : responses.map(r => (
                  <div key={r.id} className="my-response">
                    <div className="my-response-meta">
                      <span className={`tag tag-${r.type}`}>{r.type === 'oral' ? 'Oral' : 'Escrita'}</span>
                      <span className="pasture-name">{r.pasture_label}</span>
                      <span className="ts">{fmt(r.created_at)}</span>
                    </div>
                    <div className="my-response-text">{r.content}</div>
                    {r.grade != null
                      ? <div className="grade-chip">★ {r.grade}/5{r.grade_note ? ` · ${r.grade_note}` : ''}</div>
                      : <div className="grade-chip pending">Pendiente de calificar</div>}
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Pantalla de espera ── */
const Waiting = ({ session }) => (
  <div className="waiting-screen">
    <div className="waiting-pulse" />
    <h2>Esperando al profesor…</h2>
    <p>El profesor activará la próxima pregunta en breve.
      {session.status === 'closed' && ' La sesión ha finalizado.'}</p>
  </div>
)

/* ── Pregunta activa + formulario de respuesta ── */
function ActiveQuestion({ pasture, sessionId, participantId, responses, onSubmit }) {
  const [mode, setMode]    = useState('written') // 'written' | 'oral'
  const [text, setText]    = useState('')
  const [showProbes, setShowProbes] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent]    = useState(false)

  const alreadyAnswered = responses.some(
    r => r.pasture_id === pasture.id && r.type === mode
  )

  const submit = async () => {
    if (!text.trim() || alreadyAnswered) return
    setLoading(true)
    await supabase.from('responses').insert({
      session_id: sessionId,
      participant_id: participantId,
      pasture_id: pasture.id,
      pasture_label: pasture.label,
      type: mode,
      content: text.trim()
    })
    setText(''); setSent(true); setTimeout(() => setSent(false), 2000)
    setLoading(false); onSubmit()
  }

  return (
    <div>
      {/* Cabecera de la pastura */}
      <div className="question-head">
        {pasture.minutes > 0 && (
          <div className="time-badge">~{pasture.minutes} min</div>
        )}
        <h2 className="question-title">{pasture.label}</h2>
        <p className="question-text">{pasture.question}</p>
        {pasture.probes?.length > 0 && (
          <>
            <button className="probe-toggle" onClick={() => setShowProbes(s => !s)}>
              {showProbes ? '▾' : '▸'} Ver preguntas guía
            </button>
            {showProbes && (
              <ul className="probes">
                {pasture.probes.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            )}
          </>
        )}
        {/* Epílogo: mostrar timeline si existe */}
        {pasture.epilogueData && (
          <div className="epilogue-block">
            {pasture.epilogueData.timeline?.map((item, i) => (
              <div key={i} className="epi-item">
                <div className="epi-period">{item.period}</div>
                <div className="epi-title">{item.title}</div>
                <div className="epi-text">{item.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulario */}
      <div className="answer-card">
        <div className="panel-title">Tu respuesta</div>
        <div className="mode-row">
          <button className={`mode-pill ${mode === 'written' ? 'mode-written' : ''}`}
            onClick={() => setMode('written')}>✎ Escribir idea</button>
          <button className={`mode-pill ${mode === 'oral' ? 'mode-oral' : ''}`}
            onClick={() => setMode('oral')}>🗣 Registrar participación oral</button>
        </div>

        {alreadyAnswered
          ? <div className="already-sent">Ya enviaste tu respuesta de tipo «{mode === 'oral' ? 'oral' : 'escrita'}» en esta sección. Puedes cambiar el modo para agregar otra.</div>
          : <>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={mode === 'written'
                  ? 'Escribe tu idea sobre esta pregunta…'
                  : 'Resumen breve de tu intervención oral…'}
                className={mode === 'oral' ? 'ta-oral' : ''}
              />
              <div className="submit-row">
                <span className="char-count">{text.length} caracteres</span>
                <button
                  className={`btn-submit ${mode === 'oral' ? 'btn-submit-oral' : ''}`}
                  onClick={submit} disabled={loading || !text.trim()}>
                  {loading ? '…' : sent ? '✓ Enviado' : 'Enviar →'}
                </button>
              </div>
            </>}
      </div>

      {/* Mis respuestas en esta pastura */}
      <div className="my-in-pasture">
        {responses.filter(r => r.pasture_id === pasture.id).map(r => (
          <div key={r.id} className="mini-response">
            <span className={`tag tag-${r.type}`}>{r.type === 'oral' ? 'Oral' : 'Escrita'}</span>
            <span className="mini-text">{r.content.slice(0, 120)}{r.content.length > 120 ? '…' : ''}</span>
            {r.grade != null && <span className="mini-grade">★ {r.grade}/5</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================
   ROOT
   ================================================================ */
export default function App() {
  const sessionId = getSessionId()
  const [participant, setParticipant] = useState(() => {
    if (!sessionId) return null
    const pid  = localStorage.getItem(`sala-caso:pid:${sessionId}`)
    const name = localStorage.getItem(`sala-caso:name:${sessionId}`)
    return pid && name ? { participantId: pid, displayName: name } : null
  })

  if (!participant)
    return <Gate sessionId={sessionId} onJoin={setParticipant} />

  return (
    <Sala
      sessionId={sessionId}
      participantId={participant.participantId}
      displayName={participant.displayName}
    />
  )
}
