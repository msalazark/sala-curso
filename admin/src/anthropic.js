const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

export async function analyzeResponse({ content, caseTitle, pastureLabel }) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) throw new Error('Falta VITE_ANTHROPIC_API_KEY en .env')

  if (!content || content.trim().length < 20) {
    return {
      ai_probability: 0,
      ai_label: 'humano',
      ai_reasoning: 'Respuesta muy corta para analizar.',
      suggested_grade: 1,
      grade_justification: 'Respuesta insuficiente para evaluar con criterio.',
    }
  }

  const system = `Eres un evaluador académico experto en detectar contenido generado por IA en respuestas de estudiantes universitarios peruanos.

Contexto del caso: "${caseTitle}"
Pregunta evaluada: "${pastureLabel}"

Responde ÚNICAMENTE con un objeto JSON válido. Sin texto antes ni después. Sin markdown. Solo el JSON:
{
  "ai_probability": <entero 0-100>,
  "ai_label": "<humano|sospechoso|ia_detectada>",
  "ai_reasoning": "<máximo 2 frases explicando el diagnóstico>",
  "suggested_grade": <entero 1-5>,
  "grade_justification": "<máximo 2 frases justificando la nota>"
}

Reglas para ai_label:
- "humano" si ai_probability <= 30 (respuesta con errores, coloquialismos, ideas incompletas o personalidad propia)
- "sospechoso" si ai_probability 31-69 (estructura muy pulida pero podría ser buen estudiante)
- "ia_detectada" si ai_probability >= 70 (lenguaje formal perfecto, párrafos balanceados, cobertura exhaustiva, sin personalidad)

Señales de IA: conectores académicos excesivos, párrafos simétricamente largos, ausencia de typos o coloquialismos, ejemplos genéricos sin especificidad, cobertura impecable de todos los ángulos.

Reglas para suggested_grade (1-5):
1 = Respuesta mínima o irrelevante
2 = Análisis superficial, puntos básicos sin desarrollo
3 = Análisis aceptable con los puntos clave cubiertos
4 = Análisis sólido, bien fundamentado y coherente
5 = Análisis profundo, original, con criterio propio claro`

  const resp = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-request-options': 'allow-all',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: `Respuesta del estudiante:\n\n${content}` }],
    }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `HTTP ${resp.status}`)
  }

  const data = await resp.json()
  return JSON.parse(data.content[0].text.trim())
}
