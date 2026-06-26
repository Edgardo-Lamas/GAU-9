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

Las cinco planillas son la fuente de verdad del sistema. El sistema **solo las lee** — no escribe sobre ellas en Fase 1 ni Fase 2.

| # | Planilla | Formato | Propietario | ID Drive |
|---|----------|---------|-------------|----------|
| 1 | PRESENTISMO PRIMARIO 2026 | .xlsx | soporteescuelau9@gmail.com | `1rKoNDs1m8W8_z-7ImarMyXRpIQXuuvs6` |
| 2 | PRESENTISMO SECUNDARIO 2026 | .xlsx | soporteescuelau9@gmail.com | `12C_UfPBeyVoFbTx0ggoXZH5lEQWqRLmH` |
| 3 | Ingreso de Civiles 2026 | Google Sheet | caeunidad9@gmail.com | `1ycIp1bFIyNVi-UxqoAB86ok4hdMDMWWSJ0UWXYj31lo` |
| 4 | LISTADO TRABAJADORES COLEGIO 2026 | .xlsx | soporteescuelau9@gmail.com | `1Ypz1osYWJp9yVO1FSJZD7tFG82jFVTU7` |
| 5 | FACULTADES 2026 | Google Sheet | caeunidad9@gmail.com | `1jNZ7bSOAeny-8TNkNYj0c70EI19FVY4rGck2cgRhRg8` |

> La escritura de vuelta a Drive se evaluará en Fase 3 una vez probada la confiabilidad del sistema.

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
| Asistente IA | API Anthropic — claude-sonnet-4-6 (Fase 3) | ~$5/mes estimado |

> **Railway trial expiró (Jun 2026).** Se migró a Vercel (API serverless + static dashboard) + GitHub Actions (worker cron). El endpoint `POST /api/sync/ejecutar` NO funciona en Vercel serverless — la sincronización real es exclusivamente via GitHub Actions.

**Principio:** Costo cero en Fase 1 y Fase 2. El único costo aparece en Fase 3 con el asistente IA, y será evaluado contra el valor operativo que genere.

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
├── schema_gau9.sql            ← schema + activity_log al final
├── schema_auth.sql            ← tabla usuarios
├── vercel.json                ← routes: /api/* → api/index.js, /* → dashboard/
├── .env
├── .env.example               ← incluye DASHBOARD_ORIGIN
├── .github/
│   └── workflows/
│       └── sync.yml           ← cron cada 30 min → node worker/sync-once.js
├── worker/
│   ├── sync-once.js           ← entry point GitHub Actions (corre todos y sale)
│   ├── index.js               ← orquestador local (dev) + node-cron
│   ├── drive.js               ← auth service account + leerXlsx + leerSheetCompleto
│   ├── normalizar.js          ← normalizarDNI(), normalizarFC(), mapearRol(), normalizarTurno()
│   ├── sync_primario.js
│   ├── sync_secundario.js
│   ├── sync_civiles.js
│   ├── sync_trabajadores.js
│   └── sync_facultades.js
├── api/
│   ├── index.js               ← Express entry point + helmet + todas las rutas
│   ├── db.js                  ← pool pg
│   ├── logger.js              ← log() silencioso — nunca interrumpe la operación principal
│   ├── middleware/
│   │   └── auth.js            ← JWT verify; sets req.user Y req.usuario (alias)
│   └── routes/
│       ├── auth.js            ← POST /login + POST /cambiar-password
│       ├── dashboard.js       ← GET /api/dashboard/resumen
│       ├── actividad.js       ← GET /api/actividad?limit=N (ADMIN ve todo, JEFE ve lo propio)
│       ├── presentismo.js
│       ├── civiles.js
│       ├── traslados.js
│       ├── personas.js
│       └── sync.js
├── dashboard/
│   ├── index.html             ← PWA reescrito con design system institucional
│   ├── app.js                 ← Alpine.js — todos los componentes y lógica
│   ├── sw.js                  ← Service Worker Cache First + Background Sync
│   ├── style.css              ← Design system completo (CSS custom properties)
│   ├── manifest.json          ← PWA manifest (theme navy #0f1f4a)
│   └── icons/
│       └── icon.svg           ← ícono institucional navy + gold
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
```

> En GitHub Actions, el JSON de la service account se guarda como secret `GOOGLE_SERVICE_ACCOUNT_JSON` y el workflow lo escribe en `credentials/service_account.json` antes de correr el worker.

---

## 8. Schema — Notas de Implementación

### Modificación requerida: `personal_spb`
La planilla Trabajadores Colegio **no tiene columna DNI** (solo `I.D Nº` y `F.C Nº`).
El schema original tenía `dni` como PK y FK a `personas` — eso impide popular la tabla desde la planilla.

**Solución aplicada:** `personal_spb` usa UUID como PK; `dni` es nullable; `ficha_conducta` es la clave operativa.

### Tabla faltante: `usuarios` (auth)
El schema original no incluye tabla de autenticación. Se agrega en `schema_auth.sql`:

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

### Orden de sincronización (dependencias FK obligatorio)

```
1. personas           ← base, sin dependencias
2. internos_detalle   ← FK → personas
3. personal_spb       ← FK → personas (nullable cuando no hay DNI)
4. civiles_ingreso    ← FK → personas
5. presentismo        ← FK → personas (internos ya cargados)
6. traslados          ← FK → personas + internos_detalle.ficha_conducta
```

---

## 9. Normalización (worker/normalizar.js)

```javascript
// DNI: "37.610.248" → "37610248"
function normalizarDNI(dni) {
  if (!dni) return null;
  return String(dni).replace(/\./g, '').replace(/\s/g, '').trim();
}

// F.C. Nº: "645.260" → "645260"  (misma lógica)
function normalizarFC(fc) {
  if (!fc) return null;
  return String(fc).replace(/\./g, '').replace(/\s/g, '').trim();
}

// ROL civiles: "Estudiantes" → "ESTUDIANTE"
function mapearRol(rol) {
  const mapa = {
    'docente': 'DOCENTE', 'civil': 'CIVIL',
    'estudiante': 'ESTUDIANTE', 'estudiantes': 'ESTUDIANTE',
    'juez': 'JUEZ', 'abogado': 'ABOGADO',
  };
  return mapa[String(rol).toLowerCase().trim()] || 'OTRO';
}

// Turno: "Tarde" → "TARDE"
function normalizarTurno(turno) {
  return String(turno || '').toUpperCase().trim();
}
```

---

## 10. Notas por Planilla (validadas con datos reales el 23/06/2026)

### Presentismo Primario y Secundario
- Las **primeras filas de cada hoja son totales agregados** — skipear hasta encontrar la fila con "CICLO" o "CURSO"
- Columnas de días son dinámicas por mes
- DNI puede venir con o sin puntos en el mismo archivo
- Columna A (ausencias) existe en ambos niveles; en Secundario siempre es 0

### Trabajadores Colegio
- Sin columna DNI — usar `F.C Nº` como clave operativa
- Fecha en **3 columnas separadas**: `D`, `M`, `AÑO` → `new Date(AÑO, M-1, D)`
- Typo en el header original: `TAREA ASGINADA` (no ASIGNADA) — buscar esa variante exacta
- El archivo tiene múltiples secciones por página (COLEGIO / CEUSTA) — detectar por texto de sección

### Facultades
- Primera columna se llama `Fecha 2` (no `Fecha`)
- F.C. N° viene con puntos: `645.260` — usar `normalizarFC()`
- Es el libro de traslados completo: incluye Certificado, Aval, GPS/Rojo/Blanco, múltiples GDEBA
- Este sheet es la **fuente histórica** de traslados — los nuevos se cargan manualmente via API

### Ingreso Civiles
- Estructura limpia, hoja continua (no por mes)
- DNI mezcla formatos en el mismo archivo — siempre normalizar
- ROL como texto libre — siempre pasar por `mapearRol()`

---

## 11. API REST — Endpoints Fase 1

Todos los endpoints excepto `/api/auth/login` requieren `Authorization: Bearer <token>`.

```
POST /api/auth/login
POST /api/auth/cambiar-password      ← verifica pwd actual con bcrypt, actualiza hash

GET  /api/dashboard/resumen          ← métricas del día: presentismo + civiles + traslados

GET  /api/actividad?limit=N          ← ADMIN: todo | JEFE: solo lo propio

GET  /api/presentismo/hoy
GET  /api/presentismo/:dni
GET  /api/presentismo/nivel/:nivel?mes=YYYY-MM
GET  /api/presentismo/metricas?nivel=PRIMARIO&mes=YYYY-MM

GET  /api/civiles/activos
GET  /api/civiles/hoy
GET  /api/civiles/:dni
PATCH /api/civiles/:id/estado        ← log: CIVIL_CANCELADO

GET  /api/traslados/hoy
GET  /api/traslados/:dni_interno
POST /api/traslados                  ← log: TRASLADO_NUEVO
PATCH /api/traslados/:id/regreso     ← log: TRASLADO_REGRESO

GET  /api/personas/:dni
GET  /api/buscar?q=apellido

POST /api/sync/ejecutar              ← NO funciona en Vercel serverless (proceso background)
GET  /api/sync/log
```

### Activity Log — acciones registradas

| Acción           | Cuándo                              |
| ---------------- | ----------------------------------- |
| LOGIN            | Cada login exitoso                  |
| TRASLADO_NUEVO   | POST /api/traslados                 |
| TRASLADO_REGRESO | PATCH /api/traslados/:id/regreso    |
| CIVIL_CANCELADO  | PATCH /api/civiles/:id/estado       |
| CAMBIO_PASSWORD  | POST /api/auth/cambiar-password     |

> El log es silencioso: si falla, nunca interrumpe la operación principal (catch vacío en `api/logger.js`).

---

## 12. Traslados — Modalidades GPS

**Modalidad CON_GPS:** el interno se desplaza solo con tobillera. El sistema registra horario pautado y resultado informado por el oficial.
- En Fase 2: seguimiento de cumplimiento horario (Escenario A — registro manual pasivo)

**Modalidad SIN_GPS:** el interno es trasladado por personal SPB. Se registra el oficial responsable, hora de salida y hora de regreso.

**Escenario B (tracking en tiempo real):** escalabilidad futura. Requiere integración con sistemas GPS del SPB central y acuerdos institucionales. No forma parte del roadmap actual.

---

## 13. PWA — Comportamiento Offline

- **Conectividad:** WiFi solo en área de Coordinación; fuera de la unidad los jefes usan datos móviles
- **Cache First:** presentismo del día, civiles activos, traslados pendientes
- **Network First:** búsquedas, sync manual
- **Background Sync:** cola de traslados creados offline — se sincronizan al reconectar
- No cachear en localStorage — usar IndexedDB con expiración

---

## 14. Advertencias de Hosting (free tier)

- **Supabase** pausa la DB tras 7 días de inactividad → el worker debe incluir un keepalive query diario
- **Railway free tier** duerme tras inactividad → el worker debe ser un proceso con `node-cron`, no `setInterval` dentro del servidor API
- **Vercel** — la API corre serverless; procesos background se matan al terminar el handler. `POST /api/sync/ejecutar` no funciona en producción; la sincronización real es vía GitHub Actions cron
- **GitHub Actions free tier** — 2000 min/mes; el cron cada 30 min usa ~60 min/mes, sin problema
- **Railway** — ya no se usa. Trial expiró en Jun 2026. No reconectar.

---

## 15. Reglas de Negocio Críticas

1. El DNI debe normalizarse al ingresar: sin puntos, sin espacios, solo dígitos
2. El F.C. Nº es la clave de cruce entre Presentismo y Facultades cuando no hay DNI explícito
3. Los traslados se registran con hora de salida al partir y hora de regreso al volver
4. Los cambios en civiles (cancelación/reemplazo) se registran solo en la base de datos — no en Drive
5. Las planillas tienen múltiples hojas (una por mes) — el worker itera todas
6. El campo `observaciones` en traslados actúa como libro de guardia digital
7. Drive es solo lectura hasta que el sistema demuestre confiabilidad operativa
8. El flujo de autorización de civiles es externo (SPB central) — la Coordinación solo recibe el resultado
9. **Datos sensibles:** no loguear DNIs ni nombres completos en consola en producción

---

## 16. Roadmap de Fases

### Fase 1 — Sistema Base *(en producción — pendiente sync real)*
- [x] Schema PostgreSQL completo + schema_auth.sql + activity_log
- [x] Worker de sincronización desde Drive (código completo, bloqueado por service account)
- [x] Normalización de DNI y datos
- [x] API REST con auth JWT — todos los endpoints + cambiar-password + dashboard/resumen + actividad
- [x] Dashboard móvil: Inicio con métricas, presentismo, civiles, traslados, búsqueda
- [x] Registro de traslados (salida / regreso / novedad)
- [x] Registro de cambios en civiles (cancelación / reemplazo)
- [x] PWA con Service Worker (Cache First + Background Sync + offline queue IndexedDB)
- [x] Log de actividad del sistema
- [x] Cambio de contraseña para usuarios
- [x] Deploy en Vercel: https://gau-9.vercel.app
- [ ] **PENDIENTE BLOQUEANTE:** compartir las 5 planillas con gau9-worker@gau-9-drive.iam.gserviceaccount.com
- [ ] **PENDIENTE BLOQUEANTE:** crear las 3 cuentas de usuario para los jefes
- [ ] UX/UI: usar MCP de 21st.dev (magic component builder/inspector) para rediseño más profesional

### Fase 2 — Vistas Especializadas y Seguimiento GPS Pasivo
- [ ] Vista de Cursos activos
- [ ] Vista de Abogados / Jueces / Charlas
- [ ] Vista de Actividades semanales
- [ ] Métricas académicas comparativas (Primario vs Secundario)
- [ ] Seguimiento horario de internos CON_GPS (Escenario A — cumplimiento manual)
- [ ] Reportes exportables

### Fase 3 — Asistente IA + Escritura a Drive
- [ ] Integración API Anthropic (claude-sonnet-4-6)
- [ ] Asistente con acceso a PostgreSQL consolidado
- [ ] Consultas en lenguaje natural sobre las planillas
- [ ] Alertas automáticas (traslados sin regreso, vencimiento de autorizaciones)
- [ ] Evaluación de escritura de vuelta a Drive (si el sistema demostró confiabilidad)

### Escalabilidad Futura (post Fase 3)
- [ ] Tracking GPS en tiempo real — Escenario B (requiere integración SPB central)
- [ ] Extensión a otras unidades del SPB

---

## 17. Plan de Trabajo Fase 1 — Checklist de Implementación

### Fase 1A — Fundaciones ✓ COMPLETA (23/06/2026)
- [x] Crear `schema_gau9.sql` con modificación a `personal_spb` (dni nullable, PK UUID)
- [x] Crear `schema_auth.sql` con tabla `usuarios`
- [x] Ejecutar schemas en Supabase y verificar las 8 tablas (7 + usuarios)
- [x] Crear estructura de carpetas del proyecto
- [x] Inicializar `package.json` con dependencias
- [x] Crear `.env.example`

### Fase 1B — Worker de Sincronización ✓ COMPLETA — bloqueada esperando service account

- [x] `worker/normalizar.js` — normalizarDNI, normalizarFC, mapearRol, normalizarTurno
- [x] `worker/drive.js` — auth service account + leerXlsx + leerSheetCompleto
- [x] `worker/sync_civiles.js`
- [x] `worker/sync_primario.js` — skipeo de filas de totales
- [x] `worker/sync_secundario.js`
- [x] `worker/sync_trabajadores.js` — secciones múltiples, fecha en 3 cols, typo ASGINADA
- [x] `worker/sync_facultades.js` — F.C. normalizado, columna "Fecha 2"
- [x] `worker/index.js` — orquestador + node-cron + keepalive Supabase 06:00
- [x] `worker/sync-once.js` — entry point GitHub Actions (corre todos y sale con process.exit)

### Fase 1C — API ✓ COMPLETA

- [x] `api/db.js` — pool pg + manejo de errores de conexión
- [x] `api/logger.js` — log() silencioso; usa req.usuario (alias de req.user)
- [x] `api/middleware/auth.js` — JWT middleware; sets req.user Y req.usuario
- [x] `api/routes/auth.js` — POST /login + POST /cambiar-password
- [x] `api/routes/dashboard.js` — GET /api/dashboard/resumen
- [x] `api/routes/actividad.js` — GET /api/actividad (ADMIN vs JEFE)
- [x] `api/routes/presentismo.js`
- [x] `api/routes/civiles.js` — con log CIVIL_CANCELADO
- [x] `api/routes/traslados.js` — con log TRASLADO_NUEVO y TRASLADO_REGRESO
- [x] `api/routes/personas.js`
- [x] `api/routes/sync.js`
- [x] `api/index.js` — Express + helmet + CORS (DASHBOARD_ORIGIN) + todas las rutas

### Fase 1D — PWA Frontend ✓ COMPLETA

- [x] `dashboard/index.html` — 5 vistas + 5 modales, design system institucional
- [x] `dashboard/app.js` — Alpine.js: login, resumen, presentismo, civiles, traslados, búsqueda, actividad, cambio de contraseña, offline queue
- [x] `dashboard/sw.js` — Cache First + Background Sync + IndexedDB offline
- [x] `dashboard/style.css` — design system completo (CSS custom properties, navy + gold)
- [x] `dashboard/manifest.json` + `dashboard/icons/icon.svg` — PWA instalable Android/iOS
- [x] Deploy activo: <https://gau-9.vercel.app>

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
    "helmet": "^7.x"
  }
}
```

---

## 19. Registro de Decisiones Técnicas

| Fecha | Decisión | Motivo |
|-------|----------|--------|
| Jun 2026 | DNI como PK universal | Único identificador presente en los tres grupos |
| Jun 2026 | Node.js + Express (no Python) | Consistencia con JS del Service Worker; menos context switching |
| Jun 2026 | Alpine.js + Tailwind (no React) | Sin build step; carga rápida en celular; 3 usuarios no justifican SPA compleja |
| Jun 2026 | Railway para worker (original) | Free tier duerme — worker en cron propio evita fallos silenciosos |
| Jun 2026 | **Vercel + GitHub Actions** (reemplazo Railway) | Railway trial expiró Jun 2026; Vercel sirve API serverless + static; GH Actions hace el cron de sync |
| Jun 2026 | personal_spb.dni nullable | Planilla Trabajadores Colegio no tiene DNI — PK cambiado a UUID |
| Jun 2026 | schema_auth.sql separado | El schema original no incluía autenticación |
| Jun 2026 | Drive solo lectura en Fase 1 y 2 | El sistema debe probar confiabilidad antes de permisos de escritura |
| Jun 2026 | PWA con caché offline | Jefes usan celulares fuera del área con WiFi |
| Jun 2026 | Asistente IA en Fase 3 | Datos deben estar limpios y consolidados antes de agregar lenguaje natural |
| Jun 2026 | GPS Escenario A en Fase 2 | Seguimiento pasivo sin costo; Escenario B (tiempo real) queda como escalabilidad futura |
| Jun 2026 | Costo cero en Fase 1 y 2 | Free tiers de Supabase, Vercel, GitHub Actions; único costo en Fase 3 ($5/mes Anthropic) |
| Jun 2026 | Flujo de autorización civil es externo | SPB central gestiona la autorización; Coordinación solo recibe resultado final |
| Jun 2026 | Activity log silencioso | El log nunca interrumpe la operación principal — catch vacío en api/logger.js |
| Jun 2026 | req.usuario alias en auth middleware | Rutas y logger usan req.usuario; middleware JWT seteaba solo req.user — se agrega alias |
| Jun 2026 | CSS custom properties (sin Tailwind @apply) | @apply requiere PostCSS; en browser sin build se ignoraba todo y la pantalla quedaba en blanco |
| Jun 2026 | UX/UI: usar MCP 21st.dev en próxima iteración | El rediseño actual fue hecho inline sin las skills de magic component builder/inspector — debe mejorarse |

---

---

## 20. Estado Actual y Próximos Pasos (26/06/2026)

### Sistema en producción

- URL: <https://gau-9.vercel.app>
- API serverless en Vercel, DB en Supabase (sa-east-1)
- GitHub Actions cron configurado, pendiente que se active con las credenciales correctas
- Usuario ADMIN creado: `admin@gau9.com`

### Bloqueantes para operación real

1. **Compartir planillas Drive** con `gau9-worker@gau-9-drive.iam.gserviceaccount.com`
   - `soporteescuelau9@gmail.com` debe compartir: Presentismo Primario, Presentismo Secundario, Trabajadores Colegio
   - `caeunidad9@gmail.com` debe compartir: Ingreso Civiles, Facultades
2. **Crear las 3 cuentas de los jefes** (script `node scripts/crear_admin.js`)
3. **Verificar secrets en GitHub Actions**: `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `JWT_SECRET`

### Pendiente de mejora (próxima sesión)

- **UX/UI**: usar los MCP de 21st.dev (`mcp__magic__21st_magic_component_builder`,
  `mcp__magic__21st_magic_component_inspiration`, `mcp__magic__21st_magic_component_refiner`)
  para un rediseño de nivel profesional real — no hacerlo inline
- **Logo**: mostrar al usuario los 4 candidatos de Canva para que elija
- **Guía de entrega** para los jefes (cómo instalar la PWA, cómo cambiar contraseña)

---

*Proyecto GAU-9 — Coordinación Académica, Unidad 9 SPB*
*Iniciado: 23 de junio 2026 | Mantenido por Claude Code*
