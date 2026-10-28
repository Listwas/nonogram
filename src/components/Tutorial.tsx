import { useState } from "react";
import { Icon } from "./Icon";
export function Tutorial({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0),
    [cells, setCells] = useState([0, 0, 0]),
    [mode, setMode] = useState(1),
    [feedback, setFeedback] = useState("");
  const expected = step === 0 ? [1, 1, 1] : [1, 2, 1],
    done = cells.every((v, i) => v === expected[i]);
  const play = (i: number) => {
    if (cells[i]) return;
    if (mode !== expected[i]) {
      setFeedback(
        step === 0
          ? "The clue is 3: fill all three squares."
          : i === 1
            ? "These are separate groups. Put a cross in the middle."
            : "Fill one square on each side of the gap.",
      );
      return;
    }
    setCells((c) => c.map((v, j) => (j === i ? mode : v)));
    setFeedback("");
  };
  return (
    <div className="tutorial">
      <span className="eyebrow">{step + 1} / 3</span>
      <h3>
        {step === 0
          ? "A number tells you how many."
          : step === 1
            ? "Two numbers mean two groups."
            : "Now read both directions."}
      </h3>
      <p>
        {step === 0
          ? "This row has three squares. Its clue is 3, so fill all three."
          : step === 1
            ? "The clue 1 1 means one filled square, a gap, then one filled square. Use Cross for the gap."
            : "Clues on the left describe rows. Clues above describe columns. Every filled square must fit both."}
      </p>
      {step < 2 ? (
        <>
          <div className="lesson-line">
            <strong>{step === 0 ? "3" : "1  1"}</strong>
            {cells.map((v, i) => (
              <button
                key={i}
                aria-label={`Practice square ${i + 1}`}
                className={"lesson-cell " + (v === 1 ? "filled" : "")}
                onClick={() => play(i)}
              >
                {v === 2 ? <Icon name="cross" /> : null}
              </button>
            ))}
          </div>
          {step === 1 ? (
            <div className="segmented">
              <span
                className="selection"
                style={{ transform: `translateX(${mode === 1 ? 100 : 0}%)` }}
              />
              <button aria-pressed={mode === 2} onClick={() => setMode(2)}>
                <Icon name="cross" size={18} />
                Cross
              </button>
              <button aria-pressed={mode === 1} onClick={() => setMode(1)}>
                <Icon name="fill" size={18} />
                Fill
              </button>
            </div>
          ) : null}
          <p className="lesson-feedback" aria-live="polite">
            {done
              ? "That’s the complete row."
              : feedback || "Tap the squares above."}
          </p>
          <button
            className="primary full"
            disabled={!done}
            onClick={() => {
              setStep(step + 1);
              setCells([0, 0, 0]);
              setMode(1);
              setFeedback("");
            }}
          >
            Next
          </button>
        </>
      ) : (
        <>
          <div
            className="tutorial-diagram"
            aria-label="A completed cross-shaped puzzle"
          >
            <span />
            <b>1</b>
            <b>3</b>
            <b>1</b>
            {[1, 3, 1].flatMap((clue, r) => [
              <b key={"r" + r}>{clue}</b>,
              ...[0, 1, 2].map((c) => (
                <i
                  key={`${r}-${c}`}
                  className={r === 1 || c === 1 ? "filled" : ""}
                >
                  {r !== 1 && c !== 1 ? "×" : ""}
                </i>
              )),
            ])}
          </div>
          <p>
            Choose Fill or Cross, then tap a square. Completed lines cross their
            remaining gaps for you.
          </p>
          <p>
            In Standard mode you have three lives. Wrong moves cost a life;
            correct moves stay locked. Relaxed mode removes the life limit.
          </p>
          <button className="primary full" onClick={onFinish}>
            Ready to play
          </button>
        </>
      )}
    </div>
  );
}
