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
  const user = await AdminUser.findById(req.session.adminId);
  if (!user) {
    // Utente eliminato: la sessione non vale più
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

function requireSuper(req, res, next) {
  if (req.admin && req.admin.role === 'super') return next();
  throw new HttpError(403, 'Solo il gestore della piattaforma può farlo', 'FORBIDDEN');
}

module.exports = { resolvePublicShop, loadAdminContext, requireSuper };
