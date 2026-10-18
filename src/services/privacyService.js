/**
 * Conservazione dei dati dei clienti (GDPR).
 *
 * Una volta al giorno, per le prenotazioni più vecchie di
 * privacy.retentionMonths (config.json, default 24 mesi) cancella nome,
 * telefono, email e note del cliente. La prenotazione resta, anonima, così
 * lo storico e i conteggi del negozio non cambiano.
 */
const config = require('../config');
const { Booking } = require('../models');
const { nowInTimezone, addDays } = require('../utils/time');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data (YYYY-MM-DD) prima della quale i dati vanno cancellati. */
function cutoffDate(months = config.privacy.retentionMonths) {
  return addDays(nowInTimezone('Europe/Rome').date, -Math.round(months * 30.44));
}

async function anonymizeOldBookings(months = config.privacy.retentionMonths) {
  if (!months || months <= 0) return 0;
  const res = await Booking.updateMany(
    { date: { $lt: cutoffDate(months) }, anonymizedAt: null },
    {
      $set: {
        'customer.name': 'Cliente',
        'customer.phone': '-',
        'customer.email': '',
        'customer.phoneKey': '',
        notes: '',
        anonymizedAt: new Date(),
      },
      $unset: { manageToken: 1 },
    }
  );
  if (res.modifiedCount) console.log(`[privacy] Anonimizzate ${res.modifiedCount} prenotazioni più vecchie di ${months} mesi`);
  return res.modifiedCount;
}

function startPrivacyJob() {
  const run = () => anonymizeOldBookings().catch((err) => console.error('[privacy]', err));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
}

module.exports = { anonymizeOldBookings, cutoffDate, startPrivacyJob };
