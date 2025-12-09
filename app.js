// whatsapp-bot/app.js

// 1. Importamos express
const express = require('express');

// 2. Creamos la app
const app = express();

// 3. Puerto donde escucha el bot de WhatsApp
//    Lo separamos del otro microservicio para que no haya conflicto.
//    Por ejemplo, el otro usa 3000 y este usa 4000.
const PORT = process.env.PORT || 4000;

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_de_pruebas';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

async function sendWhatsAppTextMessage(to, text) {
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log('📤 Respuesta de envío:', JSON.stringify(data, null, 2));
}

// 4. Middleware para leer JSON en el cuerpo de las peticiones
app.use(express.json());

// 5. Endpoint de prueba
//    GET http://localhost:4000/ping
app.get('/ping', (req, res) => {
  res.json({ mensaje: 'pong desde whatsapp-bot' });
});

// Verificación del webhook de WhatsApp (Cloud API)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook de WhatsApp verificado correctamente');
    return res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación de webhook fallida');
    return res.sendStatus(403);
  }
});

// 6. Webhook de WhatsApp (todavía sin IA, solo para ver que llega algo)
//    POST http://localhost:4000/webhook/whatsapp
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('📩 Mensaje recibido en /webhook/whatsapp');
  console.log(JSON.stringify(req.body, null, 2));

  // Respondemos rápido a Meta para que no dé error
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log('No hay mensajes en el webhook.');
      return;
    }

    const from = message.from;                 // número del cliente
    const text = message.text?.body || '';     // texto que ha escrito

    console.log(`👤 Mensaje de ${from}: ${text}`);

    const replyText =
      `Hola 👋, soy el bot de Atrapamuebles.\n` +
      `Has escrito: "${text}"`;

    await sendWhatsAppTextMessage(from, replyText);
  } catch (err) {
    console.error('❌ Error procesando el webhook:', err);
  }
});

// 7. Arrancamos el servidor
app.listen(PORT, () => {
  console.log(`whatsapp-bot escuchando en el puerto ${PORT}`);
});
