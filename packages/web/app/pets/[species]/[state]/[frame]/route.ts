import { getPetSvgFrame, type PetSvgFrameName } from "@twin-md/core";

type RouteContext = {
  params: Promise<{ species: string; state: string; frame: string }>;
};

const VALID_FRAMES: readonly PetSvgFrameName[] = [
  "breath-a",
  "breath-b",
  "blink",
  "reminder-speak",
  "reaction-happy",
  "reaction-wilt",
  "turn-3q",
  "turn-front"
];

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { species, state, frame } = await ctx.params;
  const bareFrame = frame.replace(/\.svg$/, "") as PetSvgFrameName;
  const frameName: PetSvgFrameName = VALID_FRAMES.includes(bareFrame)
    ? bareFrame
    : "breath-a";

  const svg = getPetSvgFrame(species, state, frameName);
  if (!svg) {
    return new Response("sprite not found", { status: 404 });
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate"
    }
  });
}
