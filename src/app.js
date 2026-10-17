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
const requireAdmin = require('./middleware/requireAdmin');
const requireJson = require('./middleware/requireJson');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

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
  app.use('/api', requireJson, publicRoutes);
  app.use('/admin/api', requireJson, adminRoutes);
  app.use(['/api', '/admin/api'], notFoundHandler);

  /* ------------------------------- Pagine -------------------------------- */
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.get('/admin/login', (req, res) => {
    if (req.session.adminId) return res.redirect('/admin');
    return res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html'));
  });
  app.get(['/admin', '/admin/'], requireAdmin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
  });

  // La pagina admin si raggiunge solo da /admin (che verifica il login)
  app.get('/admin/index.html', (req, res) => res.redirect('/admin'));

  // File statici (CSS/JS/immagini, widget)
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: config.env.isProduction ? '1h' : 0 }));
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
