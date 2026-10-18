/**
 * Gestione dei "lucchetti" sugli orari (vedi models/SlotLock.js).
 *
 * acquire() riserva tutti i blocchi da 5 minuti di un intervallo, in una
 * agenda (il collaboratore, o l'agenda unica del negozio), per una
 * prenotazione. Se anche solo uno è già occupato, annulla quanto fatto e
 * lancia un errore 409: è questo che garantisce l'assenza di doppie
 * prenotazioni anche con richieste simultanee.
 */
const { SlotLock } = require('../models');
const { LOCK_UNIT_MINUTES, LEGACY_INDEX } = require('../models/SlotLock');
const { conflict } = require('../utils/errors');

const DUPLICATE_KEY = 11000;

/** Chiave dell'agenda: id del collaboratore, oppure "" per l'agenda unica. */
const staffKeyOf = (staffId) => (staffId ? String(staffId) : '');

function keysFor(date, start, end, staffKey = '') {
  const keys = [];
  // Allinea l'inizio alla griglia da 5 minuti (es. 10:02 → 10:00)
  const first = Math.floor(start / LOCK_UNIT_MINUTES) * LOCK_UNIT_MINUTES;
  for (let m = first; m < end; m += LOCK_UNIT_MINUTES) keys.push({ staffKey, date, minute: m });
  return keys;
}

const keyId = (k) => `${k.staffKey || ''}|${k.date}|${k.minute}`;
const keyFilter = (k) => ({ staffKey: k.staffKey || '', date: k.date, minute: k.minute });

/**
 * Riserva l'intervallo [start, end) del giorno `date` nell'agenda `staffKey`
 * per `bookingId`. I blocchi già posseduti dalla stessa prenotazione (in caso
 * di modifica) vengono riutilizzati; quelli non più necessari vengono liberati.
 */
async function acquire(businessId, bookingId, date, start, end, staffKey = '') {
  const wanted = keysFor(date, start, end, staffKey);
  const owned = await SlotLock.find({ bookingId }, { staffKey: 1, date: 1, minute: 1 }).lean();
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
      await SlotLock.deleteMany({ bookingId, $or: toAdd.map(keyFilter) });
      if (err.code === DUPLICATE_KEY || err.writeErrors?.some((e) => e.code === DUPLICATE_KEY)) {
        throw conflict("L'orario scelto non è più disponibile", 'SLOT_TAKEN');
      }
      throw err;
    }
  }

  // Libera i blocchi che la prenotazione non usa più (es. orario o collaboratore cambiato)
  const wantedIds = new Set(wanted.map(keyId));
  const stale = owned.filter((k) => !wantedIds.has(keyId(k)));
  if (stale.length) {
    await SlotLock.deleteMany({ bookingId, $or: stale.map(keyFilter) });
  }
}

/** Libera tutti gli orari di una prenotazione (cancellazione). */
async function release(bookingId) {
  await SlotLock.deleteMany({ bookingId });
}

/**
 * Migrazione per le installazioni precedenti ai collaboratori: i lucchetti
 * esistenti finiscono nell'agenda unica ("") e il vecchio indice univoco
 * (una sola agenda per negozio) viene sostituito da quello per agenda.
 */
async function migrateLocks() {
  await SlotLock.updateMany({ staffKey: { $exists: false } }, { $set: { staffKey: '' } });
  const indexes = await SlotLock.collection.indexes().catch(() => []);
  if (indexes.some((i) => i.name === LEGACY_INDEX)) {
    await SlotLock.collection.dropIndex(LEGACY_INDEX);
    console.log("[bootstrap] Lucchetti degli orari: ora un'agenda per collaboratore");
  }
  await SlotLock.syncIndexes();
}

module.exports = { acquire, release, keysFor, staffKeyOf, migrateLocks };
