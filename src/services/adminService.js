/**
 * Autenticazione e utenti del pannello (titolari e super admin).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { AdminUser, Business } = require('../models');
const config = require('../config');
const mailer = require('./mailer');
const { renderEmail, publicUrl } = require('./notifications/layout');
const { HttpError, badRequest } = require('../utils/errors');

const RESET_VALID_MS = 60 * 60 * 1000; // il link di recupero vale un'ora
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

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

/* --------------------------- Cambio password --------------------------- */

function assertNewPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw badRequest('La nuova password deve avere almeno 8 caratteri');
  if (password.length > 200) throw badRequest('Password troppo lunga');
}

async function changePassword(user, current, password) {
  if (!(await user.checkPassword(String(current || '')))) throw new HttpError(400, 'La password attuale non è corretta', 'WRONG_PASSWORD');
  assertNewPassword(password);
  await user.setPassword(password);
  await user.save();
}

/** Dove mandare il link di recupero: email degli avvisi o del negozio; per il super admin ADMIN_EMAIL. */
async function recoveryEmail(user) {
  if (user.role === 'super') return process.env.ADMIN_EMAIL || '';
  const shop = await Business.findOne({ slug: user.businessId }, { notifyEmail: 1, email: 1, name: 1 }).lean();
  return (shop && (shop.notifyEmail || shop.email)) || '';
}

/**
 * "Password dimenticata": se l'utente esiste e ha un'email, gli manda un link
 * valido un'ora. Non dice mai se lo username esiste (risponde sempre uguale).
 * Il link usa PUBLIC_URL (mai l'header Host della richiesta, che si può falsificare).
 */
async function requestPasswordReset(username) {
  const user = await AdminUser.findOne({ username: String(username || '').trim().toLowerCase() });
  if (!user || !mailer.isEnabled()) return false;
  const to = await recoveryEmail(user);
  const base = publicUrl('');
  if (!to || !base) {
    if (!base) console.warn('[password] PUBLIC_URL non impostato: impossibile mandare il link di recupero');
    return false;
  }
  const token = crypto.randomBytes(24).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetExpires = new Date(Date.now() + RESET_VALID_MS);
  await user.save();

  const link = `${base}/admin/reset/${token}`;
  const { html, text } = renderEmail({
    business: { name: config.platform.name },
    eyebrow: 'Recupero password',
    intro: `Qualcuno (speriamo tu) ha chiesto di reimpostare la password dell'account "${user.username}". Il link vale un'ora.`,
    rows: [['Account', user.username]],
    button: { href: link, label: 'Scegli una nuova password' },
    outro: 'Se non sei stato tu, ignora questa email: la password attuale resta valida.',
    footer: `Email inviata da ${config.platform.name}.`,
  });
  await mailer.sendMail({ to, subject: 'Reimposta la password del pannello', text, html });
  return true;
}

async function resetPassword(token, password) {
  const user = /^[a-f0-9]{48}$/.test(String(token || ''))
    ? await AdminUser.findOne({ resetTokenHash: sha256(token), resetExpires: { $gt: new Date() } })
    : null;
  if (!user) throw new HttpError(400, 'Il link non è valido o è scaduto: richiedine uno nuovo', 'INVALID_TOKEN');
  assertNewPassword(password);
  await user.setPassword(password);
  await user.save();
  return user;
}

module.exports = { authenticate, upsertAdmin, ensurePlatformAdmin, changePassword, requestPasswordReset, resetPassword };
