// sttClient.js
const OpenAI = require('openai');
const fs = require('fs');

let openai = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else {
  console.warn('[STT] Falta OPENAI_API_KEY. Transcripción de audio desactivada (Whisper).');
}

async function transcribirAudioWhisper(filePath) {
  // Si no hay OpenAI configurado, no transcribimos (pero no rompemos el bot)
  if (!openai) return null;

  const fileStream = fs.createReadStream(filePath);

  const res = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    // language: 'es',
  });

  return res.text;
}

module.exports = {
  transcribirAudioWhisper,
};
