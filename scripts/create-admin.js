/**
 * Crea un amministratore o ne reimposta la password.
 *
 * Uso:  npm run create-admin -- <username> <password>
 */
const mongoose = require('mongoose');
const { connectDb } = require('../src/db');
const { upsertAdmin } = require('../src/services/adminService');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Uso: npm run create-admin -- <username> <password>');
    process.exit(1);
  }
  await connectDb();
  await upsertAdmin(username, password);
  console.log(`Amministratore "${username.toLowerCase()}" salvato.`);
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('Errore:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
