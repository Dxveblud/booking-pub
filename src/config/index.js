/**
 * Configurazione centralizzata.
 *
 * - Variabili d'ambiente (.env) → segreti e parametri di deploy.
 * - config.json → dati dell'attività (nome, logo, descrizione, default).
 *
 * Tutto il resto dell'app importa da qui, così c'è un solo punto
 * in cui cambiare le impostazioni.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const ROOT = path.resolve(__dirname, '..', '..');
const configPath = path.resolve(ROOT, process.env.CONFIG_PATH || 'config.json');

let fileConfig;
try {
  fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`[config] Impossibile leggere ${configPath}: ${err.message}`);
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/booking-template',
  sessionSecret: process.env.SESSION_SECRET || '',
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Cartella dove salvare logo e foto caricati dai negozi
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'uploads'),
  // Prenotazioni online consentite per IP ogni 15 minuti (anti-spam)
  bookingRateLimit: Number(process.env.BOOKING_RATE_LIMIT) || 10,
  // Elenco di origini che possono incorporare il widget (CSP frame-ancestors)
  widgetAllowedOrigins: (process.env.WIDGET_ALLOWED_ORIGINS || '*').split(/\s+/).filter(Boolean),
};

if (isProduction && (!env.sessionSecret || env.sessionSecret === 'cambia-questo-valore')) {
  console.error('[config] SESSION_SECRET mancante o di default: impostalo prima di avviare in produzione.');
  process.exit(1);
}
if (!env.sessionSecret) {
  env.sessionSecret = 'dev-only-insecure-secret';
  console.warn('[config] SESSION_SECRET non impostato: uso un valore di sviluppo NON sicuro.');
}

const business = {
  id: 'default',
  name: 'La tua attività',
  timezone: 'Europe/Rome',
  currency: 'EUR',
  locale: 'it-IT',
  primaryColor: '#1c1917',
  accentColor: '#b08a4e',
  ...fileConfig.business,
};

// Contenuti del sito template (foto, sezioni). Tutti facoltativi.
const site = {
  heroImage: '',
  aboutImage: '',
  aboutTitle: '',
  highlights: [],
  gallery: [],
  demoNotice: '',
  ...fileConfig.site,
};

// Modalità demo (portfolio): servizi e prenotazioni di esempio generati da soli.
// Da lasciare disattivata per le attività reali.
const demo = {
  enabled: false,
  seedVersion: 1,
  fillRatio: 0.45,
  daysToFill: 14,
  ...fileConfig.demo,
};

const booking = {
  slotStepMinutes: 15,
  minNoticeMinutes: 60,
  maxDaysAhead: 60,
  ...fileConfig.booking,
};

const defaults = {
  openingHours: {},
  services: [],
  ...fileConfig.defaults,
};

module.exports = { env, business, site, booking, defaults, demo, ROOT };
