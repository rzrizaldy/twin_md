// Browser-safe public surface for @twin-md/core.
//
// Anything that reaches for `node:fs`, `node:os`, `node:path`, the Anthropic
// SDK, or the local file vault lives under the `@twin-md/core/server`
// subpath. Keeping the root entry fs-free is what lets the Next.js client
// bundle and the Tauri webview import shared types without esbuild trying
// to polyfill `fs/promises`.

export * from "./chat-commands.js";
export * from "./pet.js";
export * from "./schema.js";

// Type-only re-exports for bits that live alongside node-tainted code.
// `export type` is erased at compile time, so esbuild never follows the
// underlying module at runtime.
export type {
  AiKeyStorage,
  AiProvider,
  TwinConfig,
  TwinSpecies
} from "./config.js";
export type { PetState } from "./interpret.js";
export type {
  Reminder,
  ReminderRuleId,
  ReminderTier,
  ReminderTone
} from "./reminders.js";
