/**
 * Inserisce i dati iniziali (impostazioni e servizi di esempio da config.json).
 * I servizi vengono creati solo se il catalogo è vuoto.
 * Le stesse operazioni sono eseguite automaticamente all'avvio del server.
 *
 * Uso:  npm run seed
 */
const mongoose = require('mongoose');
const { connectDb } = require('../src/db');
const { bootstrap } = require('../src/services/bootstrap');

connectDb()
  .then(bootstrap)
  .then(() => console.log('Seed completato.'))
  .catch((err) => {
    console.error('Errore:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
