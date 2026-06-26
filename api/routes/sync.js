'use strict';

const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');

const { syncCiviles }      = require('../../worker/sync_civiles');
const { syncPrimario }     = require('../../worker/sync_primario');
const { syncSecundario }   = require('../../worker/sync_secundario');
const { syncTrabajadores } = require('../../worker/sync_trabajadores');
const { syncFacultades }   = require('../../worker/sync_facultades');

let syncEnCurso = false;

async function registrarLog(stats) {
  const detalleStr = stats.detalle_errores?.length
    ? stats.detalle_errores.slice(0, 20).join('\n')
    : null;
  const estado = stats.errores === 0 ? 'OK'
    : stats.filas_insertadas + stats.filas_actualizadas > 0 ? 'PARCIAL' : 'ERROR';

  await db.query(`
    INSERT INTO sync_log
      (planilla, filas_leidas, filas_insertadas, filas_actualizadas, errores, detalle_errores, estado, finalizado_en)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
  `, [stats.planilla, stats.filas_leidas, stats.filas_insertadas, stats.filas_actualizadas, stats.errores, detalleStr, estado]);
}

// POST /api/sync/ejecutar  — solo ADMIN
// Dispara sync en segundo plano y responde 202 de inmediato
router.post('/ejecutar', auth, requireAdmin, (req, res) => {
  if (syncEnCurso) {
    return res.status(409).json({ error: 'Sincronización ya en curso' });
  }

  res.status(202).json({ mensaje: 'Sincronización iniciada en segundo plano' });

  const tareas = [
    { fn: syncCiviles,      nombre: 'CIVILES' },
    { fn: syncPrimario,     nombre: 'PRESENTISMO_PRIMARIO' },
    { fn: syncSecundario,   nombre: 'PRESENTISMO_SECUNDARIO' },
    { fn: syncTrabajadores, nombre: 'TRABAJADORES' },
    { fn: syncFacultades,   nombre: 'FACULTADES' },
  ];

  syncEnCurso = true;
  (async () => {
    for (const t of tareas) {
      try {
        const stats = await t.fn();
        await registrarLog(stats);
      } catch (err) {
        await registrarLog({
          planilla: t.nombre,
          filas_leidas: 0, filas_insertadas: 0, filas_actualizadas: 0,
          errores: 1, detalle_errores: [err.message],
        }).catch(() => {});
      }
    }
    syncEnCurso = false;
  })();
});

// GET /api/sync/log
// Últimas 50 entradas del log de sincronización
router.get('/log', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id, planilla, filas_leidas, filas_insertadas, filas_actualizadas,
        errores, estado, iniciado_en, finalizado_en
      FROM sync_log
      ORDER BY iniciado_en DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[sync] /log:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
