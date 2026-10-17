/**
 * Autenticazione e utenti del pannello (titolari e super admin).
 */
const bcrypt = require('bcryptjs');
const { AdminUser } = require('../models');
const config = require('../config');

// Hash fittizio: se l'utente non esiste confrontiamo comunque una password,
// così il tempo di risposta non rivela quali username sono validi.
let dummyHash;
const getDummyHash = () => (dummyHash ||= bcrypt.hashSync('dummy-password-for-timing', 12));

async function authenticate(username, password) {
  const user = await AdminUser.findOne({ username: String(username || '').trim().toLowerCase() });
  if (!user) {
    await bcrypt.compare(String(password || ''), getDummyHash());
    return null;
  }
  const ok = await user.checkPassword(String(password || ''));
  return ok ? user : null;
}

/** Crea o aggiorna un utente (usato dallo script create-admin). */
async function upsertAdmin(username, password, { businessId = config.business.id, role = 'super' } = {}) {
  if (!username || !password || password.length < 8) {
    throw new Error('Username obbligatorio e password di almeno 8 caratteri');
  }
  const normalized = username.trim().toLowerCase();
  let user = await AdminUser.findOne({ username: normalized });
  if (!user) user = new AdminUser({ username: normalized, businessId, role });
  await user.setPassword(password);
  await user.save();
  return user;
}

/**
 * Garantisce che esista un super admin (il gestore della piattaforma).
 *  - Installazioni precedenti alla versione multi-negozio: il primo admin
 *    esistente diventa super admin.
 *  - Database vuoto: lo crea da ADMIN_USERNAME / ADMIN_PASSWORD.
 */
async function ensurePlatformAdmin() {
  if (await AdminUser.exists({ role: 'super' })) return;
  const legacy = await AdminUser.findOne().sort({ createdAt: 1 });
  if (legacy) {
    legacy.role = 'super';
    await legacy.save();
    console.log(`[admin] "${legacy.username}" ora è il super admin della piattaforma`);
    return;
  }
  const { adminUsername, adminPassword } = config.env;
  if (!adminUsername || !adminPassword) {
    console.warn('[admin] Nessun amministratore: imposta ADMIN_USERNAME e ADMIN_PASSWORD o usa "npm run create-admin".');
    return;
  }
  await upsertAdmin(adminUsername, adminPassword, { role: 'super' });
  console.log(`[admin] Creato il super admin "${adminUsername}"`);
}

module.exports = { authenticate, upsertAdmin, ensurePlatformAdmin };
