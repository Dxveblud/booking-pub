/**
 * Modalità demo (config.json → "demo.enabled": true).
 *
 * Pensata per la vetrina/portfolio: fa sembrare il gestionale "vivo".
 *  - Quando cambia `demo.seedVersion` ricarica servizi e orari da config.json
 *    e rigenera le prenotazioni di esempio.
 *  - Tiene occupati circa `fillRatio` degli orari nei prossimi `daysToFill`
 *    giorni con prenotazioni finte (isDemo: true), così il widget mostra una
 *    disponibilità realistica e il calendario admin non è vuoto.
 *
 * Le prenotazioni finte non emettono eventi (niente notifiche) e non toccano
 * quelle vere fatte dai visitatori. NON attivarla per un'attività reale.
 */
const config = require('../config');
const { Booking, Service, SlotLock } = require('../models');
const { getSettings, openingHoursFromConfig } = require('./settingsService');
const { seedDefaultServices } = require('./bootstrap');
const { getAvailability } = require('./availability');
const { createBooking } = require('./bookingService');
const { addDays, fromMinutes, nowInTimezone, weekdayOf } = require('../utils/time');

const businessId = config.business.id;
const REFRESH_MS = 6 * 60 * 60 * 1000; // ogni 6 ore

const FIRST_NAMES = [
  'Marco', 'Luca', 'Andrea', 'Matteo', 'Alessandro', 'Davide', 'Simone', 'Federico', 'Lorenzo', 'Riccardo',
  'Giacomo', 'Tommaso', 'Nicola', 'Stefano', 'Paolo', 'Filippo', 'Gabriele', 'Michele', 'Daniele', 'Pietro',
  'Edoardo', 'Samuele', 'Antonio', 'Giovanni', 'Fabio', 'Emanuele', 'Mattia', 'Leonardo', 'Enrico', 'Diego',
];
const LAST_INITIALS = 'BCDFGLMNPRSTV';
const NOTES = ['', '', '', '', '', 'Prima volta', 'Solo sfumatura laterale', 'Porta il bambino', 'Arriva 5 min prima', 'Cliente abituale'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fakeCustomer() {
  const digits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return {
    name: `${pick(FIRST_NAMES)} ${pick(LAST_INITIALS.split(''))}.`,
    phone: `+39 3${Math.floor(Math.random() * 50 + 20)} 000 ${digits}`,
  };
}

/** Rimuove le prenotazioni demo (e i relativi lucchetti) da una certa data in poi. */
async function clearDemoBookings(fromDate = '0000-00-00') {
  const ids = (await Booking.find({ businessId, isDemo: true, date: { $gte: fromDate } }, { _id: 1 }).lean()).map((b) => b._id);
  if (!ids.length) return;
  await SlotLock.deleteMany({ bookingId: { $in: ids } });
  await Booking.deleteMany({ _id: { $in: ids } });
}

/** Ricarica servizi, orari e regole da config.json (solo quando cambia seedVersion). */
async function applySeed(settings) {
  console.log(`[demo] Carico i dati di esempio (versione ${config.demo.seedVersion})`);
  await clearDemoBookings();
  await Service.deleteMany({ businessId });
  await seedDefaultServices();
  settings.openingHours = openingHoursFromConfig(config.defaults.openingHours);
  settings.slotStepMinutes = config.booking.slotStepMinutes;
  settings.minNoticeMinutes = config.booking.minNoticeMinutes;
  settings.maxDaysAhead = config.booking.maxDaysAhead;
  settings.demoSeedVersion = config.demo.seedVersion;
  await settings.save();
}

/** Riempie un giorno con prenotazioni finte, rispettando orari e disponibilità reali. */
async function fillDay(date, services, settings) {
  const intervals = settings.intervalsFor(weekdayOf(date));
  let created = 0;
  for (const { start, end } of intervals) {
    let t = start;
    while (t < end) {
      if (Math.random() < config.demo.fillRatio) {
        const service = pick(services);
        // eslint-disable-next-line no-await-in-loop
        const slots = (await getAvailability(service, date, date)).get(date) || [];
        if (slots.includes(t)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await createBooking(
              { serviceId: service._id, date, time: fromMinutes(t), customer: fakeCustomer(), notes: pick(NOTES) },
              { source: Math.random() < 0.7 ? 'online' : 'admin', isDemo: true, silent: true }
            );
            created += 1;
            t += service.durationMinutes;
            continue;
          } catch {
            /* orario preso nel frattempo: si va avanti */
          }
        }
      }
      t += settings.slotStepMinutes * (1 + Math.floor(Math.random() * 2));
    }
  }
  return created;
}

async function refreshDemoData() {
  const settings = await getSettings();
  if (settings.demoSeedVersion !== config.demo.seedVersion) await applySeed(settings);

  const services = await Service.find({ businessId, active: true });
  if (!services.length) return;

  // Giorni futuri senza prenotazioni demo → da riempire (oggi incluso, solo orari futuri)
  const today = nowInTimezone(config.business.timezone).date;
  let total = 0;
  for (let i = 0; i <= config.demo.daysToFill; i += 1) {
    const date = addDays(today, i);
    // eslint-disable-next-line no-await-in-loop
    const already = await Booking.exists({ businessId, isDemo: true, date });
    // eslint-disable-next-line no-await-in-loop
    if (!already) total += await fillDay(date, services, settings);
  }
  if (total) console.log(`[demo] Aggiunte ${total} prenotazioni di esempio`);
}

function startDemoMode() {
  if (!config.demo.enabled) return;
  const run = () => refreshDemoData().catch((err) => console.error('[demo] Errore:', err));
  run();
  setInterval(run, REFRESH_MS).unref();
}

module.exports = { startDemoMode, refreshDemoData, clearDemoBookings };
