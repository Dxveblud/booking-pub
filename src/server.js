/**
 * Punto di avvio: connessione al DB, dati iniziali, integrazioni, server HTTP.
 */
const mongoose = require('mongoose');
const config = require('./config');
const { connectDb } = require('./db');
const { createApp } = require('./app');
const { bootstrap } = require('./services/bootstrap');
const { registerIntegrations } = require('./services/integrations');
const { startDemoMode } = require('./services/demoService');
const { startReminderJob } = require('./services/notifications/customer');
const { startPrivacyJob } = require('./services/privacyService');

async function main() {
  await connectDb();
  await bootstrap();
  registerIntegrations();
  startDemoMode(); // attiva solo se config.json → demo.enabled
  startReminderJob(); // promemoria email ai clienti (se l'email è configurata)
  startPrivacyJob(); // cancella i dati dei clienti dopo il periodo di conservazione

  const app = createApp();
  const server = app.listen(config.env.port, (err) => {
    // Express 5 passa qui l'eventuale errore (es. porta già occupata)
    if (err) {
      console.error(`[server] Impossibile usare la porta ${config.env.port}: ${err.message}`);
      process.exit(1);
    }
    console.log(`[server] "${config.business.name}" in ascolto su http://localhost:${config.env.port}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} ricevuto, chiusura in corso…`);
    server.close(() => mongoose.connection.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[server] Avvio fallito:', err);
  process.exit(1);
});
