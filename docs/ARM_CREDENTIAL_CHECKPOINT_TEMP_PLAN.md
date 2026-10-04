# Temporary ARM credential checkpoint plan

1. Add a server-owned checkpoint operation that captures each live Superset
   agent credential and acknowledges its encrypted, revision-fenced write-back.
2. Expose that operation through a machine-authenticated internal API route.
3. Add an ARM controller adapter that calls the API and fails closed on any
   unacknowledged run.
4. Wire the adapter into the production lifecycle construction, and add a
   separately auditable forced-destruction outcome for dead VMs.
5. Verify focused unit/lifecycle coverage, commit each step, then remove this
   temporary file in the final cleanup commit.
