---
name: twin-md V3 — Wellness Brain & Harness
overview: "Adapt garrytan/gbrain's thin-harness / fat-skills / two-tree architecture for twin.md, bent for chill wellness instead of CEO productivity. Split into agent tree (~/.claude/twin/) and brain tree (~/twin-brain/). Markdown is truth; PGLite is a cache. Signal-detector + chores give the pet self-agency without burning tokens. Reference plan: docs/PLAN_V3_BRAIN.md."
todos:
  # ── Phase 1 — Brain foundation ────────────────────────────────
  - id: p1_brain_tree_layout
    content: "Phase 1: scaffold ~/twin-brain/ layout (diary/, moods/, observations/, sessions/, themes/, people/) + README explaining 'this is yours, markdown, delete anytime'"
    status: pending
  - id: p1_brain_init_cmd
    content: "Phase 1: twin-md brain init — create tree at user-chosen path (default ~/twin-brain), add to twin.config.json as brainPath"
    status: pending
  - id: p1_brain_sync_cmd
    content: "Phase 1: twin-md brain sync — build PGLite cache.db at ~/.claude/twin/cache.db from brain tree; idempotent, disposable"
    status: pending
  - id: p1_pglite_cache
    content: "Phase 1: pglite integration — schema for docs/edges/entities; keyword search only (no vectors yet); mark DB as cache in docs"
    status: pending
  - id: p1_compiled_truth_schema
    content: "Phase 1: evolve twin.md into compiled-truth + timeline — top = current state (rewriteable), below separator = append-only evidence; update schema.ts + harvest merge"
    status: pending
  - id: p1_query_me_scaffold
    content: "Phase 1: query_me(question) MVP — hybrid over brain + twin.md; returns quotes + citations (file path + line); no LLM required in default path"
    status: pending
  - id: p1_onboarding_brain_path
    content: "Phase 1: desktop + CLI onboarding — add 'where should your brain live?' step (default ~/twin-brain); write brainPath to twin.config.json"
    status: pending
  - id: p1_onboarding_privacy_tier
    content: "Phase 1: onboarding — add privacy tier toggle (local-only default / allow-cloud-embed opt-in); persist to twin.config.json"
    status: pending

  # ── Phase 2 — Skills + MCP ────────────────────────────────────
  - id: p2_skills_loader
    content: "Phase 2: skill loader — read skills/RESOLVER.md + each skill's SKILL.md at runtime; expose to MCP, terminal Claude, Tauri bubble"
    status: pending
  - id: p2_skill_mood_checkin
    content: "Phase 2: skills/mood-checkin/SKILL.md — markdown-authored voice/prompts; writes ~/twin-brain/moods/YYYY-MM-DD.md"
    status: pending
  - id: p2_skill_diary_compose
    content: "Phase 2: skills/diary-compose/SKILL.md — returns 3 prompts grounded in today's harvest; writes ~/twin-brain/diary/YYYY-MM-DD.md"
    status: pending
  - id: p2_skill_session_ingest
    content: "Phase 2: skills/session-ingest/SKILL.md — normalize Claude JSONL → ~/twin-brain/sessions/<project>/<id>.md; extract graph edges on write"
    status: pending
  - id: p2_skill_query_me
    content: "Phase 2: skills/query-me/SKILL.md — routing rules + citation format; wraps Phase-1 scaffold"
    status: pending
  - id: p2_skill_privacy_gate
    content: "Phase 2: skills/privacy-gate/SKILL.md — redact/refuse rules per privacy tier; every outbound call must pass"
    status: pending
  - id: p2_mcp_log_mood
    content: "Phase 2: MCP tool log_mood(mood, note?) — append-only to moods/YYYY-MM-DD.md; one-line ack"
    status: pending
  - id: p2_mcp_compose_diary
    content: "Phase 2: MCP tool compose_diary() — returns 3 grounded prompts; writes stub diary entry when user responds"
    status: pending
  - id: p2_mcp_query_me
    content: "Phase 2: MCP tool query_me(question) — hybrid search; always returns citations"
    status: pending
  - id: p2_mcp_pet_agency
    content: "Phase 2: MCP tool pet_agency(action, why) — tap/dim/hide/silent; Claude clients ignore, Tauri + web-lite honor"
    status: pending
  - id: p2_soul_md
    content: "Phase 2: SOUL.md — pet voice + guardrails (wellness > productivity, mirror user quotes, max 3 taps/day, consent-gated capture); markdown-tunable"
    status: pending
  - id: p2_resolver_md
    content: "Phase 2: skills/RESOLVER.md — intent → skill routing table shared by MCP / terminal / Tauri"
    status: pending

  # ── Phase 3 — Chores + signal detector + doctor ───────────────
  - id: p3_chores_engine
    content: "Phase 3: extend daemon with cron-style chores/*.cron (morning/midday/evening/weekly); shell out to CLI; zero LLM by default"
    status: pending
  - id: p3_chore_morning
    content: "Phase 3: morning.cron 07:30 — run harvest + optional mood bubble"
    status: pending
  - id: p3_chore_midday
    content: "Phase 3: midday.cron 12:00 — if context_switches_24h ≥ 5 → nudge skill; else silent"
    status: pending
  - id: p3_chore_evening
    content: "Phase 3: evening.cron 22:00 — diary prompt (silent if user is typing)"
    status: pending
  - id: p3_chore_weekly
    content: "Phase 3: weekly.cron Sun 10:00 — weekly-recap skill → diary/YYYY-Www.md"
    status: pending
  - id: p3_signal_detector
    content: "Phase 3: signal detector — cheap flash/mini classifier on opted-in Claude projects only; append one line to observations/today.md; respects privacy-gate"
    status: pending
  - id: p3_signal_detector_optin
    content: "Phase 3: per-project opt-in UI + twin.config.json schema (observedProjects: string[])"
    status: pending
  - id: p3_doctor_cmd
    content: "Phase 3: twin-md doctor — prints health of every source + exact fix command per missing/stale source"
    status: pending
  - id: p3_self_wiring_graph
    content: "Phase 3: graph extractor — regex + tiny classifier on every brain write; edges mentioned/felt/worked_on/appeared_with; stored in PGLite cache"
    status: pending
  - id: p3_optional_embed_flag
    content: "Phase 3 (optional): --embed flag on brain sync — local embedding model for semantic query_me; off by default"
    status: pending

  # ── Phase 4 — Only if needed ──────────────────────────────────
  - id: p4_minion_queue
    content: "Phase 4 (gated): PGLite-backed durable job queue for long migrations (e.g. big Obsidian import). Only if we hit pain."
    status: pending

  # ── Documentation / housekeeping ──────────────────────────────
  - id: doc_plan_v3_brain
    content: "Docs: docs/PLAN_V3_BRAIN.md — principal review document (done, landed with this board)"
    status: completed
  - id: doc_update_architecture
    content: "Docs: update ARCHITECTURE.md once Phase 1 lands — add brain tree, compiled-truth schema, two-tree diagram"
    status: pending
  - id: doc_update_readme
    content: "Docs: update README.md once Phase 2 lands — add brain init + MCP tools + doctor to the 4-line quickstart"
    status: pending

  # ── Explicit cuts (tracked so we don't re-add them) ───────────
  - id: cut_remote_mcp
    content: "Explicit cut: no remote MCP / ngrok / OAuth. Local-only is the brand."
    status: cancelled
  - id: cut_crm_recipes
    content: "Explicit cut: no CRM / email / social-to-brain recipes. Wellness ≠ pipeline."
    status: cancelled
  - id: cut_tiered_people
    content: "Explicit cut: no tiered person enrichment (Tier 1/2/3). Replaced with mood enrichment over time."
    status: cancelled
  - id: cut_pgvector
    content: "Explicit cut: no pgvector / Supabase. PGLite file cache only."
    status: cancelled
  - id: cut_skill_sprawl
    content: "Explicit cut: ship 6–8 skills total, not 26. Resist scope creep."
    status: cancelled
---
