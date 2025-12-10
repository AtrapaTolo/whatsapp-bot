// npsClient.js
const fetch = require('node-fetch'); // npm install node-fetch@2

// p.ej. http://localhost:3000 en local
// o https://encuestas-nps-xxxxx.onrender.com en Render
const NPS_BASE_URL = process.env.NPS_BASE_URL;
const NPS_API_KEY  = process.env.NPS_API_KEY; // MISMA que API_KEY del microservicio NPS

if (!NPS_BASE_URL) {
  console.warn(
    '[NPS] Ojo: NPS_BASE_URL no está definido. No se enviarán respuestas reales.'
  );
}

if (!NPS_API_KEY) {
  console.warn(
    '[NPS] Ojo: NPS_API_KEY no está definido. Las llamadas reales fallarán con 401.'
  );
}

async function enviarRespuestaEncuesta(payload) {
  if (!NPS_BASE_URL) {
    console.log('[NPS] (SIMULADO) Envío de respuesta de encuesta:', payload);
    return;
  }

  try {
    console.log('[NPS] Enviando respuesta de encuesta a:', `${NPS_BASE_URL}/encuestas/respuestas`);

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
      console.error(
        '[NPS] Error al enviar respuesta',
        res.status,
        text
      );
    } else {
      console.log('[NPS] Respuesta de encuesta enviada OK. Respuesta:', text);
    }
  } catch (err) {
    console.error('[NPS] Error llamando al microservicio NPS', err);
  }
}

module.exports = { enviarRespuestaEncuesta };
