'use strict';

require('dotenv').config();
const db = require('../api/db');
const { leerXlsx, xlsxAFilas, DRIVE_IDS } = require('./drive');
const {
  normalizarDNI, normalizarFC, normalizarTurno,
  splitApellidoNombre, formatearFecha, mesDesdeNombreHoja, normalizarEstadoPresentismo,
} = require('./normalizar');

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

async function upsertInterno(dni, nombre, apellido_1, apellido_2) {
  await db.query(`
    INSERT INTO personas (dni, tipo, nombre, apellido_1, apellido_2)
    VALUES ($1, 'INTERNO', $2, $3, $4)
    ON CONFLICT (dni) DO UPDATE SET
      nombre        = EXCLUDED.nombre,
      apellido_1    = EXCLUDED.apellido_1,
      apellido_2    = EXCLUDED.apellido_2,
      actualizado_en = NOW()
  `, [dni, nombre, apellido_1, apellido_2]);

  // nivel_educativo: si ya es SECUNDARIO → AMBOS; si es PRIMARIO o NULL → PRIMARIO
  await db.query(`
    INSERT INTO internos_detalle (dni, nivel_educativo)
    VALUES ($1, 'PRIMARIO')
    ON CONFLICT (dni) DO UPDATE SET
      nivel_educativo = CASE
        WHEN internos_detalle.nivel_educativo = 'SECUNDARIO' THEN 'AMBOS'
        ELSE 'PRIMARIO'
      END,
      actualizado_en = NOW()
  `, [dni]);
}

async function procesarHoja(filas, mes, stats) {
  if (filas.length < 2) return;

  // Encontrar fila de encabezado: contiene 'CICLO', 'CURSO', 'DNI' o 'APELLIDO'
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
    dni:     colIdx(headers, ['dni', 'nrodocumento', 'documento']),
    fc:      colIdx(headers, ['fc', 'fichaconducta', 'ficha', 'nroficha']),
    nombre:  colIdx(headers, ['apellidonombre', 'apellidoynombre', 'nombreyapellido', 'apellido,nombre', 'nombre']),
    turno:   colIdx(headers, ['turno']),
    curso:   colIdx(headers, ['curso', 'grado', 'año']),
    division: colIdx(headers, ['division', 'div']),
    pabellon: colIdx(headers, ['pabellon', 'pab']),
  };

  // Columnas de días: encabezados que sean número entre 1 y 31
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

      await upsertInterno(dni, nombre, apellido_1, apellido_2);

      // Actualizar fc y pabellón si los tenemos
      if (fc || pabellon) {
        await db.query(`
          UPDATE internos_detalle SET
            ficha_conducta = COALESCE($1, ficha_conducta),
            pabellon       = COALESCE($2, pabellon),
            actualizado_en = NOW()
          WHERE dni = $3
        `, [fc, pabellon, dni]);
      }

      // Insertar registros de presentismo por cada día
      for (const { col, dia } of colsDias) {
        const valorCelda = String(fila[col] || '').trim();
        if (!valorCelda) continue;

        const estado = normalizarEstadoPresentismo(valorCelda);
        if (!estado) continue;

        const fecha = formatearFecha(new Date(ANIO_PLANILLA, mes - 1, dia));
        if (!fecha) continue;

        await db.query(`
          INSERT INTO presentismo (dni, fecha, nivel, turno, division, curso, estado, fuente_planilla)
          VALUES ($1,$2,'PRIMARIO',$3,$4,$5,$6,'PRIMARIO')
          ON CONFLICT (dni, fecha, nivel, turno) DO UPDATE SET
            estado = EXCLUDED.estado,
            curso  = EXCLUDED.curso,
            division = EXCLUDED.division
        `, [dni, fecha, turno, division, curso, estado]);

        stats.filas_insertadas++;
      }
    } catch (err) {
      stats.errores++;
      stats.detalle_errores.push(`Hoja mes=${mes} fila ${i + 1}: ${err.message}`);
    }
  }
}

async function syncPrimario() {
  const stats = {
    planilla: 'PRESENTISMO_PRIMARIO',
    filas_leidas: 0,
    filas_insertadas: 0,
    filas_actualizadas: 0,
    errores: 0,
    detalle_errores: [],
  };

  const workbook = await leerXlsx(DRIVE_IDS.PRESENTISMO_PRIMARIO);

  for (const nombreHoja of workbook.SheetNames) {
    const mes = mesDesdeNombreHoja(nombreHoja);
    if (!mes) continue;

    const filas = xlsxAFilas(workbook, nombreHoja);
    await procesarHoja(filas, mes, stats);
  }

  return stats;
}

module.exports = { syncPrimario };
