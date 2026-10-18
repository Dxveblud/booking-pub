/**
 * Blocchi di orari/giorni (ferie, pause, chiusure).
 */
const mongoose = require('mongoose');
const { Block, Booking } = require('../models');
const { addDays, diffDays, isValidDate, isValidTime, toMinutes, fromMinutes } = require('../utils/time');
const { badRequest, notFound } = require('../utils/errors');
const { findStaff } = require('./staffService');

const MAX_RANGE_DAYS = 366;

function serializeBlock(b) {
  return {
    id: String(b._id),
    date: b.date,
    start: fromMinutes(b.startMinutes),
    end: fromMinutes(b.endMinutes),
    allDay: b.startMinutes === 0 && b.endMinutes === 1440,
    reason: b.reason || '',
    staffId: b.staffId ? String(b.staffId) : null, // null = tutto il negozio
  };
}

function listBlocks(businessId, { from, to }) {
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('Intervallo di date non valido');
  return Block.find({ businessId, date: { $gte: from, $lte: to } }).sort({ date: 1, startMinutes: 1 });
}

/**
 * Crea uno o più blocchi: un documento per ogni giorno dell'intervallo.
 * Le prenotazioni già presenti non vengono cancellate: vengono restituite
 * come `conflicts` così l'admin può decidere cosa fare.
 *
 * @param {object} body { fromDate, toDate?, allDay, start?, end?, reason?, staffId? }
 *                      staffId: solo per quel collaboratore (es. le sue ferie)
 */
async function createBlocks(businessId, body) {
  const fromDate = body.fromDate;
  const toDate = body.toDate || body.fromDate;
  if (!isValidDate(fromDate) || !isValidDate(toDate)) throw badRequest('Date non valide');
  const days = diffDays(fromDate, toDate);
  if (days < 0) throw badRequest('La data di fine deve essere successiva a quella di inizio');
  if (days >= MAX_RANGE_DAYS) throw badRequest(`Puoi bloccare al massimo ${MAX_RANGE_DAYS} giorni alla volta`);

  let startMinutes = 0;
  let endMinutes = 1440;
  if (!body.allDay) {
    if (!isValidTime(body.start) || !isValidTime(body.end)) throw badRequest('Orari non validi');
    startMinutes = toMinutes(body.start);
    endMinutes = toMinutes(body.end);
    if (endMinutes <= startMinutes) throw badRequest("L'orario di fine deve essere dopo quello di inizio");
  }

  const staff = body.staffId ? await findStaff(businessId, body.staffId) : null;
  const reason = String(body.reason || '').trim().slice(0, 120);
  const docs = [];
  for (let i = 0; i <= days; i += 1) {
    docs.push({ businessId, date: addDays(fromDate, i), startMinutes, endMinutes, reason, staffId: staff ? staff._id : undefined });
  }
  const blocks = await Block.insertMany(docs);

  // Blocco di un collaboratore: contano i suoi appuntamenti e quelli non assegnati
  const conflicts = await Booking.find({
    businessId,
    status: 'confirmed',
    date: { $gte: fromDate, $lte: toDate },
    startMinutes: { $lt: endMinutes },
    endMinutes: { $gt: startMinutes },
    ...(staff ? { staffId: { $in: [staff._id, null] } } : {}),
  }).sort({ date: 1, startMinutes: 1 });

  return { blocks, conflicts };
}

async function deleteBlock(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Blocco non trovato');
  const res = await Block.deleteOne({ _id: id, businessId });
  if (!res.deletedCount) throw notFound('Blocco non trovato');
}

module.exports = { listBlocks, createBlocks, deleteBlock, serializeBlock };
