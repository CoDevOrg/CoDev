# Orca upstream

- Repository: https://github.com/stablyai/orca
- License: MIT
- Reference commit: `fc8441194ce400ad3a6dfdc053d163a9f9688a33`
- Reference release: `v1.4.176`

CoDev's hosted Orca workspace is an adaptation of Orca's agent-first web IDE
model. It uses CoDev's authenticated Firecracker APIs instead of Orca's
Electron preload and direct runtime-pairing transport. This keeps the product
browser-hosted and prevents guest ports, pairing tokens, or provider
credentials from being exposed publicly.
