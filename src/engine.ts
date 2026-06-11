/* ─────────────────────────────────────────────────────────────
   Stockfish 16 (single-threaded WASM) wrapper.
   Loads lazily on first analyze() so the ~40MB net is only
   fetched when the user actually turns analysis on.
   Scores are reported from the side-to-move's perspective —
   the caller normalises to white-positive.
───────────────────────────────────────────────────────────── */
export interface EvalInfo {
  type: "cp" | "mate";
  value: number;   // side-to-move perspective
  depth: number;
  pv: string[];    // principal variation, UCI moves
}
type Cb = (info: EvalInfo, done: boolean) => void;

let worker: Worker | null = null;
let ready = false;
let readyWaiters: (() => void)[] = [];
let reqId = 0;
let activeCb: Cb | null = null;
let lastInfo: EvalInfo | null = null;

function handleLine(line: string) {
  if (line.includes("uciok")) {
    worker!.postMessage("setoption name Threads value 1");
    worker!.postMessage("setoption name Hash value 32");
    worker!.postMessage("isready");
  } else if (line.includes("readyok") && !ready) {
    ready = true;
    readyWaiters.forEach((r) => r());
    readyWaiters = [];
  } else if (line.startsWith("info") && line.includes(" score ") && line.includes(" pv ")) {
    const m = line.match(/score (cp|mate) (-?\d+)/);
    if (!m) return;
    const d = line.match(/ depth (\d+)/);
    const pv = line.match(/ pv (.+)$/);
    lastInfo = {
      type: m[1] as "cp" | "mate",
      value: +m[2],
      depth: d ? +d[1] : 0,
      pv: pv ? pv[1].trim().split(/\s+/) : [],
    };
    activeCb?.(lastInfo, false);
  } else if (line.startsWith("bestmove")) {
    if (activeCb && lastInfo) activeCb(lastInfo, true);
  }
}

function ensureWorker(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    readyWaiters.push(resolve);
    if (worker) return;
    worker = new Worker("/engine/stockfish-nnue-16-single.js");
    worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
      if (line) handleLine(line);
    };
    worker.postMessage("uci");
  });
}

/** Analyse a FEN to the given depth. cb streams progressive evals; done=true on final. */
export async function analyze(fen: string, depth: number, cb: Cb): Promise<void> {
  await ensureWorker();
  const id = ++reqId;
  lastInfo = null;
  activeCb = (info, done) => { if (id === reqId) cb(info, done); };
  worker!.postMessage("stop");
  worker!.postMessage("position fen " + fen);
  worker!.postMessage("go depth " + depth);
}

/** Cancel any running search and detach callbacks. */
export function stop(): void {
  reqId++;
  activeCb = null;
  lastInfo = null;
  worker?.postMessage("stop");
}

/** Whether analysis has ever been started (net loaded). */
export function isReady(): boolean {
  return ready;
}
