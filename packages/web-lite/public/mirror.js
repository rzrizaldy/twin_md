/**
 * Web mirror: clean PNGs by default (matches landing). Cat tries *-reference.png first.
 */
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

function petCandidates(species, mood, frame) {
  const sp = species || "axolotl";
  const m = mood || "healthy";
  const base = `breath-${frame}`;
  const clean = `/pets/${sp}/${m}/${base}.png`;
  if (sp === "cat") {
    return [`/pets/${sp}/${m}/${base}-reference.png`, clean];
  }
  return [clean];
}

function blinkCandidates(species, mood) {
  const sp = species || "axolotl";
  const m = mood || "healthy";
  const clean = `/pets/${sp}/${m}/blink.png`;
  if (sp === "cat") {
    return [`/pets/${sp}/${m}/blink-reference.png`, clean];
  }
  return [clean];
}

function loadPetFromUrls(urls) {
  let i = 0;
  const next = () => {
    if (i >= urls.length) {
      petEl.onerror = null;
      petEl.onload = null;
      return;
    }
    petEl.onerror = () => {
      i += 1;
      next();
    };
    petEl.onload = () => {
      petEl.onerror = null;
      petEl.onload = null;
    };
    petEl.src = urls[i];
  };
  next();
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
  loadPetFromUrls(
    petCandidates(petEl.dataset.species, petEl.dataset.mood, breathFrame)
  );
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
    loadPetFromUrls(petCandidates(sp, mood, breathFrame));
  }, BREATH_MS);
}

function scheduleBlink() {
  if (blinkTimer) clearTimeout(blinkTimer);
  const delay = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
  blinkTimer = window.setTimeout(() => {
    const sp = petEl.dataset.species || "axolotl";
    const mood = petEl.dataset.mood || "healthy";
    loadPetFromUrls(blinkCandidates(sp, mood));
    window.setTimeout(() => {
      loadPetFromUrls(petCandidates(sp, mood, breathFrame));
      scheduleBlink();
    }, BLINK_HOLD_MS);
  }, delay);
}

void fetchState();
setInterval(fetchState, POLL_MS);
breathLoop();
scheduleBlink();
