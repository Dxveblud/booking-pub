/**
 * API pubbliche usate dal widget e dal sito.
 *
 *   GET  /api/business                       info attività (da config.json)
 *   GET  /api/services                       servizi attivi
 *   GET  /api/opening-hours                  orari di apertura settimanali
 *   GET  /api/availability/days              giorni con almeno un orario libero
 *   GET  /api/availability?serviceId&date    orari liberi di un giorno
 *   POST /api/bookings                       crea una prenotazione
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const config = require('../config');
const { Service } = require('../models');
const { listServices, serializeService } = require('../services/catalogService');
const { getSettings, serializeOpeningHours } = require('../services/settingsService');
const { getAvailability } = require('../services/availability');
const { createBooking, serializePublicBooking } = require('../services/bookingService');
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

async function loadActiveService(serviceId) {
  if (!mongoose.isValidObjectId(serviceId)) throw badRequest('Servizio non valido');
  const service = await Service.findOne({ _id: serviceId, businessId: config.business.id, active: true });
  if (!service) throw badRequest('Servizio non trovato');
  return service;
}

router.get('/business', async (req, res) => {
  const settings = await getSettings();
  const { id, ...business } = config.business; // l'id interno non serve al client
  res.json({ ...business, site: config.site, maxDaysAhead: settings.maxDaysAhead });
});

router.get('/services', async (req, res) => {
  const services = await listServices({ onlyActive: true });
  res.json(services.map((s) => {
    const { active, sortOrder, ...pub } = serializeService(s);
    return pub;
  }));
});

router.get('/opening-hours', async (req, res) => {
  res.json(serializeOpeningHours(await getSettings()));
});

/** Giorni prenotabili da oggi in avanti, con il numero di orari liberi. */
router.get('/availability/days', async (req, res) => {
  const service = await loadActiveService(req.query.serviceId);
  const settings = await getSettings();
  const today = nowInTimezone(config.business.timezone).date;
  const availability = await getAvailability(service, today, addDays(today, settings.maxDaysAhead));
  const days = [];
  for (const [date, slots] of availability) days.push({ date, available: slots.length });
  res.json({ days });
});

router.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!isValidDate(date)) throw badRequest('Data non valida');
  const service = await loadActiveService(req.query.serviceId);
  const availability = await getAvailability(service, date, date);
  res.json({ date, slots: (availability.get(date) || []).map(fromMinutes) });
});

router.post('/bookings', bookingLimiter, async (req, res) => {
  const { serviceId, date, time, customer, notes } = req.body || {};
  const booking = await createBooking({ serviceId, date, time, customer, notes }, { source: 'online' });
  res.status(201).json(serializePublicBooking(booking));
});

module.exports = router;
