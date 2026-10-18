/**
 * Link personale del cliente (/disdici/<codice>), mandato nell'email di
 * conferma e mostrato a fine prenotazione.
 *
 *   GET  /api/manage/:token          dettagli dell'appuntamento
 *   POST /api/manage/:token/cancel   disdetta
 *
 * Il codice è casuale (128 bit): chi lo conosce vede solo quell'appuntamento.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bookingService = require('../services/bookingService');
const { getBusiness } = require('../services/businessService');
const { getSettings } = require('../services/settingsService');
const { fromMinutes } = require('../utils/time');
const { HttpError, notFound } = require('../utils/errors');

const router = express.Router();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste, riprova tra qualche minuto' } },
}));

async function load(token) {
  const booking = await bookingService.findByManageToken(token);
  const business = await getBusiness(booking.businessId);
  if (!business) throw notFound('Prenotazione non trovata');
  const settings = await getSettings(business.slug);
  return { booking, business, settings };
}

function serialize({ booking, business, settings }) {
  return {
    serviceName: booking.serviceName,
    staffName: booking.staffName || '',
    durationMinutes: booking.durationMinutes,
    price: booking.priceCents / 100,
    date: booking.date,
    start: fromMinutes(booking.startMinutes),
    end: fromMinutes(booking.endMinutes),
    customerName: booking.customer.name,
    status: booking.status,
    cancelledBy: booking.cancelledBy || null,
    past: bookingService.minutesUntil(business, booking) < 0,
    canCancel: bookingService.canCustomerCancel(business, settings, booking),
    cancelNoticeMinutes: settings.cancelNoticeMinutes,
    business: {
      slug: business.slug,
      name: business.name,
      logo: business.logo,
      address: business.address,
      phone: business.phone,
      primaryColor: business.primaryColor,
      accentColor: business.accentColor,
      locale: business.locale,
      currency: business.currency,
    },
  };
}

router.get('/:token', async (req, res) => {
  res.json(serialize(await load(req.params.token)));
});

router.post('/:token/cancel', async (req, res) => {
  const ctx = await load(req.params.token);
  if (ctx.booking.status === 'cancelled') return res.json(serialize(ctx));
  if (!bookingService.canCustomerCancel(ctx.business, ctx.settings, ctx.booking)) {
    throw new HttpError(409, "Ormai è tardi per disdire online: chiama il negozio", 'TOO_LATE');
  }
  ctx.booking = await bookingService.cancelBooking(ctx.business, ctx.booking._id, { by: 'customer' });
  return res.json(serialize(ctx));
});

module.exports = router;
