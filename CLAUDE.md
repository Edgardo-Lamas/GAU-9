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
| Backend / Worker | **Node.js + Express** (confirmado) | Gratuito |
| Sincronización | Google Drive API v3 — solo lectura | Gratuito |
| Frontend | **Alpine.js + Tailwind CSS** — PWA | Gratuito |
| Hosting API | Railway | Gratuito |
| Hosting Frontend | Vercel o Netlify | Gratuito |
| Auth | JWT (jsonwebtoken + bcryptjs) | Gratuito |
| Asistente IA | API Anthropic — claude-sonnet-4-6 (Fase 3) | ~$5/mes estimado |

**Principio:** Costo cero en Fase 1 y Fase 2. El único costo aparece en Fase 3 con el asistente IA, y será evaluado contra el valor operativo que genere.

### División de roles:
- **Claude.ai** → Arquitectura, análisis de planillas, decisiones técnicas
- **Claude Code** → Implementación: API, worker, frontend

---

## 5. Arquitectura en Tres Capas

```
[Google Drive] ← solo lectura
     ↓
[Worker de Sincronización]  (node-cron, Railway)
     ↓
[PostgreSQL — Supabase]
     ↓
[API REST — Express]
     ↓
[Dashboard Móvil PWA]  (Alpine.js + Tailwind)
```

---

## 6. Estructura de Carpetas

```
gau9/
├── schema_gau9.sql            ← schema original con modificaciones
├── schema_auth.sql            ← tabla usuarios (agregada — no estaba en schema original)
├── .env
├── .env.example
├── worker/
│   ├── index.js               ← orquestador + node-cron
│   ├── drive.js               ← autenticación service account + lectura
│   ├── normalizar.js          ← normalizarDNI(), normalizarFC(), mapearRol(), normalizarTurno()
│   ├── sync_primario.js
│   ├── sync_secundario.js
│   ├── sync_civiles.js
│   ├── sync_trabajadores.js
│   └── sync_facultades.js
├── api/
│   ├── index.js               ← Express entry point
│   ├── middleware/
│   │   └── auth.js            ← JWT verify middleware
│   ├── routes/
│   │   ├── auth.js            ← POST /api/auth/login
│   │   ├── presentismo.js
│   │   ├── civiles.js
│   │   ├── traslados.js
│   │   ├── personas.js
│   │   └── sync.js
│   └── db.js                  ← pool pg
├── dashboard/
│   ├── index.html
│   ├── sw.js                  ← Service Worker
│   ├── app.js                 ← Alpine.js components
│   └── style.css
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
```

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

GET  /api/presentismo/hoy
GET  /api/presentismo/:dni
GET  /api/presentismo/nivel/:nivel?mes=YYYY-MM
GET  /api/presentismo/metricas?nivel=PRIMARIO&mes=YYYY-MM

GET  /api/civiles/activos
GET  /api/civiles/hoy
GET  /api/civiles/:dni
PATCH /api/civiles/:id/estado

GET  /api/traslados/hoy
GET  /api/traslados/:dni_interno
POST /api/traslados
PATCH /api/traslados/:id/regreso

GET  /api/personas/:dni
GET  /api/buscar?q=apellido

POST /api/sync/ejecutar
GET  /api/sync/log
```

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
- Separar worker y API como dos servicios Railway independientes

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

### Fase 1 — Sistema Base *(actual)*
- [ ] Schema PostgreSQL completo + schema_auth.sql
- [ ] Worker de sincronización desde Drive (solo lectura)
- [ ] Normalización de DNI y datos
- [ ] API REST con auth JWT — endpoints principales
- [ ] Dashboard móvil: vistas de presentismo, civiles activos, traslados del día
- [ ] Registro de traslados (salida / regreso / novedad)
- [ ] Registro de cambios en civiles (cancelación / reemplazo)
- [ ] PWA con Service Worker

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

### Fase 1B — Worker de Sincronización
- [ ] `worker/normalizar.js` — todas las funciones de normalización
- [ ] `worker/drive.js` — autenticación service account + lectura xlsx y gsheet
- [ ] `worker/sync_civiles.js` — primero (más simple, sin dependencias de FC)
- [ ] `worker/sync_primario.js` — skipeo de filas de totales
- [ ] `worker/sync_secundario.js`
- [ ] `worker/sync_trabajadores.js` — manejo de secciones múltiples, fecha en 3 cols
- [ ] `worker/sync_facultades.js` — F.C. normalizado, columna "Fecha 2"
- [ ] `worker/index.js` — orquestador con orden correcto + node-cron + keepalive Supabase

### Fase 1C — API
- [ ] `api/db.js` — pool pg + manejo de errores de conexión
- [ ] `api/middleware/auth.js` — JWT middleware
- [ ] `api/routes/auth.js` — POST /login con bcrypt
- [ ] `api/routes/presentismo.js`
- [ ] `api/routes/civiles.js`
- [ ] `api/routes/traslados.js`
- [ ] `api/routes/personas.js`
- [ ] `api/routes/sync.js`
- [ ] `api/index.js` — Express con CORS configurado para la PWA

### Fase 1D — PWA Frontend
- [ ] `dashboard/index.html` — estructura base mobile-first
- [ ] `dashboard/app.js` — Alpine.js components (presentismo, civiles, traslados)
- [ ] `dashboard/sw.js` — Service Worker con Cache First + Background Sync
- [ ] Login screen con JWT

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
    "cors": "^2.x"
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
| Jun 2026 | Railway para worker como proceso separado | Free tier duerme — worker en cron propio evita fallos silenciosos |
| Jun 2026 | personal_spb.dni nullable | Planilla Trabajadores Colegio no tiene DNI — PK cambiado a UUID |
| Jun 2026 | schema_auth.sql separado | El schema original no incluía autenticación |
| Jun 2026 | Drive solo lectura en Fase 1 y 2 | El sistema debe probar confiabilidad antes de permisos de escritura |
| Jun 2026 | PWA con caché offline | Jefes usan celulares fuera del área con WiFi |
| Jun 2026 | Asistente IA en Fase 3 | Datos deben estar limpios y consolidados antes de agregar lenguaje natural |
| Jun 2026 | GPS Escenario A en Fase 2 | Seguimiento pasivo sin costo; Escenario B (tiempo real) queda como escalabilidad futura |
| Jun 2026 | Costo cero en Fase 1 y 2 | Free tiers de Supabase, Railway, Vercel; único costo en Fase 3 ($5/mes Anthropic) |
| Jun 2026 | Flujo de autorización civil es externo | SPB central gestiona la autorización; Coordinación solo recibe resultado final |

---

*Proyecto GAU-9 — Coordinación Académica, Unidad 9 SPB*
*Iniciado: 23 de junio 2026 | Mantenido por Claude Code*
