'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/cursos — lista de cursos con cantidad de alumnos
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        c.id, c.nombre, c.destino, c.fecha_inicio, c.fecha_fin, c.estado, c.observaciones,
        c.docente_dni,
        pe.nombre       AS docente_nombre,
        pe.apellido_1   AS docente_apellido,
        COUNT(i.id)::int               AS total_alumnos,
        COUNT(i.id) FILTER (WHERE i.estado = 'Cursando')::int    AS cursando,
        COUNT(i.id) FILTER (WHERE i.estado = 'Aprobado')::int    AS aprobados,
        COUNT(i.id) FILTER (WHERE i.estado = 'Desaprobado')::int AS desaprobados
      FROM cursos c
      LEFT JOIN civiles_ingreso ci ON ci.dni = c.docente_dni AND ci.estado = 'ACTIVO'
      LEFT JOIN personas pe        ON pe.dni = c.docente_dni
      LEFT JOIN inscripciones i    ON i.curso_id = c.id
      WHERE c.estado = $1
      GROUP BY c.id, pe.nombre, pe.apellido_1
      ORDER BY c.nombre
    `, [req.query.estado || 'ACTIVO']);

    res.json(result.rows);
  } catch (err) {
    console.error('[cursos] GET /:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/cursos/:id/alumnos — alumnos de un curso con datos de la persona
router.get('/:id/alumnos', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        i.id, i.ficha_conducta, i.estado, i.observaciones, i.actualizado_en,
        pe.nombre, pe.apellido_1, pe.apellido_2,
        id2.nivel_educativo, id2.anio_cursada
      FROM inscripciones i
      LEFT JOIN internos_detalle id2 ON id2.ficha_conducta = i.ficha_conducta
      LEFT JOIN personas pe          ON pe.dni = id2.dni
      WHERE i.curso_id = $1
      ORDER BY pe.apellido_1 NULLS LAST, pe.nombre NULLS LAST, i.ficha_conducta
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    console.error('[cursos] GET /:id/alumnos:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/inscripciones/:id/estado — cambiar estado de un alumno
router.patch('/inscripciones/:id/estado', auth, async (req, res) => {
  const { estado, observaciones } = req.body || {};
  const estados = ['Cursando', 'Aprobado', 'Desaprobado'];

  if (!estado || !estados.includes(estado)) {
    return res.status(400).json({ error: `Estado debe ser: ${estados.join(', ')}` });
  }

  try {
    const result = await db.query(`
      UPDATE inscripciones SET
        estado         = $1,
        observaciones  = COALESCE($2, observaciones),
        actualizado_en = NOW()
      WHERE id = $3
      RETURNING id, ficha_conducta, estado
    `, [estado, observaciones || null, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[cursos] PATCH inscripciones/:id/estado:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/cursos/:id — cambiar estado del curso (Aprobados/Desaprobados masivo)
router.patch('/:id/cerrar', auth, async (req, res) => {
  const { aprobados = [], desaprobados = [] } = req.body || {};

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      if (aprobados.length > 0) {
        await client.query(`
          UPDATE inscripciones SET estado = 'Aprobado', actualizado_en = NOW()
          WHERE curso_id = $1 AND ficha_conducta = ANY($2)
        `, [req.params.id, aprobados]);
      }

      if (desaprobados.length > 0) {
        await client.query(`
          UPDATE inscripciones SET estado = 'Desaprobado', actualizado_en = NOW()
          WHERE curso_id = $1 AND ficha_conducta = ANY($2)
        `, [req.params.id, desaprobados]);
      }

      await client.query(`
        UPDATE cursos SET estado = 'FINALIZADO', actualizado_en = NOW()
        WHERE id = $1
      `, [req.params.id]);

      await client.query('COMMIT');
      res.json({ ok: true, aprobados: aprobados.length, desaprobados: desaprobados.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[cursos] PATCH /:id/cerrar:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
