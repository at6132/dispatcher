import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, db } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsFolder = path.join(__dirname, '../../drizzle');
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete');
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
