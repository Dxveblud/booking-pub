/**
 * Individua il negozio di ogni richiesta.
 *
 *  - API pubbliche: dal parametro ?shop=<codice> (lo aggiunge il widget) o
 *    dall'header X-Shop; senza indicazioni si usa il negozio predefinito.
 *  - API admin: dal titolare loggato (o dal negozio scelto dal super admin).
 *
 * Il negozio trovato è disponibile in req.business.
 */
const config = require('../config');
const { AdminUser } = require('../models');
const { getBusiness } = require('../services/businessService');
const { HttpError } = require('../utils/errors');

async function resolvePublicShop(req, res, next) {
  const slug = String(req.query.shop || req.get('X-Shop') || config.business.id).toLowerCase();
  const business = await getBusiness(slug);
  if (!business || !business.active) {
    throw new HttpError(404, 'Negozio non trovato o non attivo', 'SHOP_NOT_FOUND');
  }
  req.business = business;
  next();
}

async function loadAdminContext(req, res, next) {
  // Visitatore della demo (/admin/demo): titolare "finto" del negozio demo
  if (req.session.demo) {
    const business = config.demo.enabled ? await getBusiness(config.platform.demoShop, { fresh: true }) : null;
    if (!business) {
      req.session.destroy(() => {});
      throw new HttpError(401, 'Demo non disponibile', 'UNAUTHORIZED');
    }
    req.admin = { username: 'demo', role: 'demo', businessId: business.slug };
    req.business = business;
    return next();
  }
  const user = await AdminUser.findById(req.session.adminId);
  // Utente eliminato, o password cambiata dopo il login: la sessione non vale più
  const stale = user && user.passwordChangedAt && (req.session.loginAt || 0) < user.passwordChangedAt.getTime();
  if (!user || stale) {
    req.session.destroy(() => {});
    throw new HttpError(401, 'Accesso richiesto', 'UNAUTHORIZED');
  }
  const slug = user.role === 'super' ? (req.session.businessId || user.businessId) : user.businessId;
  let business = await getBusiness(slug, { fresh: true });
  if (!business && user.role === 'super') business = await getBusiness(config.business.id, { fresh: true });
  if (!business) throw new HttpError(404, 'Negozio non trovato', 'SHOP_NOT_FOUND');
  req.admin = user;
  req.business = business;
  next();
}

/**
 * Nella demo si possono provare calendario, prenotazioni e ferie;
 * il resto (dati del negozio, servizi, orari, staff, password…) è in sola lettura.
 */
const DEMO_WRITABLE = /^\/(bookings|blocks)(\/|$)/;
function demoReadOnly(req, res, next) {
  if (req.admin.role !== 'demo' || req.method === 'GET' || DEMO_WRITABLE.test(req.path)) return next();
  throw new HttpError(403, 'Nella demo questa sezione è in sola lettura: puoi provare calendario e prenotazioni.', 'DEMO_READ_ONLY');
}

function requireSuper(req, res, next) {
  if (req.admin && req.admin.role === 'super') return next();
  throw new HttpError(403, 'Solo il gestore della piattaforma può farlo', 'FORBIDDEN');
}

module.exports = { resolvePublicShop, loadAdminContext, demoReadOnly, requireSuper };
