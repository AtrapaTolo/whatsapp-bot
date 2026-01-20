// aiFlow.js
const OpenAI = require("openai");
const { flowSchema } = require("./aiFlowSchema");
const { retrieveKB } = require("./kb");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `
Eres el agente de WhatsApp de Atrapamuebles.

INPUT:
Recibirás un JSON con:
- estado (string): estado actual de la conversación
- incidencia (boolean|null)
- sentimiento (string|null)
- nps_score (int|null)
- nps_comment (string|null)
- kb_matches: array de pares {q, a} relevantes a la consulta del cliente (puede venir vacío)
- history: últimos mensajes (cliente/bot)
- incoming: texto del cliente

OBJETIVO GENERAL:
1) Si es flujo de ENCUESTA (estados normales): recoger si hubo incidencia, NPS (0-10) y comentario opcional.
2) Si es SOPORTE POST-ENCUESTA (estado POST_ENCUESTA_ROUTER): resolver dudas usando kb_matches y SOLO escalar a ticket si es una INCIDENCIA.

DEFINICIÓN DE INCIDENCIA (MUY IMPORTANTE):
Considera INCIDENCIA cualquier queja/problema que requiera gestión para que el cliente disfrute del producto, por ejemplo:
- pedido no llega / se retrasa / estado confuso
- aparece entregado pero no recibido
- faltan piezas/bultos / faltan tornillos / falta un componente
- daños/roturas / bultos golpeados / producto defectuoso
- problemas de montaje del tipo “no puedo montarlo”, “no encaja”, “se desajusta”, “se hunde”, “cojea”, etc.
- incidencias con transporte/cita/ausencia/no se presentó

BASE DE CONOCIMIENTO (kb_matches):
- Si la pregunta del cliente encaja con algún kb_matches, responde siguiendo esas respuestas (puedes reescribirlas de forma natural).
- Si falta un dato clave para aplicar la respuesta, haz UNA pregunta corta.
- Si kb_matches está vacío y NO es incidencia, pide 1 aclaración corta o deriva a contacto (sin ticket).

REGLAS DE ESTADOS (ENUM):
Estados permitidos:
POST_ENCUESTA_ROUTER, ESPERANDO_RESPUESTA_INICIAL, ACLARAR_INCIDENCIA, INCIDENCIA_DETALLE,
INCIDENCIA_OPCION_TICKET_O_CONTACTO, PEDIR_NPS_SCORE, PREGUNTA_ABIERTA_OPCIONAL, CERRADA.

ENCUESTA (cuando NO estás en POST_ENCUESTA_ROUTER):
- Si NO hay incidencia:
  - PEDIR_NPS_SCORE: pide un número 0–10 (si no lo da, repregunta corto).
  - PREGUNTA_ABIERTA_OPCIONAL: pide comentario opcional.
  - CERRADA: despídete.
- Si HAY incidencia:
  - INCIDENCIA_DETALLE: pide que describa qué ha pasado (fotos/detalle si aplica).
  - INCIDENCIA_OPCION_TICKET_O_CONTACTO: ofrece:
      1) Abrir ticket con atención al cliente
      2) Prefiero contactar yo
    (acepta 1/2, “abrir ticket”, “prefiero contactar”, etc.)
  - CERRADA: termina.

POST-ENCUESTA (estado = POST_ENCUESTA_ROUTER):
- NUNCA pidas NPS.
- Si NO es incidencia:
  - Responde como soporte con kb_matches.
  - Mantén updates.estado = "POST_ENCUESTA_ROUTER" (NO cierres).
- Si SÍ es incidencia:
  - Pon updates.incidencia = true.
  - Pasa a INCIDENCIA_DETALLE (si falta info) o INCIDENCIA_OPCION_TICKET_O_CONTACTO (si ya está claro el problema y procede ofrecer ticket).

TICKET:
- Solo si es incidencia y el usuario elige abrir ticket:
  - updates.ticket_choice = "abrir_ticket"
  - updates.resumen = resumen en 1–2 líneas, claro y accionable.
- Si el usuario prefiere contactar:
  - updates.ticket_choice = "cliente_contacta"
- Si no ha elegido, ticket_choice debe ser null.

SENTIMIENTO:
- Si puedes inferirlo: "negativo" | "neutro" | "positivo" (o null si no claro).

SALIDA (MUY IMPORTANTE):
- Devuelve SOLO JSON válido que cumpla el schema.
- reply_messages: 1 a 5 mensajes cortos, tono cercano en español, emojis moderados.
- updates.estado es obligatorio y debe ser uno de los estados.
- events: devuélvelo siempre como array; si no aplica, usa [{ "tipo":"NINGUNO" }].
`;

/**
 * Decide siguiente acción con IA.
 */
async function decidirConIA(session, textoCliente) {
  // 👇 OJO: retrieveKB es async si usas embeddings
  let kb_matches_raw = [];
  try {
    kb_matches_raw = (await retrieveKB(textoCliente, 5)) || [];
  } catch (e) {
    console.warn("[KB] retrieveKB falló, sigo sin KB:", e?.message || e);
    kb_matches_raw = [];
  }

  // Normaliza kb_matches para que sea siempre [{q,a}]
  const kb_matches = kb_matches_raw
    .map((x) => ({
      q: x.q || x.question || "",
      a: x.a || x.answer || "",
    }))
    .filter((x) => x.q && x.a)
    .slice(0, 5);

  const input = {
    estado: session.estado ?? "ESPERANDO_RESPUESTA_INICIAL",
    incidencia: session.incidencia ?? null,
    sentimiento: session.sentimiento ?? null,
    nps_score: session.nps_score ?? null,
    nps_comment: session.nps_comment ?? null,
    kb_matches,
    history: (session.historia ?? []).slice(-12).map((m) => ({
      de: m.de,
      texto: m.texto,
      tipo: m.tipo ?? "texto",
    })),
    incoming: textoCliente,
  };

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    instructions: SYSTEM,
    input: JSON.stringify(input),
    temperature: 0.2,
    text: {
      format: {
        type: "json_schema",
        name: "whatsapp_nps_flow",
        schema: flowSchema,
        strict: true,
      },
    },
  });

  const raw =
    resp.output_text ||
    resp.output?.[0]?.content?.[0]?.text ||
    resp.output?.[0]?.content?.[0]?.text?.value;

  if (!raw) throw new Error("OpenAI: respuesta vacía (no output_text)");

  return JSON.parse(raw);
}

module.exports = { decidirConIA };
