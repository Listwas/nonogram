import { useEffect, useRef, useState } from "react";
import type { Attempt } from "../core/session";

export function GameClock({
  attempt,
  running,
  onTick,
}: {
  attempt: Attempt;
  running: boolean;
  onTick: () => void;
}) {
  const [, update] = useState(0);
  const tick = useRef(onTick);
  tick.current = onTick;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      tick.current();
      update((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = Math.floor(attempt.elapsed / 1000);
  return (
    <time>{`${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`}</time>
  );
}
