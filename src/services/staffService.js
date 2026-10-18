/**
 * Collaboratori di un negozio: gestione dal pannello e regole usate da
 * disponibilità e prenotazioni.
 *
 * "Modalità collaboratori": un negozio la usa appena ha almeno un
 * collaboratore attivo. Senza collaboratori tutto funziona come prima
 * (agenda unica).
 */
const mongoose = require('mongoose');
const { Staff, Booking, Service } = require('../models');
const { parseOpeningHours } = require('./settingsService');
const { fromMinutes, nowInTimezone } = require('../utils/time');
const { badRequest, notFound, conflict } = require('../utils/errors');

const MAX_STAFF = 30;

function serializeStaff(s) {
  const hours = {};
  for (let day = 0; day <= 6; day += 1) {
    const d = s.openingHours.find((x) => x.day === day);
    hours[day] = d ? d.intervals.map((i) => ({ start: fromMinutes(i.start), end: fromMinutes(i.end) })) : [];
  }
  return {
    id: String(s._id),
    name: s.name,
    active: s.active,
    sortOrder: s.sortOrder,
    serviceIds: s.serviceIds.map(String),
    customHours: s.customHours,
    openingHours: hours,
  };
}

/** Versione pubblica (widget): solo nome e id. */
const serializePublicStaff = (s) => ({ id: String(s._id), name: s.name });

function listStaff(businessId, { onlyActive = false } = {}) {
  const query = { businessId };
  if (onlyActive) query.active = true;
  return Staff.find(query).sort({ sortOrder: 1, name: 1 });
}

/** Il negozio lavora con i collaboratori? */
async function hasStaff(businessId) {
  return Boolean(await Staff.exists({ businessId, active: true }));
}

/** Collaboratori attivi che sanno fare il servizio (eventualmente solo quello indicato). */
async function candidatesFor(businessId, serviceId, staffId) {
  const list = await listStaff(businessId, { onlyActive: true });
  return list.filter((s) => s.canDo(serviceId) && (!staffId || String(s._id) === String(staffId)));
}

/** Collaboratore del negozio (anche disattivato) o errore 400. */
async function findStaff(businessId, staffId) {
  if (!mongoose.isValidObjectId(staffId)) throw badRequest('Collaboratore non valido');
  const staff = await Staff.findOne({ _id: staffId, businessId });
  if (!staff) throw badRequest('Collaboratore non trovato');
  return staff;
}

async function parseInput(businessId, body, { partial = false } = {}) {
  const data = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) throw badRequest('Il nome del collaboratore è obbligatorio');
    data.name = name;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
  if (body.serviceIds !== undefined) {
    if (!Array.isArray(body.serviceIds)) throw badRequest('Servizi non validi');
    const ids = [...new Set(body.serviceIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
    const found = await Service.countDocuments({ businessId, _id: { $in: ids } });
    if (found !== ids.length) throw badRequest('Uno dei servizi indicati non esiste');
    data.serviceIds = ids;
  }
  if (body.customHours !== undefined) data.customHours = Boolean(body.customHours);
  if (body.openingHours !== undefined) data.openingHours = parseOpeningHours(body.openingHours);
  return data;
}

async function createStaff(businessId, body) {
  if (await Staff.countDocuments({ businessId }) >= MAX_STAFF) throw badRequest(`Massimo ${MAX_STAFF} collaboratori per negozio`);
  const data = await parseInput(businessId, body);
  if (data.sortOrder === undefined) data.sortOrder = await Staff.countDocuments({ businessId });
  return Staff.create({ businessId, ...data });
}

async function updateStaff(businessId, id, body) {
  const staff = await findStaff(businessId, id).catch(() => { throw notFound('Collaboratore non trovato'); });
  const data = await parseInput(businessId, body, { partial: true });
  const renamed = data.name && data.name !== staff.name;
  Object.assign(staff, data);
  await staff.save();
  // Il nome è copiato nelle prenotazioni future: lo teniamo allineato
  if (renamed) {
    const today = nowInTimezone('Europe/Rome').date;
    await Booking.updateMany({ businessId, staffId: staff._id, date: { $gte: today } }, { $set: { staffName: staff.name } });
  }
  return staff;
}

/** Elimina un collaboratore solo se non ha appuntamenti futuri (altrimenti va disattivato). */
async function deleteStaff(businessId, id) {
  const staff = await findStaff(businessId, id).catch(() => { throw notFound('Collaboratore non trovato'); });
  const today = nowInTimezone('Europe/Rome').date;
  const future = await Booking.countDocuments({ businessId, staffId: staff._id, status: 'confirmed', date: { $gte: today } });
  if (future) {
    throw conflict(`${staff.name} ha ancora ${future} appuntamenti in programma: spostali a un collega o disattivalo`, 'STAFF_HAS_BOOKINGS');
  }
  await staff.deleteOne();
}

module.exports = {
  serializeStaff,
  serializePublicStaff,
  listStaff,
  hasStaff,
  candidatesFor,
  findStaff,
  createStaff,
  updateStaff,
  deleteStaff,
};
