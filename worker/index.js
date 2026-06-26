'use strict';

require('dotenv').config();
const cron = require('node-cron');
const db = require('../api/db');

const { syncCiviles }      = require('./sync_civiles');
const { syncPrimario }     = require('./sync_primario');
const { syncSecundario }   = require('./sync_secundario');
const { syncTrabajadores } = require('./sync_trabajadores');
const { syncFacultades }   = require('./sync_facultades');

const INTERVALO = parseInt(process.env.SYNC_INTERVALO_MINUTOS || '30');

async function registrarLog(stats, driveId, hoja) {
  try {
    const detalleStr = stats.detalle_errores && stats.detalle_errores.length
      ? stats.detalle_errores.slice(0, 20).join('\n')
      : null;

    const estado = stats.errores === 0
      ? 'OK'
      : stats.filas_insertadas + stats.filas_actualizadas > 0 ? 'PARCIAL' : 'ERROR';

    await db.query(`
      INSERT INTO sync_log
        (planilla, drive_id, hoja, filas_leidas, filas_insertadas, filas_actualizadas, errores, detalle_errores, estado, finalizado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    `, [
      stats.planilla,
      driveId || null,
      hoja || null,
      stats.filas_leidas,
      stats.filas_insertadas,
      stats.filas_actualizadas,
      stats.errores,
      detalleStr,
      estado,
    ]);
  } catch (err) {
    console.error('[sync_log] Error al registrar log:', err.message);
  }
}

async function keepalive() {
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error('[keepalive] Error de conexión:', err.message);
  }
}

async function ejecutarSync() {
  const inicio = Date.now();
  console.log(`[worker] Sincronización iniciada: ${new Date().toISOString()}`);

  // Orden obligatorio por dependencias FK:
  // 1. personas  ← base
  // 2. civiles   ← FK → personas
  // 3. primario  ← FK → personas → internos_detalle
  // 4. secundario← FK → personas → internos_detalle
  // 5. trabajadores ← sin FK obligatorio (dni nullable)
  // 6. facultades← FK → internos_detalle (por ficha_conducta → dni)

  const tareas = [
    { nombre: 'Civiles',      fn: syncCiviles      },
    { nombre: 'Primario',     fn: syncPrimario      },
    { nombre: 'Secundario',   fn: syncSecundario    },
    { nombre: 'Trabajadores', fn: syncTrabajadores  },
    { nombre: 'Facultades',   fn: syncFacultades    },
  ];

  for (const tarea of tareas) {
    try {
      console.log(`[worker] → Iniciando sync ${tarea.nombre}...`);
      const stats = await tarea.fn();
      await registrarLog(stats, null, null);
      console.log(
        `[worker] ✓ ${tarea.nombre}: ` +
        `leídas=${stats.filas_leidas} insertadas=${stats.filas_insertadas} ` +
        `actualizadas=${stats.filas_actualizadas} errores=${stats.errores}`
      );
    } catch (err) {
      console.error(`[worker] ✗ ${tarea.nombre} falló:`, err.message);
      await registrarLog(
        { planilla: tarea.nombre, filas_leidas: 0, filas_insertadas: 0, filas_actualizadas: 0, errores: 1, detalle_errores: [err.message] },
        null, null
      );
    }
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[worker] Sincronización completa en ${seg}s`);
}

// Keepalive diario a las 06:00 para evitar que Supabase pause la DB por inactividad
cron.schedule('0 6 * * *', keepalive, { timezone: 'America/Argentina/Buenos_Aires' });

// Sync periódico según SYNC_INTERVALO_MINUTOS (default: 30)
const expresionCron = `*/${INTERVALO} * * * *`;
console.log(`[worker] Cron de sync configurado: cada ${INTERVALO} minutos`);
cron.schedule(expresionCron, ejecutarSync, { timezone: 'America/Argentina/Buenos_Aires' });

// Ejecutar una vez al arrancar sin esperar el primer ciclo cron
ejecutarSync().catch(err => console.error('[worker] Error en sync inicial:', err.message));
