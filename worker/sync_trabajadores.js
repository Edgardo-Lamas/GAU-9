'use strict';

require('dotenv').config();
const db = require('../api/db');
const { leerXlsx, xlsxAFilas, DRIVE_IDS } = require('./drive');
const { normalizarFC, formatearFecha } = require('./normalizar');

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

async function procesarHoja(filas, stats) {
  if (filas.length < 2) return;

  // Encontrar fila de encabezado: contiene 'F.C', 'APELLIDO' o 'TAREA'
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
    // "TAREA ASGINADA" — typo confirmado en el original
    tarea:    colIdx(headers, ['tareaasginada', 'tareaasignada', 'tarea']),
    nombre:   colIdx(headers, ['apellidonombre', 'apellidoynombre', 'apellido,nombre', 'nombre', 'apellido']),
    taller:   colIdx(headers, ['taller', 'area']),
    categoria: colIdx(headers, ['categoria', 'cat']),
    situacion: colIdx(headers, ['sit', 'situacion', 'estado']),
    dias:     colIdx(headers, ['diastraba', 'dias']),
    // Fecha en 3 columnas
    colD:     colIdx(headers, ['^d$', 'dia', 'dd']),
    colM:     colIdx(headers, ['^m$', 'mes', 'mm']),
    colAnio:  colIdx(headers, ['año', 'anio', 'aaaa', 'yyyy']),
  };

  // Fallback para D/M/AÑO: buscar por posición relativa si hay 3 columnas numéricas de fecha
  if (cols.colD < 0 || cols.colM < 0 || cols.colAnio < 0) {
    // Buscar patrón D M AÑO buscando encabezados cortos numéricos/fecha
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

    // Detectar cambio de sección (COLEGIO / CEUSTA)
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

      // Upsert personal_spb por (ficha_conducta, fecha_alta) si existe; sino insert
      const existe = await db.query(
        'SELECT id FROM personal_spb WHERE ficha_conducta = $1 AND (fecha_alta = $2 OR ($2 IS NULL AND fecha_alta IS NULL)) LIMIT 1',
        [fc, fechaAlta]
      );

      if (existe.rows.length === 0) {
        await db.query(`
          INSERT INTO personal_spb
            (ficha_conducta, id_numero, apellido_nombre, tarea_asignada, taller, categoria, sector, situacion, dias_trabajados, fecha_alta)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          fc,
          limpiar(fila, cols.idnumero),
          apellidoNombre || '',
          limpiar(fila, cols.tarea),
          limpiar(fila, cols.taller),
          limpiar(fila, cols.categoria),
          sectorValido,
          limpiar(fila, cols.situacion),
          parseInt(limpiar(fila, cols.dias) || '0') || null,
          fechaAlta,
        ]);
        stats.filas_insertadas++;
      } else {
        await db.query(`
          UPDATE personal_spb SET
            apellido_nombre = $1,
            tarea_asignada  = $2,
            taller          = $3,
            categoria       = $4,
            sector          = $5,
            situacion       = $6,
            dias_trabajados = $7,
            actualizado_en  = NOW()
          WHERE ficha_conducta = $8 AND (fecha_alta = $9 OR ($9 IS NULL AND fecha_alta IS NULL))
        `, [
          apellidoNombre || '',
          limpiar(fila, cols.tarea),
          limpiar(fila, cols.taller),
          limpiar(fila, cols.categoria),
          sectorValido,
          limpiar(fila, cols.situacion),
          parseInt(limpiar(fila, cols.dias) || '0') || null,
          fc, fechaAlta,
        ]);
        stats.filas_actualizadas++;
      }
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

  const workbook = await leerXlsx(DRIVE_IDS.TRABAJADORES);

  for (const nombreHoja of workbook.SheetNames) {
    const filas = xlsxAFilas(workbook, nombreHoja);
    await procesarHoja(filas, stats);
  }

  return stats;
}

module.exports = { syncTrabajadores };
