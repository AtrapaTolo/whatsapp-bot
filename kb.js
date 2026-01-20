// kb.js (CommonJS) - retrieval por embeddings usando kbIndex.json
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INDEX_PATH = path.join(__dirname, "kbIndex.json");

// Ajustables por env (si no, valores razonables)
const DEFAULT_MIN_SCORE = Number(process.env.KB_MIN_SCORE || 0.78);
const DEFAULT_TOPK = Number(process.env.KB_TOPK || 5);

let KB = null;      // { model, dimensions, entries: [{q,a,embedding}] }
let NORMS = null;   // norma L2 precomputada de cada embedding

function loadIndex() {
  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  const json = JSON.parse(raw);

  if (!json || !Array.isArray(json.entries)) {
    throw new Error("kbIndex.json inválido: se esperaba { entries: [...] }");
  }

  const entries = json.entries
    .map((e) => ({
      q: e.q,
      a: e.a,
      embedding: e.embedding,
    }))
    .filter((e) => e.q && e.a && Array.isArray(e.embedding));

  return {
    model: json.model || process.env.KB_EMBEDDING_MODEL || "text-embedding-3-small",
    dimensions: json.dimensions || null,
    entries,
  };
}

function ensureLoaded() {
  if (KB) return;
  KB = loadIndex();
  NORMS = KB.entries.map((e) => l2norm(e.embedding));
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function l2norm(v) {
  return Math.sqrt(dot(v, v)) || 1e-12;
}

function cosineSim(a, b, normA, normB) {
  return dot(a, b) / ((normA || l2norm(a)) * (normB || l2norm(b)));
}

async function embedQuery(text) {
  ensureLoaded();

  const resp = await client.embeddings.create({
    model: KB.model,
    input: text,
    encoding_format: "float",
    ...(KB.dimensions ? { dimensions: KB.dimensions } : {}),
  });

  return resp.data[0].embedding;
}

/**
 * Devuelve matches de KB como [{q,a}] (sin score) para meter en kb_matches.
 * Si no supera umbral, devuelve [] (=> “no hay match”).
 */
async function retrieveKB(text, k = DEFAULT_TOPK, minScore = DEFAULT_MIN_SCORE) {
  ensureLoaded();

  const t = (text || "").trim();
  if (!t) return [];

  let qEmb;
  try {
    qEmb = await embedQuery(t);
  } catch (e) {
    // Si falla embeddings, mejor devolver [] y que la IA pregunte 1 cosa corta
    console.warn("[KB] Error creando embedding:", e?.message || e);
    return [];
  }

  const qNorm = l2norm(qEmb);

  const scored = KB.entries.map((e, idx) => {
    const score = cosineSim(qEmb, e.embedding, qNorm, NORMS[idx]);
    return { q: e.q, a: e.a, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const filtered = scored.filter((x) => x.score >= minScore).slice(0, k);

  // Si quieres depurar: activa KB_DEBUG=1
  if (process.env.KB_DEBUG === "1") {
    console.log(
      "[KB] top matches:",
      filtered.map((m) => ({ score: Number(m.score.toFixed(3)), q: m.q.slice(0, 80) }))
    );
  }

  return filtered.map(({ q, a }) => ({ q, a }));
}

module.exports = { retrieveKB };
