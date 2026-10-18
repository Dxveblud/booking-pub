/**
 * Notifiche.
 *
 *  - owner.js     email al titolare (nuova prenotazione online, disdetta)       — ATTIVO
 *  - customer.js  email al cliente (conferma, modifica, disdetta, promemoria)   — ATTIVO
 *  - whatsapp.js  messaggi WhatsApp                                             — PREDISPOSIZIONE
 *
 * Le email partono solo se in .env c'è SMTP_HOST (vedi services/mailer.js).
 *
 * Ogni "provider" (WhatsApp, SMS…) espone la stessa interfaccia:
 *   { name, isEnabled(), send({ to, template, booking }) }
 * Per aggiungerne uno:
 *   1. implementa `send` nel file del provider (es. whatsapp.js);
 *   2. fai restituire `true` a `isEnabled()` (es. leggendo una variabile d'ambiente);
 *   3. nient'altro: i listener qui sotto lo useranno automaticamente.
 */
const { BOOKING_EVENTS, onBookingEvent } = require('../events');
const whatsappProvider = require('./whatsapp');
const { registerOwnerNotifications } = require('./owner');
const { registerCustomerNotifications } = require('./customer');

const providers = [whatsappProvider];

async function notifyAll(template, booking) {
  const active = providers.filter((p) => p.isEnabled());
  await Promise.all(active.map((p) => p.send({ template, booking })));
}

function registerNotificationListeners() {
  registerOwnerNotifications();
  registerCustomerNotifications();
  onBookingEvent(BOOKING_EVENTS.CREATED, (booking) => notifyAll('booking-confirmed', booking));
  onBookingEvent(BOOKING_EVENTS.UPDATED, (booking) => notifyAll('booking-updated', booking));
  onBookingEvent(BOOKING_EVENTS.CANCELLED, (booking) => notifyAll('booking-cancelled', booking));
}

module.exports = { registerNotificationListeners, providers };
