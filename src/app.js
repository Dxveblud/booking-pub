/**
 * Configurazione dell'applicazione Express (separata da server.js così
 * può essere riutilizzata nei test).
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');

const config = require('./config');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const manageRoutes = require('./routes/manage');
const requireAdmin = require('./middleware/requireAdmin');
const requireJson = require('./middleware/requireJson');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { getBusiness } = require('./services/businessService');
const { renderLanding, renderPrivacy } = require('./services/landing');

const PUBLIC_DIR = path.join(config.ROOT, 'public');
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 ore

/* ------------------------- Header di sicurezza -------------------------- */

const baseCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  // In locale (http://localhost) non forzare l'HTTPS
  upgradeInsecureRequests: config.env.isProduction ? [] : null,
};

// Sito e admin: non incorporabili in altri siti
const defaultHelmet = helmet({
  contentSecurityPolicy: { directives: baseCsp },
  frameguard: false, // sostituito da CSP frame-ancestors
});

// Widget: deve poter essere incorporato (iframe) e caricato (script) da altri domini
const widgetHelmet = helmet({
  contentSecurityPolicy: {
    directives: { ...baseCsp, frameAncestors: config.env.widgetAllowedOrigins.map((o) => (o === '*' ? '*' : o)) },
  },
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

function createApp() {
  const app = express();

  // Render (e la maggior parte degli hosting) sta dietro un proxy HTTPS
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => (req.path.startsWith('/widget/') ? widgetHelmet : defaultHelmet)(req, res, next));
  app.use(express.json({ limit: '50kb' }));

  /* ------------------------------ Sessione ------------------------------ */
  app.use(
    session({
      name: 'bt.sid',
      secret: config.env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'sessions',
        ttl: SESSION_MAX_AGE / 1000,
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.env.isProduction,
        maxAge: SESSION_MAX_AGE,
      },
    })
  );

  /* -------------------------------- API --------------------------------- */
  app.use('/api/manage', requireJson, manageRoutes);
  app.use('/api', requireJson, publicRoutes);
  app.use('/admin/api', requireJson, adminRoutes);
  app.use(['/api', '/admin/api'], notFoundHandler);

  /* ------------------------------- Pagine -------------------------------- */
  // Per i servizi di monitoraggio: 503 se il database non risponde
  app.get('/health', (req, res) => {
    const dbOk = mongoose.connection.readyState === 1;
    res.status(dbOk ? 200 : 503).json({ ok: dbOk });
  });

  app.get('/admin/login', (req, res) => {
    if (req.session.adminId) return res.redirect('/admin');
    return res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html'));
  });
  // Link "scegli una nuova password" (la pagina di login mostra il modulo giusto)
  app.get('/admin/reset/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html')));
  app.get(['/admin', '/admin/'], requireAdmin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
  });

  // Pagina pubblica di ogni negozio: /s/<codice> (stesso HTML, i dati arrivano dall'API).
  // Negozio inesistente o disattivato: stessa pagina (mostra "non disponibile") ma con 404,
  // così i motori di ricerca non la indicizzano.
  app.get('/s/:slug', async (req, res) => {
    const business = await getBusiness(req.params.slug);
    if (!business || !business.active) res.status(404);
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Link personale del cliente per vedere o disdire l'appuntamento
  app.get('/disdici/:token', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.sendFile(path.join(PUBLIC_DIR, 'manage.html'));
  });

  // Informativa privacy: della piattaforma e di ogni negozio
  app.get('/privacy', (req, res) => res.type('html').send(renderPrivacy(null)));
  app.get('/s/:slug/privacy', async (req, res) => {
    const business = await getBusiness(req.params.slug);
    if (!business || !business.active) return res.status(404).type('html').send(renderPrivacy(null));
    return res.type('html').send(renderPrivacy(business));
  });

  // Logo e foto caricati dai negozi (nomi casuali: si possono tenere in cache a lungo)
  app.use('/uploads', express.static(config.env.uploadDir, { index: false, maxAge: '30d', immutable: true }));

  // La pagina admin si raggiunge solo da /admin (che verifica il login)
  app.get('/admin/index.html', (req, res) => res.redirect('/admin'));

  // File statici. HTML, CSS e JS vengono sempre ricontrollati (risposta 304
  // se non sono cambiati): dopo un aggiornamento nessuno resta con la
  // versione vecchia del widget. Immagini e font invece cambiano di rado.
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', config.env.isProduction ? 'public, max-age=604800' : 'no-cache');
    },
  }));
  // "/" = presentazione della piattaforma (oppure il negozio predefinito, se platform.landing è false)
  app.get('/', (req, res) => {
    if (!config.platform.landing) return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('html').send(renderLanding());
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
