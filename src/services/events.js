/**
 * Bus di eventi interno.
 *
 * La logica delle prenotazioni emette eventi (creata, modificata, cancellata)
 * senza sapere chi li ascolta. Notifiche email/WhatsApp e sincronizzazione con
 * Google Calendar si "agganciano" qui: aggiungerle in futuro non richiede di
 * toccare il codice delle prenotazioni.
 *
 * Eventi:
 *   booking.created   (booking)
 *   booking.updated   (booking, previous)
 *   booking.cancelled (booking)
 */
const { EventEmitter } = require('events');

const bookingEvents = new EventEmitter();

const BOOKING_EVENTS = Object.freeze({
  CREATED: 'booking.created',
  UPDATED: 'booking.updated',
  CANCELLED: 'booking.cancelled',
});

/**
 * Registra un listener asincrono: gli errori vengono loggati e non bloccano
 * mai la risposta al cliente.
 */
function onBookingEvent(event, handler) {
  bookingEvents.on(event, (...args) => {
    Promise.resolve()
      .then(() => handler(...args))
      .catch((err) => console.error(`[events] Errore nel listener di "${event}":`, err));
  });
}

function emitBookingEvent(event, ...args) {
  bookingEvents.emit(event, ...args);
}

module.exports = { BOOKING_EVENTS, onBookingEvent, emitBookingEvent };
