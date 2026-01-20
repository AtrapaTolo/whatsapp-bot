// conversationLogicAI.js
const { decidirConIA } = require('./aiFlow');
const {
  procesarMensaje: procesarMensajeFallback,
  addToHistory,
  construirPayloadEmail,
} = require('./conversationLogic');

function yaEstaEnHistorial(session, textoCliente) {
  const h = session.historia || [];
  if (!h.length) return false;
  const last = h[h.length - 1];
  if (!last || last.de !== 'cliente') return false;
  if ((last.texto || '') !== (textoCliente || '')) return false;

  // Si coincide el texto y es reciente, evitamos duplicar (imagen/audio ya lo meten antes)
  const lastTs = Date.parse(last.fecha || '');
  if (!Number.isFinite(lastTs)) return false;
  return Date.now() - lastTs < 5000;
}

function clampNps(n) {
  if (n === null || n === undefined) return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 10) return 10;
  return Math.trunc(num);
}

function sentimientoFromNps(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;

  if (n <= 2) return "muy_negativo";
  if (n <= 4) return "negativo";
  if (n <= 6) return "neutro";
  if (n <= 8) return "positivo";
  return "muy_positivo";
}

function aplicarUpdates(session, updates = {}) {
  if (updates.estado) session.estado = updates.estado;

  if (typeof updates.incidencia === 'boolean') session.incidencia = updates.incidencia;

  if (typeof updates.sentimiento === 'string') session.sentimiento = updates.sentimiento;

  // NPS score
  if (updates.nps_score !== undefined) {
  session.nps_score = clampNps(updates.nps_score);

    // Forzamos sentimiento por NPS (si no hay incidencia)
    if (session.incidencia === false) {
      const s = sentimientoFromNps(session.nps_score);
      if (s) session.sentimiento = s;
    }
  }

  // Comentario final NPS
  if (typeof updates.nps_comment === 'string') {
    session.nps_comment = updates.nps_comment.trim() || null;
  }

  // Elección ticket
  if (updates.ticket_choice === 'abrir_ticket') {
    session.ticket_escalado = true;
    session.cliente_contacta = false;
  } else if (updates.ticket_choice === 'cliente_contacta') {
    session.ticket_escalado = false;
    session.cliente_contacta = true;
  }
}

async function procesarMensajeAI(session, textoCliente) {
  const mensajesACliente = [];
  const eventos = [];

  session.comentarios = session.comentarios || '';
  session.historia = session.historia || [];
  session.nps_comment = session.nps_comment || null;

  // Historial: evitamos duplicar si imagen/audio ya añadió una entrada “cliente”
  if (!yaEstaEnHistorial(session, textoCliente)) {
    addToHistory(session, 'cliente', textoCliente);
  }

  // Mantén un resumen simple para emails (si quieres, luego lo refinamos con IA)
  if ((textoCliente || '').trim()) {
    session.comentarios += (session.comentarios ? '\n' : '') + textoCliente.trim().slice(0, 200);
  }

  let ai;
  try {
    ai = await decidirConIA(session, textoCliente);
  } catch (e) {
    console.error('[AI_FLOW] Error, fallback a lógica clásica:', e?.message || e);
    return await procesarMensajeFallback(session, textoCliente);
  }

  aplicarUpdates(session, ai?.updates || {});
  const reply = Array.isArray(ai?.reply_messages) ? ai.reply_messages : [];

  // Mensajes al cliente
  for (const m of reply) {
    if (typeof m === 'string' && m.trim()) {
      mensajesACliente.push(m);
    }
  }

  // Añadir respuestas del bot al historial antes de construir email
  for (const m of mensajesACliente) {
    addToHistory(session, 'bot', m);
  }

  // BACKEND decide eventos en base al estado/updates (no dependemos de que la IA “se acuerde”)
  const quiereTicket = session.ticket_escalado === true;
  if (quiereTicket) {
    eventos.push({
      tipo: 'CREAR_TICKET',
      payload: construirPayloadEmail(session), // backend lo construye
    });
  }

  if (session.estado === 'CERRADA' && session.conversacionIdNps) {
    eventos.push({
      tipo: 'ACTUALIZAR_CONVERSACION_NPS',
      payload: {
        conversacionId: session.conversacionIdNps,
        tuvo_incidencia: session.incidencia ? 1 : 0,
        sentimiento: session.sentimiento,
        nps_score: session.nps_score,
        nps_comment: session.nps_comment,
      },
    });
  }

  return { session, mensajesACliente, eventos };
}

module.exports = { procesarMensajeAI };