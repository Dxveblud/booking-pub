/**
 * Negozi della piattaforma: creazione, modifica, lettura (con cache).
 */
const crypto = require('crypto');
const { Business, Service, AdminUser } = require('../models');
const { getTemplate } = require('./templates');
const { getSettings } = require('./settingsService');
const { badRequest, notFound, conflict } = require('../utils/errors');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'widget', 's', 'img', 'css', 'js', 'fonts', 'uploads', 'health', 'www']);
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CACHE_MS = 30 * 1000;

/* -------------------------------- Cache --------------------------------- */
// Il widget chiede i dati del negozio a ogni richiesta: una cache breve
// evita di interrogare MongoDB ogni volta.
const cache = new Map();

async function getBusiness(slug, { fresh = false } = {}) {
  const key = String(slug || '').toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.doc;
  const doc = await Business.findOne({ slug: key });
  if (doc) cache.set(key, { doc, expires: Date.now() + CACHE_MS });
  return doc;
}

function invalidate(slug) { cache.delete(slug); }

/* ---------------------------- Serializzazione ---------------------------- */

/** Dati visibili da chiunque (widget e pagina pubblica). */
function serializePublic(b) {
  return {
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    description: b.description,
    logo: b.logo, // vuoto = l'interfaccia mostra l'iniziale del nome
    address: b.address,
    phone: b.phone,
    email: b.email,
    instagram: b.instagram,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    timezone: b.timezone,
    currency: b.currency,
    locale: b.locale,
    site: {
      heroImage: b.site.heroImage,
      aboutImage: b.site.aboutImage,
      aboutTitle: b.site.aboutTitle,
      highlights: b.site.highlights.map((h) => ({ title: h.title, text: h.text })),
      gallery: [...b.site.gallery],
      demoNotice: b.site.demoNotice,
    },
  };
}

/** Dati per il pannello (titolare e super admin). */
function serializeAdmin(b) {
  return {
    ...serializePublic(b),
    notifyEmail: b.notifyEmail || '',
    type: b.type,
    active: b.active,
    notes: b.notes,
    createdAt: b.createdAt,
  };
}

/* ------------------------------ Validazione ------------------------------ */

function normalizeSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // toglie gli accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function assertSlug(slug) {
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) {
    throw badRequest('Codice negozio non valido: usa 3-40 tra lettere minuscole, numeri e trattini');
  }
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isUrlOrPath = (v) => v === '' || /^\/[\w\-./]+$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v);

/** Applica al documento i campi modificabili dal titolare. */
function applyEditable(doc, body) {
  const text = { name: 80, tagline: 140, description: 1200, address: 160, phone: 30, email: 120, instagram: 120 };
  for (const [key, max] of Object.entries(text)) {
    if (body[key] !== undefined) doc[key] = str(body[key], max);
  }
  if (body.name !== undefined && !doc.name) throw badRequest('Il nome del negozio è obbligatorio');
  if (body.notifyEmail !== undefined) {
    const email = str(body.notifyEmail, 120).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw badRequest('Email per gli avvisi non valida');
    doc.notifyEmail = email;
  }
  for (const key of ['primaryColor', 'accentColor']) {
    if (body[key] !== undefined) {
      if (!COLOR_RE.test(body[key])) throw badRequest('Colore non valido (usa il formato #rrggbb)');
      doc[key] = body[key];
    }
  }
  if (body.logo !== undefined) {
    if (!isUrlOrPath(body.logo)) throw badRequest('Logo non valido');
    doc.logo = body.logo;
  }
  if (body.site && typeof body.site === 'object') {
    const site = body.site;
    for (const key of ['heroImage', 'aboutImage']) {
      if (site[key] !== undefined) {
        if (!isUrlOrPath(site[key])) throw badRequest('Immagine non valida');
        doc.site[key] = site[key];
      }
    }
    if (site.aboutTitle !== undefined) doc.site.aboutTitle = str(site.aboutTitle, 80);
    if (Array.isArray(site.gallery)) {
      const gallery = site.gallery.filter((g) => typeof g === 'string' && g && isUrlOrPath(g)).slice(0, 12);
      doc.site.gallery = gallery;
    }
    if (Array.isArray(site.highlights)) {
      doc.site.highlights = site.highlights.slice(0, 4)
        .map((h) => ({ title: str(h && h.title, 60), text: str(h && h.text, 160) }))
        .filter((h) => h.title);
    }
  }
}

/* ------------------------------- Operazioni ------------------------------ */

function listBusinesses() {
  return Business.find().sort({ createdAt: -1 });
}

async function updateBusiness(slug, body) {
  const doc = await Business.findOne({ slug });
  if (!doc) throw notFound('Negozio non trovato');
  applyEditable(doc, body);
  await doc.save();
  invalidate(slug);
  return doc;
}

async function setActive(slug, active) {
  const doc = await Business.findOneAndUpdate({ slug }, { active: Boolean(active) }, { returnDocument: 'after' });
  if (!doc) throw notFound('Negozio non trovato');
  invalidate(slug);
  return doc;
}

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

/**
 * Crea un negozio con servizi e orari dal modello scelto e il suo titolare.
 * Restituisce anche la password generata (mostrata una sola volta).
 */
async function createBusiness({ name, slug, type, ownerUsername, ownerPassword, ...rest }) {
  const finalSlug = normalizeSlug(slug || name);
  assertSlug(finalSlug);
  if (!str(name, 80)) throw badRequest('Il nome del negozio è obbligatorio');
  if (await Business.exists({ slug: finalSlug })) throw conflict('Esiste già un negozio con questo codice', 'SLUG_TAKEN');

  const username = str(ownerUsername || finalSlug, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw badRequest('Username non valido');
  if (await AdminUser.exists({ username })) throw conflict('Username già usato da un altro negozio', 'USERNAME_TAKEN');
  const password = ownerPassword || randomPassword();
  if (password.length < 8) throw badRequest('La password deve avere almeno 8 caratteri');

  const template = getTemplate(type);
  const doc = new Business({ slug: finalSlug, name: str(name, 80), type: type || 'generico' });
  applyEditable(doc, rest);
  await doc.save();

  await getSettings(finalSlug, template.openingHours);
  await Service.insertMany(template.services.map((s, i) => ({
    businessId: finalSlug,
    name: s.name,
    description: s.description || '',
    durationMinutes: s.durationMinutes,
    priceCents: Math.round(s.price * 100),
    sortOrder: i,
  })));

  const owner = new AdminUser({ businessId: finalSlug, username, role: 'owner' });
  await owner.setPassword(password);
  await owner.save();

  return { business: doc, owner: { username, password } };
}

/** Reimposta la password del titolare (la nuova viene restituita una volta). */
async function resetOwnerPassword(slug) {
  const owner = await AdminUser.findOne({ businessId: slug, role: 'owner' }).sort({ createdAt: 1 });
  if (!owner) throw notFound('Questo negozio non ha un titolare');
  const password = randomPassword();
  await owner.setPassword(password);
  await owner.save();
  return { username: owner.username, password };
}

async function ownersBySlug() {
  const owners = await AdminUser.find({ role: 'owner' }, { businessId: 1, username: 1 }).lean();
  const map = {};
  owners.forEach((o) => { if (!map[o.businessId]) map[o.businessId] = o.username; });
  return map;
}

module.exports = {
  getBusiness,
  invalidate,
  serializePublic,
  serializeAdmin,
  normalizeSlug,
  listBusinesses,
  createBusiness,
  updateBusiness,
  setActive,
  resetOwnerPassword,
  ownersBySlug,
};
