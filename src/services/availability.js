/**
 * Calcolo degli orari disponibili.
 *
 * La funzione `computeSlots` è "pura" (niente database) così è facile da
 * testare; `getAvailability` raccoglie i dati da MongoDB e la richiama.
 *
 * Negozi con collaboratori: ogni collaboratore ha la sua agenda. Un orario è
 * libero se almeno un collaboratore adatto al servizio è libero; per
 * ciascuno contano le sue prenotazioni, i blocchi del negozio, i suoi blocchi
 * e le prenotazioni "senza collaboratore" (rimaste da prima che il negozio
 * li aggiungesse), che per prudenza occupano tutti.
 */
const { Booking, Block } = require('../models');
const { getSettings } = require('./settingsService');
const { hasStaff, candidatesFor } = require('./staffService');
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

const UNASSIGNED = '';
const keyOf = (staffId) => (staffId ? String(staffId) : UNASSIGNED);

/**
 * Prenotazioni confermate e blocchi in un intervallo di date, raggruppati per
 * giorno e per agenda: data → { agenda ("" = negozio/nessuno) → fasce occupate }.
 */
async function loadBusyByDate(businessId, fromDate, toDate, { excludeBookingId } = {}) {
  const bookingQuery = { businessId, status: 'confirmed', date: { $gte: fromDate, $lte: toDate } };
  if (excludeBookingId) bookingQuery._id = { $ne: excludeBookingId };

  const [bookings, blocks] = await Promise.all([
    Booking.find(bookingQuery, { date: 1, startMinutes: 1, endMinutes: 1, staffId: 1 }).lean(),
    Block.find({ businessId, date: { $gte: fromDate, $lte: toDate } }, { date: 1, startMinutes: 1, endMinutes: 1, staffId: 1 }).lean(),
  ]);

  const map = new Map();
  for (const item of [...bookings, ...blocks]) {
    if (!map.has(item.date)) map.set(item.date, new Map());
    const day = map.get(item.date);
    const key = keyOf(item.staffId);
    if (!day.has(key)) day.set(key, []);
    day.get(key).push({ start: item.startMinutes, end: item.endMinutes });
  }
  return map;
}

/** Fasce occupate per un'agenda: le sue più quelle "di tutti" (negozio o senza collaboratore). */
function busyFor(day, staffKey) {
  if (!day) return [];
  const shared = day.get(UNASSIGNED) || [];
  if (staffKey === null) return [...day.values()].flat(); // agenda unica: tutto conta
  return staffKey ? [...shared, ...(day.get(staffKey) || [])] : shared;
}

/**
 * Orari disponibili per un servizio in un intervallo di date (regole "online":
 * apertura, blocchi, preavviso minimo, giorni massimi in anticipo).
 *
 * @param {{slug:string, timezone:string}} business  negozio
 * @param {object} [options]
 * @param {string} [options.excludeBookingId]  ignora questa prenotazione (modifica)
 * @param {string} [options.staffId]           solo questo collaboratore
 * @returns {Promise<Map<string, number[]>>} data → minuti di inizio
 */
async function getAvailability(business, service, fromDate, toDate, options = {}) {
  const { union } = await computeAvailability(business, service, fromDate, toDate, options);
  return union;
}

/**
 * Come getAvailability, ma dice anche chi è libero:
 *  - union:   data → minuti in cui almeno qualcuno è libero
 *  - byStaff: data → Map(id collaboratore → minuti) (vuota nei negozi senza collaboratori)
 *  - staff:   i collaboratori considerati, nell'ordine del negozio
 *  - staffMode: il negozio lavora con i collaboratori
 */
async function computeAvailability(business, service, fromDate, toDate, { excludeBookingId, staffId } = {}) {
  const settings = await getSettings(business.slug);
  const now = nowInTimezone(business.timezone);
  const earliest = earliestBookable(now, settings.minNoticeMinutes);
  const lastDate = addDays(now.date, settings.maxDaysAhead);
  const staffMode = await hasStaff(business.slug);
  const result = { union: new Map(), byStaff: new Map(), staff: [], staffMode };
  if (staffMode) result.staff = await candidatesFor(business.slug, service._id, staffId);

  // Restringe l'intervallo alle sole date prenotabili
  const from = fromDate < earliest.date ? earliest.date : fromDate;
  const to = toDate > lastDate ? lastDate : toDate;
  if (from > to) return result;

  const busyByDate = await loadBusyByDate(business.slug, from, to, { excludeBookingId });
  const days = diffDays(from, to);
  for (let i = 0; i <= days; i += 1) {
    const date = addDays(from, i);
    const weekday = weekdayOf(date);
    const base = {
      duration: service.durationMinutes,
      step: settings.slotStepMinutes,
      earliestStart: date === earliest.date ? earliest.minutes : 0,
    };
    if (!staffMode) {
      result.union.set(date, computeSlots({ ...base, intervals: settings.intervalsFor(weekday), busy: busyFor(busyByDate.get(date), null) }));
      continue;
    }
    const perStaff = new Map();
    const all = new Set();
    for (const s of result.staff) {
      const key = String(s._id);
      const slots = computeSlots({ ...base, intervals: s.intervalsFor(weekday, settings), busy: busyFor(busyByDate.get(date), key) });
      perStaff.set(key, slots);
      slots.forEach((t) => all.add(t));
    }
    result.byStaff.set(date, perStaff);
    result.union.set(date, [...all].sort((a, b) => a - b));
  }
  return result;
}

module.exports = { computeSlots, earliestBookable, getAvailability, computeAvailability, loadBusyByDate };
