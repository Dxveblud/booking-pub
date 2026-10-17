/**
 * Sincronizzazione con Google Calendar — PREDISPOSIZIONE, non ancora attiva.
 *
 * Come implementarla:
 *   1. `npm install googleapis` e crea un service account con accesso al calendario;
 *   2. in `createEvent`/`updateEvent`/`deleteEvent` chiama l'API Calendar;
 *   3. salva l'ID dell'evento in booking.externalRefs.googleCalendarEventId
 *      (il campo esiste già nel modello Booking);
 *   4. abilita impostando GOOGLE_CALENDAR_ENABLED=true.
 *
 * Per la sync inversa (eventi creati su Google che bloccano orari) si può
 * usare un job periodico che crea documenti Block.
 */
const { BOOKING_EVENTS, onBookingEvent } = require('../events');

function isEnabled() {
  // Cambia in: return process.env.GOOGLE_CALENDAR_ENABLED === 'true';
  return false;
}

/* eslint-disable no-unused-vars */
async function createEvent(booking) { /* TODO */ }
async function updateEvent(booking) { /* TODO */ }
async function deleteEvent(booking) { /* TODO */ }
/* eslint-enable no-unused-vars */

function registerGoogleCalendarSync() {
  if (!isEnabled()) return;
  onBookingEvent(BOOKING_EVENTS.CREATED, createEvent);
  onBookingEvent(BOOKING_EVENTS.UPDATED, updateEvent);
  onBookingEvent(BOOKING_EVENTS.CANCELLED, deleteEvent);
}

module.exports = { registerGoogleCalendarSync };
