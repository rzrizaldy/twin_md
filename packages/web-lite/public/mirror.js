/** Web mirror — one canonical PNG per (species, mood, frame), resolved server-side. */
const POLL_MS = 4000;
const BREATH_MS = 2200;
const BLINK_MIN = 4000;
const BLINK_MAX = 7000;
const BLINK_HOLD_MS = 120;

const sceneEl = document.getElementById("scene");
const weatherEl = document.getElementById("weather");
const deviceEl = document.getElementById("device");
const petEl = document.getElementById("pet");
const captionEl = document.getElementById("caption");
const messageEl = document.getElementById("message");
const metaEl = document.getElementById("meta");

let breathFrame = "a";
let breathTimer = null;
let blinkTimer = null;
let lastEnv = "";

function setWeather(environment, state) {
  weatherEl.className = "weather";
  deviceEl.classList.remove("env-neglected");

  if (state === "healthy") weatherEl.classList.add("sparkles");
  if (state === "stressed") weatherEl.classList.add("rain");
  if (state === "sleep_deprived") weatherEl.classList.add("stars");
  if (state === "neglected") {
    weatherEl.classList.add("fog", "neglected");
    deviceEl.classList.add("env-neglected");
  }
}

function sceneUrl(environment) {
  const id = environment || "sunny_island";
  return `/scenes/${id}.svg`;
}

function petUrl(species, mood, frame) {
  const sp = species || "axolotl";
  const m = mood || "healthy";
  return `/pets/${sp}/${m}/breath-${frame}.png`;
}

function blinkUrl(species, mood) {
  const sp = species || "axolotl";
  const m = mood || "healthy";
  return `/pets/${sp}/${m}/blink.png`;
}

function loadPet(url) {
  petEl.onerror = null;
  petEl.onload = null;
  petEl.src = url;
}

function applyState(data) {
  if (!data || data.ok === false) {
    captionEl.textContent = "No state yet";
    messageEl.textContent =
      data?.hint ?? "Run `twin-md harvest` once, then refresh this page.";
    metaEl.textContent = "";
    sceneEl.removeAttribute("src");
    petEl.removeAttribute("src");
    return;
  }

  const env = data.environment || "sunny_island";
  if (env !== lastEnv) {
    lastEnv = env;
    sceneEl.classList.add("is-fading");
    const next = sceneUrl(env);
    const img = new Image();
    img.onload = () => {
      sceneEl.src = next;
      sceneEl.classList.remove("is-fading");
    };
    img.src = next;
  } else if (!sceneEl.src) {
    sceneEl.src = sceneUrl(env);
  }

  setWeather(env, data.state);

  captionEl.textContent = data.caption || "";
  messageEl.textContent = data.message || "";
  const updated = data.updated || "";
  metaEl.textContent = updated ? `Last updated · ${updated}` : "";

  petEl.dataset.species = data.species || "axolotl";
  petEl.dataset.mood = data.state || "healthy";
  loadPet(petUrl(petEl.dataset.species, petEl.dataset.mood, breathFrame));
}

async function fetchState() {
  try {
    const res = await fetch("/state.json", { cache: "no-store" });
    const data = await res.json();
    if (data.ok === false) {
      applyState(data);
      return;
    }
    applyState(data);
  } catch {
    captionEl.textContent = "Offline";
    messageEl.textContent = "Could not reach this page’s server.";
    metaEl.textContent = "";
  }
}

function breathLoop() {
  if (breathTimer) clearInterval(breathTimer);
  breathTimer = window.setInterval(() => {
    breathFrame = breathFrame === "a" ? "b" : "a";
    const sp = petEl.dataset.species || "axolotl";
    const mood = petEl.dataset.mood || "healthy";
    loadPet(petUrl(sp, mood, breathFrame));
  }, BREATH_MS);
}

function scheduleBlink() {
  if (blinkTimer) clearTimeout(blinkTimer);
  const delay = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
  blinkTimer = window.setTimeout(() => {
    const sp = petEl.dataset.species || "axolotl";
    const mood = petEl.dataset.mood || "healthy";
    loadPet(blinkUrl(sp, mood));
    window.setTimeout(() => {
      loadPet(petUrl(sp, mood, breathFrame));
      scheduleBlink();
    }, BLINK_HOLD_MS);
  }, delay);
}

void fetchState();
setInterval(fetchState, POLL_MS);
breathLoop();
scheduleBlink();

// ── Pulse strip ─────────────────────────────────────────────────────────────
const pulseEl = document.getElementById("pulse");
const PULSE_POLL_MS = 60_000;

async function fetchPulse() {
  if (!pulseEl) return;
  try {
    const res = await fetch("/pulse.json", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok || !data.days?.length) {
      pulseEl.hidden = true;
      return;
    }
    pulseEl.hidden = false;
    pulseEl.innerHTML = `<h2 class="pulse-heading">recent activity</h2>` +
      data.days.slice(0, 5).map(day =>
        `<div class="pulse-day"><span class="pulse-date">${day.date}</span>` +
        day.entries.slice(0, 3).map(e =>
          `<span class="pulse-entry" title="${e.files.join(', ')}">${e.sha} ${e.subject}</span>`
        ).join("") +
        `</div>`
      ).join("");
  } catch {
    if (pulseEl) pulseEl.hidden = true;
  }
}

void fetchPulse();
setInterval(fetchPulse, PULSE_POLL_MS);
