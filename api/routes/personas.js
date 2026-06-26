'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/personas/:dni
// Datos completos de una persona (cualquier tipo)
router.get('/:dni', auth, async (req, res) => {
  const { dni } = req.params;

  try {
    const persona = await db.query(
      'SELECT * FROM personas WHERE dni = $1',
      [dni]
    );
    if (persona.rows.length === 0) {
      return res.status(404).json({ error: 'Persona no encontrada' });
    }

    const tipo = persona.rows[0].tipo;
    let detalle = null;

    if (tipo === 'INTERNO') {
      const r = await db.query('SELECT * FROM internos_detalle WHERE dni = $1', [dni]);
      detalle = r.rows[0] || null;
    } else if (tipo === 'SPB') {
      const r = await db.query('SELECT * FROM personal_spb WHERE dni = $1 ORDER BY creado_en DESC LIMIT 1', [dni]);
      detalle = r.rows[0] || null;
    } else if (tipo === 'CIVIL') {
      const r = await db.query(
        'SELECT * FROM civiles_ingreso WHERE dni = $1 ORDER BY alta DESC LIMIT 1',
        [dni]
      );
      detalle = r.rows[0] || null;
    }

    res.json({ ...persona.rows[0], detalle });
  } catch (err) {
    console.error('[personas] /:dni:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/buscar?q=texto
// Búsqueda por apellido o nombre (mínimo 2 caracteres)
router.get('/', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Búsqueda mínima: 2 caracteres' });
  }

  try {
    const result = await db.query(`
      SELECT
        p.dni, p.tipo, p.nombre, p.apellido_1, p.apellido_2,
        id.ficha_conducta, id.pabellon, id.nivel_educativo
      FROM personas p
      LEFT JOIN internos_detalle id ON id.dni = p.dni
      WHERE
        p.apellido_1 ILIKE $1 OR
        p.apellido_2 ILIKE $1 OR
        p.nombre ILIKE $1 OR
        p.dni = $2
      ORDER BY p.apellido_1, p.nombre
      LIMIT 30
    `, [`%${q}%`, q]);

    res.json(result.rows);
  } catch (err) {
    console.error('[personas] buscar:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
