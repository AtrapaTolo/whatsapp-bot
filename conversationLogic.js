// conversationLogic.js
const {
  clasificarIncidenciaTexto,
  extraerNotaNPS,
  clasificarOpcionTicket,
} = require('./aiClient');

function addToHistory(session, de, texto, extra = {}) {
  const {
    tipo = 'texto',       // 'texto' | 'imagen' | 'audio' | ...
    url = null,
    transcripcion = null,
    caption = null,
  } = extra;

  session.historia.push({
    de,                   // 'cliente' | 'bot'
    texto,
    tipo,
    url,
    transcripcion,
    caption,
    fecha: new Date().toISOString(),
  });
}

// 👉 AQUÍ volvemos a declarar construirPayloadEncuesta
function construirPayloadEncuesta(session) {
  return {
    pedido_id: session.order_id || null,
    cliente_id: session.cliente_id || null,
    tuvo_incidencia: session.incidencia ? 1 : 0,           
    satisfaccion: session.nps_score ?? null,                
    sentimiento: session.sentimiento || null,
    comentario: session.comentarios || null,
    canal: 'whatsapp',
  };
}

// 👉 construirPayloadEmail con el formato nuevo del asunto y del cuerpo
function construirPayloadEmail(session) {
  const rawOrderId = session.order_id || 'SINPEDIDO';

  // Si ya lleva PVAM, no lo repetimos
  const orderIdParaAsunto = rawOrderId.toString().toUpperCase().startsWith('PVAM')
    ? rawOrderId
    : `PVAM ${rawOrderId}`;

  const asunto = `Incidencia detectada por whatsapp - ${orderIdParaAsunto}`;

  const lineas = [];

  lineas.push('Hemos detectado una incidencia en la experiencia de compra de un cliente:');
  lineas.push('');
  lineas.push(`Pedido: ${session.order_id || 'No informado'}`);
  lineas.push(`Cliente ID: ${session.cliente_id || 'No informado'}`);
  lineas.push(`Teléfono: ${session.telefono || 'No informado'}`);

  if (session.sentimiento) {
    lineas.push(`Sentimiento detectado: ${session.sentimiento}`);
  }
  if (session.nps_score != null) {
    lineas.push(`NPS (si se ha informado): ${session.nps_score}`);
  }

  lineas.push('');
  lineas.push('Resumen / comentarios:');
  lineas.push(session.comentarios || '(sin comentarios)');
  lineas.push('');
  lineas.push('Transcripción completa:');

  session.historia.forEach((m) => {
    const fecha = m.fecha || '';
    const autor = m.de === 'cliente' ? 'Cliente' : 'Bot';
    const tipo = m.tipo || 'texto';

    if (tipo === 'texto') {
      lineas.push(`[${fecha}] ${autor}: ${m.texto}`);
    } else if (tipo === 'imagen') {
      lineas.push(`[${fecha}] ${autor}: Imagen recibida`);
      if (m.caption) {
        lineas.push(`   Pie de foto: ${m.caption}`);
      }
      if (m.url) {
        lineas.push(`   Referencia imagen: ${m.url}`);
      }
    } else if (tipo === 'audio') {
      lineas.push(`[${fecha}] ${autor}: Audio recibido`);
      if (m.transcripcion) {
        lineas.push(`   Transcripción: ${m.transcripcion}`);
      }
      if (m.url) {
        lineas.push(`   Referencia audio: ${m.url}`);
      }
    } else {
      lineas.push(`[${fecha}] ${autor}: Mensaje tipo ${tipo}`);
      if (m.texto) {
        lineas.push(`   Contenido: ${m.texto}`);
      }
    }
  });

  const cuerpo = lineas.join('\n');
  return { asunto, cuerpo };
}

/**
 * Procesa un mensaje entrante del cliente según el estado actual de la sesión.
 * Devuelve:
 *  - session: sesión actualizada
 *  - mensajesACliente: array de textos a enviar por WhatsApp
 *  - eventos: acciones técnicas (GUARDAR_ENCUESTA, CREAR_TICKET)
 */
async function procesarMensaje(session, textoCliente) {
  const mensajesACliente = [];
  const eventos = [];

  addToHistory(session, 'cliente', textoCliente);

  switch (session.estado) {
    case 'ESPERANDO_RESPUESTA_INICIAL':
    case undefined: {
      const clasif = await clasificarIncidenciaTexto(
        textoCliente,
        session.historia
      );
      session.sentimiento = clasif.sentimiento;
      if (clasif.resumen) {
        session.comentarios +=
          (session.comentarios ? '\n' : '') + clasif.resumen;
      }

      if (clasif.tipo === 'incidencia') {
        session.incidencia = true;
        mensajesACliente.push(
          '¡Vaya, sentimos mucho que hayas tenido este problema con tu pedido! 😔',
          'Para poder ayudarte mejor, ¿podrías contarnos un poco más sobre lo que ha pasado?'
        );
        session.estado = 'INCIDENCIA_DETALLE';
      } else if (clasif.tipo === 'no_incidencia') {
        session.incidencia = false;
        mensajesACliente.push(
          '¡Qué bien leer eso, nos alegra mucho! 🙌',
          'Para seguir mejorando, ¿del 1 al 10 cómo valorarías tu experiencia de compra con Atrapamuebles?',
          '(Siendo 1 muy mala y 10 excelente ⭐)'
        );
        session.estado = 'PEDIR_NPS_SCORE';
      } else {
        mensajesACliente.push(
          'Gracias por tu respuesta 😊',
          '¿Dirías que tu experiencia con el pedido de Atrapamuebles ha sido buena en general o has tenido alguna incidencia (retrasos, daños, piezas que faltan, etc.)?'
        );
        session.estado = 'ACLARAR_INCIDENCIA';
      }
      break;
    }

    case 'ACLARAR_INCIDENCIA': {
      const clasif2 = await clasificarIncidenciaTexto(
        textoCliente,
        session.historia
      );
      session.sentimiento = clasif2.sentimiento;
      session.comentarios +=
        (session.comentarios ? '\n' : '') + textoCliente;

      if (clasif2.tipo === 'incidencia') {
        session.incidencia = true;
        mensajesACliente.push(
          '¡Vaya, sentimos mucho que hayas tenido este problema con tu pedido! 😔',
          'Para poder ayudarte mejor, ¿podrías contarnos un poco más sobre lo que ha pasado?'
        );
        session.estado = 'INCIDENCIA_DETALLE';
      } else if (clasif2.tipo === 'no_incidencia') {
        session.incidencia = false;
        mensajesACliente.push(
          '¡Qué bien leer eso, nos alegra mucho! 🙌',
          'Para seguir mejorando, ¿del 1 al 10 cómo valorarías tu experiencia de compra con Atrapamuebles?',
          '(Siendo 1 muy mala y 10 excelente ⭐)'
        );
        session.estado = 'PEDIR_NPS_SCORE';
      } else {
        mensajesACliente.push(
          'Perdona, no me ha quedado del todo claro 🙈',
          '¿Nos podrías decir si has tenido alguna incidencia con tu pedido o si ha ido todo bien?'
        );
      }
      break;
    }

    case 'INCIDENCIA_DETALLE': {
      session.comentarios +=
        (session.comentarios ? '\n' : '') + textoCliente;

      mensajesACliente.push(
        'Gracias por la info 🙏',
        '¿Qué prefieres que hagamos ahora?',
        '1️⃣ Abrir un ticket con nuestro equipo de atención al cliente para que revisen tu caso.',
        '2️⃣ Prefiero contactar yo directamente con atención al cliente.',
        'Puedes contestar con “1” o “2” 😊'
      );
      session.estado = 'INCIDENCIA_OPCION_TICKET_O_CONTACTO';
      break;
    }

    case 'INCIDENCIA_OPCION_TICKET_O_CONTACTO': {
      const opcion = await clasificarOpcionTicket(textoCliente);

      if (opcion === 'abrir_ticket') {
        session.ticket_escalado = true;
        session.cliente_contacta = false;

        mensajesACliente.push(
          'Perfecto, abrimos un ticket con nuestro equipo de atención al cliente ✅',
          'Les pasaremos toda la información que nos has comentado para que puedan revisarlo.',
          'En breve se pondrán en contacto contigo (por email o teléfono) para darte una solución.',
          'Muchísimas gracias por avisarnos y ayudarnos a mejorar 💙'
        );

        session.estado = 'CERRADA';

        eventos.push({
          tipo: 'GUARDAR_ENCUESTA',
          payload: construirPayloadEncuesta(session),
        });
        eventos.push({
          tipo: 'CREAR_TICKET',
          payload: construirPayloadEmail(session),
        });
      } else {
        session.ticket_escalado = false;
        session.cliente_contacta = true;

        mensajesACliente.push(
          'Perfecto, te dejamos por aquí nuestros datos de contacto 👇',
          '📧 Email: info@atrapamuebles.com',
          '☎️ Teléfono: 976 40 12 63',
          'Estos días tenemos bastante volumen de consultas, así que puede que tardemos un poquito más de lo habitual, pero te atenderemos lo antes posible 💙',
          '¡Gracias por contarnos tu caso!'
        );

        session.estado = 'CERRADA';

        eventos.push({
          tipo: 'GUARDAR_ENCUESTA',
          payload: construirPayloadEncuesta(session),
        });
      }
      break;
    }

    case 'PEDIR_NPS_SCORE': {
      const { score } = await extraerNotaNPS(textoCliente);

      if (!score) {
        mensajesACliente.push(
          '¿Me podrías decir un número del 1 al 10 para poder registrarlo? 😊'
        );
      } else {
        session.nps_score = score;

        mensajesACliente.push(
          '¡Gracias! 🙏',
          'Si quieres, cuéntanos qué es lo que más te ha gustado o qué podríamos mejorar para que la próxima vez tu experiencia sea de 10 💬'
        );

        session.estado = 'PREGUNTA_ABIERTA_OPCIONAL';
      }
      break;
    }

    case 'PREGUNTA_ABIERTA_OPCIONAL': {
      if (textoCliente && textoCliente.trim()) {
        session.comentarios +=
          (session.comentarios ? '\n' : '') + textoCliente;
      }

      mensajesACliente.push(
        'Gracias por tu tiempo y por confiar en Atrapamuebles 🛋️',
        'Aquí nos tienes para cualquier cosa que necesites. ¡Que disfrutes mucho de tu nuevo mueble! 💙'
      );

      session.estado = 'CERRADA';

      eventos.push({
        tipo: 'GUARDAR_ENCUESTA',
        payload: construirPayloadEncuesta(session),
      });
      break;
    }

    case 'CERRADA': {
      mensajesACliente.push(
        'Esta conversación de encuesta ya está cerrada 👍',
        'Si necesitas algo más con tu pedido, puedes escribirnos a info@atrapamuebles.com o al 976 40 12 63.'
      );
      break;
    }

    default: {
      mensajesACliente.push(
        'Perdona, ahora mismo no sé muy bien cómo ayudarte con esto 😅',
        'Si tienes alguna incidencia con tu pedido, cuéntanosla, o escríbenos a info@atrapamuebles.com.'
      );
    }
  }

    // Si la sesión está cerrada y tenemos conversación NPS, lanzamos el evento de actualización
  if (session.estado === 'CERRADA' && session.conversacionIdNps) {
    eventos.push({
      tipo: 'ACTUALIZAR_CONVERSACION_NPS',
      payload: {
        conversacionId: session.conversacionIdNps,
        tuvo_incidencia: session.incidencia ? 1 : 0,
        sentimiento: session.sentimiento,
        nps_score: session.nps_score,
        nps_comment: session.comentarios,
      },
    });
  }

  // Añadir respuestas del bot al historial SIEMPRE
  mensajesACliente.forEach((texto) =>
    addToHistory(session, 'bot', texto)
  );

  // Devolvemos siempre lo mismo
  return { session, mensajesACliente, eventos };
}

module.exports = { procesarMensaje, addToHistory };
