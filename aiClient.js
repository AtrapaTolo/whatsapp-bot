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

  // 1) Caso ideal: solo el número
  let m = t.match(/^\s*(10|[0-9])\s*$/);

  // 2) Caso típico: “un 8”, “pongo 10”, “mi nota es 7”
  if (!m) {
    m = t.match(/\b(10|[0-9])\b/);
  }

  if (!m) return { score: null };

  const num = parseInt(m[1], 10);
  return { score: num };
}

function normalizeSimple(s = '') {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function clasificarOpcionTicket(texto) {
  const t0 = (texto || '').toString();
  const t = normalizeSimple(t0);

  // 1) Si responde EXACTAMENTE 1 o 2 (o con emoji 1️⃣/2️⃣)
  if (/^\s*(1|1️⃣)\s*$/.test(t0.trim())) return 'abrir_ticket';
  if (/^\s*(2|2️⃣)\s*$/.test(t0.trim())) return 'cliente_contacta';

  // 2) Si responde "uno/dos"
  if (/^\s*uno\s*$/.test(t)) return 'abrir_ticket';
  if (/^\s*dos\s*$/.test(t)) return 'cliente_contacta';

  // 3) Keywords claras
  if (t.includes('ticket') || t.includes('abrir')) return 'abrir_ticket';
  if (t.includes('llamar') || t.includes('contactar') || t.includes('contacto') || t.includes('prefiero yo'))
    return 'cliente_contacta';

  // 4) Sí/No: si dice "sí", asumimos abrir ticket (como hacías)
  if (t === 'si' || t === 'sí') return 'abrir_ticket';

  return 'abrir_ticket';
}

module.exports = {
  clasificarIncidenciaTexto,
  extraerNotaNPS,
  clasificarOpcionTicket,
};
