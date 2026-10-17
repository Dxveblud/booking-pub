/**
 * SlotLock: il meccanismo che impedisce le doppie prenotazioni.
 *
 * Ogni prenotazione "occupa" una serie di blocchi da LOCK_UNIT_MINUTES minuti
 * (es. 10:00–10:30 → 10:00, 10:05, …, 10:25). Ogni blocco è un documento con
 * indice UNIVOCO su (businessId, date, minute): se due richieste provano a
 * prenotare lo stesso orario nello stesso istante, MongoDB ne accetta solo una
 * e l'altra riceve un errore di chiave duplicata.
 *
 * Funziona anche su MongoDB standalone (senza replica set / transazioni).
 */
const mongoose = require('mongoose');

const LOCK_UNIT_MINUTES = 5;

const slotLockSchema = new mongoose.Schema({
  businessId: { type: String, required: true },
  date: { type: String, required: true }, // "YYYY-MM-DD"
  minute: { type: Number, required: true }, // minuti dalla mezzanotte
  bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
});

slotLockSchema.index({ businessId: 1, date: 1, minute: 1 }, { unique: true });

const SlotLock = mongoose.model('SlotLock', slotLockSchema);

module.exports = SlotLock;
module.exports.LOCK_UNIT_MINUTES = LOCK_UNIT_MINUTES;
