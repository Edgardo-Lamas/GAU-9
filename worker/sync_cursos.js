'use strict';

require('dotenv').config();
const db = require('../api/db');
const { leerSheetCompleto, DRIVE_IDS } = require('./drive');
const { normalizarDNI, parsearFecha, formatearFecha } = require('./normalizar');

function colIdx(headers, variantes) {
  for (const v of variantes) {
    const vl = v.toLowerCase().replace(/[.\s]/g, '');
    const idx = headers.findIndex(h =>
      String(h || '').toLowerCase().replace(/[.\s]/g, '').includes(vl)
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function limpiar(fila, idx) {
  return idx >= 0 ? String(fila[idx] || '').trim() || null : null;
}

async function syncCursos() {
  const stats = {
    planilla: 'CURSOS',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  if (!DRIVE_IDS.CURSOS) {
    console.log('[sync_cursos] DRIVE_IDS.CURSOS no configurado — saltando');
    return stats;
  }

  // ── Hoja 1: Cursos ────────────────────────────────────────────
  let filasCursos;
  try {
    filasCursos = await leerSheetCompleto(DRIVE_IDS.CURSOS, 'Cursos');
  } catch (err) {
    stats.errores++;
    stats.detalle_errores.push(`Hoja Cursos: ${err.message}`);
    return stats;
  }

  if (filasCursos.length < 2) return stats;

  // Detectar fila de encabezado
  let headerIdx = 0;
  for (let i = 0; i < Math.min(filasCursos.length, 5); i++) {
    const lower = filasCursos[i].map(c => String(c || '').toLowerCase());
    if (lower.some(c => c.includes('nombre') || c.includes('curso') || c.includes('docente'))) {
      headerIdx = i;
      break;
    }
  }

  const headers = filasCursos[headerIdx];
  const cols = {
    nombre:       colIdx(headers, ['nombre', 'curso', 'taller', 'materia']),
    docenteDni:   colIdx(headers, ['docentedni', 'dniDocente', 'dni', 'docentedni']),
    destino:      colIdx(headers, ['destino', 'establecimiento', 'lugar']),
    fechaInicio:  colIdx(headers, ['fechainicio', 'inicio', 'fechadeInicio']),
    fechaFin:     colIdx(headers, ['fechafin', 'fin', 'hasta', 'fechadefin']),
    estado:       colIdx(headers, ['estado', 'situacion']),
    observaciones: colIdx(headers, ['observaciones', 'obs', 'notas']),
  };

  // Map nombre → id para usarlo en inscripciones
  const cursoIdPorNombre = {};

  for (let i = headerIdx + 1; i < filasCursos.length; i++) {
    const fila = filasCursos[i];
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    stats.filas_leidas++;
    const nombre = limpiar(fila, cols.nombre);
    if (!nombre) continue;

    try {
      const docenteDni = normalizarDNI(limpiar(fila, cols.docenteDni));
      const fechaInicio = formatearFecha(parsearFecha(limpiar(fila, cols.fechaInicio)));
      const fechaFin    = formatearFecha(parsearFecha(limpiar(fila, cols.fechaFin)));
      const destinoRaw  = (limpiar(fila, cols.destino) || '').toUpperCase();
      const destino     = destinoRaw || null;
      const estadoRaw   = (limpiar(fila, cols.estado) || 'ACTIVO').trim();
      const estado      = ['ACTIVO', 'FINALIZADO', 'SUSPENDIDO'].includes(estadoRaw.toUpperCase())
        ? estadoRaw.toUpperCase() : 'ACTIVO';

      const result = await db.query(`
        INSERT INTO cursos (nombre, docente_dni, destino, fecha_inicio, fecha_fin, estado, observaciones, fuente_fila)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (nombre) DO UPDATE SET
          docente_dni    = EXCLUDED.docente_dni,
          destino        = EXCLUDED.destino,
          fecha_inicio   = EXCLUDED.fecha_inicio,
          fecha_fin      = EXCLUDED.fecha_fin,
          estado         = EXCLUDED.estado,
          observaciones  = EXCLUDED.observaciones,
          fuente_fila    = EXCLUDED.fuente_fila,
          actualizado_en = NOW()
        RETURNING id, (xmax = 0) AS es_nuevo
      `, [nombre, docenteDni, destino, fechaInicio, fechaFin, estado,
          limpiar(fila, cols.observaciones), i + 1]);

      const { id, es_nuevo } = result.rows[0];
      cursoIdPorNombre[nombre.toLowerCase()] = id;
      if (es_nuevo) stats.filas_insertadas++;
      else stats.filas_actualizadas++;
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Cursos fila ${i + 1}: ${err.message}`);
    }
  }

  // Si no cargó ningún curso del sheet, leer los existentes en DB para las inscripciones
  if (Object.keys(cursoIdPorNombre).length === 0) {
    const existentes = await db.query('SELECT id, nombre FROM cursos');
    for (const r of existentes.rows) {
      cursoIdPorNombre[r.nombre.toLowerCase()] = r.id;
    }
  }

  // ── Hoja 2: Inscripciones ─────────────────────────────────────
  let filasInsc;
  try {
    filasInsc = await leerSheetCompleto(DRIVE_IDS.CURSOS, 'Inscripciones');
  } catch (err) {
    stats.errores++;
    stats.detalle_errores.push(`Hoja Inscripciones: ${err.message}`);
    return stats;
  }

  if (filasInsc.length < 2) return stats;

  let hdrInsc = 0;
  for (let i = 0; i < Math.min(filasInsc.length, 5); i++) {
    const lower = filasInsc[i].map(c => String(c || '').toLowerCase());
    if (lower.some(c => c.includes('ficha') || c.includes('fc') || c.includes('interno'))) {
      hdrInsc = i;
      break;
    }
  }

  const hInsc = filasInsc[hdrInsc];
  const ci = {
    fc:           colIdx(hInsc, ['fichaconducta', 'fc', 'fcnro', 'ficha', 'interno']),
    curso:        colIdx(hInsc, ['curso', 'nombre', 'materia', 'taller']),
    estado:       colIdx(hInsc, ['estado', 'situacion', 'condicion']),
    observaciones: colIdx(hInsc, ['observaciones', 'obs', 'notas']),
  };

  for (let i = hdrInsc + 1; i < filasInsc.length; i++) {
    const fila = filasInsc[i];
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    const fc = String(fila[ci.fc] || '').replace(/\./g, '').trim();
    const cursoNombre = limpiar(fila, ci.curso);
    if (!fc || !cursoNombre) continue;

    const cursoId = cursoIdPorNombre[cursoNombre.toLowerCase()];
    if (!cursoId) {
      stats.errores++;
      stats.detalle_errores.push(`Inscripciones fila ${i + 1}: curso "${cursoNombre}" no encontrado`);
      continue;
    }

    try {
      const estadoRaw = (limpiar(fila, ci.estado) || 'Cursando').trim();
      const estado = ['Cursando', 'Aprobado', 'Desaprobado']
        .find(e => e.toLowerCase() === estadoRaw.toLowerCase()) || 'Cursando';

      await db.query(`
        INSERT INTO inscripciones (curso_id, ficha_conducta, estado, observaciones, fuente_fila)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (curso_id, ficha_conducta) DO UPDATE SET
          estado         = EXCLUDED.estado,
          observaciones  = EXCLUDED.observaciones,
          fuente_fila    = EXCLUDED.fuente_fila,
          actualizado_en = NOW()
      `, [cursoId, fc, estado, limpiar(fila, ci.observaciones), i + 1]);

      stats.filas_insertadas++;
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Inscripciones fila ${i + 1}: ${err.message}`);
    }
  }

  return stats;
}

module.exports = { syncCursos };
