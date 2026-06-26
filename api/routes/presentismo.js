'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/presentismo/hoy
// Lista de asistencia del día actual
router.get('/hoy', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        p.id, p.dni, p.fecha, p.nivel, p.turno, p.division, p.curso, p.estado,
        pe.nombre, pe.apellido_1, pe.apellido_2,
        id.ficha_conducta, id.pabellon
      FROM presentismo p
      JOIN personas pe ON pe.dni = p.dni
      LEFT JOIN internos_detalle id ON id.dni = p.dni
      WHERE p.fecha = CURRENT_DATE
      ORDER BY p.nivel, p.turno, pe.apellido_1, pe.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[presentismo] /hoy:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/presentismo/nivel/:nivel?mes=YYYY-MM
// Listado completo de un nivel para un mes
router.get('/nivel/:nivel', auth, async (req, res) => {
  const nivel = req.params.nivel?.toUpperCase();
  if (!['PRIMARIO', 'SECUNDARIO'].includes(nivel)) {
    return res.status(400).json({ error: 'Nivel debe ser PRIMARIO o SECUNDARIO' });
  }

  let fechaInicio, fechaFin;
  if (req.query.mes) {
    if (!/^\d{4}-\d{2}$/.test(req.query.mes)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM' });
    }
    const [anio, mes] = req.query.mes.split('-').map(Number);
    fechaInicio = `${req.query.mes}-01`;
    fechaFin = new Date(anio, mes, 0).toISOString().slice(0, 10);
  } else {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    fechaInicio = `${now.getFullYear()}-${mm}-01`;
    fechaFin = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  try {
    const result = await db.query(`
      SELECT
        p.id, p.dni, p.fecha, p.nivel, p.turno, p.division, p.curso, p.estado,
        pe.nombre, pe.apellido_1,
        id.ficha_conducta, id.pabellon
      FROM presentismo p
      JOIN personas pe ON pe.dni = p.dni
      LEFT JOIN internos_detalle id ON id.dni = p.dni
      WHERE p.nivel = $1 AND p.fecha BETWEEN $2 AND $3
      ORDER BY p.fecha, pe.apellido_1, pe.nombre
    `, [nivel, fechaInicio, fechaFin]);
    res.json(result.rows);
  } catch (err) {
    console.error('[presentismo] /nivel:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/presentismo/metricas?nivel=PRIMARIO&mes=YYYY-MM
// Métricas agregadas por día para un nivel/mes
router.get('/metricas', auth, async (req, res) => {
  const nivel = (req.query.nivel || '').toUpperCase();
  if (!['PRIMARIO', 'SECUNDARIO'].includes(nivel)) {
    return res.status(400).json({ error: 'Parámetro nivel requerido (PRIMARIO o SECUNDARIO)' });
  }

  let fechaInicio, fechaFin;
  if (req.query.mes) {
    if (!/^\d{4}-\d{2}$/.test(req.query.mes)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM' });
    }
    const [anio, mes] = req.query.mes.split('-').map(Number);
    fechaInicio = `${req.query.mes}-01`;
    fechaFin = new Date(anio, mes, 0).toISOString().slice(0, 10);
  } else {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    fechaInicio = `${now.getFullYear()}-${mm}-01`;
    fechaFin = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  try {
    const result = await db.query(`
      SELECT
        fecha,
        COUNT(*) FILTER (WHERE estado = 'P') AS presentes,
        COUNT(*) FILTER (WHERE estado = 'A') AS ausentes,
        COUNT(DISTINCT dni) AS total_alumnos
      FROM presentismo
      WHERE nivel = $1 AND fecha BETWEEN $2 AND $3
      GROUP BY fecha
      ORDER BY fecha
    `, [nivel, fechaInicio, fechaFin]);
    res.json({ nivel, desde: fechaInicio, hasta: fechaFin, dias: result.rows });
  } catch (err) {
    console.error('[presentismo] /metricas:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/presentismo/:dni
// Historial de asistencia de un interno
router.get('/:dni', auth, async (req, res) => {
  const { dni } = req.params;

  try {
    const result = await db.query(`
      SELECT p.id, p.fecha, p.nivel, p.turno, p.division, p.curso, p.estado
      FROM presentismo p
      WHERE p.dni = $1
      ORDER BY p.fecha DESC, p.nivel
      LIMIT 200
    `, [dni]);
    res.json(result.rows);
  } catch (err) {
    console.error('[presentismo] /:dni:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
