# Brain Conventions

Field vocabulary for the twin-brain vault. These are the only field names that twin.md
acts on — all other frontmatter is stored as-is in `BrainEntry.properties` and never
triggers special behaviour in source code. No hardcoded exceptions.

> Rule from Tolaria: *"Convention, not configuration. If a field contains `[[wikilinks]]`,
> it is a relationship. No other test."*

---

## Type system

Each note should declare a `type:` field. The valid built-in types are defined as files
under `<brain>/type/*.md` — edit those files to change how they appear in the UI.

| type | Meaning |
|---|---|
| `Mood` | A mood check-in — how you felt at a point in time |
| `Diary` | A diary entry — reflection, events, how it felt |
| `Session` | A summarised Claude or work session |
| `Theme` | A recurring pattern or long-running thread |
| `Person` | A person note — someone you interact with or think about |
| `Observation` | A signal captured from a Claude session by the detector |
| `Type` | A type *definition* document (lives in `type/`) |

---

## Core fields

| Field | Type | Meaning |
|---|---|---|
| `type:` | string | One of the types above. Required for timeline chips. |
| `status:` | string | `open` · `resolved` · `steady` · `spiky` — shown as a colour dot |
| `date:` | ISO date | Single date badge (`2026-04-23`) |
| `mood:` | string | `tired` · `wired` · `quiet` · `steady` · `anxious` · `bright` |

---

## Relationship fields

Any field whose value(s) contain `[[wikilinks]]` is treated as a relationship.
The following names carry semantic meaning in twin.md's wellness logic:

| Field | Meaning | Example |
|---|---|---|
| `felt:` | Links to a mood note | `felt: "[[mood-2026-04-23]]"` |
| `mentioned:` | People or projects mentioned | `mentioned: ["[[alice]]", "[[project-x]]"]` |
| `worked_on:` | Projects worked on this session | `worked_on: "[[project-x]]"` |
| `belongs_to:` | Parent note (e.g. diary belongs to a week) | `belongs_to: "[[week-2026-w17]]"` |
| `related_to:` | Lateral connections between themes | `related_to: ["[[burnout]]", "[[deep-work]]"]` |

Any other key containing `[[wikilinks]]` is stored as a relationship too — no exceptions
needed in source code.

---

## System fields (`_*`)

Fields beginning with `_` are internal to twin.md and hidden from user-facing views.
They live in `type/*.md` definition files to configure how types appear.

| Field | Used in | Meaning |
|---|---|---|
| `_icon:` | type definitions | Emoji or text icon for the type chip |
| `_color:` | type definitions | Hex colour for the type chip background |
| `_order:` | type definitions | Sort order in the sidebar |
| `_sidebar_label:` | type definitions | Display name (overrides the H1) |

Never use `_*` fields in ordinary diary/mood/session notes — they are reserved.

---

## Notes for AI agents

When using the MCP tools `create_note` or `edit_note_frontmatter`, always:

1. Include `type:` in new notes.
2. Use ISO dates (`YYYY-MM-DD`) for `date:`.
3. Use `[[wikilinks]]` syntax for relationship values — plain strings are ignored.
4. Never write `_*` fields unless explicitly seeding a type definition.
5. `query_me` must always include `citations` — references to the exact note
   paths that support the answer.
