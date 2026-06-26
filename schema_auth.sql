-- ============================================================
-- GAU-9 — Schema de Autenticación
-- Ejecutar DESPUÉS de schema_gau9.sql
-- ============================================================

CREATE TABLE usuarios (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    rol           VARCHAR(20) DEFAULT 'JEFE' CHECK (rol IN ('JEFE', 'ADMIN')),
    activo        BOOLEAN DEFAULT TRUE,
    creado_en     TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE usuarios IS 'Usuarios del sistema GAU-9. Tres jefes del área académica + administrador.';
COMMENT ON COLUMN usuarios.rol IS 'JEFE: acceso de solo lectura + registro de traslados. ADMIN: acceso total + gestión de usuarios.';

-- ============================================================
-- FIN DEL SCHEMA DE AUTH
-- ============================================================
