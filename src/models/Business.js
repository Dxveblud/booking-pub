/**
 * Negozio (attività cliente). Ogni dato dell'app (servizi, prenotazioni,
 * blocchi, impostazioni, admin) è legato a un negozio tramite `businessId`,
 * che coincide con lo `slug` del negozio (es. "barberia-mario").
 *
 * Lo slug è il "codice negozio" che il cliente mette nel widget
 * (data-shop="barberia-mario") e non va cambiato dopo la creazione.
 */
const mongoose = require('mongoose');

const highlightSchema = new mongoose.Schema(
  { title: { type: String, trim: true, maxlength: 60 }, text: { type: String, trim: true, maxlength: 160 } },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, default: 'generico' }, // modello di partenza (barbiere, estetista…)
    tagline: { type: String, trim: true, maxlength: 140, default: '' },
    description: { type: String, trim: true, maxlength: 1200, default: '' },
    logo: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, maxlength: 160, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    email: { type: String, trim: true, maxlength: 120, default: '' },
    instagram: { type: String, trim: true, maxlength: 120, default: '' },
    primaryColor: { type: String, default: '#1c1917' },
    accentColor: { type: String, default: '#b08a4e' },
    timezone: { type: String, default: 'Europe/Rome' },
    currency: { type: String, default: 'EUR' },
    locale: { type: String, default: 'it-IT' },
    // Contenuti della pagina pubblica /s/<slug>
    site: {
      heroImage: { type: String, default: '' },
      aboutImage: { type: String, default: '' },
      aboutTitle: { type: String, trim: true, maxlength: 80, default: '' },
      highlights: { type: [highlightSchema], default: [] },
      gallery: { type: [String], default: [] },
      demoNotice: { type: String, trim: true, maxlength: 300, default: '' },
    },
    // Indirizzo che riceve un'email a ogni prenotazione online (vuoto = nessun avviso)
    notifyEmail: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
    active: { type: Boolean, default: true }, // se false widget e pagina mostrano "non disponibile"
    notes: { type: String, trim: true, maxlength: 1000, default: '' }, // note interne (solo super admin)
  },
  { timestamps: true }
);

module.exports = mongoose.model('Business', businessSchema);
