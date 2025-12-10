// sttClient.js
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribirAudioWhisper(filePath) {
  // filePath es la ruta local del audio que has guardado (ogg, mp3, etc.)
  const fileStream = fs.createReadStream(filePath);

  const res = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1', // puedes cambiar a gpt-4o-mini-transcribe si quieres probar
    // language: 'es',   // opcional, Whisper detecta idioma automáticamente
    // response_format: 'json', // por defecto es json con .text
  });

  // La respuesta trae la transcripción en res.text 
  return res.text;
}

module.exports = {
  transcribirAudioWhisper,
};
