'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');
const { log }  = require('../logger');

const BASE_SELECT = `
  SELECT
    t.id, t.dni_interno, t.fecha, t.hora_salida, t.hora_regreso,
    t.destino, t.facultad, t.materia, t.modalidad, t.dni_oficial,
    t.gdeba_nro, t.horario_pautado, t.resultado, t.observaciones,
    pe.nombre, pe.apellido_1, pe.apellido_2,
    id.ficha_conducta, id.pabellon, id.tiene_gps
  FROM traslados t
  JOIN personas pe ON pe.dni = t.dni_interno
  LEFT JOIN internos_detalle id ON id.dni = t.dni_interno
`;

// GET /api/traslados/hoy
router.get('/hoy', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE t.fecha = CURRENT_DATE
      ORDER BY t.hora_salida NULLS LAST, pe.apellido_1
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[traslados] /hoy:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/traslados/:dni_interno
// Historial de traslados de un interno
router.get('/:dni_interno', auth, async (req, res) => {
  try {
    const result = await db.query(`
      ${BASE_SELECT}
      WHERE t.dni_interno = $1
      ORDER BY t.fecha DESC, t.hora_salida NULLS LAST
      LIMIT 100
    `, [req.params.dni_interno]);
    res.json(result.rows);
  } catch (err) {
    console.error('[traslados] /:dni:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/traslados
// Registrar salida de traslado
router.post('/', auth, async (req, res) => {
  const {
    dni_interno, fecha, hora_salida, destino, facultad,
    materia, modalidad, dni_oficial, gdeba_nro,
    horario_pautado, observaciones,
  } = req.body || {};

  if (!dni_interno)  return res.status(400).json({ error: 'dni_interno requerido' });
  if (!modalidad || !['CON_GPS', 'SIN_GPS'].includes(modalidad)) {
    return res.status(400).json({ error: 'modalidad debe ser CON_GPS o SIN_GPS' });
  }
  if (modalidad === 'SIN_GPS' && !dni_oficial) {
    return res.status(400).json({ error: 'dni_oficial requerido para traslados SIN_GPS' });
  }
  if (!destino && !facultad) {
    return res.status(400).json({ error: 'Se requiere destino o facultad' });
  }

  const fechaTraslado = fecha || new Date().toISOString().slice(0, 10);

  try {
    // Verificar que el interno existe
    const interno = await db.query(
      'SELECT dni FROM personas WHERE dni = $1 AND tipo = \'INTERNO\'',
      [dni_interno]
    );
    if (interno.rows.length === 0) {
      return res.status(404).json({ error: 'Interno no encontrado' });
    }

    const result = await db.query(`
      INSERT INTO traslados
        (dni_interno, fecha, hora_salida, destino, facultad, materia,
         modalidad, dni_oficial, gdeba_nro, horario_pautado, observaciones, resultado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDIENTE')
      RETURNING *
    `, [
      dni_interno, fechaTraslado, hora_salida || null,
      destino || null, facultad || null, materia || null,
      modalidad, dni_oficial || null, gdeba_nro || null,
      horario_pautado || null, observaciones || null,
    ]);

    await log(req, 'TRASLADO_NUEVO',
      `DNI ${dni_interno} → ${facultad || destino} (${modalidad})`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[traslados] POST:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/traslados/:id/regreso
// Registrar regreso y resultado
router.patch('/:id/regreso', auth, async (req, res) => {
  const { hora_regreso, resultado, observaciones } = req.body || {};

  if (!resultado || !['REGRESÓ', 'NOVEDAD'].includes(resultado)) {
    return res.status(400).json({ error: 'resultado debe ser REGRESÓ o NOVEDAD' });
  }
  if (resultado === 'NOVEDAD' && !observaciones) {
    return res.status(400).json({ error: 'observaciones requeridas cuando resultado es NOVEDAD' });
  }

  try {
    const result = await db.query(`
      UPDATE traslados SET
        hora_regreso   = $1,
        resultado      = $2,
        observaciones  = COALESCE($3, observaciones),
        actualizado_en = NOW()
      WHERE id = $4 AND resultado = 'PENDIENTE'
      RETURNING id, hora_regreso, resultado, observaciones
    `, [hora_regreso || null, resultado, observaciones || null, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Traslado no encontrado o ya tiene resultado registrado' });
    }
    await log(req, 'TRASLADO_REGRESO',
      `ID ${req.params.id} → ${resultado}${observaciones ? ': ' + observaciones : ''}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[traslados] PATCH regreso:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
