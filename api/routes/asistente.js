'use strict';

const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const pool     = require('../db');

const router = express.Router();
const dotenv = require('dotenv');
dotenv.config({ override: true });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function obtenerContextoDB() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM personas)                                                   AS total_personas,
      (SELECT COUNT(*) FROM personas WHERE tipo = 'INTERNO')                           AS total_internos,
      (SELECT COUNT(*) FROM personas WHERE tipo = 'CIVIL')                             AS total_civiles_db,
      (SELECT COUNT(*) FROM personas WHERE tipo = 'SPB')                               AS total_spb,
      (SELECT COUNT(*) FROM civiles_ingreso WHERE DATE(alta) = CURRENT_DATE)            AS civiles_hoy,
      (SELECT COUNT(*) FROM traslados WHERE DATE(creado_en) = CURRENT_DATE)            AS traslados_hoy,
      (SELECT COUNT(*) FROM traslados WHERE DATE(creado_en) = CURRENT_DATE AND resultado = 'PENDIENTE') AS traslados_pendientes,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND estado = 'P')              AS presentes_hoy,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE)              AS total_presentismo_hoy,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'PRIMARIO' AND estado = 'P')   AS presentes_primario,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'PRIMARIO')                    AS total_primario,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'SECUNDARIO' AND estado = 'P') AS presentes_secundario,
      (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'SECUNDARIO')                  AS total_secundario
  `);
  return rows[0];
}

function construirSystemPrompt(ctx, usuarioNombre) {
  const fecha = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return `Sos el asistente operativo del sistema GAU-9, la plataforma digital de la Coordinación Académica de la Unidad 9 del Servicio Penitenciario Bonaerense (SPB).

Estás respondiendo a ${usuarioNombre}, un jefe del área académica.

Hoy es ${fecha}.

ESTADO ACTUAL DEL SISTEMA (datos en tiempo real de la base de datos):
- Total de personas registradas: ${ctx.total_personas}
  · Internos: ${ctx.total_internos}
  · Personal SPB: ${ctx.total_spb}
  · Civiles/docentes en base: ${ctx.total_civiles_db}
- Presentismo hoy:
  · Primario: ${ctx.presentes_primario} presentes de ${ctx.total_primario} (${ctx.total_primario > 0 ? Math.round(ctx.presentes_primario / ctx.total_primario * 100) : 0}%)
  · Secundario: ${ctx.presentes_secundario} presentes de ${ctx.total_secundario} (${ctx.total_secundario > 0 ? Math.round(ctx.presentes_secundario / ctx.total_secundario * 100) : 0}%)
  · Total: ${ctx.presentes_hoy} presentes de ${ctx.total_presentismo_hoy}
- Civiles autorizados hoy: ${ctx.civiles_hoy}
- Traslados hoy: ${ctx.traslados_hoy} (${ctx.traslados_pendientes} sin regreso)

FUENTES DE DATOS DEL SISTEMA:
1. Presentismo Primario 2026 — registro diario de asistencia nivel primario
2. Presentismo Secundario 2026 — registro diario de asistencia nivel secundario
3. Ingreso de Civiles 2026 — autorizaciones de ingreso de docentes, jueces, abogados, estudiantes universitarios
4. Listado Trabajadores Colegio 2026 — personal SPB asignado al colegio
5. Facultades 2026 — registro histórico de traslados a instituciones universitarias

TU ROL:
- Respondés preguntas operativas sobre el estado del sistema, los datos del día y el funcionamiento de la plataforma
- Explicás qué datos están disponibles y cómo interpretarlos
- Si te preguntan por un interno, civil o traslado específico, aclarás que podés dar métricas generales pero que los datos individuales se consultan desde las vistas del dashboard
- Respondés en español, con tono profesional pero directo
- **Cuando presentás datos comparativos o listados de múltiples campos, SIEMPRE usás una tabla Markdown** (formato: | Col1 | Col2 | \n |---|---| \n | val | val |)
- Para un solo dato o respuesta simple, usás texto directo o lista
- Tus respuestas son concisas — máximo 3 párrafos salvo que te pidan un informe detallado
- No inventás datos que no están en el contexto — si no tenés información, lo decís`;
}

// POST /api/asistente  — SSE streaming
router.post('/', auth, async (req, res) => {
  const { mensaje, historial = [] } = req.body;

  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Asistente IA no configurado' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const ctx = await obtenerContextoDB();
    const systemPrompt = construirSystemPrompt(ctx, req.usuario?.nombre || 'Jefe');

    // Construir historial de mensajes (últimos 10 turnos para no exceder tokens)
    const mensajesHistorial = historial.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));
    mensajesHistorial.push({ role: 'user', content: mensaje.trim() });

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: mensajesHistorial,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[asistente] Error:', err.message);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al procesar la consulta' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Error al procesar la consulta' })}\n\n`);
      res.end();
    }
  }
});

module.exports = router;
