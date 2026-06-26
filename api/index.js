'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes        = require('./routes/auth');
const dashboardRoutes   = require('./routes/dashboard');
const presentismoRoutes = require('./routes/presentismo');
const civilesRoutes     = require('./routes/civiles');
const trasladosRoutes   = require('./routes/traslados');
const personasRoutes    = require('./routes/personas');
const syncRoutes        = require('./routes/sync');

const app  = express();
const PORT = process.env.PORT || 3000;

// En producción, limitar CORS al dominio del dashboard
const corsOptions = {
  origin: process.env.DASHBOARD_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check (sin auth — Railway lo usa para verificar que el proceso está vivo)
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth',        authRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/presentismo', presentismoRoutes);
app.use('/api/civiles',     civilesRoutes);
app.use('/api/traslados',   trasladosRoutes);
app.use('/api/buscar',      personasRoutes);   // GET /api/buscar?q=texto
app.use('/api/personas',    personasRoutes);   // GET /api/personas/:dni
app.use('/api/sync',        syncRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Error handler global
app.use((err, req, res, _next) => {
  console.error('[api] Error no manejado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// En Vercel el servidor lo levanta la plataforma — solo escuchamos en dev/local
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[api] GAU-9 escuchando en puerto ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
