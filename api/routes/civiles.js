'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');
const { log }  = require('../logger');

const BASE_SELECT = `
  SELECT
    ci.id, ci.dni, ci.rol, ci.actividad, ci.alta, ci.fin,
    ci.dias_horarios, ci.destino, ci.origen, ci.gdeba_nro,
    ci.estado, ci.observaciones, ci.reemplazado_por_dni,
    pe.nombre, pe.apellido_1, pe.apellido_2
  FROM civiles_ingreso ci
  JOIN personas pe ON pe.dni = ci.dni
`;

// GET /api/civiles/hoy
// Civiles cuyo días_horarios incluye el día de la semana de hoy
router.get('/hoy', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE ci.estado = 'ACTIVO'
        AND ci.alta <= CURRENT_DATE
        AND (ci.fin IS NULL OR ci.fin >= CURRENT_DATE)
        AND LOWER(unaccent(ci.dias_horarios)) ILIKE '%' || (
          CASE EXTRACT(DOW FROM CURRENT_DATE)
            WHEN 0 THEN 'domingo'
            WHEN 1 THEN 'lunes'
            WHEN 2 THEN 'martes'
            WHEN 3 THEN 'miercoles'
            WHEN 4 THEN 'jueves'
            WHEN 5 THEN 'viernes'
            WHEN 6 THEN 'sabado'
          END
        ) || '%'
      ORDER BY pe.apellido_1, pe.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    // Si unaccent no está disponible, fallback sin normalizar acentos
    try {
      const result = await db.query(`
        ${BASE_SELECT}
        WHERE ci.estado = 'ACTIVO'
          AND ci.alta <= CURRENT_DATE
          AND (ci.fin IS NULL OR ci.fin >= CURRENT_DATE)
          AND LOWER(ci.dias_horarios) ILIKE '%' || (
            CASE EXTRACT(DOW FROM CURRENT_DATE)
              WHEN 0 THEN 'domingo'
              WHEN 1 THEN 'lunes'
              WHEN 2 THEN 'martes'
              WHEN 3 THEN 'mi_rcoles'
              WHEN 4 THEN 'jueves'
              WHEN 5 THEN 'viernes'
              WHEN 6 THEN 's_bado'
            END
          ) || '%'
        ORDER BY pe.apellido_1, pe.nombre
      `);
      res.json(result.rows);
    } catch (err2) {
      console.error('[civiles] /hoy:', err2.message);
      res.status(500).json({ error: 'Error interno' });
    }
  }
});

// GET /api/civiles/vigentes — todos los civiles con autorización activa en el período
router.get('/vigentes', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE ci.estado = 'ACTIVO'
        AND ci.alta <= CURRENT_DATE
        AND (ci.fin IS NULL OR ci.fin >= CURRENT_DATE)
      ORDER BY pe.apellido_1, pe.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[civiles] /vigentes:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/civiles/activos
// Todos los civiles con estado ACTIVO (pueden no tener fecha válida hoy)
router.get('/activos', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE ci.estado = 'ACTIVO'
      ORDER BY pe.apellido_1, pe.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[civiles] /activos:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/civiles/:dni
// Todos los registros de ingreso de un civil por DNI
router.get('/:dni', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE ci.dni = $1
      ORDER BY ci.alta DESC
    `, [req.params.dni]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Civil no encontrado' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error('[civiles] /:dni:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/civiles/:id/estado
// Cancelar o reemplazar un ingreso civil
router.patch('/:id/estado', auth, async (req, res) => {
  const { estado, observaciones, reemplazado_por_dni } = req.body || {};

  if (!estado || !['CANCELADO', 'REEMPLAZADO'].includes(estado)) {
    return res.status(400).json({ error: 'Estado debe ser CANCELADO o REEMPLAZADO' });
  }
  if (estado === 'REEMPLAZADO' && !reemplazado_por_dni) {
    return res.status(400).json({ error: 'reemplazado_por_dni requerido cuando estado es REEMPLAZADO' });
  }

  try {
    const result = await db.query(`
      UPDATE civiles_ingreso SET
        estado              = $1,
        observaciones       = COALESCE($2, observaciones),
        reemplazado_por_dni = COALESCE($3, reemplazado_por_dni),
        actualizado_en      = NOW()
      WHERE id = $4
      RETURNING id, estado, observaciones
    `, [estado, observaciones || null, reemplazado_por_dni || null, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    await log(req, 'CIVIL_CANCELADO',
      `ID ${req.params.id} → ${estado}${observaciones ? ': ' + observaciones : ''}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[civiles] PATCH estado:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
