// emailClient.js
const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  INCIDENT_EMAIL_TO,
} = process.env;

// Creamos el transport solo una vez
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn(
      '[Email] Falta SMTP_HOST o SMTP_PORT. No se podrán enviar correos reales, solo se simularán en consola.'
    );
    return null;
  }

  const portNumber = Number(SMTP_PORT) || 587;
  const secure = portNumber === 465; // true para 465, false para 587/25

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: portNumber,
    secure,
    auth:
      SMTP_USER && SMTP_PASS
        ? {
            user: SMTP_USER,
            pass: SMTP_PASS,
          }
        : undefined,
  });

  return transporter;
}

/**
 * Envía un email real de incidencia.
 * Recibe { asunto, cuerpo } que viene de construirPayloadEmail(session).
 */
async function enviarEmailIncidencia({ asunto, cuerpo }) {
  // Siempre mostramos el contenido en consola, para depurar:
  console.log('---------------- EMAIL INCIDENCIA ----------------');
  console.log('Asunto:', asunto);
  console.log('Cuerpo:\n', cuerpo);
  console.log('--------------------------------------------------');

  const to = INCIDENT_EMAIL_TO || SMTP_FROM || SMTP_USER;

  if (!to) {
    console.warn(
      '[Email] No hay INCIDENT_EMAIL_TO ni SMTP_FROM ni SMTP_USER. No sé a quién enviar el correo. Solo se ha simulado.'
    );
    return;
  }

  const transport = getTransporter();

  if (!transport) {
    console.warn(
      '[Email] No hay transporter SMTP configurado. Solo se ha simulado el correo en consola.'
    );
    return;
  }

  try {
    const mailOptions = {
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: asunto,
      // Versión texto plano (la que ya teníamos)
      text: cuerpo,
      // Versión HTML simple: convertimos saltos de línea a <br>
      html:
        '<pre style="font-family: monospace; white-space: pre-wrap;">' +
        escapeHtml(cuerpo) +
        '</pre>',
    };

    const info = await transport.sendMail(mailOptions);
    console.log('[Email] Correo de incidencia enviado ✅', info.messageId);
  } catch (err) {
    console.error('[Email] Error enviando correo de incidencia ❌', err);
  }
}

// Pequeña función para escapar caracteres en HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  enviarEmailIncidencia,
};
