/**
 * Gestione dei "lucchetti" sugli orari (vedi models/SlotLock.js).
 *
 * acquire() riserva tutti i blocchi da 5 minuti di un intervallo per una
 * prenotazione. Se anche solo uno è già occupato, annulla quanto fatto e
 * lancia un errore 409: è questo che garantisce l'assenza di doppie
 * prenotazioni anche con richieste simultanee.
 */
const { SlotLock } = require('../models');
const { LOCK_UNIT_MINUTES } = require('../models/SlotLock');
const { conflict } = require('../utils/errors');

const DUPLICATE_KEY = 11000;

function keysFor(date, start, end) {
  const keys = [];
  // Allinea l'inizio alla griglia da 5 minuti (es. 10:02 → 10:00)
  const first = Math.floor(start / LOCK_UNIT_MINUTES) * LOCK_UNIT_MINUTES;
  for (let m = first; m < end; m += LOCK_UNIT_MINUTES) keys.push({ date, minute: m });
  return keys;
}

const keyId = (k) => `${k.date}|${k.minute}`;

/**
 * Riserva l'intervallo [start, end) del giorno `date` per `bookingId`.
 * I blocchi già posseduti dalla stessa prenotazione (in caso di modifica)
 * vengono riutilizzati; quelli non più necessari vengono liberati.
 */
async function acquire(businessId, bookingId, date, start, end) {
  const wanted = keysFor(date, start, end);
  const owned = await SlotLock.find({ bookingId }, { date: 1, minute: 1 }).lean();
  const ownedIds = new Set(owned.map(keyId));
  const toAdd = wanted.filter((k) => !ownedIds.has(keyId(k)));

  if (toAdd.length) {
    try {
      await SlotLock.insertMany(
        toAdd.map((k) => ({ ...k, businessId, bookingId })),
        { ordered: true }
      );
    } catch (err) {
      // Rollback dei blocchi appena inseriti prima del conflitto
      await SlotLock.deleteMany({
        bookingId,
        $or: toAdd.map((k) => ({ date: k.date, minute: k.minute })),
      });
      if (err.code === DUPLICATE_KEY || err.writeErrors?.some((e) => e.code === DUPLICATE_KEY)) {
        throw conflict("L'orario scelto non è più disponibile", 'SLOT_TAKEN');
      }
      throw err;
    }
  }

  // Libera i blocchi che la prenotazione non usa più (es. orario spostato)
  const wantedIds = new Set(wanted.map(keyId));
  const stale = owned.filter((k) => !wantedIds.has(keyId(k)));
  if (stale.length) {
    await SlotLock.deleteMany({ bookingId, $or: stale.map((k) => ({ date: k.date, minute: k.minute })) });
  }
}

/** Libera tutti gli orari di una prenotazione (cancellazione). */
async function release(bookingId) {
  await SlotLock.deleteMany({ bookingId });
}

module.exports = { acquire, release, keysFor };
