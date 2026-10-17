/**
 * Fascia oraria bloccata (ferie, pausa, chiusura straordinaria).
 * Un giorno intero è rappresentato da 0 → 1440.
 */
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    startMinutes: { type: Number, required: true, min: 0, max: 1440 },
    endMinutes: { type: Number, required: true, min: 0, max: 1440 },
    reason: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { timestamps: true }
);

blockSchema.index({ businessId: 1, date: 1 });

module.exports = mongoose.model('Block', blockSchema);
