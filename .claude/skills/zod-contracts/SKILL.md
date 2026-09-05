---
name: zod-contracts
description: Use when adding or changing API payloads, packages/contracts, packages/shared-types, or packages/config schemas. Activate for validation at service/persistence boundaries. Do not invent unchecked types for those boundaries.
---

# Zod / contracts

- Shared API shapes go in `packages/contracts` (or existing shared-types/config packages).
- Parse at trust boundaries. Infer TS types from Zod rather than duplicating interfaces.
- Match existing schema style in the same package.
