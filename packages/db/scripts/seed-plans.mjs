import { Pool } from "pg";

import { normalizePostgresConnectionString } from "../src/connection.ts";

const connection =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL;

if (!connection) {
  throw new Error("Database configuration is missing.");
}

const pool = new Pool({
  connectionString: normalizePostgresConnectionString(connection),
});

try {
  await pool.query(
    `INSERT INTO public.plans (id, name) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, active = true, updated_at = now()`,
    ["power", "Power"],
  );
  console.log("Billing plan catalog is ready.");
} finally {
  await pool.end();
}
