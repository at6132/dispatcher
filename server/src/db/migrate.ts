import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';

import { closeDb, db } from './client.js';

async function main() {
  // Prefer cwd (Docker WORKDIR / local `server/`) so this works from dist/ too.
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
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
