/**
 * Collaboratore di un negozio (es. i due barbieri di una barberia), con la
 * sua agenda: due collaboratori possono avere appuntamenti alla stessa ora.
 *
 * Un negozio senza collaboratori funziona come prima: agenda unica.
 */
const mongoose = require('mongoose');

const intervalSchema = new mongoose.Schema(
  { start: { type: Number, required: true, min: 0, max: 1440 }, end: { type: Number, required: true, min: 0, max: 1440 } },
  { _id: false }
);
const daySchema = new mongoose.Schema(
  { day: { type: Number, required: true, min: 0, max: 6 }, intervals: { type: [intervalSchema], default: [] } },
  { _id: false }
);

const staffSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    // Servizi che sa fare (vuoto = tutti)
    serviceIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // Orari propri (es. part-time). Se customHours è false valgono quelli del negozio.
    customHours: { type: Boolean, default: false },
    openingHours: { type: [daySchema], default: [] },
  },
  { timestamps: true }
);

/** Il collaboratore sa fare questo servizio? */
staffSchema.methods.canDo = function canDo(serviceId) {
  return !this.serviceIds.length || this.serviceIds.some((id) => String(id) === String(serviceId));
};

/** Fasce di lavoro di un giorno della settimana (le sue o quelle del negozio). */
staffSchema.methods.intervalsFor = function intervalsFor(weekday, settings) {
  if (!this.customHours) return settings.intervalsFor(weekday);
  const day = this.openingHours.find((d) => d.day === weekday);
  return day ? day.intervals.map((i) => ({ start: i.start, end: i.end })) : [];
};

module.exports = mongoose.model('Staff', staffSchema);
