import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProfileStore } from "./core/profile";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="boot">
    <h1>Nonogram</h1>
    <p>Getting comfortable…</p>
  </div>,
);
const store = new ProfileStore();
void store
  .open()
  .then((profile) => root.render(<App profile={profile} store={store} />))
  .catch(() =>
    root.render(
      <div className="boot">
        <h1>Couldn’t open the game.</h1>
        <button onClick={() => location.reload()}>Try again</button>
      </div>,
    ),
  );
