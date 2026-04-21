import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import chokidar from "chokidar";
import {
  acknowledgeReminder,
  dismissReminder,
  getPendingReminders,
  getTwinMdPath,
  getTwinStatePath,
  getTwinRemindersPath,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readReminderLedger,
  renderAsciiPet,
  runReminderSweep,
  type PetState,
  type Reminder,
  type TwinConfig,
  writePetState
} from "@twin-md/core";

type TwinWatchAppProps = {
  config: TwinConfig;
};

const MAX_VISIBLE_BUBBLES = 3;

export function TwinWatchApp({ config }: TwinWatchAppProps) {
  const { exit } = useApp();
  const [petState, setPetState] = useState<PetState | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useInput(async (input) => {
    const key = input.toLowerCase();
    if (key === "q") {
      exit();
      return;
    }

    if (key === "d") {
      const [top] = reminders;
      if (!top) {
        return;
      }
      setReminders((current) => current.filter((entry) => entry.id !== top.id));
      try {
        await acknowledgeReminder(top.id);
      } catch {
        // ignore
      }
      return;
    }

    if (key === "n") {
      const [top] = reminders;
      if (!top) {
        return;
      }
      setReminders((current) => current.filter((entry) => entry.id !== top.id));
      try {
        await dismissReminder(top.id);
      } catch {
        // ignore
      }
    }
  });

  useEffect(() => {
    let active = true;

    async function loadState() {
      try {
        const current = await readCurrentTwinState();
        if (active && current) {
          setPetState(current);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load pet state."
          );
        }
      }
    }

    async function loadReminders() {
      try {
        const pending = getPendingReminders(await readReminderLedger());
        if (active) {
          setReminders(pending);
        }
      } catch {
        // silent: missing file is fine
      }
    }

    async function syncFromTwinDocument() {
      try {
        const document = await readCurrentTwinDocument(config);
        const nextState = await interpretTwinDocument(document, config);
        await writePetState(nextState);
        const sweep = await runReminderSweep(document, nextState);
        if (active) {
          setPetState(nextState);
          setReminders(getPendingReminders(sweep.all));
          setError(null);
        }
      } catch (syncError) {
        if (active) {
          setError(
            syncError instanceof Error
              ? syncError.message
              : "Failed to refresh from twin.md."
          );
        }
      }
    }

    void loadState();
    void loadReminders();
    const animation = setInterval(() => {
      setFrame((current) => current + 1);
    }, 900);

    const watcher = chokidar.watch(
      [getTwinMdPath(), getTwinStatePath(), getTwinRemindersPath()],
      { ignoreInitial: true }
    );

    watcher.on("change", (changedPath) => {
      if (changedPath === getTwinMdPath()) {
        void syncFromTwinDocument();
        return;
      }

      if (changedPath === getTwinRemindersPath()) {
        void loadReminders();
        return;
      }

      void loadState();
    });

    watcher.on("add", (addedPath) => {
      if (addedPath === getTwinRemindersPath()) {
        void loadReminders();
      }
    });

    return () => {
      active = false;
      clearInterval(animation);
      void watcher.close();
    };
  }, [config]);

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">twin watch error: {error}</Text>
      </Box>
    );
  }

  if (!petState) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading twin state...</Text>
      </Box>
    );
  }

  const visibleReminders = reminders.slice(0, MAX_VISIBLE_BUBBLES);

  return (
    <Box flexDirection="column" padding={1}>
      {visibleReminders.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {visibleReminders.map((reminder) => (
            <ReminderBubble key={reminder.id} reminder={reminder} />
          ))}
        </Box>
      ) : null}
      <Text color={petState.color}>{renderAsciiPet(petState.species, petState.state, frame)}</Text>
      <Text>{petState.caption}</Text>
      <Text dimColor>{petState.scene}</Text>
      <Text>{petState.message}</Text>
      <Text dimColor>{petState.reason.join(" | ")}</Text>
      <Text dimColor>
        Watching {getTwinMdPath()} and {getTwinStatePath()}
      </Text>
      <Text dimColor>
        Press q to exit{reminders.length > 0 ? " · d acknowledge top · n dismiss top" : ""}.
      </Text>
    </Box>
  );
}

function ReminderBubble({ reminder }: { reminder: Reminder }) {
  const color = toneColor(reminder.tone);
  const body = reminder.body.length > 78 ? `${reminder.body.slice(0, 75)}...` : reminder.body;
  const title = reminder.title.toLowerCase();
  const width = Math.max(title.length, body.length) + 4;
  const border = `+${"-".repeat(width)}+`;
  const pad = (text: string) => `| ${text.padEnd(width - 2)} |`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>{border}</Text>
      <Text color={color} bold>
        {pad(title)}
      </Text>
      <Text color={color}>{pad(body)}</Text>
      <Text color={color}>{border}</Text>
    </Box>
  );
}

function toneColor(tone: Reminder["tone"]): string {
  switch (tone) {
    case "soft":
      return "green";
    case "groggy":
      return "yellow";
    case "clipped":
      return "red";
    default:
      return "gray";
  }
}
