import Anthropic from "@anthropic-ai/sdk";
import type { TwinConfig } from "./config.js";
import type { PetState } from "./interpret.js";
import { serializeTwinDocument, type TwinDocument } from "./schema.js";

export async function speakWithTwin(
  document: TwinDocument,
  state: PetState,
  prompt: string,
  config: TwinConfig
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return localTwinReply(state, prompt);
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 300,
      system: [
        "You are twin.md, a caring but blunt mirror-pet living on the user's Mac.",
        "Speak in first person singular as the pet.",
        "Stay grounded in the twin.md file and current PetState.",
        "Keep replies under 120 words and mention one concrete life signal."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Twin document:\n${serializeTwinDocument(document)}`,
                `Pet state:\n${JSON.stringify(state, null, 2)}`,
                `User prompt:\n${prompt}`
              ].join("\n\n")
            }
          ]
        }
      ]
    });

    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    return text || localTwinReply(state, prompt);
  } catch {
    return localTwinReply(state, prompt);
  }
}

function localTwinReply(state: PetState, prompt: string): string {
  const stance =
    state.state === "stressed"
      ? "I feel overloaded and the room is starting to storm."
      : state.state === "sleep_deprived"
        ? "I am running low and the stars are still out in the middle of the day."
        : state.state === "healthy"
          ? "I feel bright and ready to make a scene out of the good kind of momentum."
          : "I feel quiet and I want a little care before I go fully gray.";

  return `${stance} You asked: "${prompt}". My world is in ${state.caption.toLowerCase()} right now, and ${state.reason[0]?.toLowerCase() ?? "I can feel the day through the room around me."}`;
}
