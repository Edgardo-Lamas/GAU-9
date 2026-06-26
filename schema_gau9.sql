-- ============================================================
-- GAU-9 — Schema PostgreSQL
-- Coordinación Académica, Unidad 9, SPB
-- Versión: Fase 1
-- Fecha: Junio 2026
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONES
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. PERSONAS
-- Tabla central. Unifica internos, personal SPB y civiles.
-- ------------------------------------------------------------
CREATE TABLE personas (
    dni             VARCHAR(20) PRIMARY KEY,  -- Normalizado: sin puntos, sin espacios, solo dígitos
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('INTERNO', 'SPB', 'CIVIL')),
    nombre          VARCHAR(100) NOT NULL,
    apellido_1      VARCHAR(100) NOT NULL,
    apellido_2      VARCHAR(100),
    creado_en       TIMESTAMP DEFAULT NOW(),
    actualizado_en  TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE personas IS 'Tabla central. Unifica los tres grupos: INTERNO, SPB, CIVIL. DNI normalizado sin puntos.';
COMMENT ON COLUMN personas.dni IS 'PK universal. Sin puntos, sin espacios, solo dígitos. Ej: 26576900';

-- ------------------------------------------------------------
-- 2. INTERNOS_DETALLE
-- Datos específicos de internos (educativos y de alojamiento).
-- ------------------------------------------------------------
CREATE TABLE internos_detalle (
    dni                 VARCHAR(20) PRIMARY KEY REFERENCES personas(dni) ON DELETE CASCADE,
    ficha_conducta      VARCHAR(20),           -- FC Nº normalizado sin puntos
    pabellon            VARCHAR(10),
    nivel_educativo     VARCHAR(20) CHECK (nivel_educativo IN ('PRIMARIO', 'SECUNDARIO', 'AMBOS')),
    tiene_gps           BOOLEAN DEFAULT FALSE,
    activo              BOOLEAN DEFAULT TRUE,
    creado_en           TIMESTAMP DEFAULT NOW(),
    actualizado_en      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_internos_ficha ON internos_detalle(ficha_conducta);

COMMENT ON TABLE internos_detalle IS 'Datos educativos y de alojamiento de internos.';
COMMENT ON COLUMN internos_detalle.ficha_conducta IS 'FC Nº normalizado (sin puntos). Clave de cruce con planilla FACULTADES 2026.';
COMMENT ON COLUMN internos_detalle.tiene_gps IS 'TRUE si el interno tiene tobillera GPS. Habilita seguimiento en Fase 2.';

-- ------------------------------------------------------------
-- 3. PERSONAL_SPB
-- Personal del Servicio Penitenciario asignado al área académica.
--
-- NOTA DE IMPLEMENTACIÓN:
-- La planilla TRABAJADORES COLEGIO no tiene columna DNI (solo I.D Nº y F.C Nº).
-- Por eso dni es nullable y la PK es UUID. ficha_conducta es la clave operativa.
-- ------------------------------------------------------------
CREATE TABLE personal_spb (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni             VARCHAR(20) REFERENCES personas(dni) ON DELETE SET NULL,  -- nullable
    ficha_conducta  VARCHAR(20),              -- clave operativa cuando no hay DNI
    id_numero       VARCHAR(20),              -- I.D Nº (identificador interno SPB)
    apellido_nombre VARCHAR(200) NOT NULL,     -- campo unificado tal como viene en la planilla
    tarea_asignada  VARCHAR(200),
    taller          VARCHAR(100),
    categoria       VARCHAR(50),
    sector          VARCHAR(20) CHECK (sector IN ('COLEGIO', 'CEUSTA', 'TALLER', 'OTRO')),
    situacion       VARCHAR(10),              -- SIT. columna de la planilla
    dias_trabajados INTEGER,
    fecha_alta      DATE,
    activo          BOOLEAN DEFAULT TRUE,
    creado_en       TIMESTAMP DEFAULT NOW(),
    actualizado_en  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_spb_ficha ON personal_spb(ficha_conducta);
CREATE INDEX idx_spb_dni ON personal_spb(dni);

COMMENT ON TABLE personal_spb IS 'Personal SPB asignado al área académica. DNI nullable porque la planilla solo tiene F.C Nº.';
COMMENT ON COLUMN personal_spb.ficha_conducta IS 'Clave operativa principal cuando no hay DNI disponible en la planilla.';
COMMENT ON COLUMN personal_spb.apellido_nombre IS 'Nombre completo tal como aparece en la planilla (APELLIDO NOMBRE).';

-- ------------------------------------------------------------
-- 4. CIVILES_INGRESO
-- Docentes, jueces, abogados, estudiantes y otros civiles
-- autorizados a ingresar a la unidad.
-- ------------------------------------------------------------
CREATE TABLE civiles_ingreso (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni                 VARCHAR(20) NOT NULL REFERENCES personas(dni) ON DELETE RESTRICT,
    rol                 VARCHAR(20) NOT NULL CHECK (rol IN ('DOCENTE', 'CIVIL', 'ESTUDIANTE', 'JUEZ', 'ABOGADO', 'OTRO')),
    actividad           VARCHAR(300),
    alta                DATE NOT NULL,
    fin                 DATE,
    dias_horarios       VARCHAR(200),
    destino             VARCHAR(20) CHECK (destino IN ('CEUSTA', 'COLEGIO', 'OTRO')),
    origen              VARCHAR(100),
    gdeba_nro           VARCHAR(100),
    estado              VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'CANCELADO', 'REEMPLAZADO')),
    reemplazado_por_dni VARCHAR(20) REFERENCES personas(dni),
    observaciones       TEXT,
    fuente_fila         INTEGER,              -- número de fila en Drive para trazabilidad
    creado_en           TIMESTAMP DEFAULT NOW(),
    actualizado_en      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_civiles_dni ON civiles_ingreso(dni);
CREATE INDEX idx_civiles_estado ON civiles_ingreso(estado);
CREATE INDEX idx_civiles_alta_fin ON civiles_ingreso(alta, fin);

COMMENT ON TABLE civiles_ingreso IS 'Civiles/docentes autorizados. La Coordinación solo recibe el resultado final de la autorización SPB — no gestiona el flujo interno.';
COMMENT ON COLUMN civiles_ingreso.estado IS 'ACTIVO: vigente. CANCELADO: no viene. REEMPLAZADO: sustituido por otro civil.';
COMMENT ON COLUMN civiles_ingreso.fuente_fila IS 'Número de fila en la planilla Drive. Para trazabilidad y debugging del worker.';

-- ------------------------------------------------------------
-- 5. PRESENTISMO
-- Asistencia diaria de internos (Primario y Secundario).
-- ------------------------------------------------------------
CREATE TABLE presentismo (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni             VARCHAR(20) NOT NULL REFERENCES personas(dni) ON DELETE RESTRICT,
    fecha           DATE NOT NULL,
    nivel           VARCHAR(20) NOT NULL CHECK (nivel IN ('PRIMARIO', 'SECUNDARIO')),
    turno           VARCHAR(20) CHECK (turno IN ('MAÑANA', 'TARDE', 'VESPERTINO', 'INTERMEDIO')),
    division        VARCHAR(10),
    curso           VARCHAR(50),              -- Ej: "3° FORM. POR PROY.", "1° B"
    estado          CHAR(1) CHECK (estado IN ('A', 'P')),
    fuente_planilla VARCHAR(20) CHECK (fuente_planilla IN ('PRIMARIO', 'SECUNDARIO')),
    creado_en       TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_presentismo_unico ON presentismo(dni, fecha, nivel, turno);
CREATE INDEX idx_presentismo_fecha ON presentismo(fecha);
CREATE INDEX idx_presentismo_dni ON presentismo(dni);

COMMENT ON TABLE presentismo IS 'Asistencia diaria. En Primario se registran A y P. En Secundario solo P (presencias); ausencias se infieren.';
COMMENT ON COLUMN presentismo.estado IS 'A=Ausente, P=Presente. En Secundario solo existen registros P.';
COMMENT ON COLUMN presentismo.turno IS 'Normalizado a mayúsculas. La planilla puede traer "Tarde" o "TARDE" — el worker normaliza.';

-- ------------------------------------------------------------
-- 6. TRASLADOS
-- Movimientos de internos a facultades para rendir exámenes.
-- ------------------------------------------------------------
CREATE TABLE traslados (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni_interno     VARCHAR(20) NOT NULL REFERENCES personas(dni) ON DELETE RESTRICT,
    fecha           DATE NOT NULL,
    hora_salida     TIME,
    hora_regreso    TIME,                    -- NULL hasta que el interno regresa
    destino         VARCHAR(100),            -- Nombre libre de la facultad/institución
    facultad        VARCHAR(100),
    materia         VARCHAR(200),
    modalidad       VARCHAR(10) NOT NULL CHECK (modalidad IN ('CON_GPS', 'SIN_GPS')),
    dni_oficial     VARCHAR(20) REFERENCES personas(dni),  -- solo si SIN_GPS
    gdeba_nro       VARCHAR(100),
    horario_pautado TIME,                    -- hora límite autorizada (CON_GPS)
    resultado       VARCHAR(20) DEFAULT 'PENDIENTE' CHECK (resultado IN ('PENDIENTE', 'REGRESÓ', 'NOVEDAD')),
    observaciones   TEXT,                    -- libro de guardia digital
    creado_en       TIMESTAMP DEFAULT NOW(),
    actualizado_en  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_traslados_fecha ON traslados(fecha);
CREATE INDEX idx_traslados_dni ON traslados(dni_interno);
CREATE INDEX idx_traslados_resultado ON traslados(resultado);

COMMENT ON TABLE traslados IS 'Registro de traslados a facultades para exámenes. Creados manualmente vía API; planilla FACULTADES es fuente histórica.';
COMMENT ON COLUMN traslados.modalidad IS 'CON_GPS: interno se desplaza solo. SIN_GPS: traslado a cargo de personal SPB.';
COMMENT ON COLUMN traslados.destino IS 'Texto libre. En Fase 1: Humanidades, Derecho, etc. Sin CHECK para admitir nuevas facultades.';
COMMENT ON COLUMN traslados.hora_regreso IS 'NULL mientras PENDIENTE. Se completa al registrar regreso.';
COMMENT ON COLUMN traslados.observaciones IS 'Libro de guardia digital. El oficial registra novedades, demoras o incidentes.';

-- ------------------------------------------------------------
-- 7. SYNC_LOG
-- Registro de cada ejecución del worker con Google Drive.
-- ------------------------------------------------------------
CREATE TABLE sync_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    planilla            VARCHAR(50) NOT NULL,
    drive_id            VARCHAR(100),
    hoja                VARCHAR(100),         -- nombre de la hoja (mes)
    filas_leidas        INTEGER DEFAULT 0,
    filas_insertadas    INTEGER DEFAULT 0,
    filas_actualizadas  INTEGER DEFAULT 0,
    errores             INTEGER DEFAULT 0,
    detalle_errores     TEXT,
    estado              VARCHAR(20) CHECK (estado IN ('OK', 'PARCIAL', 'ERROR')),
    iniciado_en         TIMESTAMP DEFAULT NOW(),
    finalizado_en       TIMESTAMP
);

COMMENT ON TABLE sync_log IS 'Log de sincronizaciones del worker con Google Drive. Para trazabilidad y diagnóstico.';

-- ------------------------------------------------------------
-- TRIGGER: actualizar campo actualizado_en automáticamente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_personas_ts
    BEFORE UPDATE ON personas
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_internos_ts
    BEFORE UPDATE ON internos_detalle
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_spb_ts
    BEFORE UPDATE ON personal_spb
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_civiles_ts
    BEFORE UPDATE ON civiles_ingreso
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_traslados_ts
    BEFORE UPDATE ON traslados
    FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- ============================================================
-- activity_log — auditoría de acciones de usuario
-- Agregado en migración add_activity_log (26/06/2026)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    email       VARCHAR(100),
    accion      VARCHAR(50) NOT NULL,
    detalle     TEXT,
    ip          VARCHAR(45),
    creado_en   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_creado   ON activity_log (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_usuario  ON activity_log (usuario_id);

-- ============================================================
-- FIN DEL SCHEMA — GAU-9 Fase 1
-- Tablas: personas, internos_detalle, personal_spb,
--         civiles_ingreso, presentismo, traslados, sync_log,
--         usuarios, activity_log
-- ============================================================
