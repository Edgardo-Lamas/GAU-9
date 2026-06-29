# CLAUDE.md — Proyecto GAU-9
## Guía de Arquitectura, Decisiones y Plan de Trabajo

---

## 1. Identidad del Proyecto

**Nombre:** GAU-9 — Sistema de Gestión Operativa Penitenciaria y Educativa
**Cliente:** Coordinación Académica, Unidad 9 — Servicio Penitenciario Bonaerense (SPB)
**Usuarios finales:** 3 jefes del área académica
**Fecha de inicio:** Junio 2026

La Coordinación gestiona actualmente cinco planillas de Google Drive de forma manual. Los jefes no tienen acceso a información consolidada fuera de la PC de escritorio.

**Problema central:** Información dispersa, no accesible en movilidad, sin cruce de datos entre planillas.
**Objetivo central:** Brindar información operativa en tiempo real desde cualquier celular, dentro y fuera de la unidad.

---

## 2. Fuentes de Verdad (Google Drive)

Las planillas son la fuente de verdad del sistema. El sistema **solo las lee** — no escribe sobre ellas en Fase 1 ni Fase 2.

| # | Planilla | Formato | Propietario | ID Drive |
|---|----------|---------|-------------|----------|
| 1 | PRESENTISMO PRIMARIO 2026 | .xlsx | soporteescuelau9@gmail.com | `1rKoNDs1m8W8_z-7ImarMyXRpIQXuuvs6` |
| 2 | PRESENTISMO SECUNDARIO 2026 | .xlsx | soporteescuelau9@gmail.com | `12C_UfPBeyVoFbTx0ggoXZH5lEQWqRLmH` |
| 3 | Ingreso de Civiles 2026 | Google Sheet | caeunidad9@gmail.com | `1ycIp1bFIyNVi-UxqoAB86ok4hdMDMWWSJ0UWXYj31lo` |
| 4 | LISTADO TRABAJADORES COLEGIO 2026 | .xlsx | soporteescuelau9@gmail.com | `1Ypz1osYWJp9yVO1FSJZD7tFG82jFVTU7` |
| 5 | FACULTADES 2026 | Google Sheet | caeunidad9@gmail.com | `1jNZ7bSOAeny-8TNkNYj0c70EI19FVY4rGck2cgRhRg8` |
| 6 | Cursos 2026 | Google Sheet | a crear por coordinador | `env: DRIVE_ID_CURSOS` (pendiente) |

> La escritura de vuelta a Drive se evaluará en Fase 3 una vez probada la confiabilidad del sistema.

### Planilla Cursos 2026 — estructura requerida

El coordinador debe crear un Google Sheet con dos hojas exactas:

**Hoja "Cursos":** Nombre · Docente DNI · Destino · Fecha Inicio · Fecha Fin · Estado · Observaciones

**Hoja "Inscripciones":** F.C. Nº · Curso (nombre exacto) · Estado (Cursando/Aprobado/Desaprobado) · Observaciones

Compartir con `gau9-worker@gau-9-drive.iam.gserviceaccount.com` y agregar el ID como secret `DRIVE_ID_CURSOS` en Vercel y GitHub Actions.

---

## 3. Tres Grupos de Personas

| Tipo | Identificador principal | Identificador secundario |
|------|------------------------|--------------------------|
| **INTERNO** | DNI | F.C. Nº (Ficha de Conducta) |
| **PERSONAL SPB** | DNI (cuando existe) | F.C. Nº + I.D. Nº |
| **CIVIL / DOCENTE** | DNI | N° GDEBA (autorización) |

**Regla:** El DNI es la clave primaria universal para vincular los tres grupos en PostgreSQL.
**Problema conocido:** El DNI aparece con formatos inconsistentes entre planillas (con/sin puntos). El worker normaliza antes de insertar.

---

## 4. Stack Técnico

| Capa | Tecnología | Costo |
|------|-----------|-------|
| Base de datos | PostgreSQL (Supabase free tier) | Gratuito |
| Backend / API | **Node.js + Express serverless** | Gratuito |
| Sincronización Drive | **GitHub Actions cron** (cada 30 min) — `worker/sync-once.js` | Gratuito |
| Google Drive API | Drive API v3 + Sheets API v4 — solo lectura | Gratuito |
| Frontend | **Alpine.js + CSS custom properties** — PWA | Gratuito |
| Hosting (API + Frontend) | **Vercel** — mismo dominio, misma app | Gratuito |
| Auth | JWT (jsonwebtoken + bcryptjs) | Gratuito |
| Seguridad HTTP | **helmet.js** | Gratuito |
| Asistente IA | **@anthropic-ai/sdk** — claude-sonnet-4-6 — **activo en producción** | ~$5/mes estimado |

> **Railway trial expiró (Jun 2026).** Se migró a Vercel (API serverless + static dashboard) + GitHub Actions (worker cron). El endpoint `POST /api/sync/ejecutar` NO funciona en Vercel serverless — la sincronización real es exclusivamente via GitHub Actions.

**Principio:** Costo cero en Fase 1 y Fase 2 salvo Anthropic (~$5/mes, ya activo).

### División de roles:
- **Claude.ai** → Arquitectura, análisis de planillas, decisiones técnicas
- **Claude Code** → Implementación: API, worker, frontend

---

## 5. Arquitectura en Tres Capas

```
[Google Drive] ← solo lectura
     ↓
[GitHub Actions — cron cada 30 min]
  └── worker/sync-once.js (corre todos los sync y sale)
     ↓
[PostgreSQL — Supabase]  (sa-east-1, pooler IPv4)
     ↓
[API REST — Express serverless en Vercel]
  ├── /api/*  → api/index.js
  └── /*      → dashboard/ (archivos estáticos)
     ↓
[Dashboard Móvil PWA]  (Alpine.js + CSS design system)
  URL: https://gau-9.vercel.app
```

---

## 6. Estructura de Carpetas

```
gau9/
├── schema_gau9.sql            ← schema base + activity_log
├── schema_auth.sql            ← tabla usuarios
├── vercel.json                ← routes: /api/* → api/index.js, /* → dashboard/
├── .env
├── .env.example
├── .github/
│   └── workflows/
│       └── sync.yml           ← cron cada 30 min → node worker/sync-once.js
├── worker/
│   ├── sync-once.js           ← entry point GitHub Actions (corre todos y sale)
│   ├── index.js               ← orquestador local (dev) + node-cron
│   ├── drive.js               ← auth service account + leerXlsx + leerSheetCompleto
│   ├── normalizar.js          ← normalizarDNI(), normalizarFC(), mapearRol(), etc.
│   ├── sync_primario.js
│   ├── sync_secundario.js
│   ├── sync_civiles.js
│   ├── sync_trabajadores.js
│   ├── sync_facultades.js
│   └── sync_cursos.js         ← hojas "Cursos" e "Inscripciones"
├── api/
│   ├── index.js               ← Express entry point + helmet + todas las rutas
│   ├── db.js                  ← pool pg
│   ├── logger.js              ← log() silencioso — nunca interrumpe la operación principal
│   ├── middleware/
│   │   └── auth.js            ← JWT verify; sets req.user Y req.usuario (alias)
│   └── routes/
│       ├── auth.js            ← POST /login + POST /cambiar-password
│       ├── dashboard.js       ← GET /api/dashboard/resumen
│       ├── actividad.js       ← GET /api/actividad?limit=N
│       ├── presentismo.js
│       ├── civiles.js         ← /hoy filtra por día de semana (ILIKE dias_horarios)
│       ├── traslados.js
│       ├── personas.js        ← INTERNO incluye datos laborales de personal_spb via FC
│       ├── cursos.js          ← CRUD cursos + inscripciones + cerrar cursada
│       ├── asistente.js       ← POST SSE streaming — claude-sonnet-4-6
│       └── sync.js
├── dashboard/
│   ├── index.html             ← 6 vistas + 6 modales + asistente FAB
│   ├── app.js                 ← Alpine.js — todos los componentes
│   ├── sw.js                  ← Service Worker gau9-v9
│   ├── style.css              ← Design system (CSS custom properties, navy + gold)
│   ├── manifest.json          ← PWA manifest
│   └── icons/
│       ├── icon.svg
│       ├── icon-192.png       ← PNG para instalación Android/desktop
│       └── icon-512.png
└── CLAUDE.md
```

---

## 7. Variables de Entorno

```env
DATABASE_URL=postgresql://user:password@host:5432/gau9
GOOGLE_SERVICE_ACCOUNT_KEY=./credentials/service_account.json
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.readonly
PORT=3000
SYNC_INTERVALO_MINUTOS=30
JWT_SECRET=<secreto largo aleatorio>
JWT_EXPIRES_IN=8h
NODE_ENV=development
DASHBOARD_ORIGIN=https://gau-9.vercel.app   ← CORS en producción
ANTHROPIC_API_KEY=<clave API Anthropic>      ← Asistente IA activo
DRIVE_ID_CURSOS=<ID Sheet Cursos 2026>       ← pendiente hasta que el coordinador cree la planilla
```

> En GitHub Actions, el JSON de la service account se guarda como secret `GOOGLE_SERVICE_ACCOUNT_JSON` y el workflow lo escribe en `credentials/service_account.json` antes de correr el worker. `ANTHROPIC_API_KEY` y `DRIVE_ID_CURSOS` también deben estar como secrets de GitHub Actions.

---

## 8. Schema — Notas de Implementación

### Modificación requerida: `personal_spb`
La planilla Trabajadores Colegio **no tiene columna DNI** (solo `I.D Nº` y `F.C Nº`).
**Solución aplicada:** `personal_spb` usa UUID como PK; `dni` es nullable; `ficha_conducta` es la clave operativa.

### Tabla `usuarios` (auth)
```sql
CREATE TABLE usuarios (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre        VARCHAR(100),
    rol           VARCHAR(20) DEFAULT 'JEFE' CHECK (rol IN ('JEFE', 'ADMIN')),
    activo        BOOLEAN DEFAULT TRUE,
    creado_en     TIMESTAMP DEFAULT NOW()
);
```

### Tablas `cursos` e `inscripciones` (Fase 2 — creadas 29/06/2026)
```sql
CREATE TABLE cursos (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre         VARCHAR(200) NOT NULL UNIQUE,
    docente_dni    VARCHAR(20),
    destino        VARCHAR(50),
    fecha_inicio   DATE,
    fecha_fin      DATE,
    estado         VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','FINALIZADO','SUSPENDIDO')),
    observaciones  TEXT,
    fuente_fila    INTEGER,
    creado_en      TIMESTAMP DEFAULT NOW(),
    actualizado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE inscripciones (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    curso_id       UUID NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
    ficha_conducta VARCHAR(20) NOT NULL,
    estado         VARCHAR(20) DEFAULT 'Cursando' CHECK (estado IN ('Cursando','Aprobado','Desaprobado')),
    observaciones  TEXT,
    fuente_fila    INTEGER,
    creado_en      TIMESTAMP DEFAULT NOW(),
    actualizado_en TIMESTAMP DEFAULT NOW(),
    UNIQUE (curso_id, ficha_conducta)
);
```

### Orden de sincronización (dependencias FK)

```
1. personas           ← base, sin dependencias
2. internos_detalle   ← FK → personas
3. personal_spb       ← FK → personas (nullable cuando no hay DNI)
4. civiles_ingreso    ← FK → personas
5. presentismo        ← FK → personas
6. traslados          ← FK → personas + internos_detalle.ficha_conducta
7. cursos             ← sin dependencias FK externas
8. inscripciones      ← FK → cursos (ficha_conducta referencia operativa)
```

---

## 9. Normalización (worker/normalizar.js)

```javascript
// DNI: "37.610.248" → "37610248"
function normalizarDNI(dni) { ... }

// F.C. Nº: "645.260" → "645260"
function normalizarFC(fc) { ... }

// ROL civiles: "Estudiantes" → "ESTUDIANTE"
function mapearRol(rol) {
  // DOCENTE, CIVIL, ESTUDIANTE, JUEZ, ABOGADO → OTRO
}

// Turno: "Tarde" → "TARDE"
function normalizarTurno(turno) { ... }
```

---

## 10. Notas por Planilla

### Presentismo Primario y Secundario
- Las **primeras filas de cada hoja son totales agregados** — skipear hasta encontrar la fila con "CICLO" o "CURSO"
- Columnas de días son dinámicas por mes
- DNI puede venir con o sin puntos en el mismo archivo

### Trabajadores Colegio
- Sin columna DNI — usar `F.C Nº` como clave operativa
- Fecha en **3 columnas separadas**: `D`, `M`, `AÑO`
- Typo en el header original: `TAREA ASGINADA` (no ASIGNADA)
- El archivo tiene múltiples secciones por página (COLEGIO / CEUSTA)
- Los datos de trabajo (tarea, taller, sector) se muestran en el perfil del interno via JOIN por ficha_conducta

### Facultades
- Primera columna se llama `Fecha 2` (no `Fecha`)
- F.C. N° viene con puntos: `645.260` — usar `normalizarFC()`
- Es el libro de traslados históricos — los nuevos se cargan manualmente via API
- Internos que solo aparecen en Facultades se crean con DNI placeholder `FC-{numero}`

### Ingreso Civiles
- Estructura limpia, hoja continua (no por mes)
- DNI mezcla formatos — siempre normalizar
- ROL como texto libre — siempre pasar por `mapearRol()`
- `dias_horarios` contiene el día de semana en texto: "Viernes de 14:00 hs a 18:00 hs"
- El filtro `/hoy` usa ILIKE con CASE DOW — funciona para días regulares, NO para eventos especiales por fecha puntual (pendiente definir con jefes)

### Cursos 2026 (pendiente creación por coordinador)
- Google Sheet con dos hojas: "Cursos" e "Inscripciones"
- El interno se identifica por F.C. Nº (no DNI, consistente con Trabajadores)
- El nombre del curso en "Inscripciones" debe coincidir exactamente con el nombre en "Cursos"
- Estado de inscripción: `Cursando` / `Aprobado` / `Desaprobado` (case-sensitive en el Sheet)

---

## 11. API REST — Endpoints

Todos los endpoints excepto `/api/auth/login` y `/verificar/:codigo` requieren `Authorization: Bearer <token>`.

```
POST /api/auth/login
POST /api/auth/cambiar-password

GET  /api/dashboard/resumen          ← civiles count filtrado por día de semana

GET  /api/actividad?limit=N

GET  /api/presentismo/hoy
GET  /api/presentismo/:dni
GET  /api/presentismo/nivel/:nivel?mes=YYYY-MM
GET  /api/presentismo/metricas?nivel=PRIMARIO&mes=YYYY-MM

GET  /api/civiles/hoy                ← filtrado por día de semana (ILIKE dias_horarios)
GET  /api/civiles/vigentes           ← todos activos en período, sin filtro de día
GET  /api/civiles/activos
GET  /api/civiles/:dni
PATCH /api/civiles/:id/estado

GET  /api/traslados/hoy
GET  /api/traslados/:dni_interno
POST /api/traslados
PATCH /api/traslados/:id/regreso

GET  /api/personas/:dni              ← INTERNO: incluye datos de personal_spb via ficha_conducta
GET  /api/buscar?q=apellido

GET  /api/cursos?estado=ACTIVO       ← lista con métricas (total, cursando, aprobados, desaprobados)
GET  /api/cursos/:id/alumnos         ← alumnos con datos de persona
PATCH /api/cursos/inscripciones/:id/estado
PATCH /api/cursos/:id/cerrar         ← cierra cursada masivamente (listas aprobados/desaprobados)

POST /api/asistente                  ← SSE streaming, claude-sonnet-4-6, contexto DB en tiempo real

POST /api/sync/ejecutar              ← NO funciona en Vercel serverless
GET  /api/sync/log
```

---

## 12. Asistente IA (activo desde 29/06/2026)

- **Endpoint:** `POST /api/asistente` — SSE streaming con `text/event-stream`
- **Modelo:** `claude-sonnet-4-6` via `@anthropic-ai/sdk` con `client.messages.stream()`
- **Contexto en tiempo real:** `obtenerContextoDB()` consulta métricas del día, últimas 15 acciones del activity_log, tendencia de presentismo 7 días
- **Dotenv override:** `dotenv.config({ override: true })` necesario para que `ANTHROPIC_API_KEY` no sea sobreescrita por el entorno de Claude Code local
- **UI:** botón flotante FAB (z-index 120), panel full-screen con historial de chat, chips de sugerencias, `renderMarkdown()` con soporte de tablas
- **Roles del asistente:** operativo (estado del día) + estratégico (análisis de tendencias, sugerencias de mejora)

---

## 13. Traslados — Modalidades GPS

**Modalidad CON_GPS:** tobillera, registro de horario pautado y resultado.
**Modalidad SIN_GPS:** traslado por personal SPB, registro de oficial + horarios.
**Escenario B (tiempo real):** escalabilidad futura, requiere integración SPB central.

---

## 14. PWA — Comportamiento Offline

- **Cache First:** presentismo del día, civiles activos, traslados pendientes
- **Network First:** búsquedas, sync manual
- **Background Sync:** cola de traslados offline — se sincronizan al reconectar
- **SW versión actual:** `gau9-v9` — incrementar con cada deploy que cambie archivos estáticos
- **Íconos PNG:** `icon-192.png` y `icon-512.png` generados con `rsvg-convert` para instalación en desktop/Android

---

## 15. Advertencias de Hosting (free tier)

- **Supabase** pausa la DB tras 7 días de inactividad → worker incluye keepalive query diario a las 06:00
- **Vercel** — API serverless; `POST /api/sync/ejecutar` no funciona. Sync real es vía GitHub Actions
- **GitHub Actions free tier** — 2000 min/mes; cron cada 30 min ≈ 60 min/mes, sin problema
- **Railway** — ya no se usa. Trial expiró Jun 2026. No reconectar.

---

## 16. Reglas de Negocio Críticas

1. El DNI debe normalizarse al ingresar: sin puntos, sin espacios, solo dígitos
2. El F.C. Nº es la clave de cruce entre Presentismo/Facultades/Trabajadores/Inscripciones cuando no hay DNI
3. Los traslados se registran con hora de salida al partir y hora de regreso al volver
4. Los cambios en civiles (cancelación/reemplazo) se registran solo en la base de datos — no en Drive
5. Las planillas tienen múltiples hojas (una por mes) — el worker itera todas
6. El campo `observaciones` en traslados actúa como libro de guardia digital
7. Drive es solo lectura hasta que el sistema demuestre confiabilidad operativa
8. El flujo de autorización de civiles es externo (SPB central) — la Coordinación solo recibe el resultado
9. **Datos sensibles:** no loguear DNIs ni nombres completos en consola en producción
10. El filtro de civiles por día usa ILIKE sobre `dias_horarios` — solo funciona para autorizaciones semanales recurrentes. Eventos especiales por fecha puntual son un caso pendiente de definir con los jefes.

---

## 17. Roadmap de Fases

### Fase 1 — Sistema Base ✓ COMPLETA EN PRODUCCIÓN
- [x] Schema PostgreSQL completo + schema_auth.sql + activity_log
- [x] Worker de sincronización desde Drive (6 workers incluyendo sync_cursos)
- [x] Normalización de DNI y datos
- [x] API REST con auth JWT — todos los endpoints
- [x] Dashboard móvil: 6 vistas (Inicio, Asistencia, Civiles, Traslados, Cursos, Buscar)
- [x] Registro de traslados (salida / regreso / novedad)
- [x] Registro de cambios en civiles (cancelación / reemplazo)
- [x] PWA con Service Worker + offline queue IndexedDB
- [x] Log de actividad del sistema
- [x] Cambio de contraseña para usuarios
- [x] Deploy en Vercel: https://gau-9.vercel.app
- [x] Asistente IA streaming (claude-sonnet-4-6) con contexto operativo y estratégico
- [x] Civiles agrupados por categoría (DOCENTE, JUEZ, ABOGADO, etc.)
- [x] Perfil del interno con datos laborales (tarea, taller, sector de personal_spb)
- [x] Módulo Cursos + Inscripciones (schema + worker + API + vista)
- [ ] **PENDIENTE:** compartir planilla "Cursos 2026" con service account + agregar `DRIVE_ID_CURSOS`
- [ ] **PENDIENTE:** crear las 3 cuentas de usuario para los jefes
- [ ] **PENDIENTE:** cosas varias que quedaron de la sesión 29/06 — ver con jefes

### Fase 2 — Vistas Especializadas y Seguimiento
- [x] Vista de Cursos activos ← adelantada a Fase 1
- [ ] Certificado PDF con código de validación único + QR
- [ ] Página pública `/verificar/:codigo` para validación de certificados (juzgados)
- [ ] Eventos especiales: campo `fecha_especial` en civiles para autorizaciones puntuales (pendiente consulta a jefes)
- [ ] Métricas académicas comparativas (Primario vs Secundario)
- [ ] Seguimiento horario de internos CON_GPS (Escenario A — cumplimiento manual)
- [ ] Reportes exportables

### Fase 3 — Asistente IA avanzado + Escritura a Drive
- [x] Integración API Anthropic ← adelantada a Fase 1
- [ ] Alertas automáticas (traslados sin regreso, vencimiento de autorizaciones)
- [ ] Evaluación de escritura de vuelta a Drive
- [ ] Asistente con acceso a historial de cursos y certificados

### Escalabilidad Futura
- [ ] Tracking GPS en tiempo real — Escenario B (requiere integración SPB central)
- [ ] Extensión a otras unidades del SPB

---

## 18. Dependencias Node.js

```json
{
  "dependencies": {
    "express": "^4.x",
    "pg": "^8.x",
    "googleapis": "^140.x",
    "xlsx": "^0.18.x",
    "node-cron": "^3.x",
    "jsonwebtoken": "^9.x",
    "bcryptjs": "^2.x",
    "dotenv": "^16.x",
    "cors": "^2.x",
    "helmet": "^7.x",
    "@anthropic-ai/sdk": "^0.x"
  }
}
```

---

## 19. Registro de Decisiones Técnicas

| Fecha | Decisión | Motivo |
|-------|----------|--------|
| Jun 2026 | DNI como PK universal | Único identificador presente en los tres grupos |
| Jun 2026 | Node.js + Express (no Python) | Consistencia con JS del Service Worker |
| Jun 2026 | Alpine.js + CSS custom properties (no React/Tailwind @apply) | Sin build step; @apply requiere PostCSS y falla silenciosamente en browser |
| Jun 2026 | **Vercel + GitHub Actions** (reemplazo Railway) | Railway trial expiró Jun 2026 |
| Jun 2026 | personal_spb.dni nullable | Planilla Trabajadores no tiene DNI — PK cambiado a UUID |
| Jun 2026 | Drive solo lectura en Fase 1 y 2 | El sistema debe probar confiabilidad antes de permisos de escritura |
| Jun 2026 | PWA con caché offline | Jefes usan celulares fuera del área WiFi |
| Jun 2026 | Activity log silencioso | Nunca interrumpe la operación principal — catch vacío en api/logger.js |
| Jun 2026 | req.usuario alias en auth middleware | Rutas y logger usan req.usuario; middleware JWT seteaba solo req.user |
| Jun 2026 | dotenv.config({ override: true }) en asistente.js | Sin override, ANTHROPIC_API_KEY del entorno Claude Code sobreescribía la del .env local |
| Jun 2026 | Asistente IA adelantado a Fase 1 | Demanda operativa real — los jefes necesitan apoyo estratégico desde el inicio |
| Jun 2026 | Civiles /hoy filtra por día de semana | El campo dias_horarios contiene el nombre del día — ILIKE es suficiente para autorizaciones recurrentes |
| Jun 2026 | Civiles agrupados por rol (no lista plana) | Con 10-50 personas en eventos la lista plana es ilegible; agrupado por DOCENTE/JUEZ/ABOGADO/etc. da estructura visual |
| Jun 2026 | Perfil interno via JOIN personal_spb por FC | La planilla Trabajadores no tiene DNI — el único link es ficha_conducta → internos_detalle → personas |
| Jun 2026 | Cursos: nombre UNIQUE como clave de upsert | Evita duplicados sin requerir ID externo; el coordinador controla los nombres |
| Jun 2026 | Inscripciones: ficha_conducta sin FK dura a internos_detalle | Permite inscribir antes de que el interno esté sincronizado desde Presentismo |

---

## 20. Estado Actual y Próximos Pasos (29/06/2026)

### Sistema en producción

- URL: https://gau-9.vercel.app
- API serverless en Vercel, DB en Supabase (sa-east-1)
- GitHub Actions cron activo — las 5 planillas originales ya sincronizadas
- Usuario ADMIN creado: `admin@gau9.com`
- Asistente IA activo con `ANTHROPIC_API_KEY` en Vercel

### Pendientes operativos

1. **Planilla "Cursos 2026"**: el coordinador debe crearla con las hojas "Cursos" e "Inscripciones", compartirla con el service account, y pasar el ID para agregar `DRIVE_ID_CURSOS` en Vercel + GitHub Actions secrets
2. **Crear las 3 cuentas de los jefes** (`node scripts/crear_admin.js`)
3. **Cosas varias** observadas en la sesión del 29/06 — revisar con los jefes en la próxima sesión

### Pendientes técnicos (próxima sesión)

- **Eventos especiales civiles**: definir con jefes si las autorizaciones para eventos puntuales usan fecha específica (campo `fecha_especial`) o convención de texto en `dias_horarios`
- **Certificado PDF**: jsPDF en frontend, código único de validación, QR imprimible
- **Página pública de validación** (`/verificar/:codigo`) para que juzgados puedan autenticar certificados
- **Cosas varias del dashboard** que quedaron pendientes de revisar

---

*Proyecto GAU-9 — Coordinación Académica, Unidad 9 SPB*
*Iniciado: 23 de junio 2026 | Actualizado: 29 de junio 2026 | Mantenido por Claude Code*
