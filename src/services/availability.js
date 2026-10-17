/**
 * Calcolo degli orari disponibili.
 *
 * La funzione `computeSlots` è "pura" (niente database) così è facile da
 * testare; `getAvailability` raccoglie i dati da MongoDB e la richiama.
 */
const { Booking, Block } = require('../models');
const config = require('../config');
const { getSettings } = require('./settingsService');
const { addDays, weekdayOf, nowInTimezone, overlaps, diffDays } = require('../utils/time');

/**
 * Restituisce gli orari di inizio possibili (in minuti) per un giorno.
 *
 * @param {object} p
 * @param {number} p.duration        durata del servizio in minuti
 * @param {{start:number,end:number}[]} p.intervals  fasce di apertura del giorno
 * @param {{start:number,end:number}[]} p.busy       fasce occupate (prenotazioni + blocchi)
 * @param {number} p.step            passo tra un orario e il successivo
 * @param {number} [p.earliestStart] primo minuto prenotabile (preavviso minimo)
 * @returns {number[]}
 */
function computeSlots({ duration, intervals, busy, step, earliestStart = 0 }) {
  const slots = [];
  for (const { start, end } of intervals) {
    for (let t = start; t + duration <= end; t += step) {
      if (t < earliestStart) continue;
      const isBusy = busy.some((b) => overlaps(t, t + duration, b.start, b.end));
      if (!isBusy) slots.push(t);
    }
  }
  return slots;
}

/**
 * Calcola da quale data/minuto si può prenotare, considerando il preavviso.
 * Gestisce anche preavvisi più lunghi di un giorno.
 */
function earliestBookable(now, minNoticeMinutes) {
  const total = now.minutes + minNoticeMinutes;
  return {
    date: addDays(now.date, Math.floor(total / 1440)),
    minutes: total % 1440,
  };
}

/** Prenotazioni confermate e blocchi in un intervallo di date, raggruppati per giorno. */
async function loadBusyByDate(fromDate, toDate, { excludeBookingId } = {}) {
  const businessId = config.business.id;
  const bookingQuery = { businessId, status: 'confirmed', date: { $gte: fromDate, $lte: toDate } };
  if (excludeBookingId) bookingQuery._id = { $ne: excludeBookingId };

  const [bookings, blocks] = await Promise.all([
    Booking.find(bookingQuery, { date: 1, startMinutes: 1, endMinutes: 1 }).lean(),
    Block.find({ businessId, date: { $gte: fromDate, $lte: toDate } }, { date: 1, startMinutes: 1, endMinutes: 1 }).lean(),
  ]);

  const map = new Map();
  for (const item of [...bookings, ...blocks]) {
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push({ start: item.startMinutes, end: item.endMinutes });
  }
  return map;
}

/**
 * Orari disponibili per un servizio in un intervallo di date (regole "online":
 * apertura, blocchi, preavviso minimo, giorni massimi in anticipo).
 *
 * @returns {Promise<Map<string, number[]>>} data → minuti di inizio
 */
async function getAvailability(service, fromDate, toDate, options = {}) {
  const settings = await getSettings();
  const now = nowInTimezone(config.business.timezone);
  const earliest = earliestBookable(now, settings.minNoticeMinutes);
  const lastDate = addDays(now.date, settings.maxDaysAhead);

  // Restringe l'intervallo alle sole date prenotabili
  const from = fromDate < earliest.date ? earliest.date : fromDate;
  const to = toDate > lastDate ? lastDate : toDate;
  const result = new Map();
  if (from > to) return result;

  const busyByDate = await loadBusyByDate(from, to, options);
  const days = diffDays(from, to);
  for (let i = 0; i <= days; i += 1) {
    const date = addDays(from, i);
    result.set(
      date,
      computeSlots({
        duration: service.durationMinutes,
        intervals: settings.intervalsFor(weekdayOf(date)),
        busy: busyByDate.get(date) || [],
        step: settings.slotStepMinutes,
        earliestStart: date === earliest.date ? earliest.minutes : 0,
      })
    );
  }
  return result;
}

module.exports = { computeSlots, earliestBookable, getAvailability, loadBusyByDate };
