# Chat

This module owns the core chat interactions, shared chat logic, and response streaming. It manages chat room replies, permission models for shared chats, and conversation imports.

**Does not own:** The underlying LLM model connections (see `providers`) or execution environment interactions (see `runtime`).

**Key files:**

- `shared-chat.ts`, `shared-chat-permissions.ts`: Logic and access control for shared conversations.
- `room-reply-stream.ts`, `shared-chat-stream.ts`: Stream processing for chat replies.
