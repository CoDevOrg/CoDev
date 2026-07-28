export function normalizePostgresConnectionString(connectionString: string) {
  const url = new URL(connectionString);

  // node-postgres 8 interprets sslmode=require as verify-full. Supabase's
  // Marketplace URL follows libpq semantics, where require encrypts the
  // transport without requiring a locally installed Supabase CA certificate.
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}
