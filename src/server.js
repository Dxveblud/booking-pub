/**
 * Punto di avvio: connessione al DB, dati iniziali, integrazioni, server HTTP.
 */
const mongoose = require('mongoose');
const config = require('./config');
const { connectDb } = require('./db');
const { createApp } = require('./app');
const { bootstrap } = require('./services/bootstrap');
const { registerIntegrations } = require('./services/integrations');

async function main() {
  await connectDb();
  await bootstrap();
  registerIntegrations();

  const app = createApp();
  const server = app.listen(config.env.port, () => {
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
