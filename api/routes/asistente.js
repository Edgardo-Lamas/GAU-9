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
  const [metricas, actividad, tendencia] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM personas)                                                   AS total_personas,
        (SELECT COUNT(*) FROM personas WHERE tipo = 'INTERNO')                           AS total_internos,
        (SELECT COUNT(*) FROM personas WHERE tipo = 'CIVIL')                             AS total_civiles_db,
        (SELECT COUNT(*) FROM personas WHERE tipo = 'SPB')                               AS total_spb,
        (SELECT COUNT(*) FROM civiles_ingreso WHERE DATE(alta) = CURRENT_DATE)           AS civiles_hoy,
        (SELECT COUNT(*) FROM traslados WHERE DATE(creado_en) = CURRENT_DATE)            AS traslados_hoy,
        (SELECT COUNT(*) FROM traslados WHERE DATE(creado_en) = CURRENT_DATE AND resultado = 'PENDIENTE') AS traslados_pendientes,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND estado = 'P')              AS presentes_hoy,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE)              AS total_presentismo_hoy,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'PRIMARIO' AND estado = 'P')   AS presentes_primario,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'PRIMARIO')                    AS total_primario,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'SECUNDARIO' AND estado = 'P') AS presentes_secundario,
        (SELECT COUNT(*) FROM presentismo WHERE DATE(fecha) = CURRENT_DATE AND nivel = 'SECUNDARIO')                  AS total_secundario
    `),
    // Actividad reciente (últimas 15 acciones, sin datos personales)
    pool.query(`
      SELECT accion, detalle, creado_en
      FROM activity_log
      ORDER BY creado_en DESC
      LIMIT 15
    `),
    // Tendencia presentismo últimos 7 días
    pool.query(`
      SELECT fecha, nivel,
        COUNT(*) FILTER (WHERE estado = 'P') AS presentes,
        COUNT(*) AS total
      FROM presentismo
      WHERE fecha >= CURRENT_DATE - INTERVAL '7 days' AND fecha < CURRENT_DATE
      GROUP BY fecha, nivel
      ORDER BY fecha DESC, nivel
    `),
  ]);

  return {
    ...metricas.rows[0],
    actividad_reciente: actividad.rows,
    tendencia_semana: tendencia.rows,
  };
}

function construirSystemPrompt(ctx, usuarioNombre) {
  const fecha = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const actividadTexto = ctx.actividad_reciente?.length
    ? ctx.actividad_reciente.map(a =>
        `  · ${new Date(a.creado_en).toLocaleString('es-AR')} — ${a.accion}${a.detalle ? ': ' + a.detalle : ''}`
      ).join('\n')
    : '  · Sin actividad reciente registrada';

  const tendenciaTexto = ctx.tendencia_semana?.length
    ? ctx.tendencia_semana.map(t =>
        `  · ${t.fecha?.toString().slice(0,10)} ${t.nivel}: ${t.presentes}/${t.total} (${t.total > 0 ? Math.round(t.presentes/t.total*100) : 0}%)`
      ).join('\n')
    : '  · Sin datos de tendencia';

  return `Sos el asistente operativo y asesor estratégico del sistema GAU-9, la plataforma digital de la Coordinación Académica de la Unidad 9 del Servicio Penitenciario Bonaerense (SPB).

Estás respondiendo a ${usuarioNombre}, un jefe del área académica.

Hoy es ${fecha}.

ESTADO ACTUAL DEL SISTEMA (datos en tiempo real):
- Total de personas registradas: ${ctx.total_personas}
  · Internos: ${ctx.total_internos} | Personal SPB: ${ctx.total_spb} | Civiles en base: ${ctx.total_civiles_db}
- Presentismo hoy:
  · Primario: ${ctx.presentes_primario}/${ctx.total_primario} (${ctx.total_primario > 0 ? Math.round(ctx.presentes_primario/ctx.total_primario*100) : 0}%)
  · Secundario: ${ctx.presentes_secundario}/${ctx.total_secundario} (${ctx.total_secundario > 0 ? Math.round(ctx.presentes_secundario/ctx.total_secundario*100) : 0}%)
- Civiles autorizados hoy: ${ctx.civiles_hoy}
- Traslados hoy: ${ctx.traslados_hoy} (${ctx.traslados_pendientes} sin regreso)

ACTIVIDAD RECIENTE DEL SISTEMA (últimas acciones de los usuarios):
${actividadTexto}

TENDENCIA DE PRESENTISMO — ÚLTIMOS 7 DÍAS:
${tendenciaTexto}

FUENTES DE DATOS:
1. Presentismo Primario y Secundario 2026 — asistencia diaria
2. Ingreso de Civiles 2026 — docentes, jueces, abogados, estudiantes universitarios
3. Listado Trabajadores Colegio 2026 — personal SPB del colegio
4. Facultades 2026 — traslados históricos a universidades

TU ROL TIENE DOS DIMENSIONES:

1. OPERATIVA (consultas del día a día):
   - Respondés preguntas sobre el estado actual: presentismo, civiles, traslados
   - Explicás cómo interpretar los datos disponibles
   - Para datos individuales (un interno específico), indicás que se consultan desde las vistas del dashboard

2. ESTRATÉGICA Y DE MEJORA CONTINUA:
   - Analizás patrones en los datos (tendencias de presentismo, frecuencia de traslados, uso del sistema)
   - Detectás anomalías y las señalás proactivamente ("el presentismo bajó 20% esta semana — puede relacionarse con...")
   - Sugerís mejoras al workflow operativo basándote en lo que observás en el uso real
   - Proponés qué datos adicionales sería útil registrar en las planillas
   - Identificás cruces de información valiosos que hoy no se están aprovechando
   - Cuando detectás una oportunidad de mejora relevante, la mencionás aunque no te la hayan pedido

ESTILO:
- Español, tono profesional y directo
- **Para datos comparativos, SIEMPRE usás tabla Markdown** (| Col | Col |\n|---|---|\n| val | val |)
- Para un solo dato, texto directo o lista corta
- Máximo 3 párrafos salvo que pidan un análisis detallado
- No inventás datos que no están en el contexto — si no tenés información, lo decís claramente`;
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
