/**
 * Connessione a MongoDB tramite Mongoose.
 */
const mongoose = require('mongoose');
const { env } = require('./config');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri);
  console.log('[db] Connesso a MongoDB');
  return mongoose.connection;
}

module.exports = { connectDb };
