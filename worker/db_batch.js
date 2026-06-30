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

async function batchUpsertPersonas(registros) {
  const lista = dedupBy(registros, r => r.dni);
  for (const lote of chunks(lista, BATCH_SIZE)) {
    const values = [];
    const params = [];
    lote.forEach((r, idx) => {
      const b = idx * 4;
      values.push(`($${b + 1},'INTERNO',$${b + 2},$${b + 3},$${b + 4})`);
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
  batchUpsertInternosDetalle,
  batchInsertPresentismo,
};
