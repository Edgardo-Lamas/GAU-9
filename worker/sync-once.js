'use strict';

// Ejecuta todas las sincronizaciones una vez y sale.
// Usado por GitHub Actions — no usa node-cron.

require('dotenv').config();
const db = require('../api/db');

const { syncCiviles }      = require('./sync_civiles');
const { syncPrimario }     = require('./sync_primario');
const { syncSecundario }   = require('./sync_secundario');
const { syncTrabajadores } = require('./sync_trabajadores');
const { syncFacultades }   = require('./sync_facultades');

async function registrarLog(stats) {
  try {
    const detalle = stats.detalle_errores?.length
      ? stats.detalle_errores.slice(0, 20).join('\n') : null;
    const estado = stats.errores === 0 ? 'OK'
      : stats.filas_insertadas + stats.filas_actualizadas > 0 ? 'PARCIAL' : 'ERROR';

    await db.query(`
      INSERT INTO sync_log
        (planilla, filas_leidas, filas_insertadas, filas_actualizadas, errores, detalle_errores, estado, finalizado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [stats.planilla, stats.filas_leidas, stats.filas_insertadas,
        stats.filas_actualizadas, stats.errores, detalle, estado]);
  } catch (e) {
    console.error('[sync_log] Error al registrar:', e.message);
  }
}

async function main() {
  const inicio = Date.now();
  console.log(`[sync-once] Iniciando: ${new Date().toISOString()}`);

  const tareas = [
    { nombre: 'Civiles',      fn: syncCiviles },
    { nombre: 'Primario',     fn: syncPrimario },
    { nombre: 'Secundario',   fn: syncSecundario },
    { nombre: 'Trabajadores', fn: syncTrabajadores },
    { nombre: 'Facultades',   fn: syncFacultades },
  ];

  let exitCode = 0;

  for (const t of tareas) {
    try {
      console.log(`[sync-once] → ${t.nombre}...`);
      const stats = await t.fn();
      await registrarLog(stats);
      console.log(`[sync-once] ✓ ${t.nombre}: leídas=${stats.filas_leidas} insertadas=${stats.filas_insertadas} errores=${stats.errores}`);
      if (stats.errores > 0) exitCode = 1;
    } catch (err) {
      console.error(`[sync-once] ✗ ${t.nombre}:`, err.message);
      await registrarLog({
        planilla: t.nombre, filas_leidas: 0, filas_insertadas: 0,
        filas_actualizadas: 0, errores: 1, detalle_errores: [err.message],
      }).catch(() => {});
      exitCode = 1;
    }
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[sync-once] Completado en ${seg}s`);
  await db.end();
  process.exit(exitCode);
}

main().catch(err => {
  console.error('[sync-once] Error fatal:', err.message);
  process.exit(1);
});
