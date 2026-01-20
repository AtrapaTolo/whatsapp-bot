// aiFlowSchema.js
module.exports.flowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply_messages: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5
    },
    updates: {
      type: "object",
      additionalProperties: false,
      properties: {
        estado: {
          type: ["string", "null"],
          enum: [
            "POST_ENCUESTA_ROUTER",
            "ESPERANDO_RESPUESTA_INICIAL",
            "ACLARAR_INCIDENCIA",
            "INCIDENCIA_DETALLE",
            "INCIDENCIA_OPCION_TICKET_O_CONTACTO",
            "PEDIR_NPS_SCORE",
            "PREGUNTA_ABIERTA_OPCIONAL",
            "CERRADA",
            null
          ]
        },
        incidencia: { type: ["boolean", "null"] },
        sentimiento: { type: ["string", "null"] },
        nps_score: { type: ["integer", "null"], minimum: 0, maximum: 10 },
        nps_comment: { type: ["string", "null"] },
        ticket_choice: { type: ["string", "null"], enum: ["abrir_ticket", "cliente_contacta", null] },
        resumen: { type: ["string", "null"] }
      },
      // ✅ IMPORTANTÍSIMO: required debe incluir TODAS las keys de properties
      required: [
        "estado",
        "incidencia",
        "sentimiento",
        "nps_score",
        "nps_comment",
        "ticket_choice",
        "resumen"
      ]
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tipo: { type: "string", enum: ["CREAR_TICKET", "ACTUALIZAR_CONVERSACION_NPS", "NINGUNO"] }
        },
        required: ["tipo"]
      }
    }
  },
  required: ["reply_messages", "updates", "events"]
};
