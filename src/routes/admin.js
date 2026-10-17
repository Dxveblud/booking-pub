/**
 * API del pannello (/admin/api/*). Tutte richiedono login, tranne /login.
 * Ogni operazione riguarda il negozio del titolare loggato (req.business).
 * Le route /platform/* sono solo per il super admin.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const requireAdmin = require('../middleware/requireAdmin');
const { loadAdminContext, requireSuper } = require('../middleware/shop');
const { authenticate } = require('../services/adminService');
const bookingService = require('../services/bookingService');
const catalog = require('../services/catalogService');
const blocks = require('../services/blockService');
const businesses = require('../services/businessService');
const { saveUpload, MAX_UPLOAD_BYTES } = require('../services/uploadService');
const { listTemplates } = require('../services/templates');
const { getSettings, updateSettings, serializeSettings } = require('../services/settingsService');
const { Booking } = require('../models');
const { badRequest, notFound } = require('../utils/errors');
const { nowInTimezone } = require('../utils/time');

const router = express.Router();

/* ---------------------------- Autenticazione ---------------------------- */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Troppi tentativi di accesso, riprova più tardi' } },
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenziali non valide' } });
  }
  // Rigenera la sessione per prevenire session fixation
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.adminId = String(user._id);
  req.session.businessId = user.businessId;
  return res.json({ username: user.username, role: user.role });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('bt.sid');
    return res.json({ ok: true });
  });
});

// Da qui in poi serve il login
router.use(requireAdmin, loadAdminContext);

router.get('/me', (req, res) => {
  res.json({
    username: req.admin.username,
    role: req.admin.role,
    business: businesses.serializeAdmin(req.business),
  });
});

/* ------------------------------- Negozio -------------------------------- */

router.get('/business', (req, res) => res.json(businesses.serializeAdmin(req.business)));

router.put('/business', async (req, res) => {
  const doc = await businesses.updateBusiness(req.business.slug, req.body || {});
  res.json(businesses.serializeAdmin(doc));
});

// Logo e foto: corpo binario (Content-Type image/jpeg|png|webp|gif)
router.post('/uploads', express.raw({ type: 'image/*', limit: MAX_UPLOAD_BYTES }), async (req, res) => {
  const url = await saveUpload(req.business.slug, req.get('Content-Type'), req.body);
  res.status(201).json({ url });
});

/* ----------------------------- Prenotazioni ----------------------------- */

router.get('/bookings', async (req, res) => {
  const { from, to, includeCancelled } = req.query;
  const list = await bookingService.listBookings(req.business, { from, to, includeCancelled: includeCancelled === 'true' });
  res.json(list.map(bookingService.serializeBooking));
});

router.post('/bookings', async (req, res) => {
  const booking = await bookingService.createBooking(req.business, req.body || {}, { source: 'admin' });
  res.status(201).json(bookingService.serializeBooking(booking));
});

router.put('/bookings/:id', async (req, res) => {
  const booking = await bookingService.updateBooking(req.business, req.params.id, req.body || {});
  res.json(bookingService.serializeBooking(booking));
});

router.delete('/bookings/:id', async (req, res) => {
  const booking = await bookingService.cancelBooking(req.business, req.params.id);
  res.json(bookingService.serializeBooking(booking));
});

/* ------------------------------- Servizi -------------------------------- */

router.get('/services', async (req, res) => {
  res.json((await catalog.listServices(req.business.slug)).map(catalog.serializeService));
});

router.post('/services', async (req, res) => {
  res.status(201).json(catalog.serializeService(await catalog.createService(req.business.slug, req.body || {})));
});

router.put('/services/:id', async (req, res) => {
  res.json(catalog.serializeService(await catalog.updateService(req.business.slug, req.params.id, req.body || {})));
});

router.delete('/services/:id', async (req, res) => {
  await catalog.deleteService(req.business.slug, req.params.id);
  res.json({ ok: true });
});

/* -------------------------------- Blocchi ------------------------------- */

router.get('/blocks', async (req, res) => {
  res.json((await blocks.listBlocks(req.business.slug, req.query)).map(blocks.serializeBlock));
});

router.post('/blocks', async (req, res) => {
  const { blocks: created, conflicts } = await blocks.createBlocks(req.business.slug, req.body || {});
  res.status(201).json({
    blocks: created.map(blocks.serializeBlock),
    conflicts: conflicts.map(bookingService.serializeBooking),
  });
});

router.delete('/blocks/:id', async (req, res) => {
  await blocks.deleteBlock(req.business.slug, req.params.id);
  res.json({ ok: true });
});

/* ------------------------------ Impostazioni ---------------------------- */

router.get('/settings', async (req, res) => {
  res.json(serializeSettings(await getSettings(req.business.slug)));
});

router.put('/settings', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') throw badRequest('Dati mancanti');
  res.json(serializeSettings(await updateSettings(req.business.slug, req.body)));
});

/* ------------------------ Piattaforma (super admin) ---------------------- */

const platform = express.Router();
platform.use(requireSuper);

platform.get('/templates', (req, res) => res.json(listTemplates()));

platform.get('/shops', async (req, res) => {
  const [list, owners] = await Promise.all([businesses.listBusinesses(), businesses.ownersBySlug()]);
  // Prenotazioni future per negozio (escluse quelle finte della demo)
  const today = nowInTimezone('Europe/Rome').date;
  const counts = await Booking.aggregate([
    { $match: { status: 'confirmed', isDemo: { $ne: true }, date: { $gte: today } } },
    { $group: { _id: '$businessId', n: { $sum: 1 } } },
  ]);
  const upcoming = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(list.map((b) => ({
    ...businesses.serializeAdmin(b),
    owner: owners[b.slug] || null,
    upcoming: upcoming[b.slug] || 0,
  })));
});

platform.post('/shops', async (req, res) => {
  const { business, owner } = await businesses.createBusiness(req.body || {});
  res.status(201).json({ business: businesses.serializeAdmin(business), owner });
});

platform.put('/shops/:slug', async (req, res) => {
  const body = req.body || {};
  let doc;
  if (body.active !== undefined) doc = await businesses.setActive(req.params.slug, body.active);
  if (body.notes !== undefined) {
    doc = await businesses.getBusiness(req.params.slug, { fresh: true });
    if (!doc) throw notFound('Negozio non trovato');
    doc.notes = String(body.notes).slice(0, 1000);
    await doc.save();
    businesses.invalidate(req.params.slug);
  }
  if (!doc) throw badRequest('Niente da modificare');
  res.json(businesses.serializeAdmin(doc));
});

// Entra nel pannello di un negozio (per assistenza al cliente)
platform.post('/shops/:slug/enter', async (req, res) => {
  const doc = await businesses.getBusiness(req.params.slug, { fresh: true });
  if (!doc) throw notFound('Negozio non trovato');
  req.session.businessId = doc.slug;
  res.json(businesses.serializeAdmin(doc));
});

platform.post('/shops/:slug/reset-password', async (req, res) => {
  res.json(await businesses.resetOwnerPassword(req.params.slug));
});

router.use('/platform', platform);

module.exports = router;
