// app.js

const express = require('express');
const fetch = require('node-fetch'); // para llamar a la API de WhatsApp si no la tienes ya
const {
  getSessionByPhone,
  createSession,
  saveSession,
  deleteSession,
} = require('./sessions');
const { procesarMensaje, addToHistory } = require('./conversationLogic');
const { enviarRespuestaEncuesta } = require('./npsClient');
const { enviarEmailIncidencia } = require('./emailClient');
const { descargarYGuardarMedia, MEDIA_STORAGE_PATH } = require('./mediaService');
const { transcribirAudioWhisper } = require('./sttClient');

// 1. App Express
const app = express();
const PORT = process.env.PORT || 4000;

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_de_pruebas';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID; // 789116377618444

app.use(express.json());
// Servir ficheros estáticos de media
app.use('/media', express.static(MEDIA_STORAGE_PATH));

// 2. Ping
app.get('/ping', (req, res) => {
  res.json({ mensaje: 'pong desde whatsapp-bot' });
});

// Endpoint de debug para probar la conexión con el microservicio NPS
app.post('/debug/test-nps', async (req, res) => {
  try {
    console.log('[/debug/test-nps] Payload recibido:', req.body);

    const respuesta = await enviarRespuestaEncuesta(req.body);

    return res.json({
      ok: true,
      detalle: 'Llamada (o simulación) al NPS realizada. Revisa los logs del bot y del NPS.',
    });
  } catch (err) {
    console.error('[/debug/test-nps] Error llamando al NPS:', err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
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

    if (!message) {
      return;
    }

    const from = message.from; // teléfono del cliente
    let textoCliente = '';
    let esTexto = false;

    // 1) Mensajes de texto (flujo normal de IA)
    if (message.type === 'text') {
      esTexto = true;
      textoCliente = message.text?.body || '';
      console.log(`👤 Mensaje de ${from}: ${textoCliente}`);

    // 2) Imagen: la descargamos, guardamos y además usamos el caption como texto para la IA
    } else if (message.type === 'image') {
      console.log(`👤 Imagen recibida de ${from}`);

      let session = getSessionByPhone(from);
      if (!session) {
        console.warn(
          `[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`
        );
        session = createSession({ telefono: from });
      }

      const caption = message.image?.caption || '(Imagen sin texto)';
      const mediaId = message.image?.id || null;

      // 2.1) Descargar y guardar la imagen en tu entorno
      let publicUrl = null;
      if (mediaId) {
        publicUrl = await descargarYGuardarMedia({
          mediaId,
          phone: from,
          tipo: 'image',
        });
      }

      // 2.2) Guardar en el historial la imagen con su URL
      addToHistory(session, 'cliente', caption, {
        tipo: 'imagen',
        url: publicUrl || (mediaId ? `media_id:${mediaId}` : null),
        caption,
      });

      saveSession(session);

      // 2.3) Usar el caption como texto para la IA
      esTexto = true;
      textoCliente = caption;
      console.log(`👤 (caption imagen tratado como texto): ${textoCliente}`);

    // 3) AUDIO: guardamos audio + transcribimos con Whisper y usamos la transcripción
    } else if (message.type === 'audio') {
      console.log(`👤 Audio recibido de ${from}`);

      let session = getSessionByPhone(from);
      if (!session) {
        console.warn(
          `[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`
        );
        session = createSession({ telefono: from });
      }

      const mediaId = message.audio?.id || null;

      let publicUrl = null;
      let filePath = null;

      if (mediaId) {
        const mediaResult = await descargarYGuardarMedia({
          mediaId,
          phone: from,
          tipo: 'audio',
        });
        if (mediaResult) {
          publicUrl = mediaResult.publicUrl || null;
          filePath = mediaResult.filePath || null;
        }
      }

      let transcripcion = null;
      if (filePath) {
        try {
          transcripcion = await transcribirAudioWhisper(filePath);
          console.log('[STT] Transcripción de audio:', transcripcion);
        } catch (e) {
          console.error('[STT] Error transcribiendo audio con Whisper', e);
        }
      }

      const textoParaHistorial =
        transcripcion || '(Audio recibido pero no se pudo transcribir)';

      addToHistory(session, 'cliente', textoParaHistorial, {
        tipo: 'audio',
        url: publicUrl || (mediaId ? `media_id:${mediaId}` : null),
        transcripcion,
      });

      saveSession(session);

      if (transcripcion) {
        // 👉 usamos la transcripción como texto para la IA
        esTexto = true;
        textoCliente = transcripcion;
      } else {
        // si no hay texto, no seguimos con la máquina de estados
        return;
      }

    // 4) Otros tipos de mensaje: de momento los ignoramos
    } else {
      console.log(`Mensaje de tipo no manejado: ${message.type}`);
      return;
    }

    // 👇 A partir de aquí SOLO entramos si es texto (esTexto = true)

    // Buscar sesión existente
    let session = getSessionByPhone(from);

    if (!session) {
      console.warn(
        `[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`
      );
      session = createSession({ telefono: from });
    }

    if (!esTexto) {
      // Por seguridad; realmente a estas alturas siempre es true
      return;
    }

    const {
      session: updatedSession,
      mensajesACliente,
      eventos,
    } = await procesarMensaje(session, textoCliente);

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
