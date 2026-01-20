// scripts/buildKbIndex.js (CommonJS)
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { KB_RAW } = require("../kbRaw");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseKB(raw) {
  const lines = raw.split("\n");
  const entries = [];
  let q = null;
  let a = [];

  for (const line0 of lines) {
    const line = line0.trim();
    if (line.startsWith("P:")) {
      if (q && a.length) entries.push({ q: q.trim(), a: a.join("\n").trim() });
      q = line.replace(/^P:\s*/, "");
      a = [];
      continue;
    }
    if (line.startsWith("R:")) {
      a.push(line.replace(/^R:\s*/, ""));
      continue;
    }
    if (q && a.length) a.push(line);
  }
  if (q && a.length) entries.push({ q: q.trim(), a: a.join("\n").trim() });
  return entries.filter((e) => e.q && e.a);
}

async function main() {
  const entries = parseKB(KB_RAW);

  const model = process.env.KB_EMBEDDING_MODEL || "text-embedding-3-small";
  const dimensions = Number(process.env.KB_EMBEDDING_DIMENSIONS || 0) || undefined; // opcional
  const batchSize = Number(process.env.KB_EMBEDDING_BATCH || 64);

  const out = {
    model,
    dimensions: dimensions || null,
    created_at: new Date().toISOString(),
    entries: [],
  };

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    // Puedes embebder solo la pregunta; o pregunta+respuesta.
    // Yo recomiendo pregunta+respuesta para capturar matices.
    const inputs = batch.map((e) => `P: ${e.q}\nR: ${e.a}`);

    const resp = await client.embeddings.create({
      model,
      input: inputs,
      encoding_format: "float",
      ...(dimensions ? { dimensions } : {}),
    });

    // resp.data[x].embedding según docs
    batch.forEach((e, idx) => {
      out.entries.push({
        q: e.q,
        a: e.a,
        embedding: resp.data[idx].embedding,
      });
    });

    console.log(`Indexado ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
  }

  const outPath = path.join(__dirname, "..", "kbIndex.json");
  fs.writeFileSync(outPath, JSON.stringify(out), "utf-8");
  console.log("✅ kbIndex.json generado en:", outPath);
}

main().catch((e) => {
  console.error("❌ Error generando kbIndex:", e);
  process.exit(1);
});
