/**
 * Side-effect: must be the first import in each app entry. Blocks opening the
 * Vite dev URL in a normal browser (not the Tauri webview).
 */
function guard(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  if (w.__TAURI__ != null || w.__TAURI_INTERNALS__ != null) return;

  const style =
    "font:15px/1.5 system-ui,-apple-system,sans-serif;max-width:28rem;margin:2.5rem auto;padding:0 1.25rem;color:#1d161c";
  document.body.innerHTML = `<main style="${style}">
<h1 style="font-size:1.15rem;margin:0 0 0.75em">twin is a desktop app</h1>
<p style="margin:0 0 0.75em;opacity:0.88">This UI runs inside the <strong>native Tauri</strong> window, not a regular browser.</p>
<p style="margin:0">From the repo: <code style="font-size:0.88em;padding:0.2em 0.45em;border-radius:0.25em;background:#f0ebe7">cd apps/desktop && npm run dev</code></p>
</main>`;
  throw new Error("not a tauri webview");
}

guard();
