/**
 * Logica di business delle prenotazioni: creazione, modifica, cancellazione.
 *
 * Usata sia dalle API pubbliche (cliente online) sia da quelle admin.
 * Differenza principale: per i clienti online l'orario deve rientrare negli
 * orari disponibili (apertura, blocchi, preavviso); l'admin può inserire una
 * prenotazione a qualunque orario, purché non si sovrapponga ad un'altra.
 *
 * Negozi con collaboratori: ogni prenotazione ha il suo collaboratore. Online
 * il cliente può sceglierlo o lasciare "chiunque" (si assegna al collega
 * libero con meno appuntamenti quel giorno); dal pannello va sempre indicato.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../config');
const { Booking, Service } = require('../models');
const slotLocks = require('./slotLocks');
const { computeAvailability } = require('./availability');
const { hasStaff, findStaff } = require('./staffService');
const { BOOKING_EVENTS, emitBookingEvent } = require('./events');
const { toMinutes, fromMinutes, isValidDate, isValidTime, nowInTimezone, diffDays } = require('../utils/time');
const { HttpError, badRequest, notFound, conflict } = require('../utils/errors');

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
  return { name, phone, email, phoneKey: phoneKey(phone) };
}

/** Ultime 10 cifre del numero: "+39 333 123 4567" e "3331234567" sono lo stesso cliente. */
function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

/** Anti-spam: uno stesso numero non può tenere occupati troppi orari futuri. */
async function assertPhoneLimit(business, customer) {
  const limit = config.booking.maxActivePerPhone;
  if (!limit || !customer.phoneKey) return;
  const today = nowInTimezone(business.timezone).date;
  const active = await Booking.countDocuments({
    businessId: business.slug, status: 'confirmed', 'customer.phoneKey': customer.phoneKey, date: { $gte: today },
  });
  if (active >= limit) {
    throw new HttpError(409, `Hai già ${active} appuntamenti prenotati: per prenotarne altri contatta il negozio`, 'TOO_MANY_ACTIVE');
  }
}

const newManageToken = () => crypto.randomBytes(16).toString('hex');

function parseDateTime({ date, time }) {
  if (!isValidDate(date)) throw badRequest('Data non valida');
  if (!isValidTime(time)) throw badRequest('Orario non valido');
  return { date, start: toMinutes(time) };
}

async function findService(businessId, serviceId, { onlyActive }) {
  if (!mongoose.isValidObjectId(serviceId)) throw badRequest('Servizio non valido');
  const query = { _id: serviceId, businessId };
  if (onlyActive) query.active = true;
  const service = await Service.findOne(query);
  if (!service) throw badRequest('Servizio non trovato');
  return service;
}

const unavailable = () => conflict("L'orario scelto non è disponibile", 'SLOT_UNAVAILABLE');

/**
 * Prenotazione online: controlla che l'orario sia prenotabile e restituisce
 * le agende in cui provare a riservarlo, in ordine di preferenza.
 * [null] = agenda unica (negozio senza collaboratori).
 */
async function onlineAgendas(business, service, date, start, staffId) {
  const { union, byStaff, staff, staffMode } = await computeAvailability(business, service, date, date, { staffId: staffId || undefined });
  if (!staffMode) {
    if (!(union.get(date) || []).includes(start)) throw unavailable();
    return [null];
  }
  const free = staff.filter((s) => ((byStaff.get(date) || new Map()).get(String(s._id)) || []).includes(start));
  if (!free.length) throw unavailable();
  if (free.length === 1) return free;

  // "Chiunque": prima chi ha meno appuntamenti quel giorno (a parità, l'ordine del negozio)
  const counts = await Booking.aggregate([
    { $match: { businessId: business.slug, date, status: 'confirmed', staffId: { $in: free.map((s) => s._id) } } },
    { $group: { _id: '$staffId', n: { $sum: 1 } } },
  ]);
  const load = new Map(counts.map((c) => [String(c._id), c.n]));
  return free
    .map((s, i) => ({ s, i, n: load.get(String(s._id)) || 0 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Negozi con collaboratori: le prenotazioni rimaste senza collaboratore
 * (fatte prima di aggiungerli) occupano tutti. Il lucchetto non le vede,
 * quindi le controlliamo qui.
 */
async function assertNoUnassignedOverlap(businessId, date, start, end, excludeBookingId) {
  const query = { businessId, status: 'confirmed', date, staffId: null, startMinutes: { $lt: end }, endMinutes: { $gt: start } };
  if (excludeBookingId) query._id = { $ne: excludeBookingId };
  if (await Booking.exists(query)) {
    throw conflict("A quell'ora c'è un appuntamento non ancora assegnato a un collaboratore: assegnalo prima", 'SLOT_TAKEN');
  }
}

/** Collaboratore per una prenotazione dal pannello (obbligatorio se il negozio ne ha). */
async function adminStaff(businessId, staffId) {
  if (staffId) return findStaff(businessId, staffId);
  if (await hasStaff(businessId)) throw badRequest('Scegli il collaboratore');
  return null;
}

/* ------------------------------------------------------------------ */
/* Serializzazione                                                    */
/* ------------------------------------------------------------------ */

function serializeBooking(b) {
  return {
    id: String(b._id),
    serviceId: b.serviceId ? String(b.serviceId) : null,
    serviceName: b.serviceName,
    staffId: b.staffId ? String(b.staffId) : null,
    staffName: b.staffName || '',
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
    manageUrl: b.manageToken ? `/disdici/${b.manageToken}` : null,
    serviceName: b.serviceName,
    staffName: b.staffName || '',
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
 * @param {object} business negozio ({ slug, timezone })
 * @param {object} input  { serviceId, date, time, customer:{name,phone,email}, notes, staffId? }
 *                        staffId online: facoltativo ("chiunque"); dal pannello: obbligatorio se il negozio ha collaboratori
 * @param {object} opts   { source: 'online' | 'admin', isDemo, silent }
 *                        silent: non emette eventi (niente notifiche/sync)
 */
async function createBooking(business, input, { source = 'online', isDemo = false, silent = false } = {}) {
  const businessId = business.slug;
  const isOnline = source === 'online';
  const service = await findService(businessId, input.serviceId, { onlyActive: isOnline });
  const { date, start } = parseDateTime(input);
  const end = start + service.durationMinutes;
  if (end > 1440) throw badRequest('Il servizio terminerebbe dopo la mezzanotte');
  const customer = parseCustomer(input.customer);
  if (input.staffId && !mongoose.isValidObjectId(input.staffId)) throw badRequest('Collaboratore non valido');

  // Agende in cui provare, in ordine (null = agenda unica del negozio)
  let agendas;
  if (isOnline) {
    agendas = await onlineAgendas(business, service, date, start, input.staffId);
    if (!isDemo) await assertPhoneLimit(business, customer);
  } else {
    agendas = [await adminStaff(businessId, input.staffId)];
  }
  if (agendas[0]) await assertNoUnassignedOverlap(businessId, date, start, end);

  // 1) riserva gli orari (409 se già occupati). Con "chiunque", se nel
  //    frattempo un collega è stato preso si prova il successivo.
  const bookingId = new mongoose.Types.ObjectId();
  let staff = null;
  let taken = null;
  for (const candidate of agendas) {
    try {
      await slotLocks.acquire(businessId, bookingId, date, start, end, slotLocks.staffKeyOf(candidate && candidate._id));
      staff = candidate;
      taken = null;
      break;
    } catch (err) {
      if (err.code !== 'SLOT_TAKEN') throw err;
      taken = err;
    }
  }
  if (taken) throw taken;

  // 2) salva la prenotazione; se fallisce libera gli orari
  let booking;
  try {
    booking = await Booking.create({
      _id: bookingId,
      businessId,
      serviceId: service._id,
      serviceName: service.name,
      staffId: staff ? staff._id : undefined,
      staffName: staff ? staff.name : '',
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents,
      date,
      startMinutes: start,
      endMinutes: end,
      customer,
      notes: String(input.notes || '').trim().slice(0, 500),
      source,
      isDemo,
      manageToken: isDemo ? undefined : newManageToken(),
    });
  } catch (err) {
    await slotLocks.release(bookingId);
    throw err;
  }

  if (!silent) emitBookingEvent(BOOKING_EVENTS.CREATED, booking);
  return booking;
}

/** Modifica una prenotazione esistente (solo admin). */
async function updateBooking(business, id, input) {
  const businessId = business.slug;
  if (!mongoose.isValidObjectId(id)) throw notFound('Prenotazione non trovata');
  const booking = await Booking.findOne({ _id: id, businessId });
  if (!booking) throw notFound('Prenotazione non trovata');
  if (booking.status === 'cancelled') throw badRequest('Non puoi modificare una prenotazione cancellata');
  const previous = booking.toObject();

  // Servizio: se cambia, aggiorna i dati copiati
  if (input.serviceId && String(input.serviceId) !== String(booking.serviceId)) {
    const service = await findService(businessId, input.serviceId, { onlyActive: false });
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

  // Collaboratore: si può cambiare; nei negozi che ne hanno, una prenotazione
  // senza collaboratore può restare tale solo se non la si assegna
  if (input.staffId !== undefined && String(input.staffId || '') !== String(booking.staffId || '')) {
    const staff = await adminStaff(businessId, input.staffId);
    booking.staffId = staff ? staff._id : undefined;
    booking.staffName = staff ? staff.name : '';
  }
  if (booking.staffId) await assertNoUnassignedOverlap(businessId, date, start, end, booking._id);

  // Riserva il nuovo intervallo (riusa i blocchi già posseduti, libera i vecchi)
  await slotLocks.acquire(businessId, booking._id, date, start, end, slotLocks.staffKeyOf(booking.staffId));
  // Orario cambiato: il promemoria va rimandato per il nuovo orario
  if (date !== booking.date || start !== booking.startMinutes) booking.notifications.reminderSentAt = undefined;
  booking.date = date;
  booking.startMinutes = start;
  booking.endMinutes = end;

  try {
    await booking.save();
  } catch (err) {
    // Ripristina i lucchetti dell'orario originale
    await slotLocks.acquire(businessId, booking._id, previous.date, previous.startMinutes, previous.endMinutes, slotLocks.staffKeyOf(previous.staffId))
      .catch(() => {});
    throw err;
  }

  emitBookingEvent(BOOKING_EVENTS.UPDATED, booking, previous);
  return booking;
}

/** Cancella una prenotazione: resta nello storico ma libera l'orario. */
async function cancelBooking(business, id, { by = 'admin' } = {}) {
  const businessId = business.slug;
  if (!mongoose.isValidObjectId(id)) throw notFound('Prenotazione non trovata');
  const booking = await Booking.findOne({ _id: id, businessId });
  if (!booking) throw notFound('Prenotazione non trovata');
  if (booking.status === 'cancelled') return booking;

  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  booking.cancelledBy = by;
  await booking.save();
  await slotLocks.release(booking._id);

  emitBookingEvent(BOOKING_EVENTS.CANCELLED, booking);
  return booking;
}

/* ------------------------------------------------------------------ */
/* Link "gestisci/disdici" del cliente                                */
/* ------------------------------------------------------------------ */

async function findByManageToken(token) {
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw notFound('Prenotazione non trovata');
  const booking = await Booking.findOne({ manageToken: token });
  if (!booking || booking.anonymizedAt) throw notFound('Prenotazione non trovata');
  return booking;
}

/** Minuti che mancano all'inizio dell'appuntamento (negativi se è già passato). */
function minutesUntil(business, booking) {
  const now = nowInTimezone(business.timezone);
  return diffDays(now.date, booking.date) * 1440 + booking.startMinutes - now.minutes;
}

/** Il cliente può ancora disdire dal link? (fino a cancelNoticeMinutes prima) */
function canCustomerCancel(business, settings, booking) {
  return booking.status === 'confirmed' && minutesUntil(business, booking) >= settings.cancelNoticeMinutes;
}

async function listBookings(business, { from, to, includeCancelled = false }) {
  const businessId = business.slug;
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('Intervallo di date non valido');
  const query = { businessId, date: { $gte: from, $lte: to } };
  if (!includeCancelled) query.status = 'confirmed';
  return Booking.find(query).sort({ date: 1, startMinutes: 1 });
}

module.exports = {
  findByManageToken,
  canCustomerCancel,
  minutesUntil,
  phoneKey,
  createBooking,
  updateBooking,
  cancelBooking,
  listBookings,
  serializeBooking,
  serializePublicBooking,
};
