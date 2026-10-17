/**
 * Utente del pannello. La password è salvata solo come hash bcrypt.
 *
 * Ruoli:
 *  - owner: titolare di un negozio, vede e gestisce solo il suo (businessId)
 *  - super: gestore della piattaforma (tu), crea i negozi e può entrare in tutti
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

const adminUserSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true },
    role: { type: String, enum: ['owner', 'super'], default: 'owner' },
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

// Lo username è unico su tutta la piattaforma: al login non serve sapere il negozio
adminUserSchema.index({ username: 1 }, { unique: true });

adminUserSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
};

adminUserSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('AdminUser', adminUserSchema);
