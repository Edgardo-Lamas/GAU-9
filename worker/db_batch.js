'use strict';

const db = require('../api/db');

const BATCH_SIZE = 500;

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Deduplica por clave, quedándose con el último valor (el más reciente leído de la planilla)
function dedupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) map.set(keyFn(item), item);
  return [...map.values()];
}

async function batchUpsertPersonas(registros, tipo = 'INTERNO') {
  const lista = dedupBy(registros, r => r.dni);
  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [tipo];
    lote.forEach((r) => {
      const b = params.length;
      values.push(`($${b + 1},$1,$${b + 2},$${b + 3},$${b + 4})`);
      params.push(r.dni, r.nombre, r.apellido_1, r.apellido_2);
    });
    await db.query(`
      INSERT INTO personas (dni, tipo, nombre, apellido_1, apellido_2)
      VALUES ${values.join(',')}
      ON CONFLICT (dni) DO UPDATE SET
        nombre         = EXCLUDED.nombre,
        apellido_1     = EXCLUDED.apellido_1,
        apellido_2     = EXCLUDED.apellido_2,
        actualizado_en = NOW()
    `, params);
  }
  return lista.length;
}

// registros: [{ dni, rol, alta, fin, actividad, dias_horarios, destino, origen, gdeba_nro, estado, observaciones, fuente_fila }]
async function batchUpsertCiviles(registros) {
  const lista = dedupBy(registros, r => `${r.dni}|${r.alta}`);
  let total = 0;
  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [];
    lote.forEach((r, idx) => {
      const b = idx * 12;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`
      );
      params.push(
        r.dni, r.rol, r.alta, r.fin, r.actividad, r.dias_horarios,
        r.destino, r.origen, r.gdeba_nro, r.estado, r.observaciones, r.fuente_fila
      );
    });
    await db.query(`
      INSERT INTO civiles_ingreso
        (dni, rol, alta, fin, actividad, dias_horarios, destino, origen, gdeba_nro, estado, observaciones, fuente_fila)
      VALUES ${values.join(',')}
      ON CONFLICT (dni, alta) DO UPDATE SET
        rol            = EXCLUDED.rol,
        fin            = EXCLUDED.fin,
        actividad      = EXCLUDED.actividad,
        dias_horarios  = EXCLUDED.dias_horarios,
        destino        = EXCLUDED.destino,
        origen         = EXCLUDED.origen,
        gdeba_nro      = EXCLUDED.gdeba_nro,
        estado         = EXCLUDED.estado,
        observaciones  = EXCLUDED.observaciones,
        fuente_fila    = EXCLUDED.fuente_fila,
        actualizado_en = NOW()
    `, params);
    total += lote.length;
  }
  return total;
}

// registros: [{ ficha_conducta, id_numero, apellido_nombre, tarea_asignada, taller, categoria, sector, situacion, dias_trabajados, fecha_alta }]
// Filas sin ficha_conducta se insertan sin control de duplicados (no hay clave operativa confiable).
async function batchUpsertPersonalSpb(registros) {
  const conFc = registros.filter(r => r.ficha_conducta);
  const sinFc = registros.filter(r => !r.ficha_conducta);
  const lista = dedupBy(conFc, r => `${r.ficha_conducta}|${r.fecha_alta || ''}`);
  let total = 0;

  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [];
    lote.forEach((r, idx) => {
      const b = idx * 10;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
      );
      params.push(
        r.ficha_conducta, r.id_numero, r.apellido_nombre, r.tarea_asignada,
        r.taller, r.categoria, r.sector, r.situacion, r.dias_trabajados, r.fecha_alta
      );
    });
    await db.query(`
      INSERT INTO personal_spb
        (ficha_conducta, id_numero, apellido_nombre, tarea_asignada, taller, categoria, sector, situacion, dias_trabajados, fecha_alta)
      VALUES ${values.join(',')}
      ON CONFLICT (ficha_conducta, (COALESCE(fecha_alta, '1900-01-01'::date))) WHERE ficha_conducta IS NOT NULL
      DO UPDATE SET
        apellido_nombre = EXCLUDED.apellido_nombre,
        tarea_asignada  = EXCLUDED.tarea_asignada,
        taller          = EXCLUDED.taller,
        categoria       = EXCLUDED.categoria,
        sector          = EXCLUDED.sector,
        situacion       = EXCLUDED.situacion,
        dias_trabajados = EXCLUDED.dias_trabajados,
        actualizado_en  = NOW()
    `, params);
    total += lote.length;
  }

  // Filas sin FC: no hay clave operativa, así que evitamos duplicar contra lo ya existente
  // consultando los apellido_nombre ya cargados con ficha_conducta NULL.
  const sinFcDedup = dedupBy(sinFc, r => r.apellido_nombre);
  let yaExisten = new Set();
  if (sinFcDedup.length > 0) {
    const existentes = await db.query(
      'SELECT apellido_nombre FROM personal_spb WHERE ficha_conducta IS NULL'
    );
    yaExisten = new Set(existentes.rows.map(r => r.apellido_nombre));
  }
  const sinFcNuevos = sinFcDedup.filter(r => !yaExisten.has(r.apellido_nombre));

  for (const lote of chunks(sinFcNuevos, BATCH_SIZE)) {
    const values = [];
    const params = [];
    lote.forEach((r, idx) => {
      const b = idx * 10;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
      );
      params.push(
        r.ficha_conducta, r.id_numero, r.apellido_nombre, r.tarea_asignada,
        r.taller, r.categoria, r.sector, r.situacion, r.dias_trabajados, r.fecha_alta
      );
    });
    await db.query(`
      INSERT INTO personal_spb
        (ficha_conducta, id_numero, apellido_nombre, tarea_asignada, taller, categoria, sector, situacion, dias_trabajados, fecha_alta)
      VALUES ${values.join(',')}
    `, params);
    total += lote.length;
  }

  return total;
}

// nivelFijo: 'PRIMARIO' | 'SECUNDARIO' — si el interno ya tenía el otro nivel, queda 'AMBOS'
async function batchUpsertInternosDetalle(registros, nivelFijo) {
  const lista = dedupBy(registros, r => r.dni);
  const otroNivel = nivelFijo === 'PRIMARIO' ? 'SECUNDARIO' : 'PRIMARIO';
  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [nivelFijo, otroNivel];
    lote.forEach((r) => {
      const b = params.length;
      values.push(`($${b + 1},$1,$${b + 2},$${b + 3})`);
      params.push(r.dni, r.fc || null, r.pabellon || null);
    });
    await db.query(`
      INSERT INTO internos_detalle (dni, nivel_educativo, ficha_conducta, pabellon)
      VALUES ${values.join(',')}
      ON CONFLICT (dni) DO UPDATE SET
        nivel_educativo = CASE
          WHEN internos_detalle.nivel_educativo = $2 THEN 'AMBOS'
          ELSE $1
        END,
        ficha_conducta = COALESCE(EXCLUDED.ficha_conducta, internos_detalle.ficha_conducta),
        pabellon       = COALESCE(EXCLUDED.pabellon, internos_detalle.pabellon),
        actualizado_en = NOW()
    `, params);
  }
  return lista.length;
}

// registros: [{ dni, fecha, nivel, turno, division, curso, estado, fuente_planilla }]
async function batchInsertPresentismo(registros, { onConflictDoNothing = false } = {}) {
  const lista = dedupBy(registros, r => `${r.dni}|${r.fecha}|${r.nivel}|${r.turno || ''}`);
  let total = 0;
  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [];
    lote.forEach((r, idx) => {
      const b = idx * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(r.dni, r.fecha, r.nivel, r.turno, r.division, r.curso, r.estado, r.fuente_planilla);
    });
    const onConflict = onConflictDoNothing
      ? 'ON CONFLICT (dni, fecha, nivel, turno) DO NOTHING'
      : `ON CONFLICT (dni, fecha, nivel, turno) DO UPDATE SET
           estado   = EXCLUDED.estado,
           curso    = EXCLUDED.curso,
           division = EXCLUDED.division`;
    await db.query(`
      INSERT INTO presentismo (dni, fecha, nivel, turno, division, curso, estado, fuente_planilla)
      VALUES ${values.join(',')}
      ${onConflict}
    `, params);
    total += lote.length;
  }
  return total;
}

module.exports = {
  BATCH_SIZE,
  chunks,
  dedupBy,
  batchUpsertPersonas,
  batchUpsertCiviles,
  batchUpsertPersonalSpb,
  batchUpsertInternosDetalle,
  batchInsertPresentismo,
};
