// npsClient.js
const fetch = require('node-fetch'); // npm install node-fetch@2

// p.ej. https://encuestas-nps-xxxxx.onrender.com
const NPS_BASE_URL = process.env.NPS_BASE_URL;

// Clave para llamar al microservicio NPS.
// Preferimos NPS_API_KEY, pero si no existe usamos API_KEY (la que ya tienes).
const NPS_API_KEY = process.env.NPS_API_KEY || process.env.API_KEY;

if (!NPS_BASE_URL) {
  console.warn(
    '[NPS] Ojo: NPS_BASE_URL no está definido. No se enviarán respuestas reales.'
  );
}

if (!NPS_API_KEY) {
  console.warn(
    '[NPS] Ojo: NPS_API_KEY/API_KEY no está definido. Las llamadas al NPS fallarán con 401.'
  );
}

async function enviarRespuestaEncuesta(payload) {
  if (!NPS_BASE_URL) {
    console.log('[NPS] (SIMULADO) Envío de respuesta de encuesta:', payload);
    return;
  }

  try {
    console.log(
      '[NPS] Enviando respuesta de encuesta a:',
      `${NPS_BASE_URL}/encuestas/respuestas`
    );

    const res = await fetch(`${NPS_BASE_URL}/encuestas/respuestas`, {
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

module.exports = { enviarRespuestaEncuesta };
