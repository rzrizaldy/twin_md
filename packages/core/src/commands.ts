// Server-only entry point. Imports Node's `fs`, so never pull this in from a
// browser bundle — use `@twin-md/core/commands` from API routes, Tauri IPC,
// or the CLI.
export * from "./commands/index.js";
