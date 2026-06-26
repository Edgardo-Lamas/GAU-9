'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

const DRIVE_IDS = {
  PRESENTISMO_PRIMARIO:   '1rKoNDs1m8W8_z-7ImarMyXRpIQXuuvs6',
  PRESENTISMO_SECUNDARIO: '12C_UfPBeyVoFbTx0ggoXZH5lEQWqRLmH',
  CIVILES:                '1ycIp1bFIyNVi-UxqoAB86ok4hdMDMWWSJ0UWXYj31lo',
  TRABAJADORES:           '1Ypz1osYWJp9yVO1FSJZD7tFG82jFVTU7',
  FACULTADES:             '1jNZ7bSOAeny-8TNkNYj0c70EI19FVY4rGck2cgRhRg8',
};

function obtenerAuth() {
  const keyPath = path.resolve(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './credentials/service_account.json'
  );
  const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}

async function leerXlsx(driveId) {
  const auth = obtenerAuth();
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });

  const res = await drive.files.get(
    { fileId: driveId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return xlsx.read(Buffer.from(res.data), { type: 'buffer', cellDates: true });
}

async function leerSheetCompleto(spreadsheetId, nombreHoja) {
  const auth = obtenerAuth();
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const rango = nombreHoja ? `'${nombreHoja}'!A:ZZ` : 'A:ZZ';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rango,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  return res.data.values || [];
}

async function listarHojasSheet(spreadsheetId) {
  const auth = obtenerAuth();
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  return res.data.sheets.map(s => s.properties.title);
}

// Convierte una hoja de workbook xlsx a array de arrays (igual formato que leerSheetCompleto)
function xlsxAFilas(workbook, nombreHoja) {
  const sheet = workbook.Sheets[nombreHoja];
  if (!sheet) return [];
  return xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

module.exports = { DRIVE_IDS, leerXlsx, leerSheetCompleto, listarHojasSheet, xlsxAFilas };
