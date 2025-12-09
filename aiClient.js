// aiClient.js
const incidenciaKeywords = [
  'retraso',
  'tarde',
  'golpe',
  'roto',
  'daño',
  'dano',
  'falta',
  'incompleto',
  'incidencia',
  'problema',
  'malo',
  'mal',
  'decepcionado',
  'decepcionada',
];
const positiveKeywords = [
  'perfecto',
  'genial',
  'muy bien',
  'muy contento',
  'muy contenta',
  'encantado',
  'encantada',
  'todo bien',
  'todo ok',
  'estupendo',
  'fenomenal',
  'maravilla',
];

async function clasificarIncidenciaTexto(texto /*, historial */) {
  const t = (texto || '').toLowerCase().trim();
  if (!t) {
    return { tipo: 'ambiguo', sentimiento: 'neutro', resumen: '' };
  }

  const hasIncidencia = incidenciaKeywords.some((k) => t.includes(k));
  const isPositive = positiveKeywords.some((k) => t.includes(k));

  let tipo = 'ambiguo';
  let sentimiento = 'neutro';

  if (hasIncidencia) {
    tipo = 'incidencia';
    sentimiento = 'negativo';
  } else if (isPositive) {
    tipo = 'no_incidencia';
    sentimiento = 'muy_positivo';
  } else if (t.length > 10) {
    // neutro / descriptivo pero sin palabras clave claras
    tipo = 'no_incidencia';
    sentimiento = 'neutro';
  }

  return {
    tipo, // 'incidencia' | 'no_incidencia' | 'ambiguo'
    sentimiento,
    resumen: texto.slice(0, 200),
  };
}

async function extraerNotaNPS(texto) {
  const t = (texto || '').toLowerCase();
  const match = t.match(/(\d{1,2})/);
  if (!match) {
    return { score: null };
  }
  const num = parseInt(match[1], 10);
  if (num < 1 || num > 10) return { score: null };
  return { score: num };
}

async function clasificarOpcionTicket(texto) {
  const t = (texto || '').toLowerCase();
  if (
    t.includes('1') ||
    t.includes('ticket') ||
    t.includes('abrir') ||
    t.includes('sí') ||
    t.includes('si ')
  ) {
    return 'abrir_ticket';
  }
  if (
    t.includes('2') ||
    t.includes('llamar') ||
    t.includes('yo') ||
    t.includes('escribo') ||
    t.includes('contacto')
  ) {
    return 'cliente_contacta';
  }
  // Por defecto, para no dejar el tema en el aire, asumimos abrir ticket
  return 'abrir_ticket';
}

module.exports = {
  clasificarIncidenciaTexto,
  extraerNotaNPS,
  clasificarOpcionTicket,
};
