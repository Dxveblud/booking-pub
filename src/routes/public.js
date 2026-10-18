/**
 * API pubbliche usate dal widget e dalla pagina del negozio.
 * Ogni richiesta indica il negozio con ?shop=<codice> (vedi middleware/shop.js).
 *
 *   GET  /api/business                               dati del negozio
 *   GET  /api/services                               servizi attivi
 *   GET  /api/staff?serviceId                        collaboratori che fanno quel servizio (vuoto = agenda unica)
 *   GET  /api/reviews                                valutazione e recensioni (Google o inserite a mano)
 *   GET  /api/opening-hours                          orari di apertura settimanali
 *   GET  /api/availability/days?serviceId[&staffId]  giorni con almeno un orario libero
 *   GET  /api/availability?serviceId&date[&staffId]  orari liberi di un giorno
 *   POST /api/bookings                               crea una prenotazione
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const config = require('../config');
const { Service } = require('../models');
const { resolvePublicShop } = require('../middleware/shop');
const { serializePublic } = require('../services/businessService');
const { listServices, serializeService } = require('../services/catalogService');
const { getSettings, serializeOpeningHours } = require('../services/settingsService');
const { getAvailability } = require('../services/availability');
const { candidatesFor, serializePublicStaff } = require('../services/staffService');
const { getReviews } = require('../services/googleReviews');
const { createBooking, serializePublicBooking } = require('../services/bookingService');
const { customerEmailsEnabled } = require('../services/notifications/customer');
const { addDays, fromMinutes, isValidDate, nowInTimezone } = require('../utils/time');
const { badRequest } = require('../utils/errors');

const router = express.Router();

// Limita i tentativi di prenotazione per IP (anti-spam)
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env.bookingRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste, riprova tra qualche minuto' } },
});

router.use(resolvePublicShop);

async function loadActiveService(business, serviceId) {
  if (!mongoose.isValidObjectId(serviceId)) throw badRequest('Servizio non valido');
  const service = await Service.findOne({ _id: serviceId, businessId: business.slug, active: true });
  if (!service) throw badRequest('Servizio non trovato');
  return service;
}

/** ?staffId=… facoltativo: vuoto = "chiunque". */
function staffParam(req) {
  const id = req.query.staffId;
  if (!id) return undefined;
  if (!mongoose.isValidObjectId(id)) throw badRequest('Collaboratore non valido');
  return id;
}

router.get('/business', async (req, res) => {
  const settings = await getSettings(req.business.slug);
  res.json({
    ...serializePublic(req.business),
    maxDaysAhead: settings.maxDaysAhead,
    // Il widget chiede l'email solo se il negozio può davvero mandare la conferma
    features: { emailConfirmation: customerEmailsEnabled(req.business) },
  });
});

router.get('/services', async (req, res) => {
  const services = await listServices(req.business.slug, { onlyActive: true });
  res.json(services.map((s) => {
    const { active, sortOrder, ...pub } = serializeService(s);
    return pub;
  }));
});

// Recensioni da mostrare sul sito (da Google se la scheda è collegata)
router.get('/reviews', async (req, res) => {
  res.json(await getReviews(req.business));
});

router.get('/staff', async (req, res) => {
  const service = await loadActiveService(req.business, req.query.serviceId);
  res.json((await candidatesFor(req.business.slug, service._id)).map(serializePublicStaff));
});

router.get('/opening-hours', async (req, res) => {
  res.json(serializeOpeningHours(await getSettings(req.business.slug)));
});

/** Giorni prenotabili da oggi in avanti, con il numero di orari liberi. */
router.get('/availability/days', async (req, res) => {
  const service = await loadActiveService(req.business, req.query.serviceId);
  const settings = await getSettings(req.business.slug);
  const today = nowInTimezone(req.business.timezone).date;
  const availability = await getAvailability(req.business, service, today, addDays(today, settings.maxDaysAhead), { staffId: staffParam(req) });
  const days = [];
  for (const [date, slots] of availability) days.push({ date, available: slots.length });
  res.json({ days });
});

router.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!isValidDate(date)) throw badRequest('Data non valida');
  const service = await loadActiveService(req.business, req.query.serviceId);
  const availability = await getAvailability(req.business, service, date, date, { staffId: staffParam(req) });
  res.json({ date, slots: (availability.get(date) || []).map(fromMinutes) });
});

router.post('/bookings', bookingLimiter, async (req, res) => {
  const { serviceId, date, time, customer, notes, website, staffId } = req.body || {};
  // Campo nascosto nel modulo: un utente vero lo lascia vuoto, molti bot no
  if (website) throw badRequest('Richiesta non valida');
  const booking = await createBooking(req.business, { serviceId, date, time, customer, notes, staffId }, { source: 'online' });
  res.status(201).json(serializePublicBooking(booking));
});

module.exports = router;
