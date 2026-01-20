// conversationLogicSupportAI.js
const { decidirConIA } = require("./aiFlow");
const { addToHistory } = require("./conversationLogic");

function yaEstaEnHistorial(session, textoCliente) {
  const h = session.historia || [];
  if (!h.length) return false;
  const last = h[h.length - 1];
  if (!last || last.de !== "cliente") return false;
  if ((last.texto || "") !== (textoCliente || "")) return false;
  const lastTs = Date.parse(last.fecha || "");
  return Number.isFinite(lastTs) && (Date.now() - lastTs < 5000);
}

function aplicarUpdates(session, updates = {}) {
  if (updates.estado) session.estado = updates.estado;

  // Post-encuesta: solo nos interesa marcar incidencia si TRUE
  if (updates.incidencia === true) session.incidencia = true;
  if (typeof updates.sentimiento === "string") session.sentimiento = updates.sentimiento;

  if (updates.ticket_choice === "abrir_ticket") {
    session.ticket_escalado = true;
    session.cliente_contacta = false;
  } else if (updates.ticket_choice === "cliente_contacta") {
    session.ticket_escalado = false;
    session.cliente_contacta = true;
  }

  // guardamos resumen si viene
  if (typeof updates.resumen === "string" && updates.resumen.trim()) {
    session.ticket_resumen = updates.resumen.trim();
  }
}
function resumenCorto(s = "", maxChars = 220) {
  const clean = String(s)
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > maxChars ? clean.slice(0, maxChars - 1) + "…" : clean;
}

function buildTicketPayload(session) {
  const resumenBase =
    session.ticket_resumen ||
    session.comentarios ||
    (session.historia || []).slice(-6).map(m => `${m.de}: ${m.texto}`).join(" | ");

  return {
    order_id: session.order_id || null,
    telefono: session.telefono || null,
    cliente_id: session.cliente_id || null,
    resumen: resumenCorto(resumenBase, 220),     // ✅ 1-2 líneas “tipo”
    historial: (session.historia || []).slice(-40)
  };
}

async function procesarMensajeSupportAI(session, textoCliente) {
  const mensajesACliente = [];
  const eventos = [];

  session.historia = session.historia || [];
  session.comentarios = session.comentarios || "";
  session.sentimiento = session.sentimiento || null;

  if (!yaEstaEnHistorial(session, textoCliente)) {
    addToHistory(session, "cliente", textoCliente);
  }

  if ((textoCliente || "").trim()) {
    session.comentarios += (session.comentarios ? "\n" : "") + textoCliente.trim().slice(0, 200);
  }

  const ai = await decidirConIA(session, textoCliente);
  aplicarUpdates(session, ai.updates || {});

  const reply = Array.isArray(ai.reply_messages) ? ai.reply_messages : [];
  for (const m of reply) if (typeof m === "string" && m.trim()) mensajesACliente.push(m);

  for (const m of mensajesACliente) addToHistory(session, "bot", m);

  // ✅ Si hay ticket, emitimos payload para que el backend redacte email
  if (session.ticket_escalado === true) {
    eventos.push({
      tipo: "CREAR_TICKET",
      payload: buildTicketPayload(session)
    });

    // opcional: marcar incidencia en NPS sin pisar nps_score/comment
    if (session.conversacionIdNps) {
      eventos.push({
        tipo: "ACTUALIZAR_CONVERSACION_NPS",
        payload: {
          conversacionId: session.conversacionIdNps,
          tuvo_incidencia: 1,
          sentimiento: session.sentimiento
        }
      });
    }

    session.estado = "CERRADA";
  }

  return { session, mensajesACliente, eventos };
}

module.exports = { procesarMensajeSupportAI };
