/**
 * Servizio offerto dall'attività (es. "Taglio uomo", 30 min, 18 €).
 */
const mongoose = require('mongoose');
const { LOCK_UNIT_MINUTES } = require('./SlotLock');

const serviceSchema = new mongoose.Schema(
  {
    // Predisposto per il multi-attività: ogni documento appartiene a un'attività.
    businessId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    durationMinutes: {
      type: Number,
      required: true,
      min: LOCK_UNIT_MINUTES,
      max: 600,
      validate: {
        validator: (v) => Number.isInteger(v) && v % LOCK_UNIT_MINUTES === 0,
        message: `La durata deve essere un multiplo di ${LOCK_UNIT_MINUTES} minuti`,
      },
    },
    // Prezzo in centesimi per evitare errori di arrotondamento.
    priceCents: { type: Number, required: true, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Service', serviceSchema);
