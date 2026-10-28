import { generate, type Size } from "./core/puzzle";
export type GenerateRequest = {
  type: "generate";
  id: number;
  size: Size;
  seed: string;
  exclude: string[];
};
export type GenerateResult =
  | { type: "result"; id: number; puzzle: ReturnType<typeof generate> }
  | { type: "error"; id: number; message: string };
self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const request = event.data;
  if (request.type !== "generate") return;
  try {
    self.postMessage({
      type: "result",
      id: request.id,
      puzzle: generate(request.size, request.seed, 2700, request.exclude),
    } satisfies GenerateResult);
  } catch {
    self.postMessage({
      type: "error",
      id: request.id,
      message: "Could not prepare this puzzle.",
    } satisfies GenerateResult);
  }
};
