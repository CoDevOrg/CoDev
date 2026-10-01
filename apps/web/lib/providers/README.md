# Providers

This module owns the registry, configuration, and integration of external service providers, most notably AI model providers (Anthropic, Codex, etc.). It manages model capabilities, user credentials for these providers, and OAuth connections.

**Does not own:** UI implementations for the chat interface or the parsing of the streamed model output.

**Key files:**

- `ai-model.ts`, `provider-capabilities.ts`: Core definitions for model features.
- `registry.ts`, `resolve.ts`: Provider registration and resolution logic.
- `credentials.ts`, `credential-seat.ts`: Managing access credentials for external APIs.
