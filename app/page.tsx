"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pills";

const PIECE_POOL = ["I", "J", "L", "O", "S", "T", "Z"] as const;
type TetrominoKey = (typeof PIECE_POOL)[number];

type Cell = { color: string; ghost?: boolean } | null;
type Board = Cell[][];
type ActivePiece = { shape: TetrominoKey; rotation: number; x: number; y: number };

const COLS = 10;
const ROWS = 20;
const LINE_SCORES = [0, 100, 300, 500, 800];

const TETROMINOS: Record<TetrominoKey, { color: string; rotations: number[][][] }> = {
  I: {
    color: "bg-cyan-400",
    rotations: [
      [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      [
        [0, 0, 1, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 0],
      ],
    ],
  },
  J: {
    color: "bg-blue-500",
    rotations: [
      [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      [
        [0, 1, 1],
        [0, 1, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 1],
      ],
      [
        [0, 1, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
    ],
  },
  L: {
    color: "bg-orange-400",
    rotations: [
      [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
      ],
      [
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 1],
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [1, 0, 0],
      ],
      [
        [1, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
      ],
    ],
  },
  O: {
    color: "bg-yellow-300",
    rotations: [
      [
        [1, 1],
        [1, 1],
      ],
    ],
  },
  S: {
    color: "bg-emerald-400",
    rotations: [
      [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
      ],
      [
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 1],
      ],
    ],
  },
  T: {
    color: "bg-purple-500",
    rotations: [
      [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      [
        [0, 1, 0],
        [0, 1, 1],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [1, 1, 1],
        [0, 1, 0],
      ],
      [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
    ],
  },
  Z: {
    color: "bg-rose-500",
    rotations: [
      [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
      ],
      [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ],
    ],
  },
};

const createEmptyBoard = (): Board =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

const getMatrix = (shape: TetrominoKey, rotation: number) => {
  const rotations = TETROMINOS[shape].rotations;
  return rotations[rotation % rotations.length];
};

const canPlacePiece = (piece: ActivePiece, board: Board) => {
  const matrix = getMatrix(piece.shape, piece.rotation);
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) continue;
      const newX = piece.x + x;
      const newY = piece.y + y;
      if (newX < 0 || newX >= COLS) return false;
      if (newY >= ROWS) return false;
      if (newY >= 0 && board[newY][newX]) return false;
    }
  }
  return true;
};

const mergePiece = (board: Board, piece: ActivePiece): Board => {
  const clone = board.map(row => row.slice());
  const matrix = getMatrix(piece.shape, piece.rotation);
  matrix.forEach((row, y) =>
    row.forEach((value, x) => {
      if (!value) return;
      const boardY = piece.y + y;
      const boardX = piece.x + x;
      if (boardY < 0 || boardY >= ROWS || boardX < 0 || boardX >= COLS) return;
      clone[boardY][boardX] = { color: TETROMINOS[piece.shape].color };
    }),
  );
  return clone;
};

const clearLines = (board: Board) => {
  const remaining: Board = [];
  let linesCleared = 0;
  board.forEach(row => {
    if (row.every(cell => cell)) {
      linesCleared += 1;
    } else {
      remaining.push(row);
    }
  });
  while (remaining.length < ROWS) {
    remaining.unshift(Array.from({ length: COLS }, () => null));
  }
  return { board: remaining, linesCleared };
};

const ghostPiece = (piece: ActivePiece, board: Board): ActivePiece => {
  let projected = { ...piece };
  while (canPlacePiece({ ...projected, y: projected.y + 1 }, board)) {
    projected = { ...projected, y: projected.y + 1 };
  }
  return projected;
};

const randomTetromino = (): TetrominoKey => PIECE_POOL[Math.floor(Math.random() * PIECE_POOL.length)];

const statusLabel = (isRunning: boolean, isGameOver: boolean, hasPiece: boolean) => {
  if (isGameOver) return "Game Over";
  if (isRunning) return "Running";
  if (hasPiece) return "Paused";
  return "Ready";
};

export default function Page() {
  const [board, setBoard] = useState<Board>(() => createEmptyBoard());
  const [activePiece, setActivePiece] = useState<ActivePiece | null>(null);
  const [nextPiece, setNextPiece] = useState<TetrominoKey>(() => randomTetromino());
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [lines, setLines] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [lastAction, setLastAction] = useState("Tap Start to begin!");

  const gravity = useMemo(() => Math.max(150, 1000 - (level - 1) * 70), [level]);

  const takeFromQueue = useCallback(
    ({
      boardSnapshot,
      forcedShape,
      advanceQueue = true,
    }: { boardSnapshot?: Board; forcedShape?: TetrominoKey; advanceQueue?: boolean } = {}) => {
      const targetBoard = boardSnapshot ?? board;
      const shapeKey = forcedShape ?? nextPiece;
      if (!shapeKey) return;
      const startX = Math.floor(COLS / 2) - 2;
      const piece: ActivePiece = { shape: shapeKey, rotation: 0, x: startX, y: -1 };
      if (!canPlacePiece(piece, targetBoard)) {
        setIsRunning(false);
        setIsGameOver(true);
        setActivePiece(null);
        setLastAction("Board filled — press Reset");
        return;
      }
      setActivePiece(piece);
      if (advanceQueue) {
        setNextPiece(randomTetromino());
      }
    },
    [board, nextPiece],
  );

  const lockPiece = useCallback(
    (piece: ActivePiece) => {
      if (!piece) return;
      let snapshot: Board | null = null;
      let cleared = 0;
      setBoard(prev => {
        const merged = mergePiece(prev, piece);
        const result = clearLines(merged);
        snapshot = result.board;
        cleared = result.linesCleared;
        return result.board;
      });
      setActivePiece(null);
      if (cleared > 0) {
        setLines(prev => {
          const before = prev;
          const updated = prev + cleared;
          const currentLevel = Math.floor(before / 10) + 1;
          setScore(prevScore => prevScore + LINE_SCORES[cleared] * currentLevel);
          setLevel(Math.floor(updated / 10) + 1);
          return updated;
        });
        setLastAction(`Cleared ${cleared} line${cleared > 1 ? "s" : ""}!`);
      } else {
        setLastAction("Piece locked");
      }
      if (snapshot) {
        takeFromQueue({ boardSnapshot: snapshot, advanceQueue: true });
      }
    },
    [takeFromQueue],
  );

  const moveDown = useCallback(
    (manual = false) => {
      if (!isRunning || !activePiece || isGameOver) return;
      const candidate = { ...activePiece, y: activePiece.y + 1 };
      if (canPlacePiece(candidate, board)) {
        setActivePiece(candidate);
        if (manual) {
          setScore(prev => prev + 1);
          setLastAction("Soft drop");
        }
      } else {
        lockPiece(activePiece);
      }
    },
    [activePiece, board, isGameOver, isRunning, lockPiece],
  );

  const moveHorizontal = useCallback(
    (dir: -1 | 1) => {
      if (!isRunning || !activePiece || isGameOver) return;
      const candidate = { ...activePiece, x: activePiece.x + dir };
      if (canPlacePiece(candidate, board)) {
        setActivePiece(candidate);
        setLastAction(dir === -1 ? "Moved left" : "Moved right");
      }
    },
    [activePiece, board, isGameOver, isRunning],
  );

  const rotateCurrent = useCallback(() => {
    if (!isRunning || !activePiece || isGameOver) return;
    const shape = TETROMINOS[activePiece.shape];
    const nextRotation = (activePiece.rotation + 1) % shape.rotations.length;
    const candidate = { ...activePiece, rotation: nextRotation };
    if (canPlacePiece(candidate, board)) {
      setActivePiece(candidate);
      setLastAction("Rotated");
      return;
    }
    const kicks = [-1, 1, -2, 2];
    for (const kick of kicks) {
      const shifted = { ...candidate, x: candidate.x + kick };
      if (canPlacePiece(shifted, board)) {
        setActivePiece(shifted);
        setLastAction("Rotated");
        return;
      }
    }
  }, [activePiece, board, isGameOver, isRunning]);

  const hardDrop = useCallback(() => {
    if (!isRunning || !activePiece || isGameOver) return;
    let offset = 0;
    while (canPlacePiece({ ...activePiece, y: activePiece.y + offset + 1 }, board)) {
      offset += 1;
    }
    const landed = { ...activePiece, y: activePiece.y + offset };
    setScore(prev => prev + offset * 2);
    setLastAction("Hard drop");
    lockPiece(landed);
  }, [activePiece, board, isGameOver, isRunning, lockPiece]);

  const startGame = useCallback(() => {
    const empty = createEmptyBoard();
    const first = randomTetromino();
    const queuedNext = randomTetromino();
    setBoard(empty);
    setScore(0);
    setLines(0);
    setLevel(1);
    setIsGameOver(false);
    setIsRunning(true);
    setNextPiece(queuedNext);
    setLastAction("Game started");
    takeFromQueue({ boardSnapshot: empty, forcedShape: first, advanceQueue: false });
  }, [takeFromQueue]);

  const resetGame = useCallback(() => {
    setBoard(createEmptyBoard());
    setActivePiece(null);
    setScore(0);
    setLines(0);
    setLevel(1);
    setIsRunning(false);
    setIsGameOver(false);
    setNextPiece(randomTetromino());
    setLastAction("Reset complete — press Start");
  }, []);

  const togglePause = useCallback(() => {
    if (isGameOver || !activePiece) return;
    setIsRunning(prev => {
      const next = !prev;
      setLastAction(next ? "Resumed" : "Paused");
      return next;
    });
  }, [activePiece, isGameOver]);

  useEffect(() => {
    if (!isRunning || isGameOver) return;
    const timer = setInterval(() => moveDown(false), gravity);
    return () => clearInterval(timer);
  }, [gravity, isGameOver, isRunning, moveDown]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          moveHorizontal(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          moveHorizontal(1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveDown(true);
          break;
        case "ArrowUp":
          event.preventDefault();
          rotateCurrent();
          break;
        case " ":
          event.preventDefault();
          hardDrop();
          break;
        case "p":
        case "P":
          event.preventDefault();
          togglePause();
          break;
        case "r":
        case "R":
          event.preventDefault();
          resetGame();
          break;
        case "Enter":
          if (!isRunning && !activePiece) {
            event.preventDefault();
            startGame();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activePiece, hardDrop, isRunning, moveDown, moveHorizontal, resetGame, rotateCurrent, startGame, togglePause]);

  const renderedBoard = useMemo(() => {
    const clone = board.map(row => row.map(cell => (cell ? { ...cell } : cell)));
    if (activePiece) {
      const ghost = ghostPiece(activePiece, board);
      const ghostMatrix = getMatrix(ghost.shape, ghost.rotation);
      ghostMatrix.forEach((row, y) =>
        row.forEach((value, x) => {
          if (!value) return;
          const boardY = ghost.y + y;
          const boardX = ghost.x + x;
          if (boardY < 0 || boardY >= ROWS || boardX < 0 || boardX >= COLS) return;
          if (!clone[boardY][boardX]) {
            clone[boardY][boardX] = { color: TETROMINOS[ghost.shape].color, ghost: true };
          }
        }),
      );
      const matrix = getMatrix(activePiece.shape, activePiece.rotation);
      matrix.forEach((row, y) =>
        row.forEach((value, x) => {
          if (!value) return;
          const boardY = activePiece.y + y;
          const boardX = activePiece.x + x;
          if (boardY < 0 || boardY >= ROWS || boardX < 0 || boardX >= COLS) return;
          clone[boardY][boardX] = { color: TETROMINOS[activePiece.shape].color };
        }),
      );
    }
    return clone;
  }, [activePiece, board]);

  const previewMatrix = useMemo(() => {
    const base = getMatrix(nextPiece, 0);
    const size = 4;
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => base[row]?.[col] ?? 0),
    );
  }, [nextPiece]);

  const quickMoves = [
    { label: "←", action: () => moveHorizontal(-1) },
    { label: "→", action: () => moveHorizontal(1) },
    { label: "Rotate", action: rotateCurrent },
    { label: "Soft ▼", action: () => moveDown(true) },
    { label: "Hard ▼▼", action: hardDrop },
  ];

  const playStatus = statusLabel(isRunning, isGameOver, !!activePiece);

  return (
    <main className="min-h-screen bg-slate-950 py-10 text-white">
      <div className="mx-auto max-w-6xl px-4">
        <header className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300">Arcade Lab</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">StackDrop Tetris</h1>
          <p className="mt-2 text-sm text-slate-300">Clear lines, climb levels, and chase the perfect stack.</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border border-white/10 bg-slate-900/70 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-xl">
                Playfield
                <span className="text-sm font-normal text-indigo-200">{playStatus}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-4">
                <div className="mx-auto grid max-w-[440px] grid-cols-10 gap-[2px]">
                  {renderedBoard.map((row, rowIndex) =>
                    row.map((cell, colIndex) => (
                      <div
                        key={`${rowIndex}-${colIndex}`}
                        className={`aspect-square rounded-[4px] border border-slate-900/40 transition ${
                          cell
                            ? `${cell.color} ${cell.ghost ? "opacity-35" : "shadow-inner"}`
                            : "bg-slate-900/40"
                        }`}
                      />
                    )),
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border border-white/10 bg-slate-900/60 text-white backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Mission Control</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs uppercase text-slate-400">Score</div>
                    <div className="text-2xl font-bold">{score.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-400">Lines</div>
                    <div className="text-2xl font-bold">{lines}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Pill className="bg-indigo-600/30 text-indigo-100 ring-1 ring-indigo-400/50">Level {level}</Pill>
                  <Pill className="bg-slate-800 text-slate-100 ring-1 ring-slate-700">
                    Gravity {gravity}ms
                  </Pill>
                  <Pill className="bg-emerald-600/30 text-emerald-100 ring-1 ring-emerald-500/50">{playStatus}</Pill>
                </div>
                <p className="text-sm text-slate-300">{lastAction}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Button onClick={startGame} className="rounded-xl">
                    {activePiece || isRunning ? "Restart" : "Start Game"}
                  </Button>
                  <Button variant="outline" onClick={togglePause} className="rounded-xl text-slate-900">
                    {isRunning ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="outline" onClick={resetGame} className="col-span-2 rounded-xl text-slate-900">
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-white/10 bg-slate-900/60 text-white backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Next Piece</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="mx-auto w-28 rounded-2xl border border-white/10 bg-slate-950 p-3">
                  <div className="grid grid-cols-4 gap-1">
                    {previewMatrix.map((row, rowIdx) =>
                      row.map((cell, colIdx) => (
                        <div
                          key={`${rowIdx}-${colIdx}`}
                          className={`aspect-square rounded-md ${
                            cell ? `${TETROMINOS[nextPiece].color} shadow-inner` : "bg-slate-900/60"
                          }`}
                        />
                      )),
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-300">
                  {isGameOver ? "Stack collapsed — reset to play again." : "Keep the stack clean for Tetrises!"}
                </p>
              </CardContent>
            </Card>

            <Card className="border border-white/10 bg-slate-900/60 text-white backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-2">
                  {quickMoves.map(control => (
                    <Button key={control.label} variant="outline" size="sm" onClick={control.action} className="rounded-xl text-slate-900">
                      {control.label}
                    </Button>
                  ))}
                </div>
                <ul className="space-y-1 text-slate-300">
                  <li>← / → : Move horizontally</li>
                  <li>↑ : Rotate</li>
                  <li>↓ : Soft drop</li>
                  <li>Space : Hard drop</li>
                  <li>P : Pause / Resume</li>
                  <li>R : Reset board</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
