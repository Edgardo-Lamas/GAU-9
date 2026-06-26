'use strict';

const db = require('./db');

async function log(req, accion, detalle) {
  try {
    const usuario_id = req.usuario?.id || null;
    const email      = req.usuario?.email || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress
             || null;
    await db.query(
      `INSERT INTO activity_log (usuario_id, email, accion, detalle, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [usuario_id, email, accion, detalle || null, ip]
    );
  } catch {
    // El log nunca debe interrumpir la operación principal
  }
}

module.exports = { log };
