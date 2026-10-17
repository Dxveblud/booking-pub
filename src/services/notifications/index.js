/**
 * Notifiche ai clienti / all'attività — PREDISPOSIZIONE, non ancora attive.
 *
 * Ogni "provider" (email, WhatsApp, SMS…) espone la stessa interfaccia:
 *   { name, isEnabled(), send({ to, template, booking }) }
 *
 * Per aggiungere un canale:
 *   1. implementa `send` nel file del provider (es. email.js);
 *   2. fai restituire `true` a `isEnabled()` (es. leggendo una variabile d'ambiente);
 *   3. nient'altro: i listener qui sotto lo useranno automaticamente.
 */
const { BOOKING_EVENTS, onBookingEvent } = require('../events');
const emailProvider = require('./email');
const whatsappProvider = require('./whatsapp');

const providers = [emailProvider, whatsappProvider];

async function notifyAll(template, booking) {
  const active = providers.filter((p) => p.isEnabled());
  await Promise.all(active.map((p) => p.send({ template, booking })));
}

function registerNotificationListeners() {
  onBookingEvent(BOOKING_EVENTS.CREATED, (booking) => notifyAll('booking-confirmed', booking));
  onBookingEvent(BOOKING_EVENTS.UPDATED, (booking) => notifyAll('booking-updated', booking));
  onBookingEvent(BOOKING_EVENTS.CANCELLED, (booking) => notifyAll('booking-cancelled', booking));
  // TODO: promemoria (es. 24h prima) tramite un job schedulato che usa
  // booking.notifications.reminderSentAt per non inviare doppioni.
}

module.exports = { registerNotificationListeners, providers };
