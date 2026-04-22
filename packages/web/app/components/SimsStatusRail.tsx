"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { PetState, TwinDocument } from "@twin-md/core";

type Props = {
  state: PetState;
  document: TwinDocument;
};

type Level = "low" | "mid" | "high";

type Bar = {
  key: "energy" | "focus" | "knowledge";
  label: string;
  icon: ReactNode;
  value: number;
  copy: string;
};

export function SimsStatusRail({ state, document }: Props) {
  const bars = deriveBars(state, document);
  return (
    <aside className="sims-rail" aria-label="twin vitals">
      {bars.map((bar) => (
        <SimsBar key={bar.key} bar={bar} />
      ))}
    </aside>
  );
}

function SimsBar({ bar }: { bar: Bar }) {
  const [rendered, setRendered] = useState(0);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setRendered(bar.value));
    return () => window.cancelAnimationFrame(id);
  }, [bar.value]);

  const level = levelFor(bar.value);

  return (
    <div
      className={`sims-bar sims-bar-${bar.key} level-${level}`}
      data-level={level}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bar.value)}
      aria-label={`${bar.label}: ${bar.copy}`}
    >
      <div className="sims-bar-label">
        <span className="sims-bar-icon" aria-hidden="true">
          {bar.icon}
        </span>
        <span className="sims-bar-name">{bar.label}</span>
      </div>
      <div className="sims-bar-track">
        <div
          className="sims-bar-fill"
          style={{ height: `${Math.max(4, Math.min(100, rendered))}%` }}
        />
      </div>
      <span className="sims-bar-copy">{bar.copy}</span>
    </div>
  );
}

function deriveBars(state: PetState, document: TwinDocument): Bar[] {
  const energy = clamp(state.energy);
  const focus = clamp(100 - state.stress);
  const knowledge = deriveKnowledge(document);

  return [
    {
      key: "energy",
      label: "energy",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      ),
      value: energy,
      copy: pickCopy(energy, [
        "running on fumes",
        "awake enough",
        "fully charged"
      ])
    },
    {
      key: "focus",
      label: "focus",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </svg>
      ),
      value: focus,
      copy: pickCopy(focus, ["scattered", "holding it", "locked in"])
    },
    {
      key: "knowledge",
      label: "knowledge",
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4V4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7V4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ),
      value: knowledge,
      copy: pickCopy(knowledge, ["quiet brain", "buzzing", "overflowing"])
    }
  ];
}

function deriveKnowledge(document: TwinDocument): number {
  const memory = document.sections.claude_memory_signals as Record<string, unknown>;
  const obsidian = document.sections.obsidian_signals as Record<string, unknown>;
  const topics =
    (memory?.recent_topics as unknown[] | undefined)?.filter(
      (topic) => typeof topic === "string" && topic !== "setup"
    ).length ?? 0;
  const tags =
    (obsidian?.recent_tags as unknown[] | undefined)?.filter(
      (tag) => typeof tag === "string" && tag.length > 0
    ).length ?? 0;
  const todos = Number(obsidian?.unfinished_todos ?? 0);

  // Each signal contributes ~12 pts; todos saturate at 5 = +20.
  const raw = topics * 12 + tags * 10 + Math.min(todos, 5) * 4;
  return clamp(raw);
}

function levelFor(value: number): Level {
  if (value < 33) return "low";
  if (value < 67) return "mid";
  return "high";
}

function pickCopy(value: number, [low, mid, high]: [string, string, string]): string {
  if (value < 33) return low;
  if (value < 67) return mid;
  return high;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
