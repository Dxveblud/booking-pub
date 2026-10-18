/**
 * Impostazioni modificabili dal pannello admin: orari di apertura settimanali
 * e regole di prenotazione. Un solo documento per attività.
 */
const mongoose = require('mongoose');

const intervalSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true, min: 0, max: 1440 }, // minuti
    end: { type: Number, required: true, min: 0, max: 1440 },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, min: 0, max: 6 }, // 0 = domenica
    intervals: { type: [intervalSchema], default: [] },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, unique: true },
    openingHours: { type: [daySchema], default: [] },
    // Passo tra un orario proposto e il successivo (es. 15 → 9:00, 9:15, …)
    slotStepMinutes: { type: Number, default: 15, min: 5, max: 120 },
    // Preavviso minimo per prenotare online
    minNoticeMinutes: { type: Number, default: 60, min: 0, max: 10080 },
    // Quanti giorni in avanti si può prenotare online
    maxDaysAhead: { type: Number, default: 60, min: 1, max: 365 },
    // Fino a quanti minuti prima dell'appuntamento il cliente può disdire dal link
    cancelNoticeMinutes: { type: Number, default: 120, min: 0, max: 10080 },
    // Promemoria email al cliente: quante ore prima (0 = nessun promemoria)
    reminderHours: { type: Number, default: 24, min: 0, max: 168 },
    // Email "Com'è andata?" con il link per la recensione: quanti minuti dopo la fine (0 = mai)
    reviewDelayMinutes: { type: Number, default: 60, min: 0, max: 2880 },
    // Versione dei dati di esempio già caricati (solo modalità demo)
    demoSeedVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** Restituisce gli intervalli di apertura di un giorno della settimana. */
settingsSchema.methods.intervalsFor = function intervalsFor(weekday) {
  const day = this.openingHours.find((d) => d.day === weekday);
  return day ? day.intervals.map((i) => ({ start: i.start, end: i.end })) : [];
};

module.exports = mongoose.model('Settings', settingsSchema);
