/**
 * Autenticazione e creazione dell'amministratore.
 */
const bcrypt = require('bcryptjs');
const { AdminUser } = require('../models');
const config = require('../config');

// Hash fittizio: se l'utente non esiste confrontiamo comunque una password,
// così il tempo di risposta non rivela quali username sono validi.
let dummyHash;
const getDummyHash = () => (dummyHash ||= bcrypt.hashSync('dummy-password-for-timing', 12));

const businessId = config.business.id;

async function authenticate(username, password) {
  const user = await AdminUser.findOne({ businessId, username: String(username || '').trim().toLowerCase() });
  if (!user) {
    await bcrypt.compare(String(password || ''), getDummyHash());
    return null;
  }
  const ok = await user.checkPassword(String(password || ''));
  return ok ? user : null;
}

/** Crea o aggiorna un admin (usato dallo script create-admin). */
async function upsertAdmin(username, password) {
  if (!username || !password || password.length < 8) {
    throw new Error('Username obbligatorio e password di almeno 8 caratteri');
  }
  const normalized = username.trim().toLowerCase();
  let user = await AdminUser.findOne({ businessId, username: normalized });
  if (!user) user = new AdminUser({ businessId, username: normalized });
  await user.setPassword(password);
  await user.save();
  return user;
}

/**
 * Al primo avvio, se non esiste nessun admin, lo crea dalle variabili
 * ADMIN_USERNAME / ADMIN_PASSWORD (utile su Render, dove non c'è una shell
 * nel piano gratuito).
 */
async function ensureInitialAdmin() {
  const count = await AdminUser.countDocuments({ businessId });
  if (count > 0) return;
  const { adminUsername, adminPassword } = config.env;
  if (!adminUsername || !adminPassword) {
    console.warn('[admin] Nessun amministratore: imposta ADMIN_USERNAME e ADMIN_PASSWORD o usa "npm run create-admin".');
    return;
  }
  await upsertAdmin(adminUsername, adminPassword);
  console.log(`[admin] Creato l'amministratore iniziale "${adminUsername}"`);
}

module.exports = { authenticate, upsertAdmin, ensureInitialAdmin };
