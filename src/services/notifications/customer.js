/**
 * Email ai clienti (solo se hanno lasciato l'indirizzo):
 *  - conferma della prenotazione, con il link per disdire;
 *  - appuntamento spostato o annullato dal negozio;
 *  - conferma della disdetta fatta dal cliente;
 *  - promemoria qualche ora prima (Settings.reminderHours), da un job periodico.
 *
 * Il negozio dimostrativo non manda email: nessuno può usare la demo per
 * far arrivare messaggi a indirizzi altrui.
 */
const config = require('../../config');
const mailer = require('../mailer');
const { Booking } = require('../../models');
const { getBusiness } = require('../businessService');
const { getSettings } = require('../settingsService');
const { fromMinutes, nowInTimezone, addDays, diffDays } = require('../../utils/time');
const { BOOKING_EVENTS, onBookingEvent } = require('../events');
const { renderEmail, formatPrice, when, publicUrl } = require('./layout');
const { writeReviewUrl } = require('../googleReviews');

const REMINDER_INTERVAL_MS = 10 * 60 * 1000;

/** Il negozio può mandare email ai clienti? (usato anche dal widget per mostrare il campo email) */
function customerEmailsEnabled(business) {
  if (!mailer.isEnabled() || !business) return false;
  return !(config.demo.enabled && business.slug === config.platform.demoShop);
}

function rows(business, booking) {
  const list = [
    ['Servizio', booking.serviceName],
    ['Quando', `${when(business, booking)} – ${fromMinutes(booking.endMinutes)}`],
    ['Prezzo', `${formatPrice(booking.priceCents, business)} (si paga in negozio)`],
  ];
  if (booking.staffName) list.splice(2, 0, ['Con', booking.staffName]);
  if (business.address) list.push(['Dove', business.address]);
  if (business.phone) list.push(['Telefono', business.phone]);
  return list;
}

function build(business, booking, { eyebrow, subject, intro, outro, withLink = true }) {
  const manage = withLink && booking.manageToken ? publicUrl(`/disdici/${booking.manageToken}`) : '';
  const { html, text } = renderEmail({
    business,
    eyebrow,
    intro,
    rows: rows(business, booking),
    button: manage ? { href: manage, label: 'Gestisci o disdici' } : null,
    outro,
    footer: `Hai ricevuto questa email perché hai prenotato da ${business.name}.`,
    links: business.phone ? { Telefono: `tel:${business.phone.replace(/[^+\d]/g, '')}` } : {},
  });
  return { subject, text, html, replyTo: business.email || undefined, fromName: business.name };
}

/** Link per lasciare una recensione: quello inserito a mano, o quello della scheda Google collegata. */
const reviewLink = (b) => (b.reviews && b.reviews.writeUrl) || writeReviewUrl(b.google && b.google.placeId);

const firstName = (booking) => String(booking.customer.name || '').split(' ')[0];

const TEMPLATES = {
  confirmed: (b, k) => build(b, k, {
    eyebrow: 'Prenotazione confermata',
    subject: `Prenotazione confermata: ${k.serviceName}, ${when(b, k)}`,
    intro: `Ciao ${firstName(k)}, il tuo posto è riservato. Ecco il riepilogo.`,
    outro: 'Se non puoi venire, disdici dal pulsante qui sopra: liberi il posto per qualcun altro.',
  }),
  updated: (b, k) => build(b, k, {
    eyebrow: 'Appuntamento modificato',
    subject: `Il tuo appuntamento è stato modificato: ${when(b, k)}`,
    intro: `Ciao ${firstName(k)}, ${b.name} ha modificato il tuo appuntamento. Questi sono i nuovi dettagli.`,
    outro: "Se il nuovo orario non va bene, disdici dal pulsante qui sopra o chiama il negozio.",
  }),
  cancelledByShop: (b, k) => build(b, k, {
    eyebrow: 'Appuntamento annullato',
    subject: `Appuntamento annullato: ${when(b, k)}`,
    intro: `Ciao ${firstName(k)}, ${b.name} ha annullato questo appuntamento. Per sceglierne un altro puoi prenotare di nuovo o chiamare il negozio.`,
    withLink: false,
  }),
  cancelledByCustomer: (b, k) => build(b, k, {
    eyebrow: 'Disdetta registrata',
    subject: `Hai disdetto l'appuntamento del ${when(b, k)}`,
    intro: `Ciao ${firstName(k)}, abbiamo registrato la tua disdetta. Grazie per aver liberato il posto.`,
    withLink: false,
  }),
  reminder: (b, k) => build(b, k, {
    eyebrow: 'Promemoria',
    subject: `Promemoria: ${k.serviceName} ${when(b, k)}`,
    intro: `Ciao ${firstName(k)}, ti ricordiamo il tuo appuntamento.`,
    outro: 'Se non puoi più venire, disdici dal pulsante qui sopra.',
  }),
  review: (b, k) => {
    const { html, text } = renderEmail({
      business: b,
      eyebrow: "Com'è andata?",
      intro: `Ciao ${firstName(k)}, grazie per essere passato da ${b.name}! Ti è piaciuto il risultato? Ci aiuteresti moltissimo lasciando una recensione su Google: bastano 30 secondi.`,
      rows: [['Servizio', k.serviceName], ['Quando', when(b, k)]].concat(k.staffName ? [['Con', k.staffName]] : []),
      button: { href: reviewLink(b), label: 'Lascia una recensione' },
      outro: 'Se qualcosa non è andato come speravi, rispondi a questa email: ci teniamo a saperlo.',
      footer: `Hai ricevuto questa email perché hai avuto un appuntamento da ${b.name}.`,
    });
    return { subject: `Com'è andata da ${b.name}?`, text, html, replyTo: b.email || undefined, fromName: b.name };
  },
};

async function send(template, booking) {
  if (booking.isDemo || !booking.customer.email) return false;
  const business = await getBusiness(booking.businessId);
  if (!customerEmailsEnabled(business)) return false;
  return mailer.sendMail({ to: booking.customer.email, ...TEMPLATES[template](business, booking) });
}

async function onCreated(booking) {
  if (await send('confirmed', booking)) {
    await Booking.updateOne({ _id: booking._id }, { $set: { 'notifications.confirmationSentAt': new Date() } });
  }
}

function onUpdated(booking, previous) {
  const moved = previous && (previous.date !== booking.date || previous.startMinutes !== booking.startMinutes
    || String(previous.serviceId) !== String(booking.serviceId));
  return moved ? send('updated', booking) : false;
}

function onCancelled(booking) {
  return send(booking.cancelledBy === 'customer' ? 'cancelledByCustomer' : 'cancelledByShop', booking);
}

/* ------------------------------ Promemoria ------------------------------ */

/**
 * Manda i promemoria dovuti. Una prenotazione riceve il promemoria quando
 * mancano meno di `reminderHours` ore (e più di 30 minuti), solo se è stata
 * fatta prima di quella finestra: chi prenota per tra due ore ha appena
 * ricevuto la conferma e non gli serve altro.
 */
async function sendDueReminders() {
  if (!mailer.isEnabled()) return 0;
  const today = nowInTimezone('Europe/Rome').date;
  // Le date sono nel fuso di ogni negozio: un giorno di margine copre qualunque fuso
  const candidates = await Booking.find({
    status: 'confirmed',
    isDemo: { $ne: true },
    'customer.email': { $nin: ['', null] },
    'notifications.reminderSentAt': null,
    date: { $gte: addDays(today, -1), $lte: addDays(today, 8) },
  });

  let sent = 0;
  for (const booking of candidates) {
    const business = await getBusiness(booking.businessId);
    if (!business || !business.active || !customerEmailsEnabled(business)) continue;
    const { reminderHours } = await getSettings(business.slug);
    if (!reminderHours) continue;

    const now = nowInTimezone(business.timezone);
    const minutesLeft = diffDays(now.date, booking.date) * 1440 + booking.startMinutes - now.minutes;
    const window = reminderHours * 60;
    const bookedAhead = minutesLeft + (Date.now() - booking.createdAt.getTime()) / 60000;
    if (minutesLeft > window || minutesLeft < 30 || bookedAhead <= window) continue;

    // Segna prima di inviare: con più processi nessun promemoria parte due volte
    const claimed = await Booking.updateOne(
      { _id: booking._id, 'notifications.reminderSentAt': null },
      { $set: { 'notifications.reminderSentAt': new Date() } }
    );
    if (!claimed.modifiedCount) continue;
    try {
      await mailer.sendMail({ to: booking.customer.email, ...TEMPLATES.reminder(business, booking) });
      sent += 1;
    } catch (err) {
      console.error('[promemoria] Invio non riuscito:', err.message);
      await Booking.updateOne({ _id: booking._id }, { $unset: { 'notifications.reminderSentAt': 1 } });
    }
  }
  return sent;
}

/* ------------------------- "Com'è andata?" ------------------------------ */

/**
 * Dopo l'appuntamento (reviewDelayMinutes dalla fine, default 60) chiede al
 * cliente una recensione su Google, se il negozio ha inserito il link per
 * lasciarla. Una sola volta per prenotazione, e solo entro le 24 ore
 * successive: dopo un aggiornamento non partono richieste per appuntamenti vecchi.
 */
async function sendDueReviewRequests() {
  if (!mailer.isEnabled()) return 0;
  const today = nowInTimezone('Europe/Rome').date;
  const candidates = await Booking.find({
    status: 'confirmed',
    isDemo: { $ne: true },
    'customer.email': { $nin: ['', null] },
    'notifications.reviewRequestSentAt': null,
    date: { $gte: addDays(today, -2), $lte: addDays(today, 1) },
  });

  let sent = 0;
  for (const booking of candidates) {
    const business = await getBusiness(booking.businessId);
    if (!business || !business.active || !customerEmailsEnabled(business)) continue;
    if (!reviewLink(business)) continue;
    const { reviewDelayMinutes } = await getSettings(business.slug);
    if (!reviewDelayMinutes) continue;

    const now = nowInTimezone(business.timezone);
    // Minuti passati dalla fine dell'appuntamento (giorni di differenza × 1440 + minuti)
    const sinceEnd = diffDays(booking.date, now.date) * 1440 + now.minutes - booking.endMinutes;
    if (sinceEnd < reviewDelayMinutes || sinceEnd > reviewDelayMinutes + 24 * 60) continue;

    const claimed = await Booking.updateOne(
      { _id: booking._id, 'notifications.reviewRequestSentAt': null },
      { $set: { 'notifications.reviewRequestSentAt': new Date() } }
    );
    if (!claimed.modifiedCount) continue;
    try {
      await mailer.sendMail({ to: booking.customer.email, ...TEMPLATES.review(business, booking) });
      sent += 1;
    } catch (err) {
      console.error('[recensioni] Invio non riuscito:', err.message);
      await Booking.updateOne({ _id: booking._id }, { $unset: { 'notifications.reviewRequestSentAt': 1 } });
    }
  }
  return sent;
}

function startReminderJob() {
  const run = () => Promise.all([sendDueReminders(), sendDueReviewRequests()]).catch((err) => console.error('[promemoria]', err));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, REMINDER_INTERVAL_MS).unref();
}

function registerCustomerNotifications() {
  onBookingEvent(BOOKING_EVENTS.CREATED, onCreated);
  onBookingEvent(BOOKING_EVENTS.UPDATED, onUpdated);
  onBookingEvent(BOOKING_EVENTS.CANCELLED, onCancelled);
}

module.exports = {
  registerCustomerNotifications, customerEmailsEnabled, sendDueReminders, sendDueReviewRequests, startReminderJob, TEMPLATES,
};
