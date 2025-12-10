// mediaService.js
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // ya lo usas en app.js

// Carpeta raíz donde guardamos los ficheros
const MEDIA_STORAGE_PATH =
  process.env.MEDIA_STORAGE_PATH || path.join(__dirname, 'media');

// Base URL pública para construir enlaces en los emails
// Ej: http://localhost:4000/media  (en local)
//     https://mi-bot.onrender.com/media  (en producción)
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL || null;

function extensionFromMime(mime) {
  if (!mime) return '';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/mp4') return 'mp4';
  return '';
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Descarga un media de WhatsApp (imagen/audio) y lo guarda en disco.
 * Devuelve la URL pública (si MEDIA_PUBLIC_BASE_URL está configurada) o null.
 */
async function descargarYGuardarMedia({ mediaId, phone, tipo }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.error('[Media] Falta WHATSAPP_ACCESS_TOKEN, no se puede descargar media');
    return null;
  }

  try {
    // 1) Pedir metadatos del media (url de descarga, mime_type, etc.)
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const meta = await metaRes.json();

    if (!metaRes.ok) {
      console.error('[Media] Error obteniendo metadata de media:', meta);
      return null;
    }

    const mimeType = meta.mime_type;
    const downloadUrl = meta.url;

    if (!downloadUrl) {
      console.error('[Media] Metadata sin url de descarga:', meta);
      return null;
    }

    const ext =
      extensionFromMime(mimeType) ||
      (tipo === 'image' || tipo === 'imagen'
        ? 'jpg'
        : tipo === 'audio'
        ? 'ogg'
        : '');

    // 2) Descargar el fichero binario desde la URL
    const fileRes = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!fileRes.ok) {
      console.error('[Media] Error descargando media:', await fileRes.text());
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3) Construir ruta local: /media/whatsapp/<telefono>/<mediaId>.<ext>
    const safePhone = String(phone || 'desconocido');
    const dir = path.join(MEDIA_STORAGE_PATH, 'whatsapp', safePhone);
    await ensureDir(dir);

    const filename = ext ? `${mediaId}.${ext}` : mediaId;
    const filePath = path.join(dir, filename);

    await fs.promises.writeFile(filePath, buffer);

    console.log('[Media] Guardado media en', filePath);

    // 4) Construir URL pública
    let publicUrl = null;
    if (MEDIA_PUBLIC_BASE_URL) {
      const base = MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '');
      publicUrl = `${base}/whatsapp/${safePhone}/${filename}`;
    } else {
      console.warn(
        '[Media] MEDIA_PUBLIC_BASE_URL no está definido. No habrá URL pública.'
      );
    }

    // 🔴 IMPORTANTE: ahora devolvemos las dos cosas
    return { filePath, publicUrl };
  } catch (err) {
    console.error('[Media] Error descargando/guardando media', err);
    return null;
  }
}

module.exports = {
  descargarYGuardarMedia,
  MEDIA_STORAGE_PATH,
};
