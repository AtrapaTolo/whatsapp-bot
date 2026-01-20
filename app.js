// app.js

const express = require('express');
const fetch = require('node-fetch'); // para llamar a la API de WhatsApp si no la tienes ya
const {
  getSessionByPhone,
  getLastSessionByPhone,
  createSession,
  saveSession,
  deleteSession,
} = require('./sessions');

const { procesarMensaje, addToHistory } = require('./conversationLogic');
const {
  enviarRespuestaEncuesta,
  crearConversacion,
  registrarMensaje,
  actualizarConversacion,
} = require('./npsClient');

const { enviarEmailIncidencia } = require('./emailClient');
const { descargarYGuardarMedia, MEDIA_STORAGE_PATH } = require('./mediaService');
const { transcribirAudioWhisper } = require('./sttClient');

const { procesarMensajeAI } = require('./conversationLogicAI');
const AI_FLOW_MODE = (process.env.AI_FLOW_MODE || 'off').toLowerCase();
// 'off' | 'shadow' | 'on'
const { procesarMensajeSupportAI } = require('./conversationLogicSupportAI');

// 1. App Express
const app = express();
const PORT = process.env.PORT || 4000;

// Mapa teléfono -> conversacionId (solo en memoria, para empezar)
const conversacionesActivas = {};

const PING_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function normalizeSimple(s = '') {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function esPingNoAccionable(texto = '') {
  const t = normalizeSimple(texto);

  // números: NUNCA ping (sirven para NPS o opciones)
  if (/^\s*(10|[0-9])\s*$/.test(t)) return false;

  // vacío
  if (!t) return true;

  // pings típicos (solo estos)
  const set = new Set([
    'ok', 'okay', 'okey', 'vale', 'perfecto', 'genial', 'de acuerdo',
    'gracias', 'muchas gracias', 'graciass', 'ok gracias'
  ]);

  if (set.has(t)) return true;

  // variantes con signos
  if (/^(ok+|vale+|gracias+)[.!?]*$/.test(t)) return true;

  return false;
}

function sentimientoPorNps(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;

  if (n <= 2) return "muy_negativo";
  if (n <= 4) return "negativo";
  if (n <= 6) return "neutro";
  if (n <= 8) return "positivo";
  return "muy_positivo"; // 9-10
}

function asegurarFlagsSoporte(session) {
  if (!session) return;
  if (session.ya_derivada_soporte === undefined) session.ya_derivada_soporte = false;
  if (!session.tipo) session.tipo = 'encuesta'; // por compatibilidad con sesiones viejas
}

function activarModoSoporte(session) {
  asegurarFlagsSoporte(session);
  session.ya_derivada_soporte = true;
  session.tipo = 'soporte';
}

function resumenParaTicket(session, textoCliente) {
  const order = session.order_id ? `Pedido: ${session.order_id}` : 'Pedido: (no informado)';
  return `[WhatsApp soporte] ${order}\nTel: ${session.telefono || 'n/a'}\n\nÚltimo mensaje cliente:\n${textoCliente}`;
}

// Fallback soporte cuando la IA falla
async function procesarMensajeSupportFallback(session, textoCliente, err) {
  asegurarFlagsSoporte(session);

  // En soporte, forzamos incidencia (si ha entrado aquí es porque estamos derivando o ya derivado)
  session.incidencia = true;
  activarModoSoporte(session);

  const mensajesACliente = [];
  const eventos = [];

  // 1) Mensaje al cliente (sin IA)
  mensajesACliente.push(
    'Gracias por avisarnos. Hemos derivado tu caso a soporte para ayudarte cuanto antes ✅'
  );

  // Pedimos info mínima
  if (!session.order_id) {
    mensajesACliente.push('¿Me indicas el número de pedido, por favor?');
  } else {
    mensajesACliente.push(
      'Para tramitarlo, envíanos una foto del daño (si aplica) y dinos qué pieza falta o qué ha llegado mal 📸'
    );
  }

  // 2) Creamos ticket SOLO una vez
  if (!session.ticket_creado) {
    eventos.push({
      tipo: 'CREAR_TICKET',
      payload: {
        telefono: session.telefono,
        order_id: session.order_id || null,
        cliente_id: session.cliente_id || null,
        resumen: resumenParaTicket(session, textoCliente),
        motivo: 'Incidencia detectada (fallback IA)',
        error: err?.message || String(err || ''),
      },
    });
    session.ticket_creado = true;
  }

  // 3) Forzamos update en NPS para que quede DERIVADA_SOPORTE
  if (session.conversacionIdNps) {
    eventos.push({
      tipo: 'ACTUALIZAR_CONVERSACION_NPS',
      payload: {
        conversacionId: session.conversacionIdNps,
        tuvo_incidencia: 1,
        estado: 'DERIVADA_SOPORTE',
      },
    });
  }

  return { session, mensajesACliente, eventos };
}

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_de_pruebas';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID; // 789116377618444

const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es_ES';

app.use(express.json());
// Servir ficheros estáticos de media
app.use('/media', express.static(MEDIA_STORAGE_PATH));

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
    console.error('[WhatsApp] Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID');
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

// 4bis. Función para enviar mensajes de plantilla por WhatsApp
async function sendWhatsAppTemplateMessage(to, templateName, components) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error('[WhatsApp] Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID');
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: TEMPLATE_LANG },
      components,
    },
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
    console.log('📤 Respuesta envío WhatsApp (template):', JSON.stringify(data));
  } catch (err) {
    console.error('[WhatsApp] Error enviando mensaje de plantilla', err);
    throw err;
  }
}

// 5. Endpoint para que el microservicio NPS dispare la encuesta (Estado 0)
app.post('/nps/start', async (req, res) => {
  try {
    const { telefono, order_id, cliente_id, nombre } = req.body;

    if (!telefono || !order_id) {
      return res.status(400).json({ error: 'telefono y order_id son obligatorios' });
    }

    const session = createSession({ telefono, order_id, cliente_id });

    const templateName = process.env.WHATSAPP_TEMPLATE_NPS || 'valorar_experiencia_compra';

    const components = [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            parameter_name: 'customer_name',
            text: nombre || '',
          },
          {
            type: 'text',
            parameter_name: 'order_id',
            text: order_id,
          },
        ],
      },
    ];

    console.log('[NPS] Enviando plantilla NPS', { telefono, templateName, components });

    await sendWhatsAppTemplateMessage(telefono, templateName, components);

    return res.json({ ok: true, session_id: session.id });
  } catch (err) {
    console.error('[NPS] Error en /nps/start:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Error interno en /nps/start',
    });
  }
});

// 6. Webhook de mensajes de WhatsApp (POST)
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('📩 Mensaje recibido en /webhook/whatsapp');
  res.sendStatus(200); // Respondemos rápido a Meta

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from; // teléfono del cliente
    let textoCliente = '';
    let esTexto = false;
    let tipoMensajeNps = message.type; // 'text', 'image', 'audio', etc.
    let mediaUrlParaNps = null;
    let conversacionId = conversacionesActivas[from] || null;

    // 1) Texto
    if (message.type === 'text') {
      esTexto = true;
      textoCliente = message.text?.body || '';
      console.log(`👤 Mensaje de ${from}: ${textoCliente}`);
      mediaUrlParaNps = null;

      // 2) Imagen
    } else if (message.type === 'image') {
      console.log(`👤 Imagen recibida de ${from}`);

      let session = getSessionByPhone(from);
      if (!session) {
        console.warn(`[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`);
        session = createSession({ telefono: from });
      }

      const caption = message.image?.caption || '(Imagen sin texto)';
      const mediaId = message.image?.id || null;

      let publicUrl = null;
      if (mediaId) {
        publicUrl = await descargarYGuardarMedia({
          mediaId,
          phone: from,
          tipo: 'image',
        });
      }

      addToHistory(session, 'cliente', caption, {
        tipo: 'imagen',
        url: publicUrl || (mediaId ? `media_id:${mediaId}` : null),
        caption,
      });

      saveSession(session);

      esTexto = true;
      textoCliente = caption;
      console.log(`👤 (caption imagen tratado como texto): ${textoCliente}`);

      mediaUrlParaNps = publicUrl || (mediaId ? `media_id:${mediaId}` : null);

      // 3) Audio
    } else if (message.type === 'audio') {
      console.log(`👤 Audio recibido de ${from}`);

      let session = getSessionByPhone(from);
      if (!session) {
        console.warn(`[SESIONES] No había sesión para ${from}, creando una sesión huérfana (sin order_id).`);
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

      const textoParaHistorial = transcripcion || '(Audio recibido pero no se pudo transcribir)';

      addToHistory(session, 'cliente', textoParaHistorial, {
        tipo: 'audio',
        url: publicUrl || (mediaId ? `media_id:${mediaId}` : null),
        transcripcion,
      });

      saveSession(session);

      if (transcripcion) {
        esTexto = true;
        textoCliente = transcripcion;
      } else {
        return;
      }

      mediaUrlParaNps = publicUrl || (mediaId ? `media_id:${mediaId}` : null);

      // 4) Otros
    } else {
      console.log(`Mensaje de tipo no manejado: ${message.type}`);
      return;
    }

    // A partir de aquí SOLO si es texto (esTexto = true)
    if (!esTexto) return;

    // Buscar sesión existente
    let session = getSessionByPhone(from);

    // Si NO hay sesión activa, miramos la última cerrada para decidir post-encuesta
    if (!session) {
      const last = getLastSessionByPhone(from);

      const days30 = 30 * 24 * 60 * 60 * 1000;
      const lastClosedAt = last?.closedAt ? Date.parse(last.closedAt) : null;
      const isRecentClosed =
        last && last.estado === 'CERRADA' && lastClosedAt && (Date.now() - lastClosedAt) < days30;

      // ✅ Si es “ping” tras encuesta cerrada reciente: responde 1 vez cada 24h y corta SIN crear sesión nueva
      if (isRecentClosed && esPingNoAccionable(textoCliente)) {
        const lastPingAt = last?.lastAutoReplyAt ? Date.parse(last.lastAutoReplyAt) : null;
        const canReply = !lastPingAt || (Date.now() - lastPingAt) > PING_COOLDOWN_MS;

        if (canReply) {
          await sendWhatsAppTextMessage(
            from,
            '¡Perfecto! 😊 Si te surge cualquier incidencia con tu pedido (montaje, piezas, daños, etc.), escríbenos por aquí y lo pasamos a atención al cliente 💙'
          );

          last.lastAutoReplyAt = new Date().toISOString();
          saveSession(last);
        }

        return;
      }

      if (isRecentClosed) {
        // 👉 MODO SOPORTE (post-encuesta)
        session = createSession({
          telefono: from,
          order_id: last.order_id || null,
          cliente_id: last.cliente_id || null,
        });
        session.tipo = 'post_encuesta';
        session.estado = 'POST_ENCUESTA_ROUTER';

        // arrastra conversacionIdNps anterior si lo tienes
        if (last?.conversacionIdNps) {
          session.conversacionIdNps = last.conversacionIdNps;
          conversacionesActivas[from] = last.conversacionIdNps; // así NO crea conversación nueva
          conversacionId = last.conversacionIdNps;
        }
      } else {
        // 👉 Sesión normal (si no hay histórico)
        session = createSession({ telefono: from });
      }
    }

    // ✅ Anti-spam pings (si ya existe sesión post-encuesta activa)
    const esPostEncuesta =
      session.tipo === 'post_encuesta' ||
      session.estado === 'POST_ENCUESTA_ROUTER' ||
      session.tipo === 'soporte' ||
      session.ya_derivada_soporte === true ||
      session.incidencia === true;

    if (esPostEncuesta && esPingNoAccionable(textoCliente)) {
      const lastPingAt = session.lastAutoReplyAt ? Date.parse(session.lastAutoReplyAt) : null;
      const canReply = !lastPingAt || (Date.now() - lastPingAt) > PING_COOLDOWN_MS;

      if (canReply) {
        await sendWhatsAppTextMessage(
          from,
          '¡Perfecto! 😊 Si te surge cualquier incidencia con tu pedido (montaje, piezas, daños, etc.), escríbenos por aquí y lo pasamos a atención al cliente 💙'
        );
        session.lastAutoReplyAt = new Date().toISOString();
        saveSession(session);
      }

      return;
    }

    // 🔹 Asegurar conversación en el microservicio NPS
    if (!conversacionId) {
      try {
        const conv = await crearConversacion({
          telefono: from,
          order_id: session.order_id || null,
        });
        conversacionId = conv.id;
        conversacionesActivas[from] = conversacionId;
        console.log('[NPS] Conversación NPS creada para', from, '-> id', conversacionId);

        session.conversacionIdNps = conversacionId;
        saveSession(session);
      } catch (e) {
        console.error('[NPS] Error creando conversación para', from, e);
      }
    } else {
      session.conversacionIdNps = conversacionId;
      saveSession(session);
    }

    // 🔹 Registrar mensaje entrante del cliente en NPS
    if (conversacionId) {
      try {
        await registrarMensaje({
          conversacionId,
          direction: 'in',
          author: 'cliente',
          tipo: tipoMensajeNps,
          texto: textoCliente,
          mediaUrl: mediaUrlParaNps,
        });
      } catch (e) {
        console.error('[NPS] Error registrando mensaje entrante', e);
      }
    }

    let result;

    asegurarFlagsSoporte(session);

    // ✅ Modo soporte si:
    // - es post encuesta (tu caso actual)
    // - o ya está derivada a soporte
    // - o ya hay incidencia marcada
    // - o ya la marcaste como tipo soporte
    const esModoSoporte =
      session.tipo === 'post_encuesta' ||
      session.tipo === 'soporte' ||
      session.ya_derivada_soporte === true ||
      session.incidencia === true;

    if (esModoSoporte) {
      try {
        result = await procesarMensajeSupportAI(session, textoCliente);
      } catch (e) {
        console.error('[SUPPORT_AI] Error, usando fallback:', e?.message || e);
        result = await procesarMensajeSupportFallback(session, textoCliente, e);
      }
    } else {
      // Flujo normal (encuesta)
      if (AI_FLOW_MODE === 'on') {
        result = await procesarMensajeAI(session, textoCliente);
      } else if (AI_FLOW_MODE === 'shadow') {
        const classic = await procesarMensaje(session, textoCliente);
        procesarMensajeAI(session, textoCliente)
          .then((ai) =>
            console.log('[AI_FLOW][SHADOW]', { ai_estado: ai.session?.estado, ai_reply: ai.mensajesACliente })
          )
          .catch((e) => console.warn('[AI_FLOW][SHADOW] error', e?.message || e));
        result = classic;
      } else {
        result = await procesarMensaje(session, textoCliente);
      }
    }

    const { session: updatedSession, mensajesACliente, eventos } = result;

    asegurarFlagsSoporte(updatedSession);

    // ✅ Si se detecta incidencia por primera vez -> derivar a soporte
    let acabaDeDerivar = false;
    if (updatedSession.incidencia === true && updatedSession.ya_derivada_soporte !== true) {
      activarModoSoporte(updatedSession);
      acabaDeDerivar = true;
    }

    // Guardar sesión actualizada
    saveSession(updatedSession);

    // ✅ (Opcional MUY recomendado) Actualización inmediata en BD al derivar
    // Así la conversación NPS queda DERIVADA_SOPORTE aunque todavía no haya "CERRADO" la sesión.
    if (acabaDeDerivar && updatedSession.conversacionIdNps) {
      try {
        await actualizarConversacion({
          id: updatedSession.conversacionIdNps,
          tuvo_incidencia: 1,
          sentimiento: updatedSession.sentimiento ?? null,
          estado: 'DERIVADA_SOPORTE',
        });
      } catch (e) {
        console.error('[NPS] Error marcando DERIVADA_SOPORTE al derivar', e);
      }
    }

    // Responder al cliente
    for (const msg of mensajesACliente) {
      await sendWhatsAppTextMessage(from, msg);

      // 🔹 Registrar mensaje SALIENTE del bot en NPS
      if (conversacionId) {
        try {
          await registrarMensaje({
            conversacionId,
            direction: 'out',
            author: 'bot',
            tipo: 'text',
            texto: msg,
            mediaUrl: null,
          });
        } catch (e) {
          console.error('[NPS] Error registrando mensaje saliente', e);
        }
      }
    }

    // Ejecutar acciones técnicas
    for (const ev of eventos) {
      if (ev.tipo === 'CREAR_TICKET') {
        await enviarEmailIncidencia(ev.payload);
        continue;
      }

      if (ev.tipo === 'ACTUALIZAR_CONVERSACION_NPS') {
        if (ev.payload?.conversacionId) {
          const sentimientoFinal =
            ev.payload.sentimiento ?? sentimientoPorNps(ev.payload.nps_score);

          // ✅ Regla: si hay incidencia, SIEMPRE DERIVADA_SOPORTE
          // Si no hay incidencia y la sesión está cerrada, marcamos CERRADA
          const estadoForzado = (updatedSession.incidencia === true)
            ? 'DERIVADA_SOPORTE'
            : (updatedSession.estado === 'CERRADA' ? 'CERRADA' : undefined);

          const payload = {
            id: ev.payload.conversacionId,
            tuvo_incidencia:
              typeof ev.payload.tuvo_incidencia === 'boolean'
                ? (ev.payload.tuvo_incidencia ? 1 : 0)
                : ev.payload.tuvo_incidencia,
            sentimiento: sentimientoFinal,
          };

          if (ev.payload.nps_score !== undefined) payload.nps_score = ev.payload.nps_score;
          if (ev.payload.nps_comment !== undefined) payload.nps_comment = ev.payload.nps_comment;

          if (estadoForzado) payload.estado = estadoForzado; // ✅ aquí el “SIEMPRE”

          await actualizarConversacion(payload);
        }
        continue;
      }
    }

    if (updatedSession.estado === 'CERRADA') {
      updatedSession.closedAt = new Date().toISOString();
      saveSession(updatedSession);
      // NO deleteSession aquí
    }
  } catch (err) {
    console.error('Error procesando mensaje de WhatsApp', err);
  }
});

// Endpoint de debug para probar la conexión con el microservicio NPS
app.post('/debug/test-nps', async (req, res) => {
  try {
    const { telefono, order_id = null, tuvo_incidencia, sentimiento, nps_score, nps_comment } = req.body;

    if (!telefono) return res.status(400).json({ ok: false, error: 'telefono es obligatorio' });

    const conv = await crearConversacion({ telefono, order_id });

    await actualizarConversacion({
      id: conv.id,
      tuvo_incidencia,
      sentimiento,
      nps_score,
      nps_comment,
    });

    return res.json({ ok: true, convId: conv.id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Arranque
app.listen(PORT, () => {
  console.log(`whatsapp-bot escuchando en el puerto ${PORT}`);
});
