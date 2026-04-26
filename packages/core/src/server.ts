// Node/server-only public surface for @twin-md/core.
//
// Everything re-exported from here touches `node:fs`, `node:os`, `node:path`,
// or a network client (Anthropic/OpenAI/Gemini). Never import this from code
// that runs in the browser (desktop webview, Next.js client components) — use
// the root `@twin-md/core` entry for browser-safe types and helpers.

export * from "./chat.js";
export * from "./action-queue.js";
export * from "./config.js";
export * from "./context-reply.js";
export * from "./harvest/index.js";
export * from "./harvest/claude.js";
export * from "./interpret.js";
export * from "./paths.js";
export * from "./reminders.js";
export * from "./buddy/memory.js";
export * from "./buddy/greet.js";
export * from "./buddy/diary.js";

// Re-export the browser-safe bits so server code has one import line.
export * from "./chat-commands.js";
export * from "./pet.js";
export * from "./schema.js";
