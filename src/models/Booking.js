/**
 * Prenotazione di un cliente.
 *
 * I dati del servizio (nome, durata, prezzo) vengono copiati al momento della
 * prenotazione: se in futuro il servizio cambia o viene eliminato, lo storico
 * resta coerente.
 */
const mongoose = require('mongoose');

const BOOKING_STATUS = ['confirmed', 'cancelled'];
const BOOKING_SOURCE = ['online', 'admin'];

const bookingSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    serviceName: { type: String, required: true },
    // Collaboratore (solo nei negozi che li hanno); il nome è copiato per lo storico
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    staffName: { type: String, default: '' },
    durationMinutes: { type: Number, required: true },
    priceCents: { type: Number, default: 0 },

    date: { type: String, required: true }, // "YYYY-MM-DD" (fuso dell'attività)
    startMinutes: { type: Number, required: true, min: 0, max: 1440 },
    endMinutes: { type: Number, required: true, min: 0, max: 1440 },

    customer: {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      phone: { type: String, required: true, trim: true, maxlength: 25 },
      email: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
      // Solo le cifre del numero (ultime 10): per contare le prenotazioni attive di uno stesso cliente
      phoneKey: { type: String, default: '' },
    },
    notes: { type: String, trim: true, maxlength: 500, default: '' },

    source: { type: String, enum: BOOKING_SOURCE, default: 'online' },
    // Prenotazione finta generata dalla modalità demo (vedi services/demoService.js)
    isDemo: { type: Boolean, default: false },
    status: { type: String, enum: BOOKING_STATUS, default: 'confirmed' },
    cancelledAt: { type: Date },
    cancelledBy: { type: String, enum: ['customer', 'admin'] },
    // Codice casuale del link "gestisci/disdici" mandato al cliente
    manageToken: { type: String },
    // Dati del cliente cancellati dopo il periodo di conservazione (privacy)
    anonymizedAt: { type: Date },

    // --- Predisposizioni per integrazioni future -------------------------
    // ID dell'evento creato su sistemi esterni (es. Google Calendar).
    externalRefs: {
      googleCalendarEventId: { type: String },
    },
    // Tracciamento notifiche inviate (conferma, promemoria…).
    notifications: {
      confirmationSentAt: { type: Date },
      reminderSentAt: { type: Date },
      reviewRequestSentAt: { type: Date }, // email "Com'è andata? Lascia una recensione"
    },
  },
  { timestamps: true }
);

bookingSchema.index({ businessId: 1, date: 1, startMinutes: 1 });
bookingSchema.index({ manageToken: 1 }, { unique: true, sparse: true });
bookingSchema.index({ businessId: 1, 'customer.phoneKey': 1, date: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
module.exports.BOOKING_STATUS = BOOKING_STATUS;
