'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');

// GET /api/actividad?limit=50
// ADMIN ve todo; JEFE ve solo su propia actividad
router.get('/', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const esAdmin = req.usuario?.rol === 'ADMIN';
  try {
    const result = esAdmin
      ? await db.query(
          `SELECT id, email, accion, detalle, ip, creado_en
           FROM activity_log ORDER BY creado_en DESC LIMIT $1`, [limit])
      : await db.query(
          `SELECT id, email, accion, detalle, ip, creado_en
           FROM activity_log WHERE usuario_id = $1
           ORDER BY creado_en DESC LIMIT $2`, [req.usuario.id, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('[actividad] GET:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
