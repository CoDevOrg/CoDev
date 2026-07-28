import { defineConfig } from "drizzle-kit";

import { normalizePostgresConnectionString } from "./src/connection";

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  "postgresql://codev:codev@127.0.0.1:5432/codev";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: normalizePostgresConnectionString(connectionString),
  },
  strict: true,
  verbose: true,
});
