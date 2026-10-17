/**
 * Salvataggio di logo e foto caricati dai negozi.
 * I file finiscono in UPLOAD_DIR/<negozio>/ e sono serviti da /uploads/...
 * SVG non ammesso: potrebbe contenere script.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { badRequest } = require('../utils/errors');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Tipo dichiarato → estensione e "firma" dei primi byte del file
const TYPES = {
  'image/jpeg': { ext: 'jpg', check: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', check: (b) => b.slice(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: 'webp', check: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', check: (b) => b.slice(0, 3).toString() === 'GIF' },
};

async function saveUpload(slug, contentType, body) {
  const type = TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (!type) throw badRequest('Formato non supportato: usa JPG, PNG, WEBP o GIF');
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('File vuoto');
  if (!type.check(body)) throw badRequest('Il file non è un\'immagine valida');

  const dir = path.join(config.env.uploadDir, slug);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
  await fs.writeFile(path.join(dir, name), body);
  return `/uploads/${slug}/${name}`;
}

module.exports = { saveUpload, MAX_UPLOAD_BYTES };
