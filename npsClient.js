// npsClient.js
const fetch = require('node-fetch'); // npm install node-fetch@2

const NPS_BASE_URL = process.env.NPS_BASE_URL; // p.ej. https://nps-service.onrender.com

if (!NPS_BASE_URL) {
  console.warn(
    '[NPS] Ojo: NPS_BASE_URL no está definido. No se enviarán respuestas reales.'
  );
}

async function enviarRespuestaEncuesta(payload) {
  if (!NPS_BASE_URL) {
    console.log('[NPS] (SIMULADO) Envío de respuesta de encuesta:', payload);
    return;
  }

  try {
    const res = await fetch(`${NPS_BASE_URL}/encuestas/respuestas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        '[NPS] Error al enviar respuesta',
        res.status,
        text
      );
    } else {
      console.log('[NPS] Respuesta de encuesta enviada OK');
    }
  } catch (err) {
    console.error('[NPS] Error llamando al microservicio NPS', err);
  }
}

module.exports = { enviarRespuestaEncuesta };
