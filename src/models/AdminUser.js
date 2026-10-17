/**
 * Utente amministratore. La password è salvata solo come hash bcrypt.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

const adminUserSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

adminUserSchema.index({ businessId: 1, username: 1 }, { unique: true });

adminUserSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
};

adminUserSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('AdminUser', adminUserSchema);
