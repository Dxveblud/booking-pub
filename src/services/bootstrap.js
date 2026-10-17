/**
 * Operazioni eseguite all'avvio: impostazioni di default, servizi di esempio
 * (solo se il catalogo è vuoto) e admin iniziale.
 */
const { Service } = require('../models');
const config = require('../config');
const { getSettings } = require('./settingsService');
const { ensureInitialAdmin } = require('./adminService');

async function seedDefaultServices() {
  const businessId = config.business.id;
  const count = await Service.countDocuments({ businessId });
  if (count > 0 || !config.defaults.services.length) return 0;
  await Service.insertMany(
    config.defaults.services.map((s, i) => ({
      businessId,
      name: s.name,
      description: s.description || '',
      durationMinutes: s.durationMinutes,
      priceCents: Math.round((s.price || 0) * 100),
      sortOrder: i,
    }))
  );
  return config.defaults.services.length;
}

async function bootstrap() {
  await getSettings(); // crea il documento se manca
  const seeded = await seedDefaultServices();
  if (seeded) console.log(`[bootstrap] Creati ${seeded} servizi di esempio da config.json`);
  await ensureInitialAdmin();
}

module.exports = { bootstrap, seedDefaultServices };
