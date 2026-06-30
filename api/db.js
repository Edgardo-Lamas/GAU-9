'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Cada función serverless de Vercel instancia su propio pool — con max alto,
  // pocas invocaciones concurrentes ya agotaban el límite del pooler.
  max: process.env.NODE_ENV === 'production' ? 3 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en cliente inactivo:', err.message);
});

module.exports = pool;
