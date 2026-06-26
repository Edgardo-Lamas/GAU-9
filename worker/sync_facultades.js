'use strict';

require('dotenv').config();
const db = require('../api/db');
const { leerSheetCompleto, listarHojasSheet, DRIVE_IDS } = require('./drive');
const {
  normalizarFC, parsearFecha, parsearHora,
  splitApellidoNombre, formatearFecha,
} = require('./normalizar');

// FACULTADES 2026 es el libro histórico de traslados.
// Primera columna: "Fecha 2" (nombre real de la columna, no "Fecha").
// F.C. N° viene con puntos → normalizar con normalizarFC().
// GPS/Rojo/Blanco → mapear a modalidad CON_GPS / SIN_GPS.
// El sheet puede tener múltiples hojas (una por mes o una sola continua).

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

function mapearModalidad(valor) {
  const v = String(valor || '').toUpperCase().trim();
  if (v.includes('GPS')) return 'CON_GPS';
  // Rojo y Blanco son tipos de móviles SPB → SIN_GPS
  if (v.includes('ROJO') || v.includes('BLANCO') || v.includes('MOVIL') || v.includes('MOOVIL')) return 'SIN_GPS';
  return 'SIN_GPS'; // default para traslados sin tobillera
}

async function procesarHoja(filas, stats) {
  if (filas.length < 2) return;

  // Encabezado: contiene "Fecha 2" (primera columna) o "F.C" o "Facultad"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const lower = filas[i].map(c => String(c || '').toLowerCase().replace(/[.\s]/g, ''));
    if (lower.some(c => c.includes('fecha') || c.includes('fc') || c.includes('facultad'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return;

  const headers = filas[headerIdx];

  const cols = {
    fecha:      colIdx(headers, ['fecha2', 'fecha']),
    fc:         colIdx(headers, ['fcn', 'fichaconducta', 'fc', 'nroficha']),
    nombre:     colIdx(headers, ['apellidonombre', 'apellidoynombre', 'nombreyapellido', 'apellido,nombre', 'nombre']),
    facultad:   colIdx(headers, ['facultad', 'universidad', 'institucion', 'establecimiento']),
    materia:    colIdx(headers, ['materia', 'asignatura', 'carrera', 'examen']),
    modalidad:  colIdx(headers, ['modalidad', 'tipo', 'gps', 'medio']),
    gdeba:      colIdx(headers, ['gdeba', 'autorizacion', 'nrogdeba', 'aval']),
    certificado: colIdx(headers, ['certificado', 'cert']),
    horaSalida: colIdx(headers, ['horasalida', 'salida', 'hora']),
    horaRegreso: colIdx(headers, ['horaregreso', 'regreso', 'retorno']),
    horaPautada: colIdx(headers, ['horapautada', 'pautada', 'limite']),
    observaciones: colIdx(headers, ['observaciones', 'obs', 'notas']),
  };

  for (let i = headerIdx + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    stats.filas_leidas++;

    const fcRaw = limpiar(fila, cols.fc);
    const fc = normalizarFC(fcRaw);
    if (!fc) continue;

    const fechaStr = formatearFecha(parsearFecha(limpiar(fila, cols.fecha)));
    if (!fechaStr) continue;

    try {
      // Buscar el interno por ficha_conducta → obtener DNI
      const interno = await db.query(
        'SELECT dni FROM internos_detalle WHERE ficha_conducta = $1 LIMIT 1',
        [fc]
      );

      if (interno.rows.length === 0) {
        // FC no encontrada: podría ser un interno aún no sincronizado — registrar y continuar
        stats.errores++;
        stats.detalle_errores.push(`Fila ${i + 1}: FC ${fc} no encontrada en internos_detalle`);
        continue;
      }

      const dniInterno = interno.rows[0].dni;
      const modalidad = mapearModalidad(limpiar(fila, cols.modalidad));
      const facultad = limpiar(fila, cols.facultad);

      // Evitar duplicados: (dni_interno, fecha, facultad)
      const existe = await db.query(
        'SELECT id FROM traslados WHERE dni_interno = $1 AND fecha = $2 AND COALESCE(facultad,\'\') = COALESCE($3,\'\') LIMIT 1',
        [dniInterno, fechaStr, facultad]
      );

      if (existe.rows.length === 0) {
        await db.query(`
          INSERT INTO traslados
            (dni_interno, fecha, hora_salida, hora_regreso, facultad, materia,
             modalidad, gdeba_nro, horario_pautado, observaciones, resultado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDIENTE')
        `, [
          dniInterno,
          fechaStr,
          parsearHora(limpiar(fila, cols.horaSalida)),
          parsearHora(limpiar(fila, cols.horaRegreso)),
          facultad,
          limpiar(fila, cols.materia),
          modalidad,
          limpiar(fila, cols.gdeba),
          parsearHora(limpiar(fila, cols.horaPautada)),
          limpiar(fila, cols.observaciones),
        ]);
        stats.filas_insertadas++;
      }
      // No actualizar traslados históricos — son inmutables una vez cargados
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Fila ${i + 1} (FC ${fc}): ${err.message}`);
    }
  }
}

async function syncFacultades() {
  const stats = {
    planilla: 'FACULTADES',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  const hojas = await listarHojasSheet(DRIVE_IDS.FACULTADES);

  for (const hoja of hojas) {
    const filas = await leerSheetCompleto(DRIVE_IDS.FACULTADES, hoja);
    await procesarHoja(filas, stats);
  }

  return stats;
}

module.exports = { syncFacultades };
