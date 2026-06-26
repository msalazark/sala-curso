# Sala de Caso — Deploy en Netlify + Supabase

## Estructura del repositorio

```
sala-caso/
├── sql/
│   └── schema.sql          ← Ejecutar en Supabase SQL Editor (1 sola vez)
├── admin/                  ← App React del Profesor
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── admin.css
│       └── supabase.js
└── student/                ← App React del Alumno
    ├── package.json
    └── src/
        ├── App.jsx
        ├── student.css
        └── supabase.js
```

---

## PASO 1 — Crear proyecto en Supabase

1. Ir a https://supabase.com → New project.
2. Anotar:
   - **Project URL**: `https://xxxx.supabase.co`
   - **Anon key**: desde Settings → API → Project API keys → `anon public`
3. Ir a **SQL Editor** → pegar el contenido de `sql/schema.sql` → Run.
4. Confirmar que las tablas se crearon: Table Editor debe mostrar
   `cases`, `sessions`, `participants`, `responses`.
5. Ir a **Authentication → Users** → Invite User → crear el email del profesor.
   (Esta es la única cuenta con contraseña — los alumnos no necesitan cuenta.)

---

## PASO 2 — Configurar variables de entorno

Cada app necesita un archivo `.env` local para desarrollo:

**admin/.env**
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**student/.env**
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> Ambas apps usan las mismas credenciales. Las políticas RLS de Supabase
> controlan quién puede hacer qué (el anon key no da acceso de admin).

---

## PASO 3 — Desarrollo local

```bash
# Admin
cd admin && npm install && npm run dev   # → http://localhost:5173

# Estudiante (en otra terminal)
cd student && npm install && npm run dev  # → http://localhost:5174
```

Para probar: abrir el admin en una ventana, crear una sesión,
copiar la URL y abrirla en modo incógnito como estudiante.

---

## PASO 4 — Deploy en Netlify (dos sitios del mismo repo)

### 4a. Subir el código a GitHub

```bash
git init && git add . && git commit -m "feat: initial sala-caso"
git remote add origin https://github.com/TU_USUARIO/sala-caso.git
git push -u origin main
```

### 4b. Crear sitio del Admin en Netlify

1. Netlify → **Add new site → Import an existing project → GitHub**.
2. Seleccionar el repo `sala-caso`.
3. Configurar:
   - **Base directory**: `admin`
   - **Build command**: `npm run build`
   - **Publish directory**: `admin/dist`
4. En **Environment variables** agregar:
   ```
   VITE_SUPABASE_URL     = https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJ...
   ```
5. Deploy. Renombrar el sitio a algo como `sala-caso-admin.netlify.app`
   (o usar dominio propio).

### 4c. Crear sitio del Estudiante en Netlify

1. Repetir el proceso anterior con:
   - **Base directory**: `student`
   - **Build command**: `npm run build`
   - **Publish directory**: `student/dist`
2. Las mismas variables de entorno.
3. Renombrar a `sala-caso.netlify.app` (o dominio propio).

> El alumno siempre accede con `?session=UUID`.
> Ejemplo: `https://sala-caso.netlify.app?session=abc-123-...`

---

## PASO 5 — Flujo de una sesión de clase

```
1. Profesor abre: https://sala-caso-admin.netlify.app
2. Login con email + contraseña (Supabase Auth).
3. Clic en "+ Nueva sesión" → elige el caso → escribe el nombre de la sesión.
4. Se genera la sesión. Aparece la URL para alumnos con el ?session=UUID.
5. Profesor proyecta esa URL (o un QR generado con cualquier app de QR).

6. Alumnos abren la URL en su celular → escriben su nombre → entran.

7. Profesor activa la Pastura 1 → todos los alumnos ven la pregunta
   en tiempo real (Supabase Realtime WebSocket).

8. Alumnos responden (escrita u oral). Respuestas aparecen en el
   feed en vivo del admin.

9. Profesor puede calificar en el tab "Calificar" durante o después
   de la sesión.

10. Al final: "Cerrar sesión" → exportar CSV con todas las respuestas
    y calificaciones para el acta.
```

---

## Agregar un nuevo caso

Solo ejecutar en el SQL Editor de Supabase:

```sql
INSERT INTO cases (slug, title, subtitle, pastures, epilogue)
VALUES (
  'nuevo-caso-slug',
  'Título del caso',
  'Subtítulo / código HBS',
  '[
    {"id":"p1","label":"Primera pregunta","question":"...","probes":["..."],"minutes":20},
    ...
  ]',
  '{"label":"¿Qué pasó?","intro":"...","timeline":[...],"closingQuestion":"..."}'
);
```

No se toca código. La app carga los casos dinámicamente desde la BD.

---

## Gestionar usuarios admin

Desde **Supabase → Authentication → Users**:
- Invite User → se envía email con contraseña temporal.
- Para revocar acceso: Delete user.

---

## Seguridad

- Los alumnos usan el **anon key** — las políticas RLS solo les permiten
  INSERT en `participants` y `responses`, y SELECT en todo.
- Solo usuarios autenticados (admin) pueden UPDATE `responses` (calificar)
  y modificar `sessions`.
- La contraseña del admin nunca toca el código fuente — vive en Supabase Auth.

---

## Costos estimados (gratis)

| Servicio | Tier | Límite relevante |
|----------|------|-----------------|
| Supabase | Free | 500 MB DB, 50k filas, 2M realtime msgs/mes |
| Netlify  | Free | 100 GB bandwidth, 300 build minutes/mes |

Para clases de hasta 40 alumnos con sesiones semanales: **$0/mes**.
