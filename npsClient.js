// npsClient.js
const fetch = require('node-fetch'); // npm install node-fetch@2

// p.ej. https://tolmut.onrender.com
const NPS_BASE_URL = process.env.NPS_BASE_URL;

// Clave para llamar al microservicio NPS.
// Preferimos NPS_API_KEY, pero si no existe usamos API_KEY (la que ya tienes).
const NPS_API_KEY = process.env.NPS_API_KEY || process.env.API_KEY;

if (!NPS_BASE_URL) {
  console.warn(
    '[NPS] Ojo: NPS_BASE_URL no está definido. No se enviarán llamadas reales.'
  );
}

if (!NPS_API_KEY) {
  console.warn(
    '[NPS] Ojo: NPS_API_KEY/API_KEY no está definido. Las llamadas al NPS fallarán con 401.'
  );
}

/**
 * 🔹 Enviar respuesta de encuesta (lo que ya tenías)
 * POST /encuestas/respuestas
 */
async function enviarRespuestaEncuesta(payload) {
  if (!NPS_BASE_URL) {
    console.log('[NPS] (SIMULADO) Envío de respuesta de encuesta:', payload);
    return;
  }

  try {
    const url = `${NPS_BASE_URL}/encuestas/respuestas`;
    console.log('[NPS] Enviando respuesta de encuesta a:', url);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NPS_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[NPS] Error al enviar respuesta', res.status, text);
    } else {
      console.log('[NPS] Respuesta de encuesta enviada OK. Respuesta:', text);
    }
  } catch (err) {
    console.error('[NPS] Error llamando al microservicio NPS', err);
  }
}

/**
 * 🔹 Crear conversación
 * POST /conversaciones
 * body: { telefono, order_id }
 */
async function crearConversacion({ telefono, order_id = null }) {
  if (!NPS_BASE_URL || !NPS_API_KEY) {
    console.log('[NPS] (SIMULADO) crearConversacion', { telefono, order_id });
    // devolvemos algo coherente para que el código que llame no reviente
    return { id: null, telefono, order_id };
  }

  const url = `${NPS_BASE_URL}/conversaciones`;

  try {
    console.log('[NPS] Creando conversación en:', url, 'payload:', {
      telefono,
      order_id,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NPS_API_KEY,
      },
      body: JSON.stringify({ telefono, order_id }),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[NPS] Error al crear conversación', res.status, text);
      throw new Error(`Error NPS crearConversacion: ${res.status}`);
    }

    const data = JSON.parse(text);
    console.log('[NPS] Conversación creada OK:', data);
    return data; // { id, telefono, order_id, creado_en }
  } catch (err) {
    console.error('[NPS] Error creando conversación', err);
    throw err;
  }
}

/**
 * 🔹 Registrar mensaje en una conversación
 * POST /conversaciones/:id/mensajes
 * body: { direction, author, tipo, texto, media_url }
 */
async function registrarMensaje({
  conversacionId,
  direction,   // 'in' | 'out'
  author,      // 'cliente' | 'bot' | 'agente'
  tipo,        // 'text' | 'audio' | 'image' | ...
  texto = null,
  mediaUrl = null,
}) {
  if (!NPS_BASE_URL || !NPS_API_KEY) {
    console.log('[NPS] (SIMULADO) registrarMensaje', {
      conversacionId,
      direction,
      author,
      tipo,
      texto,
      mediaUrl,
    });
    return;
  }

  const url = `${NPS_BASE_URL}/conversaciones/${conversacionId}/mensajes`;

  try {
    console.log('[NPS] Registrando mensaje en:', url);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NPS_API_KEY,
      },
      body: JSON.stringify({
        direction,
        author,
        tipo,
        texto,
        media_url: mediaUrl, // la API espera "media_url"
      }),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[NPS] Error al registrar mensaje', res.status, text);
      throw new Error(`Error NPS registrarMensaje: ${res.status}`);
    }

    const data = JSON.parse(text);
    console.log('[NPS] Mensaje registrado OK:', data);
    return data; // { id, conversacion_id, ... }
  } catch (err) {
    console.error('[NPS] Error registrando mensaje', err);
    throw err;
  }
}

/**
 * 🔹 Actualizar conversación (NPS final, incidencia, sentimiento, comentario)
 * PATCH /conversaciones/:id
 */
async function actualizarConversacion({
  id,
  tuvo_incidencia = null,   // 0 | 1 | null
  sentimiento = null,        // 'muy_negativo' | 'negativo' | 'neutro' | ...
  nps_score = null,          // 0-10
  nps_comment = null,        // texto libre
}) {
  if (!NPS_BASE_URL || !NPS_API_KEY) {
    console.log('[NPS] (SIMULADO) actualizarConversacion', {
      id,
      tuvo_incidencia,
      sentimiento,
      nps_score,
      nps_comment,
    });
    return;
  }

  const url = `${NPS_BASE_URL}/conversaciones/${id}`;

  try {
    console.log('[NPS] Actualizando conversación en:', url);

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NPS_API_KEY,
      },
      body: JSON.stringify({
        tuvo_incidencia,
        sentimiento,
        nps_score,
        nps_comment,
      }),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[NPS] Error al actualizar conversación', res.status, text);
      throw new Error(`Error NPS actualizarConversacion: ${res.status}`);
    }

    const data = JSON.parse(text || '{}');
    console.log('[NPS] Conversación actualizada OK:', data);
    return data;
  } catch (err) {
    console.error('[NPS] Error actualizando conversación', err);
    throw err;
  }
}

module.exports = {
  enviarRespuestaEncuesta,
  crearConversacion,
  registrarMensaje,
  actualizarConversacion,
};
