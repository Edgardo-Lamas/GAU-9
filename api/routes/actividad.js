'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/actividad?limit=50
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const result = await db.query(`
      SELECT id, email, accion, detalle, ip, creado_en
      FROM activity_log
      ORDER BY creado_en DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('[actividad] GET:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
