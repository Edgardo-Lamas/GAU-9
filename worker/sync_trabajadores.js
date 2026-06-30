'use strict';

require('dotenv').config();
const { leerXlsx, xlsxAFilas, DRIVE_IDS } = require('./drive');
const { normalizarFC, formatearFecha } = require('./normalizar');
const { batchUpsertPersonalSpb } = require('./db_batch');

// La planilla TRABAJADORES COLEGIO no tiene DNI — F.C Nº es la clave operativa.
// Secciones: COLEGIO / CEUSTA detectadas por texto en la fila.
// Fecha en 3 columnas separadas: D, M, AÑO
// Typo confirmado: "TAREA ASGINADA" (no ASIGNADA)

const SECTORES_VALIDOS = ['COLEGIO', 'CEUSTA', 'TALLER', 'OTRO'];

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

function detectarSector(fila) {
  const texto = fila.join(' ').toUpperCase();
  if (texto.includes('CEUSTA')) return 'CEUSTA';
  if (texto.includes('COLEGIO')) return 'COLEGIO';
  if (texto.includes('TALLER')) return 'TALLER';
  return null;
}

function construirFecha(d, m, anio) {
  const dia = parseInt(d);
  const mes = parseInt(m);
  const año = parseInt(anio);
  if (isNaN(dia) || isNaN(mes) || isNaN(año)) return null;
  const fecha = new Date(año, mes - 1, dia);
  return isNaN(fecha.getTime()) ? null : fecha;
}

// Lee una hoja y acumula registros en memoria — no toca la base todavía
function procesarHoja(filas, stats, acc) {
  if (filas.length < 2) return;

  let headerIdx = -1;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const lower = filas[i].map(c => String(c || '').toLowerCase().replace(/[.\s]/g, ''));
    if (lower.some(c => c.includes('fc') || c.includes('apellido') || c.includes('tarea'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return;

  const headers = filas[headerIdx];

  const cols = {
    fc:       colIdx(headers, ['fc', 'fichaconducta', 'ficha', 'fcnro', 'nrofc']),
    idnumero: colIdx(headers, ['idnro', 'idnumero', 'nroid', 'id']),
    tarea:    colIdx(headers, ['tareaasginada', 'tareaasignada', 'tarea']),
    nombre:   colIdx(headers, ['apellidonombre', 'apellidoynombre', 'apellido,nombre', 'nombre', 'apellido']),
    taller:   colIdx(headers, ['taller', 'area']),
    categoria: colIdx(headers, ['categoria', 'cat']),
    situacion: colIdx(headers, ['sit', 'situacion', 'estado']),
    dias:     colIdx(headers, ['diastraba', 'dias']),
    colD:     colIdx(headers, ['^d$', 'dia', 'dd']),
    colM:     colIdx(headers, ['^m$', 'mes', 'mm']),
    colAnio:  colIdx(headers, ['año', 'anio', 'aaaa', 'yyyy']),
  };

  if (cols.colD < 0 || cols.colM < 0 || cols.colAnio < 0) {
    headers.forEach((h, i) => {
      const hl = String(h || '').toLowerCase().trim();
      if (hl === 'd' && cols.colD < 0) cols.colD = i;
      if (hl === 'm' && cols.colM < 0) cols.colM = i;
      if ((hl === 'año' || hl === 'anio' || hl === 'a') && cols.colAnio < 0) cols.colAnio = i;
    });
  }

  let sectorActual = 'OTRO';

  for (let i = headerIdx + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.every(c => !c || String(c).trim() === '')) continue;

    const sectorFila = detectarSector(fila);
    if (sectorFila && fila.filter(c => c && String(c).trim()).length <= 3) {
      sectorActual = sectorFila;
      continue;
    }

    const fc = normalizarFC(limpiar(fila, cols.fc));
    const apellidoNombre = limpiar(fila, cols.nombre);
    if (!fc && !apellidoNombre) continue;

    stats.filas_leidas++;

    try {
      const fechaAlta = formatearFecha(
        construirFecha(
          limpiar(fila, cols.colD),
          limpiar(fila, cols.colM),
          limpiar(fila, cols.colAnio)
        )
      );

      const sectorValido = SECTORES_VALIDOS.includes(sectorActual) ? sectorActual : 'OTRO';

      acc.push({
        ficha_conducta: fc,
        id_numero: limpiar(fila, cols.idnumero),
        apellido_nombre: apellidoNombre || '',
        tarea_asignada: limpiar(fila, cols.tarea),
        taller: limpiar(fila, cols.taller),
        categoria: limpiar(fila, cols.categoria),
        sector: sectorValido,
        situacion: limpiar(fila, cols.situacion),
        dias_trabajados: parseInt(limpiar(fila, cols.dias) || '0') || null,
        fecha_alta: fechaAlta,
      });
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Fila ${i + 1} (FC ${fc}): ${err.message}`);
    }
  }
}

async function syncTrabajadores() {
  const stats = {
    planilla: 'TRABAJADORES',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  const acc = [];
  const workbook = await leerXlsx(DRIVE_IDS.TRABAJADORES);

  for (const nombreHoja of workbook.SheetNames) {
    const filas = xlsxAFilas(workbook, nombreHoja);
    procesarHoja(filas, stats, acc);
  }

  try {
    stats.filas_insertadas = await batchUpsertPersonalSpb(acc);
  } catch (err) {
    stats.errores++;
    stats.detalle_errores.push(`Batch insert: ${err.message}`);
  }

  return stats;
}

module.exports = { syncTrabajadores };
