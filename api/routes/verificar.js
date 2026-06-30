'use strict';

const router = require('express').Router();
const db     = require('../db');

// GET /api/verificar/:codigo — PÚBLICA, sin auth. Validación de certificados.
router.get('/:codigo', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        codigo, nombre_completo, curso_nombre, docente_nombre, destino,
        fecha_inicio, fecha_fin, estado, emitido_en, revocado
      FROM certificados
      WHERE codigo = $1
    `, [req.params.codigo.trim().toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ valido: false, error: 'Código no encontrado' });
    }

    const cert = result.rows[0];
    if (cert.revocado) {
      return res.json({ valido: false, error: 'Certificado revocado', ...cert });
    }

    res.json({ valido: true, ...cert });
  } catch (err) {
    console.error('[verificar] GET /:codigo:', err.message);
    res.status(500).json({ valido: false, error: 'Error interno' });
  }
});

module.exports = router;
