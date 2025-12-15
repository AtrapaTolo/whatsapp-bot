// sessions.js

// Mapa en memoria por ahora (para piloto)
const sessions = new Map();

/**
 * Devuelve la sesión activa para un teléfono (si existe).
 * Asumo 1 conversación activa por teléfono a la vez.
 */
function getSessionByPhone(telefono) {
  const all = Array.from(sessions.values());
  return (
    all.find(
      (s) => s.telefono === telefono && s.estado !== 'CERRADA'
    ) || null
  );
}

/**
 * Crea una sesión nueva (p.ej. cuando disparamos la encuesta desde /nps/start)
 */
function createSession({ telefono, order_id = null, cliente_id = null }) {
  const id = `${telefono}:${order_id || Date.now()}`;
  const now = new Date().toISOString();

  const session = {
    id,
    telefono,
    order_id,
    cliente_id,
    estado: 'ESPERANDO_RESPUESTA_INICIAL',
    incidencia: null,
    ticket_escalado: null,
    cliente_contacta: null,
    nps_score: null,
    comentarios: '',
    sentimiento: null,
    conversacionIdNps: null,
    historia: [], // { de: 'cliente'|'bot', texto, fecha }
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(id, session);
  return session;
}

function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
}

function deleteSession(id) {
  sessions.delete(id);
}

module.exports = {
  getSessionByPhone,
  createSession,
  saveSession,
  deleteSession,
};
