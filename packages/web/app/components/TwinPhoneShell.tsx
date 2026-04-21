"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import type { PetState, Reminder, TwinDocument } from "@twin-md/core";
import { motion, AnimatePresence } from "framer-motion";

type TwinPhoneShellProps = {
  initialDocument: TwinDocument;
  initialState: PetState;
  initialReminders?: Reminder[];
  layout?: "world" | "companion";
};

type StatePayload = {
  document: TwinDocument;
  state: PetState;
};

type RemindersPayload = {
  reminders: Reminder[];
};

const SOURCE_LABELS = [
  "Health",
  "Calendar",
  "Claude Memory",
  "Obsidian",
  "Location"
];

const MAX_VISIBLE_BUBBLES = 3;

export function TwinPhoneShell({
  initialDocument,
  initialState,
  initialReminders = [],
  layout = "world"
}: TwinPhoneShellProps) {
  const [document, setDocument] = useState(initialDocument);
  const [petState, setPetState] = useState(initialState);
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const deferredState = useDeferredValue(petState);
  const isCompanion = layout === "companion";

  useEffect(() => {
    let cancelled = false;
    const interval = window.setInterval(async () => {
      const stateResponse = await fetch("/api/state", { cache: "no-store" });
      if (stateResponse.ok && !cancelled) {
        const payload = (await stateResponse.json()) as StatePayload;
        startTransition(() => {
          setDocument(payload.document);
          setPetState(payload.state);
        });
      }

      const remindersResponse = await fetch("/api/reminders?sweep=1", {
        cache: "no-store"
      });
      if (remindersResponse.ok && !cancelled) {
        const payload = (await remindersResponse.json()) as RemindersPayload;
        startTransition(() => setReminders(payload.reminders));
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      const payload = (await response.json()) as { reply: string; state: PetState };

      startTransition(() => {
        setReply(payload.reply);
        setPetState(payload.state);
        setPrompt("");
      });
    } finally {
      setPending(false);
    }
  }

  async function handleReminderAction(
    reminder: Reminder,
    action: "acknowledge" | "dismiss"
  ) {
    setReminders((current) => current.filter((entry) => entry.id !== reminder.id));
    try {
      await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reminder.id, action })
      });
    } catch {
      // best effort; the next sweep will re-reconcile
    }
  }

  const visibleReminders = useMemo(
    () => reminders.slice(0, MAX_VISIBLE_BUBBLES),
    [reminders]
  );

  if (isCompanion) {
    return (
      <main className={`companion-shell state-${deferredState.state}`}>
        <div className="companion-anchor">
          <ReminderStack
            reminders={visibleReminders}
            onAcknowledge={(reminder) => handleReminderAction(reminder, "acknowledge")}
            onDismiss={(reminder) => handleReminderAction(reminder, "dismiss")}
          />
          <motion.div
            className={`companion-pet pet-${deferredState.state}`}
            animate={getPetAnimation(deferredState.state)}
            transition={getPetTransition(deferredState.state)}
          >
            <div className="pet-shadow" />
            <div
              className="pet-svg"
              aria-label={`${deferredState.species} ${deferredState.state}`}
              dangerouslySetInnerHTML={{ __html: deferredState.svg }}
            />
          </motion.div>
          <p className="companion-caption">{deferredState.caption}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`page-shell state-${deferredState.state}`}>
      <section className="world-shell">
        <header className="world-header">
          <div>
            <p className="eyebrow">animal-crossing energy, local-first brain</p>
            <h1>twin.md</h1>
            <p className="scene-title">{deferredState.caption}</p>
          </div>

          <div className="source-ribbon" aria-label="Pet data sources">
            {SOURCE_LABELS.map((label) => (
              <span key={label} className="source-badge">
                {label}
              </span>
            ))}
          </div>
        </header>

        <section className={`world-stage state-${deferredState.state}`}>
          <SceneBackdrop state={deferredState.state} />

          <ReminderStack
            reminders={visibleReminders}
            variant="world"
            onAcknowledge={(reminder) => handleReminderAction(reminder, "acknowledge")}
            onDismiss={(reminder) => handleReminderAction(reminder, "dismiss")}
          />

          <motion.div
            className={`pet-stage pet-${deferredState.state}`}
            animate={getPetAnimation(deferredState.state)}
            transition={getPetTransition(deferredState.state)}
          >
            <div className="pet-shadow" />
            <div
              className="pet-svg"
              aria-label={`${deferredState.species} ${deferredState.state}`}
              dangerouslySetInnerHTML={{ __html: deferredState.svg }}
            />
          </motion.div>

          <div className="dialogue-bubble">
            <p className="bubble-label">{getScenePrompt(deferredState.state)}</p>
            <p className="lede">{deferredState.message}</p>
          </div>
        </section>

        <div className="whisper-row">
          {deferredState.reason.map((line) => (
            <p key={line} className="whisper-pill">
              {line}
            </p>
          ))}
        </div>
      </section>

      <section className="story-strip">
        <StoryCard title="Scene Read" text={deferredState.scene} />
        <StoryCard
          title="Latest Reflection"
          text={cleanText(document.sections.obsidian_signals.last_reflection)}
        />
        <StoryCard
          title="Backend Thread"
          text="Health, calendar, Claude memory, notes, and location harvest into one local twin.md file. That file is re-interpreted into this scene."
        />
      </section>

      <section className="chat-card">
        <div className="chat-copy">
          <p className="eyebrow">mirror voice</p>
          <h2>Talk To Your Twin</h2>
          <p>
            Ask for focus, rest, or a blunt read on the room. The pet replies from the
            same local state that drives the scene.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="chat-form">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Should I rest, ship, or stop pretending I can do both?"
            rows={3}
          />
          <button type="submit" disabled={pending}>
            {pending ? "Thinking..." : "Ask twin"}
          </button>
        </form>

        {reply ? <p className="reply-card">{reply}</p> : null}
      </section>
    </main>
  );
}

type ReminderStackProps = {
  reminders: Reminder[];
  variant?: "companion" | "world";
  onAcknowledge: (reminder: Reminder) => void;
  onDismiss: (reminder: Reminder) => void;
};

function ReminderStack({
  reminders,
  variant = "companion",
  onAcknowledge,
  onDismiss
}: ReminderStackProps) {
  return (
    <div className={`reminder-stack reminder-stack-${variant}`} aria-live="polite">
      <AnimatePresence initial={false}>
        {reminders.map((reminder, index) => (
          <motion.div
            key={reminder.id}
            className={`reminder-bubble tone-${reminder.tone}`}
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            animate={{
              opacity: 1 - index * 0.18,
              y: 0,
              scale: 1
            }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
          >
            <button
              type="button"
              className="reminder-body"
              onClick={() => onAcknowledge(reminder)}
            >
              <span className="reminder-title">{reminder.title}</span>
              <span className="reminder-text">{reminder.body}</span>
            </button>
            <button
              type="button"
              className="reminder-nevermind"
              onClick={() => onDismiss(reminder)}
              aria-label="dismiss"
            >
              nevermind
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SceneBackdrop({ state }: { state: PetState["state"] }) {
  return (
    <>
      <div className="scene-sky" />
      <div className="scene-orb" />
      <div className="scene-ground" />

      {state === "healthy" ? (
        <>
          <div className="cloud cloud-a" />
          <div className="cloud cloud-b" />
          <div className="flower flower-a" />
          <div className="flower flower-b" />
          <div className="flower flower-c" />
          <div className="sparkle sparkle-a" />
          <div className="sparkle sparkle-b" />
        </>
      ) : null}

      {state === "sleep_deprived" ? (
        <>
          <div className="cloud cloud-a hush" />
          <div className="cloud cloud-b hush" />
          {Array.from({ length: 6 }).map((_, index) => (
            <span key={`star-${index}`} className={`star star-${index + 1}`} />
          ))}
        </>
      ) : null}

      {state === "stressed" ? (
        <>
          <div className="storm-cloud storm-a" />
          <div className="storm-cloud storm-b" />
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={`rain-${index}`} className={`rain-drop rain-${index + 1}`} />
          ))}
          <div className="paper paper-a" />
          <div className="paper paper-b" />
          <div className="paper paper-c" />
          <div className="desk-edge" />
        </>
      ) : null}

      {state === "neglected" ? (
        <>
          <div className="fog" />
          <div className="wilt wilt-a" />
          <div className="wilt wilt-b" />
          <div className="wilt wilt-c" />
          <div className="chair-outline" />
        </>
      ) : null}
    </>
  );
}

function StoryCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="story-card">
      <p className="story-card-title">{title}</p>
      <p>{text}</p>
    </article>
  );
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return "No recent reflection reached the room.";
  }

  const text = String(value).trim();
  return text || "No recent reflection reached the room.";
}

function getScenePrompt(state: PetState["state"]): string {
  switch (state) {
    case "healthy":
      return "The pet is thriving";
    case "sleep_deprived":
      return "The day feels too early";
    case "stressed":
      return "Everything feels urgent";
    default:
      return "The room misses you";
  }
}

function getPetAnimation(state: PetState["state"]) {
  switch (state) {
    case "healthy":
      return {
        y: [0, -18, 0],
        rotate: [0, -5, 5, 0],
        scale: [1, 1.04, 1]
      };
    case "sleep_deprived":
      return {
        y: [0, 8, 0],
        rotate: [0, 1.5, -1.5, 0]
      };
    case "stressed":
      return {
        x: [-18, 16, -12, 10, 0],
        y: [0, -4, 0]
      };
    default:
      return {
        y: [0, 4, 0],
        rotate: [0, -2, 0],
        scale: [1, 0.99, 1]
      };
  }
}

function getPetTransition(state: PetState["state"]) {
  return {
    repeat: Infinity,
    duration: state === "stressed" ? 1.2 : state === "healthy" ? 2.2 : 2.8,
    ease: "easeInOut" as const
  };
}
