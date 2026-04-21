import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import chokidar from "chokidar";
import {
  getTwinMdPath,
  getTwinStatePath,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  renderAsciiPet,
  type PetState,
  type TwinConfig,
  writePetState
} from "@twin/core";

type TwinWatchAppProps = {
  config: TwinConfig;
};

export function TwinWatchApp({ config }: TwinWatchAppProps) {
  const { exit } = useApp();
  const [petState, setPetState] = useState<PetState | null>(null);
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useInput((input) => {
    if (input.toLowerCase() === "q") {
      exit();
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

    async function syncFromTwinDocument() {
      try {
        const document = await readCurrentTwinDocument(config);
        const nextState = await interpretTwinDocument(document, config);
        await writePetState(nextState);
        if (active) {
          setPetState(nextState);
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
    const animation = setInterval(() => {
      setFrame((current) => current + 1);
    }, 900);

    const watcher = chokidar.watch([getTwinMdPath(), getTwinStatePath()], {
      ignoreInitial: true
    });

    watcher.on("change", (changedPath) => {
      if (changedPath === getTwinMdPath()) {
        void syncFromTwinDocument();
        return;
      }

      void loadState();
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

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={petState.color}>{renderAsciiPet(petState.species, petState.state, frame)}</Text>
      <Text>{petState.caption}</Text>
      <Text dimColor>{petState.scene}</Text>
      <Text>{petState.message}</Text>
      <Text dimColor>{petState.reason.join(" | ")}</Text>
      <Text dimColor>Watching {getTwinMdPath()} and {getTwinStatePath()}</Text>
      <Text dimColor>Press q to exit.</Text>
    </Box>
  );
}
