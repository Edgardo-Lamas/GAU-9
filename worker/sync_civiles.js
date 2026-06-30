'use strict';

require('dotenv').config();
const { leerSheetCompleto, DRIVE_IDS } = require('./drive');
const {
  normalizarDNI, mapearRol, parsearFecha,
  splitApellidoNombre, formatearFecha,
} = require('./normalizar');
const { batchUpsertPersonas, batchUpsertCiviles } = require('./db_batch');

// Busca el índice de columna comparando texto limpio (sin puntos/espacios)
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

async function syncCiviles() {
  const stats = {
    planilla: 'CIVILES',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  const filas = await leerSheetCompleto(DRIVE_IDS.CIVILES);
  if (filas.length < 2) return stats;

  // Detectar fila de encabezado: primera que tenga "dni" o "apellido"
  let headerIdx = 0;
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const lower = filas[i].map(c => String(c || '').toLowerCase());
    if (lower.some(c => c.includes('dni') || c.includes('apellido') || c.includes('nombre'))) {
      headerIdx = i;
      break;
    }
  }

  const headers = filas[headerIdx];

  const cols = {
    dni:          colIdx(headers, ['dni', 'nrodocumento', 'documento', 'nrodni']),
    nombre:       colIdx(headers, ['apellidonombre', 'apellidoynombre', 'nombreyapellido', 'apellido,nombre', 'nombre']),
    rol:          colIdx(headers, ['rol', 'tipo', 'cargo', 'funcion']),
    actividad:    colIdx(headers, ['actividad', 'materia', 'motivo', 'descripcion']),
    alta:         colIdx(headers, ['alta', 'fechaalta', 'fechadealta', 'fecha']),
    fin:          colIdx(headers, ['fin', 'fechafin', 'hasta', 'vencimiento', 'baja']),
    dias:         colIdx(headers, ['diashorarios', 'diasyhora', 'dias', 'horarios']),
    destino:      colIdx(headers, ['destino', 'establecimiento', 'lugar']),
    origen:       colIdx(headers, ['origen', 'institucion', 'escuela', 'universidad']),
    gdeba:        colIdx(headers, ['gdeba', 'autorizacion', 'nrodeautorizacion']),
    estado:       colIdx(headers, ['estado', 'situacion']),
    observaciones: colIdx(headers, ['observaciones', 'obs', 'notas', 'detalle']),
  };

  // Acumular en memoria — recién escribimos a la base al final, en lote
  const personas = [];
  const civiles = [];

  for (let i = headerIdx + 1; i < filas.length; i++) {
    const fila = filas[i];

    // Saltar filas completamente vacías
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    stats.filas_leidas++;

    const dniRaw = limpiar(fila, cols.dni);
    const dni = normalizarDNI(dniRaw);
    if (!dni) continue;

    const nombreCompleto = limpiar(fila, cols.nombre) || '';
    if (!nombreCompleto) continue;

    const altaStr = formatearFecha(parsearFecha(limpiar(fila, cols.alta)));
    if (!altaStr) continue;

    try {
      const { apellido_1, apellido_2, nombre } = splitApellidoNombre(nombreCompleto);
      const rol = mapearRol(limpiar(fila, cols.rol) || '');
      const finStr = formatearFecha(parsearFecha(limpiar(fila, cols.fin)));

      const estadoRaw = (limpiar(fila, cols.estado) || 'ACTIVO').toUpperCase();
      const estado = ['ACTIVO', 'CANCELADO', 'REEMPLAZADO'].includes(estadoRaw) ? estadoRaw : 'ACTIVO';

      const destinoRaw = (limpiar(fila, cols.destino) || '').toUpperCase();
      const destino = ['CEUSTA', 'COLEGIO', 'OTRO'].includes(destinoRaw)
        ? destinoRaw
        : (destinoRaw ? 'OTRO' : null);

      personas.push({ dni, nombre, apellido_1, apellido_2 });
      civiles.push({
        dni, rol, alta: altaStr, fin: finStr,
        actividad: limpiar(fila, cols.actividad),
        dias_horarios: limpiar(fila, cols.dias),
        destino,
        origen: limpiar(fila, cols.origen),
        gdeba_nro: limpiar(fila, cols.gdeba),
        estado,
        observaciones: limpiar(fila, cols.observaciones),
        fuente_fila: i + 1,
      });
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Fila ${i + 1}: ${err.message}`);
    }
  }

  try {
    await batchUpsertPersonas(personas, 'CIVIL');
    stats.filas_insertadas = await batchUpsertCiviles(civiles);
  } catch (err) {
    stats.errores++;
    stats.detalle_errores.push(`Batch insert: ${err.message}`);
  }

  return stats;
}

module.exports = { syncCiviles };
