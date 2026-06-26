'use strict';

require('dotenv').config();
const db = require('../api/db');
const { leerSheetCompleto, DRIVE_IDS } = require('./drive');
const {
  normalizarDNI, mapearRol, parsearFecha,
  splitApellidoNombre, formatearFecha,
} = require('./normalizar');

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
    gdeba:        colIdx(headers, ['gdeba', 'autorizacion', 'nrogdeba', 'nrodeautorizacion']),
    estado:       colIdx(headers, ['estado', 'situacion']),
    observaciones: colIdx(headers, ['observaciones', 'obs', 'notas', 'detalle']),
  };

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

      // Upsert personas
      await db.query(`
        INSERT INTO personas (dni, tipo, nombre, apellido_1, apellido_2)
        VALUES ($1, 'CIVIL', $2, $3, $4)
        ON CONFLICT (dni) DO UPDATE SET
          nombre        = EXCLUDED.nombre,
          apellido_1    = EXCLUDED.apellido_1,
          apellido_2    = EXCLUDED.apellido_2,
          actualizado_en = NOW()
      `, [dni, nombre, apellido_1, apellido_2]);

      // Chequear si ya existe por (dni, alta)
      const existe = await db.query(
        'SELECT id FROM civiles_ingreso WHERE dni = $1 AND alta = $2 LIMIT 1',
        [dni, altaStr]
      );

      if (existe.rows.length === 0) {
        await db.query(`
          INSERT INTO civiles_ingreso
            (dni, rol, alta, fin, actividad, dias_horarios, destino, origen, gdeba_nro, estado, observaciones, fuente_fila)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [
          dni, rol, altaStr, finStr,
          limpiar(fila, cols.actividad),
          limpiar(fila, cols.dias),
          destino,
          limpiar(fila, cols.origen),
          limpiar(fila, cols.gdeba),
          estado,
          limpiar(fila, cols.observaciones),
          i + 1,
        ]);
        stats.filas_insertadas++;
      } else {
        await db.query(`
          UPDATE civiles_ingreso SET
            rol           = $1,
            fin           = $2,
            actividad     = $3,
            dias_horarios = $4,
            destino       = $5,
            origen        = $6,
            gdeba_nro     = $7,
            estado        = $8,
            observaciones = $9,
            fuente_fila   = $10,
            actualizado_en = NOW()
          WHERE dni = $11 AND alta = $12
        `, [
          rol, finStr,
          limpiar(fila, cols.actividad),
          limpiar(fila, cols.dias),
          destino,
          limpiar(fila, cols.origen),
          limpiar(fila, cols.gdeba),
          estado,
          limpiar(fila, cols.observaciones),
          i + 1,
          dni, altaStr,
        ]);
        stats.filas_actualizadas++;
      }
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Fila ${i + 1}: ${err.message}`);
    }
  }

  return stats;
}

module.exports = { syncCiviles };
