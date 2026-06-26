'use strict';

function normalizarDNI(dni) {
  if (dni === null || dni === undefined || dni === '') return null;
  const s = String(dni).replace(/\./g, '').replace(/[\s-]/g, '').trim();
  return /^\d+$/.test(s) ? s : null;
}

function normalizarFC(fc) {
  if (fc === null || fc === undefined || fc === '') return null;
  return String(fc).replace(/\./g, '').replace(/\s/g, '').trim();
}

function mapearRol(rol) {
  const mapa = {
    'docente': 'DOCENTE',
    'civil': 'CIVIL',
    'estudiante': 'ESTUDIANTE',
    'estudiantes': 'ESTUDIANTE',
    'juez': 'JUEZ',
    'abogado': 'ABOGADO',
    'abogada': 'ABOGADO',
  };
  return mapa[String(rol || '').toLowerCase().trim()] || 'OTRO';
}

function normalizarTurno(turno) {
  const t = String(turno || '').toUpperCase().trim();
  return t || null;
}

function parsearFecha(valor) {
  if (!valor) return null;
  const str = String(valor).trim();
  if (!str) return null;

  // DD/MM/YYYY o D/M/YYYY
  const mDMY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mDMY) {
    let anio = parseInt(mDMY[3]);
    if (anio < 100) anio += 2000;
    const d = new Date(anio, parseInt(mDMY[2]) - 1, parseInt(mDMY[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM-DD
  const mYMD = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mYMD) {
    const d = new Date(parseInt(mYMD[1]), parseInt(mYMD[2]) - 1, parseInt(mYMD[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Serial Excel/Sheets (número > 1000, < 100000)
  const n = Number(str);
  if (!isNaN(n) && n > 1000 && n < 100000) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return new Date(new Date(1899, 11, 30).getTime() + n * msPerDay);
  }

  return null;
}

function parsearHora(valor) {
  if (!valor) return null;
  const m = String(valor).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:00`;
  return null;
}

// "GARCIA JUAN PABLO" → { apellido_1: 'GARCIA', apellido_2: null, nombre: 'JUAN PABLO' }
// No hay forma fiable de distinguir dos apellidos de apellido+nombre; usamos la primera palabra.
function splitApellidoNombre(nombreCompleto) {
  const partes = String(nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { apellido_1: 'DESCONOCIDO', apellido_2: null, nombre: '' };
  if (partes.length === 1) return { apellido_1: partes[0], apellido_2: null, nombre: '' };
  return {
    apellido_1: partes[0],
    apellido_2: null,
    nombre: partes.slice(1).join(' '),
  };
}

function formatearFecha(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4,
  mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function mesDesdeNombreHoja(nombreHoja) {
  const lower = String(nombreHoja || '').toLowerCase();
  for (const [nombre, num] of Object.entries(MESES)) {
    if (lower.includes(nombre)) return num;
  }
  return null;
}

function normalizarEstadoPresentismo(valor) {
  const v = String(valor || '').toUpperCase().trim();
  if (v === 'P' || v === '1' || v === 'X' || v === 'SI' || v === 'S') return 'P';
  if (v === 'A' || v === '0' || v === 'I') return 'A';
  return null;
}

module.exports = {
  normalizarDNI,
  normalizarFC,
  mapearRol,
  normalizarTurno,
  parsearFecha,
  parsearHora,
  splitApellidoNombre,
  formatearFecha,
  mesDesdeNombreHoja,
  normalizarEstadoPresentismo,
};
