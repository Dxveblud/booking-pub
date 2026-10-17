/**
 * Operazioni eseguite all'avvio:
 *  - il negozio predefinito (config.json → business) esiste nel database;
 *  - impostazioni e servizi di esempio del negozio predefinito;
 *  - super admin della piattaforma.
 */
const { Business, Service, AdminUser } = require('../models');
const config = require('../config');
const { getSettings } = require('./settingsService');
const { ensurePlatformAdmin } = require('./adminService');

/** Il negozio predefinito, creato da config.json al primo avvio. */
async function ensureDefaultBusiness() {
  const slug = config.business.id;
  let doc = await Business.findOne({ slug });
  if (doc) return doc;
  const { id, ...fields } = config.business;
  doc = await Business.create({ ...fields, slug, site: config.site });
  console.log(`[bootstrap] Creato il negozio predefinito "${slug}"`);
  return doc;
}

async function seedDefaultServices(businessId = config.business.id, services = config.defaults.services) {
  const count = await Service.countDocuments({ businessId });
  if (count > 0 || !services.length) return 0;
  await Service.insertMany(
    services.map((s, i) => ({
      businessId,
      name: s.name,
      description: s.description || '',
      durationMinutes: s.durationMinutes,
      priceCents: Math.round((s.price || 0) * 100),
      sortOrder: i,
    }))
  );
  return services.length;
}

async function bootstrap() {
  // Indici: lo username ora è unico su tutta la piattaforma (vedi AdminUser)
  await AdminUser.syncIndexes().catch((err) => console.warn('[bootstrap] Indici admin:', err.message));
  await ensureDefaultBusiness();
  await getSettings(config.business.id); // crea il documento se manca
  const seeded = await seedDefaultServices();
  if (seeded) console.log(`[bootstrap] Creati ${seeded} servizi di esempio da config.json`);
  await ensurePlatformAdmin();
}

module.exports = { bootstrap, seedDefaultServices, ensureDefaultBusiness };
