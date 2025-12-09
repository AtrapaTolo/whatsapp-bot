// app.js

const express = require('express');
const fetch = require('node-fetch'); // para llamar a la API de WhatsApp si no la tienes ya
const {
  getSessionByPhone,
  createSession,
  saveSession,
  deleteSession,
} = require('./sessions');
const { procesarMensaje } = require('./conversationLogic');
const { enviarRespuestaEncuesta } = require('./npsClient');
const { enviarEmailIncidencia } = require('./emailClient');

// 1. App Express
const app = express();
const PORT = process.env.PORT || 4000;

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_de_pruebas';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID; // 789116377618444

app.use(express.json());

// 2. Ping
app.get('/ping', (req, res) => {
  res.json({ mensaje: 'pong desde whatsapp-bot' });
});

// 3. Verificación Webhook (GET)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook de WhatsApp verificado correctamente ✅');
    return res.status(200).send(challenge);
  }

  console.warn('Fallo en la verificación del webhook de WhatsApp ❌');
  res.sendStatus(403);
});

// 4. Función para enviar mensajes de texto por WhatsApp
async function sendWhatsAppTextMessage(to, body) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error(
      '[WhatsApp] Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID'
    );
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('📤 Respuesta envío WhatsApp:', JSON.stringify(data));
  } catch (err) {
    console.error('[WhatsApp] Error enviando mensaje', err);
  }
}

// 5. Endpoint para que el microservicio NPS dispare la encuesta (Estado 0)
app.post('/nps/start', async (req, res) => {
  const { telefono, order_id, cliente_id, nombre } = req.body;

  if (!telefono || !order_id) {
    return res
      .status(400)
      .json({ error: 'telefono y order_id son obligatorios' });
  }

  const session = createSession({ telefono, order_id, cliente_id });

  const saludoNombre = nombre ? ` ${nombre}` : '';
  const textoInicial =
    `Hola${saludoNombre} 👋\n` +
    'Hemos visto que hace unos días recibiste tu pedido de Atrapamuebles.\n' +
    '¿Te animas a contarnos qué tal? ¡Queremos saberlo todo sobre tu experiencia de compra! 🛋️';

  await sendWhatsAppTextMessage(telefono, textoInicial);

  return res.json({ ok: true, session_id: session.id });
});

// 6. Webhook de mensajes de WhatsApp (POST)
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('📩 Mensaje recibido en /webhook/whatsapp');
  res.sendStatus(200); // Respondemos rápido a Meta

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') {
      return;
    }

    const from = message.from; // teléfono del cliente
    const text = message.text?.body || '';

    console.log(`👤 Mensaje de ${from}: ${text}`);

    // Buscar sesión existente
    let session = getSessionByPhone(from);

    if (!session) {
      console.warn(
        `[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`
      );
      session = createSession({ telefono: from });
    }

    const {
      session: updatedSession,
      mensajesACliente,
      eventos,
    } = await procesarMensaje(session, text);

    // Guardar sesión actualizada
    saveSession(updatedSession);

    // Responder al cliente
    for (const msg of mensajesACliente) {
      await sendWhatsAppTextMessage(from, msg);
    }

    // Ejecutar acciones técnicas (guardar encuesta, email ticket, etc.)
    for (const ev of eventos) {
      if (ev.tipo === 'GUARDAR_ENCUESTA') {
        await enviarRespuestaEncuesta(ev.payload);
      } else if (ev.tipo === 'CREAR_TICKET') {
        await enviarEmailIncidencia(ev.payload);
      }
    }

    // Si la conversación ha terminado, podemos limpiar la sesión
    if (updatedSession.estado === 'CERRADA') {
      deleteSession(updatedSession.id);
    }
  } catch (err) {
    console.error('Error procesando mensaje de WhatsApp', err);
  }
});

// 7. Arranque
app.listen(PORT, () => {
  console.log(`whatsapp-bot escuchando en el puerto ${PORT}`);
});
