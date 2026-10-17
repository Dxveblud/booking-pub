/**
 * API del pannello admin (/admin/api/*). Tutte richiedono login,
 * tranne /login.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const requireAdmin = require('../middleware/requireAdmin');
const { authenticate } = require('../services/adminService');
const bookingService = require('../services/bookingService');
const catalog = require('../services/catalogService');
const blocks = require('../services/blockService');
const { getSettings, updateSettings, serializeSettings } = require('../services/settingsService');
const { badRequest } = require('../utils/errors');

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
  req.session.username = user.username;
  return res.json({ username: user.username });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('bt.sid');
    return res.json({ ok: true });
  });
});

// Da qui in poi serve il login
router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ username: req.session.username }));

/* ----------------------------- Prenotazioni ----------------------------- */

router.get('/bookings', async (req, res) => {
  const { from, to, includeCancelled } = req.query;
  const list = await bookingService.listBookings({ from, to, includeCancelled: includeCancelled === 'true' });
  res.json(list.map(bookingService.serializeBooking));
});

router.post('/bookings', async (req, res) => {
  const booking = await bookingService.createBooking(req.body || {}, { source: 'admin' });
  res.status(201).json(bookingService.serializeBooking(booking));
});

router.put('/bookings/:id', async (req, res) => {
  const booking = await bookingService.updateBooking(req.params.id, req.body || {});
  res.json(bookingService.serializeBooking(booking));
});

router.delete('/bookings/:id', async (req, res) => {
  const booking = await bookingService.cancelBooking(req.params.id);
  res.json(bookingService.serializeBooking(booking));
});

/* ------------------------------- Servizi -------------------------------- */

router.get('/services', async (req, res) => {
  res.json((await catalog.listServices()).map(catalog.serializeService));
});

router.post('/services', async (req, res) => {
  res.status(201).json(catalog.serializeService(await catalog.createService(req.body || {})));
});

router.put('/services/:id', async (req, res) => {
  res.json(catalog.serializeService(await catalog.updateService(req.params.id, req.body || {})));
});

router.delete('/services/:id', async (req, res) => {
  await catalog.deleteService(req.params.id);
  res.json({ ok: true });
});

/* -------------------------------- Blocchi ------------------------------- */

router.get('/blocks', async (req, res) => {
  res.json((await blocks.listBlocks(req.query)).map(blocks.serializeBlock));
});

router.post('/blocks', async (req, res) => {
  const { blocks: created, conflicts } = await blocks.createBlocks(req.body || {});
  res.status(201).json({
    blocks: created.map(blocks.serializeBlock),
    conflicts: conflicts.map(bookingService.serializeBooking),
  });
});

router.delete('/blocks/:id', async (req, res) => {
  await blocks.deleteBlock(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------ Impostazioni ---------------------------- */

router.get('/settings', async (req, res) => {
  res.json(serializeSettings(await getSettings()));
});

router.put('/settings', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') throw badRequest('Dati mancanti');
  res.json(serializeSettings(await updateSettings(req.body)));
});

module.exports = router;
