'use strict';

require('dotenv').config();
const { leerXlsx, xlsxAFilas, DRIVE_IDS } = require('./drive');
const {
  normalizarDNI, normalizarFC, normalizarTurno,
  splitApellidoNombre, formatearFecha, mesDesdeNombreHoja, normalizarEstadoPresentismo,
} = require('./normalizar');
const { batchUpsertPersonas, batchUpsertInternosDetalle, batchInsertPresentismo } = require('./db_batch');

const ANIO_PLANILLA = parseInt(process.env.ANIO_PLANILLA || new Date().getFullYear());

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

function procesarHoja(filas, mes, stats, acc) {
  if (filas.length < 2) return;

  let headerIdx = -1;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const lower = filas[i].map(c => String(c || '').toLowerCase());
    if (lower.some(c => c.includes('ciclo') || c.includes('curso') || c.includes('dni') || c.includes('apellido'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return;

  const headers = filas[headerIdx];

  const cols = {
    dni:      colIdx(headers, ['dni', 'nrodocumento', 'documento']),
    fc:       colIdx(headers, ['fc', 'fichaconducta', 'ficha', 'nroficha']),
    nombre:   colIdx(headers, ['apellidonombre', 'apellidoynombre', 'nombreyapellido', 'apellido,nombre', 'nombre']),
    turno:    colIdx(headers, ['turno']),
    curso:    colIdx(headers, ['curso', 'año', 'anio']),
    division: colIdx(headers, ['division', 'div']),
    pabellon: colIdx(headers, ['pabellon', 'pab']),
  };

  const colsDias = [];
  headers.forEach((h, i) => {
    const n = parseInt(String(h || '').trim());
    if (!isNaN(n) && n >= 1 && n <= 31) {
      colsDias.push({ col: i, dia: n });
    }
  });

  for (let i = headerIdx + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    stats.filas_leidas++;

    const dniRaw = limpiar(fila, cols.dni);
    const dni = normalizarDNI(dniRaw);
    if (!dni) continue;

    const nombreCompleto = limpiar(fila, cols.nombre) || '';
    if (!nombreCompleto) continue;

    try {
      const { apellido_1, apellido_2, nombre } = splitApellidoNombre(nombreCompleto);
      const fc = normalizarFC(limpiar(fila, cols.fc));
      const turno = normalizarTurno(limpiar(fila, cols.turno));
      const curso = limpiar(fila, cols.curso);
      const division = limpiar(fila, cols.division);
      const pabellon = limpiar(fila, cols.pabellon);

      acc.personas.push({ dni, nombre, apellido_1, apellido_2 });
      acc.detalle.push({ dni, fc, pabellon });

      for (const { col, dia } of colsDias) {
        const valorCelda = String(fila[col] || '').trim();
        if (!valorCelda) continue;

        const estado = normalizarEstadoPresentismo(valorCelda);
        // En Secundario la columna de ausencias siempre es 0: solo se guardan presencias.
        if (estado !== 'P') continue;

        const fecha = formatearFecha(new Date(ANIO_PLANILLA, mes - 1, dia));
        if (!fecha) continue;

        acc.presentismo.push({
          dni, fecha, nivel: 'SECUNDARIO', turno, division, curso, estado: 'P',
          fuente_planilla: 'SECUNDARIO',
        });
      }
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Hoja mes=${mes} fila ${i + 1}: ${err.message}`);
    }
  }
}

async function syncSecundario() {
  const stats = {
    planilla: 'PRESENTISMO_SECUNDARIO',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  const acc = { personas: [], detalle: [], presentismo: [] };

  const workbook = await leerXlsx(DRIVE_IDS.PRESENTISMO_SECUNDARIO);

  for (const nombreHoja of workbook.SheetNames) {
    const mes = mesDesdeNombreHoja(nombreHoja);
    if (!mes) continue;

    const filas = xlsxAFilas(workbook, nombreHoja);
    procesarHoja(filas, mes, stats, acc);
  }

  try {
    await batchUpsertPersonas(acc.personas);
    await batchUpsertInternosDetalle(acc.detalle, 'SECUNDARIO');
    stats.filas_insertadas = await batchInsertPresentismo(acc.presentismo, { onConflictDoNothing: true });
  } catch (err) {
    stats.errores++;
    stats.detalle_errores.push(`Batch insert: ${err.message}`);
  }

  return stats;
}

module.exports = { syncSecundario };
