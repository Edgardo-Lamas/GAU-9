'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/dashboard/resumen
router.get('/resumen', auth, async (req, res) => {
  try {
    const [presentismo, civiles, traslados] = await Promise.all([
      db.query(`
        SELECT
          nivel,
          COUNT(*) FILTER (WHERE estado = 'P')::int AS presentes,
          COUNT(*) FILTER (WHERE estado = 'A')::int AS ausentes,
          COUNT(*)::int AS total
        FROM presentismo
        WHERE fecha = CURRENT_DATE
        GROUP BY nivel
      `),
      db.query(`
        SELECT COUNT(*)::int AS total
        FROM civiles_ingreso
        WHERE estado = 'ACTIVO'
          AND alta <= CURRENT_DATE
          AND (fin IS NULL OR fin >= CURRENT_DATE)
      `),
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE resultado = 'PENDIENTE')::int AS pendientes
        FROM traslados
        WHERE fecha = CURRENT_DATE
      `),
    ]);

    const prim = presentismo.rows.find(r => r.nivel === 'PRIMARIO')  || { presentes: 0, ausentes: 0, total: 0 };
    const secu = presentismo.rows.find(r => r.nivel === 'SECUNDARIO') || { presentes: 0, ausentes: 0, total: 0 };

    res.json({
      presentismo: { primario: prim, secundario: secu },
      civiles:     civiles.rows[0],
      traslados:   traslados.rows[0],
      generado_en: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[dashboard] /resumen:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
