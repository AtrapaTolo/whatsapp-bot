// emailClient.js
const nodemailer = require("nodemailer");

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
      "[Email] Falta SMTP_HOST o SMTP_PORT. No se podrán enviar correos reales, solo se simularán en consola."
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function formatHistory(historial) {
  const h = Array.isArray(historial) ? historial : [];
  if (!h.length) return "(sin historial)";

  return h
    .map((m) => {
      const fecha = m?.fecha ? safeStr(m.fecha) : "";
      const de = m?.de ? safeStr(m.de) : "";
      const tipo = m?.tipo ? safeStr(m.tipo) : "texto";
      const texto = m?.texto ? safeStr(m.texto) : "";
      const url = m?.url ? safeStr(m.url) : "";
      const transcripcion = m?.transcripcion ? safeStr(m.transcripcion) : "";
      const caption = m?.caption ? safeStr(m.caption) : "";

      // Intentamos dejarlo legible aunque venga variado
      if (tipo === "imagen") {
        return `[${fecha}] ${de} (imagen): ${texto || "(sin texto)"}${
          caption ? ` | caption: ${caption}` : ""
        }${url ? ` | url: ${url}` : ""}`;
      }

      if (tipo === "audio") {
        return `[${fecha}] ${de} (audio): ${texto || "(sin texto)"}${
          transcripcion ? ` | transcripción: ${transcripcion}` : ""
        }${url ? ` | url: ${url}` : ""}`;
      }

      return `[${fecha}] ${de}: ${texto}`;
    })
    .join("\n");
}

function buildEmailFromPayload({
  order_id,
  telefono,
  cliente_id,
  resumen,
  historial,
}) {
  const rawOrderId = safeStr(order_id || "SINPEDIDO").trim();

  const orderIdParaAsunto = rawOrderId.toUpperCase().startsWith("PVAM")
    ? rawOrderId
    : `PVAM ${rawOrderId}`;

  const subject = `Ticket / Incidencia WhatsApp - ${orderIdParaAsunto}`;

  const lines = [];
  lines.push("Se ha detectado una incidencia y el bot solicita intervención de Atención al Cliente.");
  lines.push("");
  lines.push(`Pedido: ${rawOrderId || "No informado"}`);
  lines.push(`Cliente ID: ${cliente_id ?? "No informado"}`);
  lines.push(`Teléfono: ${telefono ?? "No informado"}`);
  lines.push("");
  lines.push("Resumen (1–2 líneas):");
  lines.push(safeStr(resumen || "(sin resumen)"));
  lines.push("");
  lines.push("Historial / Transcripción:");
  lines.push(formatHistory(historial));

  const text = lines.join("\n");
  const html =
    '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap;">' +
    escapeHtml(text) +
    "</pre>";

  return { subject, text, html };
}

/**
 * Envía un email de incidencia.
 * Recibe: { order_id, telefono, cliente_id, resumen, historial }
 */
// emailClient.js (parche mínimo)
async function enviarEmailIncidencia(payload) {
  payload = payload || {};

  let subject, text, html;

  // ✅ Compatibilidad con el formato antiguo {asunto, cuerpo}
  if (payload.asunto && payload.cuerpo) {
    subject = String(payload.asunto);
    text = String(payload.cuerpo);
    html =
      '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap;">' +
      escapeHtml(text) +
      "</pre>";
  } else {
    // Formato nuevo {order_id, telefono, cliente_id, resumen, historial}
    ({ subject, text, html } = buildEmailFromPayload(payload));
  }

  console.log("---------------- EMAIL INCIDENCIA ----------------");
  console.log("Asunto:", subject);
  console.log("Cuerpo:\n", text);
  console.log("--------------------------------------------------");


  const to = INCIDENT_EMAIL_TO || SMTP_FROM || SMTP_USER;

  if (!to) {
    console.warn(
      "[Email] No hay INCIDENT_EMAIL_TO ni SMTP_FROM ni SMTP_USER. No sé a quién enviar el correo. Solo se ha simulado."
    );
    return;
  }

  const transport = getTransporter();

  if (!transport) {
    console.warn(
      "[Email] No hay transporter SMTP configurado. Solo se ha simulado el correo en consola."
    );
    return;
  }

  try {
    const mailOptions = {
      from: SMTP_FROM || SMTP_USER,
      to,
      subject,
      text,
      html,
    };

    const info = await transport.sendMail(mailOptions);
    console.log("[Email] Correo de incidencia enviado ✅", info.messageId);
  } catch (err) {
    console.error("[Email] Error enviando correo de incidencia ❌", err);
  }
}

module.exports = {
  enviarEmailIncidencia,
};
