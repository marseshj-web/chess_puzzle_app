import { useState, useRef, useEffect } from "react";
import { Lightbulb, Eye, ChevronLeft, ChevronRight, Trophy, X, Loader2, ArrowLeft, Activity } from "lucide-react";
import * as engine from "./engine";

/* ─────────────────────────────────────────────────────────────
   Chess engine (self-contained, no external lib)
   board = { "e4": "P", ... }  uppercase=white, lowercase=black
───────────────────────────────────────────────────────────── */
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const colorOf = (pc: string) => (pc === pc.toUpperCase() ? "w" : "b");
const toFR = (sq: string): [number, number] => [sq.charCodeAt(0) - 97, +sq[1]];
const toSq = (f: number, r: number) => String.fromCharCode(97 + f) + r;
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 1 && r <= 8;
const isDark = (sq: string) => (FILES.indexOf(sq[0]) + (+sq[1] - 1)) % 2 === 0;
const uciToMove = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

interface Pos { board: Record<string, string>; turn: string; castling: string; ep: string | null; }
interface Move { from: string; to: string; promotion?: string; }

function parseFEN(fen: string): Pos {
  const [placement, turn, castling, ep] = fen.split(" ");
  const rows = placement.split("/");
  const board: Record<string, string> = {};
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else { board[FILES[file] + rank] = ch; file++; }
    }
  }
  return { board, turn, castling: castling || "-", ep: ep && ep !== "-" ? ep : null };
}

function posToFEN(pos: Pos): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const pc = pos.board[FILES[f] + rank];
      if (pc) { if (empty) { row += empty; empty = 0; } row += pc; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${pos.turn} ${pos.castling || "-"} ${pos.ep || "-"} 0 1`;
}

function findKing(board: Record<string, string>, color: string): string | null {
  const k = color === "w" ? "K" : "k";
  for (const sq in board) if (board[sq] === k) return sq;
  return null;
}

function isAttacked(board: Record<string, string>, sq: string, by: string): boolean {
  const [f, r] = toFR(sq);
  const pr = by === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) if (onBoard(f + df, pr) && board[toSq(f + df, pr)] === (by === "w" ? "P" : "p")) return true;
  for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
    if (onBoard(f+df,r+dr)) { const p=board[toSq(f+df,r+dr)]; if (p&&p.toLowerCase()==="n"&&colorOf(p)===by) return true; }
  }
  for (let df=-1;df<=1;df++) for (let dr=-1;dr<=1;dr++) {
    if ((df||dr)&&onBoard(f+df,r+dr)) { const p=board[toSq(f+df,r+dr)]; if (p&&p.toLowerCase()==="k"&&colorOf(p)===by) return true; }
  }
  for (const [df,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    let nf=f+df,nr=r+dr;
    while(onBoard(nf,nr)){ const p=board[toSq(nf,nr)]; if(p){ if(colorOf(p)===by&&"rq".includes(p.toLowerCase())) return true; break; } nf+=df; nr+=dr; }
  }
  for (const [df,dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    let nf=f+df,nr=r+dr;
    while(onBoard(nf,nr)){ const p=board[toSq(nf,nr)]; if(p){ if(colorOf(p)===by&&"bq".includes(p.toLowerCase())) return true; break; } nf+=df; nr+=dr; }
  }
  return false;
}

function pushPawn(out: Move[], from: string, to: string, promo: boolean) {
  if (promo) for (const p of ["q","r","b","n"]) out.push({ from, to, promotion: p });
  else out.push({ from, to });
}

function pseudoFrom(pos: Pos, sq: string): Move[] {
  const board=pos.board, piece=board[sq];
  if (!piece||colorOf(piece)!==pos.turn) return [];
  const color=colorOf(piece),enemy=color==="w"?"b":"w",type=piece.toLowerCase();
  const [f,r]=toFR(sq),out: Move[]=[];
  const add=(tf: number,tr: number)=>{
    if(!onBoard(tf,tr)) return false;
    const t=toSq(tf,tr),tp=board[t];
    if(tp){ if(colorOf(tp)===enemy) out.push({from:sq,to:t}); return false; }
    out.push({from:sq,to:t}); return true;
  };
  if (type==="p") {
    const dir=color==="w"?1:-1,start=color==="w"?2:7,last=color==="w"?8:1;
    if(onBoard(f,r+dir)&&!board[toSq(f,r+dir)]){
      pushPawn(out,sq,toSq(f,r+dir),r+dir===last);
      if(r===start&&!board[toSq(f,r+2*dir)]) out.push({from:sq,to:toSq(f,r+2*dir)});
    }
    for(const df of [-1,1]){
      const cf=f+df,cr=r+dir; if(!onBoard(cf,cr)) continue;
      const t=toSq(cf,cr),tp=board[t];
      if(tp&&colorOf(tp)===enemy) pushPawn(out,sq,t,cr===last);
      else if(pos.ep&&t===pos.ep) out.push({from:sq,to:t});
    }
  } else if(type==="n") {
    for(const [df,dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) add(f+df,r+dr);
  } else if("brq".includes(type)) {
    const dirs: [number,number][]=[];
    if(type==="b"||type==="q") dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
    if(type==="r"||type==="q") dirs.push([1,0],[-1,0],[0,1],[0,-1]);
    for(const [df,dr] of dirs){ let nf=f+df,nr=r+dr; while(add(nf,nr)){nf+=df;nr+=dr;} }
  } else if(type==="k") {
    for(let df=-1;df<=1;df++) for(let dr=-1;dr<=1;dr++) if(df||dr) add(f+df,r+dr);
    const home=color==="w"?1:8,rights=pos.castling||"-";
    if(r===home&&f===4&&!isAttacked(board,sq,enemy)){
      const kR=color==="w"?"K":"k",qR=color==="w"?"Q":"q";
      if(rights.includes(kR)&&!board[toSq(5,home)]&&!board[toSq(6,home)]&&board[toSq(7,home)]?.toLowerCase()==="r"
        &&!isAttacked(board,toSq(5,home),enemy)&&!isAttacked(board,toSq(6,home),enemy)) out.push({from:sq,to:toSq(6,home)});
      if(rights.includes(qR)&&!board[toSq(3,home)]&&!board[toSq(2,home)]&&!board[toSq(1,home)]&&board[toSq(0,home)]?.toLowerCase()==="r"
        &&!isAttacked(board,toSq(3,home),enemy)&&!isAttacked(board,toSq(2,home),enemy)) out.push({from:sq,to:toSq(2,home)});
    }
  }
  return out;
}

function makeMove(pos: Pos, mv: Move): Pos {
  const board={...pos.board};
  const {from,to,promotion}=mv,piece=board[from],color=colorOf(piece),type=piece.toLowerCase();
  delete board[from];
  if(type==="p"&&from[0]!==to[0]&&!pos.board[to]) delete board[to[0]+(color==="w"?+to[1]-1:+to[1]+1)];
  board[to]=promotion?(color==="w"?promotion.toUpperCase():promotion.toLowerCase()):piece;
  if(type==="k"){
    const ff=from.charCodeAt(0)-97,tf=to.charCodeAt(0)-97,rank=from[1];
    if(Math.abs(tf-ff)===2){
      if(tf>ff){ board["f"+rank]=board["h"+rank]; delete board["h"+rank]; }
      else { board["d"+rank]=board["a"+rank]; delete board["a"+rank]; }
    }
  }
  let c=pos.castling==="-"?"":pos.castling;
  if(type==="k") c=c.replace(color==="w"?/[KQ]/g:/[kq]/g,"");
  const rm: Record<string,string>={a1:"Q",h1:"K",a8:"q",h8:"k"};
  for(const s of [from,to]) if(rm[s]) c=c.replace(rm[s],"");
  let ep=null;
  if(type==="p"&&Math.abs(+to[1]-+from[1])===2) ep=to[0]+(+from[1]+ +to[1])/2;
  return {board,turn:color==="w"?"b":"w",castling:c||"-",ep};
}

function legalFrom(pos: Pos, sq: string): Move[] {
  return pseudoFrom(pos,sq).filter(mv=>{
    const after=makeMove(pos,mv);
    const ks=findKing(after.board,pos.turn);
    return ks&&!isAttacked(after.board,ks,pos.turn==="w"?"b":"w");
  });
}

function displaySquares(pc: string): string[][] {
  const ranks=pc==="w"?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];
  const files=pc==="w"?FILES:[...FILES].reverse();
  return ranks.map(rank=>files.map(f=>f+rank));
}

/* ── analysis display ── */
interface NEval { type: "cp" | "mate"; white: number; depth: number; best?: string; }

function sqCenter(sq: string, playerColor: string, cell: number): [number, number] | null {
  const grid = displaySquares(playerColor);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (grid[r][c] === sq) return [(c + 0.5) * cell, (r + 0.5) * cell];
  return null;
}

function fmtEval(e: NEval | null): string {
  if (!e) return "–";
  if (e.type === "mate") return (e.white > 0 ? "M" : "-M") + Math.abs(e.white);
  const p = e.white / 100;
  return (p >= 0 ? "+" : "") + p.toFixed(1);
}

function whiteFrac(e: NEval | null): number {
  if (!e) return 0.5;
  if (e.type === "mate") return e.white > 0 ? 1 : 0;
  const cp = Math.max(-1000, Math.min(1000, e.white));
  return 0.5 + (cp / 1000) * 0.5;
}

/* ── data types & constants ── */
interface Puzzle { id: string; fen: string; moves: string[]; rating: number; themes: string[]; popularity: number; }

const THEMES: [string, string][] = [
  ["mateIn1","1수 메이트"],["mateIn2","2수 메이트"],["mateIn3","3수 메이트"],["mate","메이트(전체)"],
  ["fork","포크"],["pin","핀"],["skewer","스큐어"],["discoveredAttack","발견 공격"],["doubleCheck","양수겸장"],
  ["sacrifice","희생"],["deflection","유인책"],["attraction","끌어들이기"],["interference","차단"],["intermezzo","중간수"],
  ["hangingPiece","무방비 기물"],["trappedPiece","갇힌 기물"],["zugzwang","추크츠방"],["quietMove","조용한 수"],
  ["advancedPawn","전진 폰"],["promotion","승진"],["backRankMate","백랭크 메이트"],["smotheredMate","질식 메이트"],
  ["kingsideAttack","킹사이드 공격"],["queensideAttack","퀸사이드 공격"],["exposedKing","노출된 킹"],
  ["opening","오프닝"],["middlegame","미들게임"],["endgame","엔드게임"],
  ["rookEndgame","룩 엔드"],["pawnEndgame","폰 엔드"],["queenEndgame","퀸 엔드"],["bishopEndgame","비숍 엔드"],["knightEndgame","나이트 엔드"],
  ["crushing","결정타"],["advantage","우세"],["short","단수"],["long","장수"],["veryLong","초장수"],
];
const THEME_KO = Object.fromEntries(THEMES);
const WINDOWS: Record<string,[number,number]> = { easy:[-300,-50], similar:[-120,120], hard:[50,250] };
const BUCKET_SIZE = 400;

function getBucketsForRange(lo: number, hi: number): string[] {
  const buckets: string[] = [];
  let start = Math.floor(lo / BUCKET_SIZE) * BUCKET_SIZE;
  while (start <= hi) {
    buckets.push(`r${String(start).padStart(4,"0")}-${String(start+BUCKET_SIZE-1).padStart(4,"0")}`);
    start += BUCKET_SIZE;
  }
  return buckets;
}

function Piece({ pc, size }: { pc: string; size: number }) {
  const white = pc === pc.toUpperCase();
  return (
    <span style={{fontSize:size,lineHeight:1,userSelect:"none",display:"block",textAlign:"center",
      color:white?"#f8f6ef":"#2a2620",
      WebkitTextStroke:white?"0.6px #7a6348":"0.6px #c8a368",
      textShadow:"0 1px 2px rgba(0,0,0,0.35)",pointerEvents:"none"}}>
      {GLYPH[pc.toLowerCase()]}
    </span>
  );
}

const C = { bg:"#1c1c2b", card:"#24243a", line:"#33334d", gold:"#e2b96f", txt:"#e8e8ef", sub:"#9a9ab0" };

export default function App() {
  const [screen, setScreen] = useState<"filter"|"loading"|"play">("filter");
  const [progress, setProgress] = useState({ loaded: 0, total: 0, pct: 0 });
  const [pool, setPool] = useState<Puzzle[]>([]);
  const [err, setErr] = useState("");
  const [dataReady, setDataReady] = useState(false);

  // filters
  const [myRating, setMyRating] = useState(1500);
  const [win, setWin] = useState("similar");
  const [custom, setCustom] = useState(false);
  const [minR, setMinR] = useState(1300);
  const [maxR, setMaxR] = useState(1600);
  const [themes, setThemes] = useState<string[]>([]);

  // play state
  const [puzzle, setPuzzle] = useState<Puzzle|null>(null);
  const [pos, setPos] = useState<Pos|null>(null);
  const [playerColor, setPlayerColor] = useState("w");
  const [moves, setMoves] = useState<string[]>([]);
  const [next, setNext] = useState(0);
  const [busy, setBusy] = useState(false);
  const [solved, setSolved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string|null>(null);
  const [dots, setDots] = useState<string[]>([]);
  const [dragging, setDragging] = useState<{from:string;piece:string;x:number;y:number}|null>(null);
  const [lastMove, setLastMove] = useState<{from:string;to:string}|null>(null);
  const [hintSq, setHintSq] = useState<string[]|null>(null);
  const [hintLvl, setHintLvl] = useState(0);
  const [promo, setPromo] = useState<{from:string;to:string}|null>(null);
  const [flash, setFlash] = useState<"ok"|"no"|null>(null);
  const [score, setScore] = useState({ correct:0, wrong:0 });
  const [boardPx, setBoardPx] = useState(0);

  // analysis
  const [analyzeOn, setAnalyzeOn] = useState(false);
  const [evalInfo, setEvalInfo] = useState<NEval|null>(null);
  const [engineThinking, setEngineThinking] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{sq:string;x0:number;y0:number;moved:boolean;movable:boolean;piece:string;toggle:boolean}|null>(null);
  const apiRef = useRef<Record<string,Function>>({});
  const abortRef = useRef<AbortController|null>(null);
  const historyRef = useRef<{ puzzles: Puzzle[]; idx: number }>({ puzzles: [], idx: -1 });
  const [historyIdx, setHistoryIdx] = useState(-1);

  const px = boardPx||360, cell = px/8;
  const grid = pos ? displaySquares(playerColor) : [];
  const playerTurn = !busy&&!solved&&!failed&&next%2===1&&next<moves.length;
  const expected = playerTurn ? moves[next] : null;
  const expFrom = expected ? expected.slice(0,2) : null;
  const expTo = expected ? expected.slice(2,4) : null;

  const minMax = (): [number,number] => custom?[minR,maxR]:[myRating+WINDOWS[win][0],myRating+WINDOWS[win][1]];

  /* ── load data from pre-processed bucket JSON files ── */
  async function loadData() {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const [lo, hi] = minMax();
    const buckets = getBucketsForRange(lo, hi);
    setErr(""); setScreen("loading");
    setProgress({ loaded: 0, total: buckets.length, pct: 0 });

    const all: Puzzle[] = [];

    for (let i = 0; i < buckets.length; i++) {
      if (abort.signal.aborted) break;
      try {
        const res = await fetch(`/data/${buckets[i]}.json`, { signal: abort.signal });
        if (res.ok) {
          const data: Puzzle[] = await res.json();
          for (const p of data) {
            if (p.rating < lo || p.rating > hi) continue;
            if (themes.length && !themes.some(t => p.themes.includes(t))) continue;
            all.push(p);
          }
        }
      } catch {
        // bucket file may not exist for that range; skip silently
      }
      setProgress({ loaded: i+1, total: buckets.length, pct: Math.round(((i+1)/buckets.length)*100) });
    }

    if (abort.signal.aborted) return;

    if (!all.length) {
      setErr("조건에 맞는 퍼즐이 없습니다. 레이팅 범위나 테마를 조정하거나, 먼저 npm run parse를 실행하세요.");
      setScreen("filter");
      return;
    }

    setPool(all); setDataReady(true); setScore({ correct:0, wrong:0 });
    historyRef.current = { puzzles: [], idx: -1 };
    setHistoryIdx(-1);
    startPuzzle(all);
  }

  /* ── puzzle lifecycle ── */
  function launchPuzzle(p: Puzzle) {
    const start = parseFEN(p.fen);
    const solver = start.turn==="w"?"b":"w";
    setPuzzle(p); setMoves(p.moves); setPlayerColor(solver);
    setPos(start); setNext(0); setSolved(false); setFailed(false);
    setSelected(null); setDots([]); setHintSq(null); setHintLvl(0); setPromo(null); setLastMove(null);
    setBusy(true); setScreen("play");
    setTimeout(()=>{
      const after=makeMove(start,uciToMove(p.moves[0]));
      setPos(after); setLastMove({from:p.moves[0].slice(0,2),to:p.moves[0].slice(2,4)});
      setNext(1); setBusy(false);
    },600);
  }

  function startPuzzle(list: Puzzle[]) {
    const p = list[Math.floor(Math.random()*list.length)];
    const h = historyRef.current;
    h.puzzles = h.puzzles.slice(0, h.idx + 1);
    h.puzzles.push(p);
    h.idx = h.puzzles.length - 1;
    setHistoryIdx(h.idx);
    launchPuzzle(p);
  }

  function goBack() {
    const h = historyRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    setHistoryIdx(h.idx);
    launchPuzzle(h.puzzles[h.idx]);
  }

  function goForward() {
    const h = historyRef.current;
    if (h.idx < h.puzzles.length - 1) {
      h.idx++;
      setHistoryIdx(h.idx);
      launchPuzzle(h.puzzles[h.idx]);
    } else {
      startPuzzle(pool);
    }
  }

  useEffect(()=>{
    if (!boardRef.current) return;
    const ro=new ResizeObserver(es=>{ for(const e of es) setBoardPx(e.contentRect.width); });
    ro.observe(boardRef.current);
    return ()=>ro.disconnect();
  },[screen]);

  /* ── engine analysis: re-evaluate whenever the position changes ── */
  useEffect(()=>{
    if(!analyzeOn||screen!=="play"||!pos){ return; }
    const turn=pos.turn;
    setEngineThinking(true);
    engine.analyze(posToFEN(pos),14,(info,done)=>{
      setEvalInfo({ type:info.type, white:turn==="w"?info.value:-info.value, depth:info.depth, best:info.pv[0] });
      if(done) setEngineThinking(false);
    });
  },[analyzeOn,pos,screen]);

  useEffect(()=>{
    if(!analyzeOn){ engine.stop(); setEvalInfo(null); setEngineThinking(false); }
  },[analyzeOn]);

  /* ── interaction ── */
  const movable=(sq: string)=>{ const pc=pos?.board[sq]; return !!pc&&colorOf(pc)===playerColor&&playerTurn; };
  const acceptable=(sq: string)=>dots.includes(sq)||(selected===expFrom&&sq===expTo);
  function select(sq: string){ setSelected(sq); setDots([...new Set(legalFrom(pos!,sq).map(m=>m.to))]); }

  function squareFromPoint(x: number,y: number): string|null {
    if(!boardRef.current) return null;
    const rect=boardRef.current.getBoundingClientRect();
    const c=Math.floor((x-rect.left)/(rect.width/8)),r=Math.floor((y-rect.top)/(rect.height/8));
    if(c<0||c>7||r<0||r>7) return null;
    return displaySquares(playerColor)[r][c];
  }

  function attemptMove(from: string,to: string,promoChoice?: string) {
    if(!playerTurn) return;
    const piece=pos!.board[from];
    if(!piece||colorOf(piece)!==playerColor) return;
    const last=playerColor==="w"?"8":"1";
    const needs=piece.toLowerCase()==="p"&&to[1]===last;
    if(needs&&!promoChoice){ setPromo({from,to}); return; }
    const uci=from+to+(needs?promoChoice:"");
    setSelected(null); setDots([]);
    if(uci.toLowerCase()===moves[next].toLowerCase()){
      const np=makeMove(pos!,{from,to,promotion:needs?promoChoice:undefined});
      setPos(np); setLastMove({from,to}); setHintSq(null); setHintLvl(0); setPromo(null);
      setFlash("ok"); setTimeout(()=>setFlash(null),450);
      const nn=next+1; setNext(nn);
      if(nn>=moves.length){ setSolved(true); setScore(s=>({...s,correct:s.correct+1})); }
      else {
        setBusy(true);
        setTimeout(()=>{
          const op=makeMove(np,uciToMove(moves[nn]));
          setPos(op); setLastMove({from:moves[nn].slice(0,2),to:moves[nn].slice(2,4)});
          setNext(nn+1); setBusy(false);
        },500);
      }
    } else {
      setPromo(null); setFlash("no"); setScore(s=>({...s,wrong:s.wrong+1}));
      setTimeout(()=>setFlash(null),950);
    }
  }

  function handleClick(sq: string) {
    if(!playerTurn){ setSelected(null); setDots([]); return; }
    if(selected){
      if(pos!.board[sq]&&colorOf(pos!.board[sq])===playerColor&&sq!==selected){ select(sq); return; }
      if(acceptable(sq)){ attemptMove(selected,sq); return; }
      setSelected(null); setDots([]); return;
    }
    if(pos!.board[sq]&&colorOf(pos!.board[sq])===playerColor) select(sq);
  }
  apiRef.current={attemptMove,handleClick,squareFromPoint,acceptable,setSelected,setDots,setDragging};

  useEffect(()=>{
    const move=(e: PointerEvent)=>{
      const p=pendingRef.current; if(!p) return;
      if(!p.moved&&Math.hypot(e.clientX-p.x0,e.clientY-p.y0)>6) p.moved=true;
      if(p.movable&&p.moved) setDragging({from:p.sq,piece:p.piece,x:e.clientX,y:e.clientY});
    };
    const up=(e: PointerEvent)=>{
      const p=pendingRef.current; pendingRef.current=null; setDragging(null);
      if(!p) return;
      const api=apiRef.current;
      if(p.moved&&p.movable){
        const t=api.squareFromPoint(e.clientX,e.clientY);
        if(t&&t!==p.sq&&api.acceptable(t)) api.attemptMove(p.sq,t);
        else { api.setSelected(null); api.setDots([]); }
      } else if(!p.movable) api.handleClick(p.sq);
      else if(p.toggle){ api.setSelected(null); api.setDots([]); }
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",up);
    return ()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); };
  },[]);

  function onDown(sq: string,e: React.PointerEvent) {
    const mv=movable(sq);
    pendingRef.current={sq,x0:e.clientX,y0:e.clientY,moved:false,movable:mv,piece:pos!.board[sq],toggle:selected===sq};
    if(mv&&selected!==sq) select(sq);
  }

  function hint() {
    if(!playerTurn) return;
    const ex=moves[next];
    if(hintLvl===0){ setHintSq([ex.slice(0,2)]); setHintLvl(1); }
    else { setHintSq([ex.slice(0,2),ex.slice(2,4)]); setHintLvl(2); }
  }

  function reveal() {
    if(solved||failed||busy) return;
    setFailed(true); setBusy(true); setSelected(null); setDots([]); setHintSq(null);
    setScore(s=>({...s,wrong:s.wrong+1}));
    let i=next,p=pos!;
    const step=()=>{
      if(i>=moves.length){ setBusy(false); setNext(i); return; }
      p=makeMove(p,uciToMove(moves[i]));
      setPos(p); setLastMove({from:moves[i].slice(0,2),to:moves[i].slice(2,4)});
      i++; setTimeout(step,560);
    };
    step();
  }

  const toggleTheme=(k: string)=>setThemes(t=>t.includes(k)?t.filter(x=>x!==k):[...t,k]);

  /* ── SCREENS ── */
  const wrap=(children: React.ReactNode)=>(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",color:C.txt,padding:18}}>
      {children}
    </div>
  );

  if (screen==="filter") {
    const [lo,hi]=minMax();
    const sel=(cond: boolean)=>({padding:"7px 12px",borderRadius:8,border:`1px solid ${cond?C.gold:C.line}`,
      background:cond?"rgba(226,185,111,0.15)":C.card,color:cond?C.gold:C.sub,cursor:"pointer",fontSize:13,fontWeight:600} as React.CSSProperties);
    return wrap(
      <div style={{maxWidth:520,margin:"0 auto"}}>
        <div style={{fontSize:22,fontWeight:800,color:C.gold,marginBottom:4,paddingTop:8}}>♟ Lichess 퍼즐 트레이너</div>
        <div style={{fontSize:12,color:C.sub,marginBottom:20}}>
          {dataReady
            ? `풀에 ${pool.length.toLocaleString()}개 퍼즐 로드됨`
            : "필터를 설정하고 퍼즐을 불러오세요"}
        </div>

        <div style={{fontSize:13,fontWeight:700,color:C.gold,marginBottom:8}}>레이팅</div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <span style={{fontSize:13,color:C.sub}}>내 레이팅</span>
          <input type="number" value={myRating} onChange={e=>setMyRating(+e.target.value||0)}
            style={{width:90,padding:"6px 8px",borderRadius:6,border:`1px solid ${C.line}`,background:C.bg,color:C.txt}} />
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          <button onClick={()=>{setCustom(false);setWin("easy");}} style={sel(!custom&&win==="easy")}>쉬움 (−300~−50)</button>
          <button onClick={()=>{setCustom(false);setWin("similar");}} style={sel(!custom&&win==="similar")}>비슷 (±120)</button>
          <button onClick={()=>{setCustom(false);setWin("hard");}} style={sel(!custom&&win==="hard")}>도전 (+50~+250)</button>
          <button onClick={()=>setCustom(true)} style={sel(custom)}>직접 설정</button>
        </div>
        {custom?(
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
            <input type="number" value={minR} onChange={e=>setMinR(+e.target.value||0)}
              style={{width:80,padding:"6px 8px",borderRadius:6,border:`1px solid ${C.line}`,background:C.bg,color:C.txt}} />
            <span style={{color:C.sub}}>~</span>
            <input type="number" value={maxR} onChange={e=>setMaxR(+e.target.value||0)}
              style={{width:80,padding:"6px 8px",borderRadius:6,border:`1px solid ${C.line}`,background:C.bg,color:C.txt}} />
          </div>
        ):(
          <div style={{fontSize:13,color:C.sub,marginBottom:16}}>선택 범위: <span style={{color:C.gold,fontWeight:700}}>{lo} ~ {hi}</span></div>
        )}

        <div style={{fontSize:13,fontWeight:700,color:C.gold,marginBottom:8}}>테마 <span style={{color:C.sub,fontWeight:400}}>(선택 안 하면 전체 · 여러 개 = OR)</span></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18,maxHeight:150,overflowY:"auto"}}>
          {THEMES.map(([k,label])=>(
            <button key={k} onClick={()=>toggleTheme(k)} style={{padding:"5px 10px",borderRadius:999,fontSize:12,fontWeight:600,cursor:"pointer",
              border:`1px solid ${themes.includes(k)?C.gold:C.line}`,
              background:themes.includes(k)?"rgba(226,185,111,0.18)":"transparent",
              color:themes.includes(k)?C.gold:C.sub}}>{label}</button>
          ))}
        </div>

        {err&&<div style={{color:"#f0807a",fontSize:13,marginBottom:12,lineHeight:1.5}}>{err}</div>}
        <button onClick={loadData}
          style={{width:"100%",padding:12,borderRadius:10,border:"none",background:C.gold,color:C.bg,fontWeight:800,fontSize:15,cursor:"pointer"}}>
          퍼즐 불러오기 →
        </button>
        {dataReady&&(
          <button onClick={()=>startPuzzle(pool)}
            style={{marginTop:8,width:"100%",padding:10,borderRadius:10,border:`1px solid ${C.line}`,background:"transparent",color:C.sub,fontWeight:600,fontSize:14,cursor:"pointer"}}>
            현재 풀로 바로 시작
          </button>
        )}
      </div>
    );
  }

  if (screen==="loading") {
    return wrap(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:"100px 12px"}}>
        <Loader2 size={32} color={C.gold} style={{animation:"spin 1s linear infinite"}} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{fontSize:15,color:C.txt}}>데이터 로드 중…</div>
        <div style={{width:260,height:8,background:C.card,borderRadius:999,overflow:"hidden"}}>
          <div style={{width:`${progress.pct}%`,height:"100%",background:C.gold,transition:"width .3s"}} />
        </div>
        <div style={{fontSize:13,color:C.sub}}>
          구간 <span style={{color:C.gold,fontWeight:700}}>{progress.loaded}</span> / {progress.total}
        </div>
        <button onClick={()=>{ abortRef.current?.abort(); setScreen("filter"); }}
          style={{marginTop:4,padding:"6px 16px",borderRadius:8,border:`1px solid ${C.line}`,background:"transparent",color:C.sub,cursor:"pointer",fontSize:13}}>
          취소
        </button>
      </div>
    );
  }

  // ── play ──
  if (!pos||!puzzle) return null;
  const frame=flash==="ok"?"#4caf50":flash==="no"?"#e05a52":solved?"#4caf50":"transparent";
  let status: string,sColor: string;
  if(solved){ status="🎉 퍼즐 완료"; sColor="#ffd54f"; }
  else if(failed){ status="정답 수순을 표시했습니다"; sColor="#f0807a"; }
  else if(flash==="no"){ status="✗ 그 수가 아닙니다. 다시 시도하세요"; sColor="#f0807a"; }
  else if(busy){ status="상대가 두는 중…"; sColor=C.sub; }
  else if(playerTurn){ status=`${playerColor==="w"?"백":"흑"} 차례 — 최선의 수를 찾으세요`; sColor=C.txt; }
  else { status="준비 중…"; sColor=C.sub; }
  const playerMoves=moves.filter((_,i)=>i%2===1);

  return wrap(
    <div style={{maxWidth:520,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <button onClick={()=>setScreen("filter")} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:13}}>
          <ArrowLeft size={14} />필터 변경
        </button>
        <div style={{fontSize:13,color:C.sub}}>
          <span style={{color:"#4caf50"}}>✓ {score.correct}</span>
          <span style={{margin:"0 8px",color:C.line}}>|</span>
          <span style={{color:"#e05a52"}}>✗ {score.wrong}</span>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:8}}>
        {analyzeOn&&(
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:800,fontVariantNumeric:"tabular-nums",
            color:(evalInfo?.white??0)>=0?"#eef0f5":"#b9b9cc",background:"#15151f",border:`1px solid ${C.line}`,borderRadius:8,padding:"3px 9px"}}>
            {engineThinking&&<Loader2 size={12} color={C.sub} style={{animation:"spin 1s linear infinite"}} />}
            <span>{evalInfo?fmtEval(evalInfo):"분석 준비…"}</span>
            {evalInfo&&<span style={{fontSize:10,color:C.sub,fontWeight:600}}>d{evalInfo.depth}</span>}
          </span>
        )}
        <span style={{fontSize:12,fontWeight:700,color:C.gold,background:"rgba(226,185,111,0.15)",border:`1px solid ${C.gold}55`,borderRadius:999,padding:"2px 9px"}}>
          레이팅 {puzzle.rating}
        </span>
        {puzzle.popularity&&<span style={{fontSize:12,color:C.sub}}>인기도 {puzzle.popularity}</span>}
        {puzzle.themes.slice(0,4).map(t=>(
          <span key={t} style={{fontSize:11.5,color:C.sub,border:`1px solid ${C.line}`,borderRadius:999,padding:"2px 8px"}}>{THEME_KO[t]||t}</span>
        ))}
      </div>

      <div style={{padding:8,borderRadius:10,background:"linear-gradient(145deg,#3a3a52,#2a2a40)",outline:`3px solid ${frame}`,outlineOffset:1,transition:"outline-color .2s",display:"flex",gap:8,alignItems:"stretch"}}>
        {analyzeOn&&(
          <div style={{width:16,flexShrink:0,borderRadius:4,overflow:"hidden",background:"#26233a",display:"flex",flexDirection:"column"}}>
            <div style={{height:`${(1-whiteFrac(evalInfo))*100}%`,background:"#1e1b17",transition:"height .35s"}} />
            <div style={{flex:1,background:"#f5f0dc"}} />
          </div>
        )}
        <div style={{position:"relative",flex:1,minWidth:0}}>
        <div ref={boardRef} style={{width:"100%",aspectRatio:"1/1",display:"grid",gridTemplateColumns:"repeat(8,1fr)",gridTemplateRows:"repeat(8,1fr)",borderRadius:4,overflow:"hidden",touchAction:"none"}}>
          {grid.map((row,r)=>row.map((sq,c)=>{
            const piece=pos.board[sq],dark=isDark(sq);
            const last=lastMove&&(lastMove.from===sq||lastMove.to===sq);
            const isSel=selected===sq,isDot=dots.includes(sq),isHint=hintSq&&hintSq.includes(sq);
            const hide=dragging&&dragging.from===sq;
            const lbl=dark?"#f0d9b5":"#b58863";
            return (
              <div key={sq} onPointerDown={e=>onDown(sq,e)}
                style={{position:"relative",background:dark?"#b58863":"#f0d9b5",display:"flex",alignItems:"center",justifyContent:"center",cursor:movable(sq)?"grab":"default"}}>
                {last&&<div style={{position:"absolute",inset:0,background:"rgba(255,206,84,0.42)"}} />}
                {isHint&&<div style={{position:"absolute",inset:0,background:"rgba(72,160,90,0.5)"}} />}
                {isSel&&<div style={{position:"absolute",inset:0,boxShadow:"inset 0 0 0 4px rgba(72,160,90,0.85)"}} />}
                {isDot&&(piece
                  ?<div style={{position:"absolute",inset:0,border:"4px solid rgba(0,0,0,0.28)",boxSizing:"border-box",borderRadius:4}} />
                  :<div style={{position:"absolute",width:"32%",height:"32%",borderRadius:"50%",background:"rgba(0,0,0,0.22)"}} />
                )}
                {c===0&&<span style={{position:"absolute",top:1,left:3,fontSize:Math.max(8,cell*0.18),fontWeight:700,color:lbl}}>{sq[1]}</span>}
                {r===7&&<span style={{position:"absolute",bottom:0,right:3,fontSize:Math.max(8,cell*0.18),fontWeight:700,color:lbl}}>{sq[0]}</span>}
                {piece&&!hide&&<Piece pc={piece} size={cell*0.82} />}
              </div>
            );
          }))}
        </div>
        {analyzeOn&&evalInfo?.best&&!busy&&(()=>{
          const from=evalInfo.best.slice(0,2),to=evalInfo.best.slice(2,4);
          const a=sqCenter(from,playerColor,cell),b=sqCenter(to,playerColor,cell);
          if(!a||!b) return null;
          const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
          const head=cell*0.42,ex=b[0]-ux*head*0.55,ey=b[1]-uy*head*0.55;
          return (
            <svg viewBox={`0 0 ${px} ${px}`} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:5}}>
              <defs>
                <marker id="arw" markerUnits="userSpaceOnUse" markerWidth={head} markerHeight={head} refX={head*0.5} refY={head*0.5} orient="auto">
                  <path d={`M0,0 L${head},${head*0.5} L0,${head} L${head*0.28},${head*0.5} Z`} fill="#15803d" />
                </marker>
              </defs>
              <line x1={a[0]} y1={a[1]} x2={ex} y2={ey} stroke="#15803d" strokeWidth={cell*0.16} strokeLinecap="round" markerEnd="url(#arw)" opacity="0.82" />
            </svg>
          );
        })()}
        </div>
      </div>

      {dragging&&(
        <div style={{position:"fixed",left:dragging.x-cell*0.41,top:dragging.y-cell*0.41,width:cell*0.82,height:cell*0.82,pointerEvents:"none",zIndex:1000}}>
          <Piece pc={dragging.piece} size={cell*0.82} />
        </div>
      )}

      {promo&&(
        <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center",justifyContent:"center",background:C.card,border:`1px solid ${C.line}`,borderRadius:10,padding:8}}>
          <span style={{fontSize:13,color:C.sub,fontWeight:600}}>승진:</span>
          {["q","r","b","n"].map(pp=>(
            <button key={pp} onClick={()=>attemptMove(promo.from,promo.to,pp)}
              style={{width:40,height:40,borderRadius:8,border:`1px solid ${C.line}`,background:"#f0d9b5",cursor:"pointer"}}>
              <Piece pc={playerColor==="w"?pp.toUpperCase():pp} size={26} />
            </button>
          ))}
          <button onClick={()=>setPromo(null)} style={{background:"none",border:"none",color:C.sub,cursor:"pointer"}}><X size={16} /></button>
        </div>
      )}

      <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600,color:sColor}}>
        {solved&&<Trophy size={17} />}<span>{status}</span>
      </div>
      {(solved||failed)&&<div style={{marginTop:4,fontSize:13,color:C.sub}}>정답: <span style={{fontFamily:"monospace",color:C.gold,fontWeight:700}}>{playerMoves.join("  →  ")}</span></div>}

      <div style={{marginTop:12,display:"flex",flexWrap:"wrap",gap:8}}>
        <Btn onClick={hint} disabled={!playerTurn} Icon={Lightbulb} label={hintLvl===0?"힌트":"힌트 더보기"} />
        <Btn onClick={reveal} disabled={solved||failed||busy} Icon={Eye} label="정답 보기" />
        <Btn onClick={()=>setAnalyzeOn(v=>!v)} Icon={Activity} label={analyzeOn?"분석 끄기":"분석"} primary={analyzeOn} />
      </div>
      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
        <Btn onClick={goBack} disabled={historyIdx<=0} Icon={ChevronLeft} label="이전" />
        <span style={{fontSize:12,color:C.sub,minWidth:48,textAlign:"center"}}>
          {historyIdx+1} / {historyRef.current.puzzles.length}
        </span>
        <Btn onClick={goForward} Icon={ChevronRight} label="다음 퍼즐" primary />
      </div>
      <div style={{marginTop:8,fontSize:11.5,color:"#6f6f88"}}>
        풀에 {pool.length.toLocaleString()}개 퍼즐 · 기물 드래그 또는 출발→도착 탭
      </div>
    </div>
  );
}

function Btn({ onClick, disabled, Icon, label, primary }: {
  onClick: ()=>void; disabled?: boolean; Icon: React.ComponentType<{size:number}>; label: string; primary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,padding:"8px 12px",borderRadius:8,
        cursor:disabled?"not-allowed":"pointer",border:primary?"none":`1px solid ${C.line}`,
        background:primary?C.gold:"transparent",color:primary?C.bg:C.sub,opacity:disabled?0.4:1}}>
      <Icon size={15} />{label}
    </button>
  );
}
