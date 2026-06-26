-- ============================================================
--  SALA DE CASO — Supabase Schema
--  Pegar completo en SQL Editor de Supabase y ejecutar.
--  El orden importa (FK references).
-- ============================================================

-- ── Extensiones ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 1. CASES ─────────────────────────────────────────────────
--  Un caso = un HBS case (reutilizable en múltiples sesiones)
create table if not exists cases (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,          -- e.g. "gap-518-s30"
  title       text not null,
  subtitle    text,
  pastures    jsonb not null default '[]',   -- array de {id, label, question, probes, minutes}
  epilogue    jsonb,                         -- {label, intro, timeline[], closingQuestion}
  created_at  timestamptz default now()
);

comment on table cases is
  'Biblioteca de casos. Un caso puede usarse en múltiples sesiones.';

-- ── 2. SESSIONS ──────────────────────────────────────────────
--  Una sesión = una instancia de clase con un caso activo.
--  El admin crea la sesión y la controla en vivo.
create table if not exists sessions (
  id              uuid primary key default uuid_generate_v4(),
  case_id         uuid not null references cases(id) on delete cascade,
  label           text not null,             -- e.g. "UPC · Mkt Digital · 2025-07-01"
  status          text not null default 'waiting'
                    check (status in ('waiting','active','closed')),
  active_pasture  text,                      -- id de pastura activa (null = ninguna)
  show_epilogue   boolean not null default false,
  admin_note      text,                      -- nota visible solo al admin
  created_at      timestamptz default now(),
  closed_at       timestamptz
);

comment on table sessions is
  'Una sesión de clase. El admin la activa y controla el avance de pasturas.';

-- ── 3. PARTICIPANTS ──────────────────────────────────────────
--  Un participante por sesión. No requiere cuenta Supabase.
create table if not exists participants (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references sessions(id) on delete cascade,
  display_name  text not null,
  joined_at     timestamptz default now(),
  unique (session_id, display_name)           -- sin duplicados por nombre en la misma sesión
);

comment on table participants is
  'Alumnos registrados en una sesión. Solo nombre, sin autenticación.';

-- ── 4. RESPONSES ─────────────────────────────────────────────
--  Una respuesta = aporte de un alumno a una pastura.
create table if not exists responses (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references sessions(id) on delete cascade,
  participant_id  uuid not null references participants(id) on delete cascade,
  pasture_id      text not null,             -- coincide con pastures[].id del caso
  pasture_label   text not null,
  type            text not null default 'written'
                    check (type in ('written','oral')),
  content         text not null,
  grade           smallint check (grade between 1 and 5),
  grade_note      text,
  graded_by       text,                      -- nombre del admin que calificó
  graded_at       timestamptz,
  created_at      timestamptz default now()
);

comment on table responses is
  'Respuestas de alumnos. El admin puede calificar con 1-5 y añadir nota.';

-- ── Índices para consultas frecuentes ────────────────────────
create index if not exists idx_responses_session    on responses(session_id);
create index if not exists idx_responses_participant on responses(participant_id);
create index if not exists idx_responses_pasture    on responses(session_id, pasture_id);
create index if not exists idx_participants_session  on participants(session_id);
create index if not exists idx_sessions_status      on sessions(status);

-- ── 5. ROW LEVEL SECURITY ────────────────────────────────────
alter table cases        enable row level security;
alter table sessions     enable row level security;
alter table participants enable row level security;
alter table responses    enable row level security;

-- CASOS: lectura pública (la app los carga sin login)
create policy "cases_read_all"  on cases    for select using (true);
create policy "cases_admin_all" on cases    for all    using (auth.role() = 'authenticated');

-- SESSIONS: lectura pública; escritura solo autenticados (admin)
create policy "sessions_read_all"  on sessions for select using (true);
create policy "sessions_admin_all" on sessions for all    using (auth.role() = 'authenticated');

-- PARTICIPANTS: lectura pública; insert anónimo (alumno se registra sin login)
create policy "participants_read_all"    on participants for select using (true);
create policy "participants_insert_anon" on participants for insert with check (true);

-- RESPONSES: lectura pública; insert anónimo; update solo autenticados (calificar)
create policy "responses_read_all"    on responses for select using (true);
create policy "responses_insert_anon" on responses for insert with check (true);
create policy "responses_grade_admin" on responses for update using (auth.role() = 'authenticated');

-- ── 6. REALTIME ──────────────────────────────────────────────
--  Habilitar para las tablas que necesitan push en vivo.
--  Ejecutar desde Supabase Dashboard > Database > Replication
--  o con estas sentencias:
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table responses;
alter publication supabase_realtime add table participants;

-- ── 7. SEED: caso Gap ────────────────────────────────────────
insert into cases (slug, title, subtitle, pastures, epilogue) values (
  'gap-518-s30',
  'Predicción de los gustos del consumidor con Big Data en Gap',
  'HBS 518-S30 · Art Peck, Producto 3.0',
  '[
    {
      "id": "p1", "minutes": 20,
      "label": "Despido de los directores creativos",
      "question": "¿Tuvo razón Peck al despedir a los directores creativos y reemplazarlos por un proceso impulsado por big data? ¿Por qué sí o por qué no?",
      "probes": [
        "¿Puede este paso reinvigorar a Gap? Gap lleva años en problemas — ¿por qué?",
        "¿Es suficiente cambiar el proceso creativo para contrarrestar estos vientos en contra?",
        "¿Cuál es el rol de un director creativo? ¿Qué se pierde al despedirlos?",
        "¿Qué tan bien o mal replica el big data los servicios que ellos brindaban?",
        "¿Gap Inc. debería aspirar a ser trendspotter o tastemaker? ¿Por qué?"
      ]
    },
    {
      "id": "p2", "minutes": 15,
      "label": "Predicción de preferencias de moda",
      "question": "¿Qué tan bien se pueden predecir las preferencias de moda de los consumidores usando datos de compra pasados?",
      "probes": [
        "¿Qué supuestos hay que asumir sobre las preferencias del consumidor?",
        "¿Son estables en el tiempo las preferencias de moda? ¿Por qué sí o no?",
        "¿Cómo surgen las preferencias del consumidor? ¿Qué influye en tu propio gusto?",
        "¿Cómo pueden los marketers moldear o influir en las preferencias de moda?",
        "¿Qué categorías de Gap están mejor o peor servidas por datos de compra pasados?"
      ]
    },
    {
      "id": "p3", "minutes": 15,
      "label": "Las marcas de Gap y Producto 3.0",
      "question": "¿El enfoque de big data funciona igual para las tres marcas? ¿Por qué sí o no?",
      "probes": [
        "¿En qué negocio está realmente Gap? ¿Y Banana Republic? ¿Y Old Navy?",
        "¿Qué marcas están mejor o peor servidas por esta estrategia?",
        "¿Puede Gap mantener cada marca diferenciada si se persigue Producto 3.0?",
        "¿Qué pasa si se elimina la moda de la ecuación de diferenciación?",
        "¿Cómo mejorarías Producto 3.0?"
      ]
    },
    {
      "id": "p4", "minutes": 15,
      "label": "Ajustando el modelo de distribución",
      "question": "¿Debería Peck permitir que las marcas de Gap Inc. se vendan en Amazon? ¿Por qué sí o no?",
      "probes": [
        "¿Third party o wholesale? ¿Pros y contras de cada uno?",
        "¿Qué oportunidades y desafíos presenta este plan?",
        "Si estuvieras en el negocio de la moda, ¿venderías en Amazon?",
        "¿Cambiarías otros elementos del marketing mix?"
      ]
    },
    {
      "id": "p5", "minutes": 10,
      "label": "Big data y analítica predictiva en marketing",
      "question": "¿Para qué propósitos es útil el big data / la analítica predictiva en marketing? ¿Para qué no lo es?",
      "probes": [
        "¿Cuál es el rol del arte frente a la ciencia en marketing?",
        "¿Bajo qué condiciones debería dominar la ciencia? ¿Y el arte?",
        "¿Qué tipos de comportamiento son fáciles o difíciles de predecir?",
        "¿Qué hay de la privacidad y la seguridad de los datos?"
      ]
    }
  ]',
  '{
    "label": "¿Qué pasó después?",
    "intro": "El caso termina en enero de 2017, con Peck apostando todo a los datos. Esto fue lo que ocurrió en la realidad en los nueve años siguientes.",
    "timeline": [
      {
        "period": "2017 – 2019",
        "title": "El experimento de Producto 3.0 se agota",
        "text": "Peck anuncia en febrero 2019 separar Old Navy. El 7 de noviembre de 2019 es despedido tras un trimestre desastroso: ventas a la baja en las tres marcas, caída de 42% en utilidades. Un analista atribuyó la erosión de marca a la indiferencia de Peck hacia el diseño y el producto."
      },
      {
        "period": "2020 – 2022",
        "title": "Se cancela el spin-off, la rotación de CEOs continúa",
        "text": "En enero 2020 Gap da marcha atrás en la separación de Old Navy. Sonia Syngal pasa a ser CEO. En 2022, con Old Navy también en declive, Syngal sale del cargo."
      },
      {
        "period": "2023 – 2026",
        "title": "Vuelve el director creativo — y la marca se recupera",
        "text": "Asume Richard Dickson (ex-Mattel, artífice del relanzamiento de Barbie). Contrata a Zac Posen como director creativo — exactamente el rol que Peck eliminó. En 2024, las cuatro marcas crecen por primera vez en siete años. Gap reporta +7% en ventas comparables en Q4 2024."
      }
    ],
    "closingQuestion": "Gap probó el extremo de solo datos, le fue mal, y nueve años después volvió a contratar exactamente la figura que Peck había eliminado. ¿Les sorprende? ¿Qué le faltó al modelo de Producto 3.0 que un director creativo sí pudo aportar?"
  }'
) on conflict (slug) do nothing;
