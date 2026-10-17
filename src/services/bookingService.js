/**
 * Logica di business delle prenotazioni: creazione, modifica, cancellazione.
 *
 * Usata sia dalle API pubbliche (cliente online) sia da quelle admin.
 * Differenza principale: per i clienti online l'orario deve rientrare negli
 * orari disponibili (apertura, blocchi, preavviso); l'admin può inserire una
 * prenotazione a qualunque orario, purché non si sovrapponga ad un'altra.
 */
const mongoose = require('mongoose');
const { Booking, Service } = require('../models');
const config = require('../config');
const slotLocks = require('./slotLocks');
const { getAvailability } = require('./availability');
const { BOOKING_EVENTS, emitBookingEvent } = require('./events');
const { toMinutes, fromMinutes, isValidDate, isValidTime } = require('../utils/time');
const { badRequest, notFound, conflict } = require('../utils/errors');

const businessId = config.business.id;
const PHONE_RE = /^\+?[0-9\s().-]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Validazione                                                        */
/* ------------------------------------------------------------------ */

function parseCustomer(raw = {}) {
  const name = String(raw.name || '').trim();
  const phone = String(raw.phone || '').trim();
  const email = String(raw.email || '').trim();
  if (name.length < 2 || name.length > 80) throw badRequest('Inserisci un nome valido');
  if (!PHONE_RE.test(phone)) throw badRequest('Inserisci un numero di telefono valido');
  if (email && !EMAIL_RE.test(email)) throw badRequest('Indirizzo email non valido');
  return { name, phone, email };
}

function parseDateTime({ date, time }) {
  if (!isValidDate(date)) throw badRequest('Data non valida');
  if (!isValidTime(time)) throw badRequest('Orario non valido');
  return { date, start: toMinutes(time) };
}

async function findService(serviceId, { onlyActive }) {
  if (!mongoose.isValidObjectId(serviceId)) throw badRequest('Servizio non valido');
  const query = { _id: serviceId, businessId };
  if (onlyActive) query.active = true;
  const service = await Service.findOne(query);
  if (!service) throw badRequest('Servizio non trovato');
  return service;
}

/** Controlla che l'orario sia tra quelli prenotabili online. */
async function assertPubliclyAvailable(service, date, start, excludeBookingId) {
  const availability = await getAvailability(service, date, date, { excludeBookingId });
  const slots = availability.get(date) || [];
  if (!slots.includes(start)) {
    throw conflict("L'orario scelto non è disponibile", 'SLOT_UNAVAILABLE');
  }
}

/* ------------------------------------------------------------------ */
/* Serializzazione                                                    */
/* ------------------------------------------------------------------ */

function serializeBooking(b) {
  return {
    id: String(b._id),
    serviceId: b.serviceId ? String(b.serviceId) : null,
    serviceName: b.serviceName,
    durationMinutes: b.durationMinutes,
    price: b.priceCents / 100,
    date: b.date,
    start: fromMinutes(b.startMinutes),
    end: fromMinutes(b.endMinutes),
    customer: { name: b.customer.name, phone: b.customer.phone, email: b.customer.email || '' },
    notes: b.notes || '',
    source: b.source,
    status: b.status,
    createdAt: b.createdAt,
  };
}

/** Versione ridotta restituita al cliente dopo la prenotazione online. */
function serializePublicBooking(b) {
  return {
    id: String(b._id),
    serviceName: b.serviceName,
    date: b.date,
    start: fromMinutes(b.startMinutes),
    end: fromMinutes(b.endMinutes),
    price: b.priceCents / 100,
    customerName: b.customer.name,
  };
}

/* ------------------------------------------------------------------ */
/* Operazioni                                                         */
/* ------------------------------------------------------------------ */

/**
 * Crea una prenotazione.
 * @param {object} input  { serviceId, date, time, customer:{name,phone,email}, notes }
 * @param {object} opts   { source: 'online' | 'admin' }
 */
async function createBooking(input, { source = 'online' } = {}) {
  const isOnline = source === 'online';
  const service = await findService(input.serviceId, { onlyActive: isOnline });
  const { date, start } = parseDateTime(input);
  const end = start + service.durationMinutes;
  if (end > 1440) throw badRequest('Il servizio terminerebbe dopo la mezzanotte');
  const customer = parseCustomer(input.customer);

  if (isOnline) await assertPubliclyAvailable(service, date, start);

  // 1) riserva gli orari (fallisce con 409 se già occupati)
  const bookingId = new mongoose.Types.ObjectId();
  await slotLocks.acquire(bookingId, date, start, end);

  // 2) salva la prenotazione; se fallisce libera gli orari
  let booking;
  try {
    booking = await Booking.create({
      _id: bookingId,
      businessId,
      serviceId: service._id,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents,
      date,
      startMinutes: start,
      endMinutes: end,
      customer,
      notes: String(input.notes || '').trim().slice(0, 500),
      source,
    });
  } catch (err) {
    await slotLocks.release(bookingId);
    throw err;
  }

  emitBookingEvent(BOOKING_EVENTS.CREATED, booking);
  return booking;
}

/** Modifica una prenotazione esistente (solo admin). */
async function updateBooking(id, input) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Prenotazione non trovata');
  const booking = await Booking.findOne({ _id: id, businessId });
  if (!booking) throw notFound('Prenotazione non trovata');
  if (booking.status === 'cancelled') throw badRequest('Non puoi modificare una prenotazione cancellata');
  const previous = booking.toObject();

  // Servizio: se cambia, aggiorna i dati copiati
  if (input.serviceId && String(input.serviceId) !== String(booking.serviceId)) {
    const service = await findService(input.serviceId, { onlyActive: false });
    booking.serviceId = service._id;
    booking.serviceName = service.name;
    booking.durationMinutes = service.durationMinutes;
    booking.priceCents = service.priceCents;
  }

  const date = input.date ?? booking.date;
  const time = input.time ?? fromMinutes(booking.startMinutes);
  const { start } = parseDateTime({ date, time });
  const end = start + booking.durationMinutes;
  if (end > 1440) throw badRequest('Il servizio terminerebbe dopo la mezzanotte');

  if (input.customer) booking.customer = parseCustomer({ ...booking.customer.toObject(), ...input.customer });
  if (input.notes !== undefined) booking.notes = String(input.notes || '').trim().slice(0, 500);

  // Riserva il nuovo intervallo (riusa i blocchi già posseduti, libera i vecchi)
  await slotLocks.acquire(booking._id, date, start, end);
  booking.date = date;
  booking.startMinutes = start;
  booking.endMinutes = end;

  try {
    await booking.save();
  } catch (err) {
    // Ripristina i lucchetti dell'orario originale
    await slotLocks.acquire(booking._id, previous.date, previous.startMinutes, previous.endMinutes).catch(() => {});
    throw err;
  }

  emitBookingEvent(BOOKING_EVENTS.UPDATED, booking, previous);
  return booking;
}

/** Cancella una prenotazione: resta nello storico ma libera l'orario. */
async function cancelBooking(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Prenotazione non trovata');
  const booking = await Booking.findOne({ _id: id, businessId });
  if (!booking) throw notFound('Prenotazione non trovata');
  if (booking.status === 'cancelled') return booking;

  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  await booking.save();
  await slotLocks.release(booking._id);

  emitBookingEvent(BOOKING_EVENTS.CANCELLED, booking);
  return booking;
}

async function listBookings({ from, to, includeCancelled = false }) {
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('Intervallo di date non valido');
  const query = { businessId, date: { $gte: from, $lte: to } };
  if (!includeCancelled) query.status = 'confirmed';
  return Booking.find(query).sort({ date: 1, startMinutes: 1 });
}

module.exports = {
  createBooking,
  updateBooking,
  cancelBooking,
  listBookings,
  serializeBooking,
  serializePublicBooking,
};
