(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const startBtn = document.getElementById("startBtn");
  const mineBtn = document.getElementById("mineBtn");
  const resetBtn = document.getElementById("resetBtn");
  const bg = new Image();
  bg.src = "./assets/mempool-control-room.png";

  const WIDTH = 1280;
  const HEIGHT = 720;
  const grid = { x: 520, y: 132, cols: 7, rows: 5, cell: 66, gap: 6 };
  const queueRect = { x: 40, y: 132, w: 390, h: 482 };
  const scoreRect = { x: 1010, y: 132, w: 230, h: 482 };
  const seed = { value: 90210 };
  const palette = {
    ink: "#f3ead8",
    muted: "#c0aa89",
    quiet: "#8a765c",
    coal: "#14120f",
    panel: "rgba(26, 19, 12, 0.84)",
    panel2: "rgba(42, 32, 21, 0.9)",
    edge: "rgba(241, 163, 60, 0.35)",
    amber: "#f1a33c",
    amber2: "#ffd06a",
    teal: "#4cc6ad",
    red: "#e25d4b",
    good: "#95db77",
  };

  const state = {
    mode: "title",
    selectedId: null,
    hover: null,
    blockIndex: 1,
    score: 0,
    target: 6800,
    timeLeft: 45,
    pressure: 0.18,
    chainTip: 848126,
    message: "Build the highest-fee block.",
    txs: [],
    placements: [],
    mined: [],
    pointer: { x: 0, y: 0, down: false },
    lastFrame: performance.now(),
  };

  function rand() {
    seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
    return seed.value / 4294967296;
  }

  function pick(items) {
    return items[Math.floor(rand() * items.length)];
  }

  function formatNum(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function makeTx(index) {
    const shapes = [
      { w: 1, h: 1, weight: 110 },
      { w: 2, h: 1, weight: 190 },
      { w: 1, h: 2, weight: 210 },
      { w: 2, h: 2, weight: 340 },
      { w: 3, h: 1, weight: 290 },
    ];
    const bands = [
      { name: "swap", color: palette.teal, base: 46 },
      { name: "vault", color: palette.amber, base: 58 },
      { name: "settle", color: palette.good, base: 38 },
      { name: "snipe", color: palette.red, base: 74 },
    ];
    const band = pick(bands);
    const shape = pick(shapes);
    const urgency = Math.min(1, 0.22 + rand() * 0.78 + state.pressure * 0.22);
    const feeRate = Math.round(band.base + rand() * 48 + state.pressure * 44);
    return {
      id: `${state.blockIndex}-${index}-${Math.round(rand() * 10000)}`,
      label: band.name,
      color: band.color,
      feeRate,
      weight: shape.weight,
      w: shape.w,
      h: shape.h,
      urgency,
      age: 0,
      placed: false,
    };
  }

  function newRound(keepScore = true) {
    state.mode = "playing";
    state.selectedId = null;
    state.hover = null;
    state.timeLeft = Math.max(24, 45 - (state.blockIndex - 1) * 4);
    state.pressure = Math.min(0.88, 0.16 + (state.blockIndex - 1) * 0.1);
    state.message = "Select a transaction, then click the block template.";
    state.txs = Array.from({ length: 9 }, (_, i) => makeTx(i));
    state.placements = [];
    if (!keepScore) {
      state.score = 0;
      state.blockIndex = 1;
      state.chainTip = 848126;
      state.mined = [];
    }
  }

  function resetGame() {
    seed.value = 90210;
    state.mode = "title";
    state.selectedId = null;
    state.blockIndex = 1;
    state.score = 0;
    state.target = 6800;
    state.timeLeft = 45;
    state.pressure = 0.18;
    state.chainTip = 848126;
    state.message = "Build the highest-fee block.";
    state.txs = [];
    state.placements = [];
    state.mined = [];
  }

  function txFee(tx) {
    return tx.feeRate * tx.weight * (0.68 + tx.urgency * 0.42);
  }

  function txCells(tx, gx, gy) {
    const cells = [];
    for (let y = 0; y < tx.h; y += 1) {
      for (let x = 0; x < tx.w; x += 1) cells.push({ x: gx + x, y: gy + y });
    }
    return cells;
  }

  function occupiedSet(ignoreId = null) {
    const taken = new Set();
    state.placements.forEach((p) => {
      if (p.id === ignoreId) return;
      const tx = state.txs.find((item) => item.id === p.id);
      if (!tx) return;
      txCells(tx, p.x, p.y).forEach((cell) => taken.add(`${cell.x}:${cell.y}`));
    });
    return taken;
  }

  function canPlace(tx, gx, gy) {
    if (gx < 0 || gy < 0 || gx + tx.w > grid.cols || gy + tx.h > grid.rows) return false;
    const taken = occupiedSet(tx.id);
    return txCells(tx, gx, gy).every((cell) => !taken.has(`${cell.x}:${cell.y}`));
  }

  function placeTx(tx, gx, gy) {
    if (!canPlace(tx, gx, gy)) {
      state.message = "That blockspace is already claimed.";
      return false;
    }
    const existing = state.placements.find((p) => p.id === tx.id);
    if (existing) {
      existing.x = gx;
      existing.y = gy;
    } else {
      state.placements.push({ id: tx.id, x: gx, y: gy });
    }
    tx.placed = true;
    state.selectedId = null;
    state.message = `${tx.label} added at ${tx.feeRate} sat/vB.`;
    return true;
  }

  function removeTx(id) {
    const tx = state.txs.find((item) => item.id === id);
    if (tx) tx.placed = false;
    state.placements = state.placements.filter((p) => p.id !== id);
  }

  function filledCells() {
    const taken = occupiedSet();
    return taken.size;
  }

  function blockFees() {
    return state.placements.reduce((sum, p) => {
      const tx = state.txs.find((item) => item.id === p.id);
      return tx ? sum + txFee(tx) : sum;
    }, 0);
  }

function missedUrgencyPenalty() {
    return state.txs
      .filter((tx) => !tx.placed && tx.urgency > 0.68)
      .reduce((sum, tx) => sum + tx.feeRate * 6, 0);
  }

  function mineBlock(auto = false) {
    if (state.mode !== "playing") return;
    const fill = filledCells();
    if (fill === 0) {
      state.message = "Empty blocks do not pay.";
      return;
    }

    const fees = blockFees();
    const efficiency = fill / (grid.cols * grid.rows);
    const pressureBonus = fees * state.pressure * 0.14;
    const emptyPenalty = (grid.cols * grid.rows - fill) * 20;
    const latePenalty = missedUrgencyPenalty() + (auto ? 320 : 0);
    const earned = Math.max(0, Math.round(fees * 0.12 + pressureBonus - emptyPenalty - latePenalty * 0.25));
    state.score += earned;
    state.mined.unshift({
      height: state.chainTip + 1,
      earned,
      fill,
      fees: Math.round(fees),
      auto,
    });
    state.mined = state.mined.slice(0, 4);
    state.chainTip += 1;

    if (state.blockIndex >= 3) {
      state.mode = state.score >= state.target ? "won" : "lost";
      state.message =
        state.mode === "won"
          ? "Three-block run cleared. Fee desk profitable."
          : "The fee desk missed the target.";
      return;
    }

    state.blockIndex += 1;
    newRound(true);
    state.message = `Block mined for ${formatNum(earned)} sats. Next block.`;
  }

  function update(dt) {
    if (state.mode !== "playing") return;
    state.timeLeft -= dt;
    state.pressure = Math.min(1, state.pressure + dt * 0.006);
    state.txs.forEach((tx) => {
      if (!tx.placed) tx.age += dt;
    });
    if (state.timeLeft <= 0) mineBlock(true);
  }

  function panel(x, y, w, h, title) {
    ctx.save();
    ctx.fillStyle = palette.panel;
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = palette.amber2;
    ctx.font = "700 18px Cascadia Mono, Consolas, monospace";
    ctx.fillText(title, x + 18, y + 30);
    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = "#17120e";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (bg.complete && bg.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.44;
      ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, "rgba(10, 8, 6, 0.46)");
    grad.addColorStop(0.5, "rgba(18, 12, 6, 0.2)");
    grad.addColorStop(1, "rgba(4, 4, 3, 0.62)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawHeader() {
    ctx.fillStyle = palette.ink;
    ctx.font = "700 32px Cascadia Mono, Consolas, monospace";
    ctx.fillText("Mempool Miner", 40, 62);
    ctx.fillStyle = palette.muted;
    ctx.font = "500 17px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Pack high-fee transactions into three profitable blocks.", 42, 92);

    const timerW = 310;
    const timerX = WIDTH - timerW - 40;
    ctx.fillStyle = "rgba(20, 18, 15, 0.78)";
    ctx.fillRect(timerX, 42, timerW, 50);
    ctx.strokeStyle = palette.edge;
    ctx.strokeRect(timerX + 0.5, 42.5, timerW - 1, 49);
    ctx.fillStyle = palette.quiet;
    ctx.font = "700 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`BLOCK ${state.blockIndex}/3`, timerX + 16, 62);
    ctx.fillStyle = state.timeLeft < 10 ? palette.red : palette.amber2;
    ctx.font = "700 22px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`${Math.max(0, Math.ceil(state.timeLeft))}s`, timerX + 146, 67);
    ctx.fillStyle = palette.teal;
    ctx.fillText(`${Math.round(state.pressure * 100)}%`, timerX + 224, 67);
  }

  function txQueueLayout() {
    return state.txs.map((tx, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      return {
        tx,
        x: queueRect.x + 20 + col * 174,
        y: queueRect.y + 54 + row * 82,
        w: 156,
        h: 66,
      };
    });
  }

  function drawTxCard(tx, x, y, w, h, compact = false) {
    const selected = state.selectedId === tx.id;
    const alpha = tx.placed && !compact ? 0.34 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = selected ? "rgba(255, 208, 106, 0.2)" : "rgba(243, 234, 216, 0.08)";
    ctx.strokeStyle = selected ? palette.amber2 : "rgba(243, 234, 216, 0.18)";
    ctx.lineWidth = selected ? 2.5 : 1.3;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = tx.color;
    ctx.fillRect(x + 8, y + 9, 8, h - 18);
    ctx.fillStyle = palette.ink;
    ctx.font = compact ? "700 13px Cascadia Mono, Consolas, monospace" : "700 15px Cascadia Mono, Consolas, monospace";
    ctx.fillText(tx.label.toUpperCase(), x + 24, y + 25);
    ctx.fillStyle = palette.muted;
    ctx.font = compact ? "500 11px Aptos, Segoe UI, sans-serif" : "500 13px Aptos, Segoe UI, sans-serif";
    ctx.fillText(`${tx.feeRate} sat/vB`, x + 24, y + 45);
    if (!compact) {
      ctx.fillStyle = tx.urgency > 0.7 ? palette.red : palette.teal;
      ctx.fillRect(x + 24, y + 53, Math.max(8, (w - 40) * tx.urgency), 4);
      ctx.fillStyle = palette.quiet;
      ctx.font = "500 11px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`${tx.w}x${tx.h}`, x + w - 34, y + 25);
    }
    ctx.restore();
  }

  function drawQueue() {
    panel(queueRect.x, queueRect.y, queueRect.w, queueRect.h, "MEMPOOL QUEUE");
    txQueueLayout().forEach(({ tx, x, y, w, h }) => drawTxCard(tx, x, y, w, h));
  }

  function drawGrid() {
    panel(grid.x - 28, grid.y - 46, grid.cols * (grid.cell + grid.gap) + 50, grid.rows * (grid.cell + grid.gap) + 86, "BLOCK TEMPLATE");
    const taken = occupiedSet();
    for (let y = 0; y < grid.rows; y += 1) {
      for (let x = 0; x < grid.cols; x += 1) {
        const px = grid.x + x * (grid.cell + grid.gap);
        const py = grid.y + y * (grid.cell + grid.gap);
        ctx.fillStyle = taken.has(`${x}:${y}`) ? "rgba(241, 163, 60, 0.12)" : "rgba(243, 234, 216, 0.055)";
        ctx.strokeStyle = "rgba(243, 234, 216, 0.16)";
        ctx.fillRect(px, py, grid.cell, grid.cell);
        ctx.strokeRect(px + 0.5, py + 0.5, grid.cell - 1, grid.cell - 1);
      }
    }

    state.placements.forEach((p) => {
      const tx = state.txs.find((item) => item.id === p.id);
      if (!tx) return;
      const px = grid.x + p.x * (grid.cell + grid.gap);
      const py = grid.y + p.y * (grid.cell + grid.gap);
      const w = tx.w * grid.cell + (tx.w - 1) * grid.gap;
      const h = tx.h * grid.cell + (tx.h - 1) * grid.gap;
      drawTxCard(tx, px, py, w, h, true);
    });

    const selected = state.txs.find((tx) => tx.id === state.selectedId);
    if (selected && state.hover && state.hover.kind === "grid") {
      const ok = canPlace(selected, state.hover.x, state.hover.y);
      const px = grid.x + state.hover.x * (grid.cell + grid.gap);
      const py = grid.y + state.hover.y * (grid.cell + grid.gap);
      const w = selected.w * grid.cell + (selected.w - 1) * grid.gap;
      const h = selected.h * grid.cell + (selected.h - 1) * grid.gap;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ok ? palette.teal : palette.red;
      ctx.fillRect(px, py, w, h);
      ctx.restore();
    }
  }

  function drawScore() {
    panel(scoreRect.x, scoreRect.y, scoreRect.w, scoreRect.h, "FEE DESK");
    const rows = [
      ["Score", formatNum(state.score)],
      ["Target", formatNum(state.target)],
      ["Tip", String(state.chainTip)],
      ["Fill", `${filledCells()}/${grid.cols * grid.rows}`],
      ["Block fees", formatNum(blockFees())],
    ];
    ctx.font = "500 15px Aptos, Segoe UI, sans-serif";
    rows.forEach(([label, value], i) => {
      const y = scoreRect.y + 68 + i * 42;
      ctx.fillStyle = palette.quiet;
      ctx.fillText(label, scoreRect.x + 18, y);
      ctx.fillStyle = label === "Score" ? palette.amber2 : palette.ink;
      ctx.font = label === "Score" ? "700 22px Cascadia Mono, Consolas, monospace" : "700 17px Cascadia Mono, Consolas, monospace";
      ctx.fillText(value, scoreRect.x + 118, y);
      ctx.font = "500 15px Aptos, Segoe UI, sans-serif";
    });

    ctx.fillStyle = palette.muted;
    ctx.font = "700 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText("RECENT BLOCKS", scoreRect.x + 18, scoreRect.y + 306);
    state.mined.forEach((block, i) => {
      const y = scoreRect.y + 338 + i * 32;
      ctx.fillStyle = "rgba(243, 234, 216, 0.08)";
      ctx.fillRect(scoreRect.x + 18, y - 19, scoreRect.w - 36, 25);
      ctx.fillStyle = palette.quiet;
      ctx.font = "500 12px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`#${block.height}`, scoreRect.x + 28, y);
      ctx.fillStyle = block.earned > 0 ? palette.good : palette.red;
      ctx.font = "700 13px Cascadia Mono, Consolas, monospace";
      ctx.fillText(`+${formatNum(block.earned)}`, scoreRect.x + 128, y);
    });
  }

  function drawFooter() {
    const y = 660;
    ctx.fillStyle = "rgba(20, 18, 15, 0.82)";
    ctx.fillRect(40, y - 26, WIDTH - 80, 46);
    ctx.strokeStyle = "rgba(243, 234, 216, 0.14)";
    ctx.strokeRect(40.5, y - 25.5, WIDTH - 81, 45);
    ctx.fillStyle = palette.ink;
    ctx.font = "500 16px Aptos, Segoe UI, sans-serif";
    ctx.fillText(state.message, 60, y + 2);
    ctx.fillStyle = palette.quiet;
    ctx.font = "500 13px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Select tx. Pack blockspace. Mine before pressure spikes.", 780, y + 2);
  }

  function drawTitleOverlay() {
    ctx.save();
    ctx.fillStyle = "rgba(20, 18, 15, 0.78)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = palette.amber2;
    ctx.font = "700 56px Cascadia Mono, Consolas, monospace";
    ctx.fillText("Mempool Miner", 372, 286);
    ctx.fillStyle = palette.ink;
    ctx.font = "500 22px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Three blocks. One fee target. No wasted blockspace.", 374, 330);
    ctx.fillStyle = palette.teal;
    ctx.font = "700 18px Cascadia Mono, Consolas, monospace";
    ctx.fillText("Press Start", 374, 378);
    ctx.restore();
  }

  function drawEndOverlay() {
    const won = state.mode === "won";
    ctx.save();
    ctx.fillStyle = "rgba(20, 18, 15, 0.78)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = won ? palette.good : palette.red;
    ctx.font = "700 52px Cascadia Mono, Consolas, monospace";
    ctx.fillText(won ? "Blocks cleared" : "Fee target missed", 320, 292);
    ctx.fillStyle = palette.ink;
    ctx.font = "500 24px Aptos, Segoe UI, sans-serif";
    ctx.fillText(`Final score: ${formatNum(state.score)} sats`, 322, 340);
    ctx.fillStyle = palette.muted;
    ctx.font = "500 18px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Reset for a clean run.", 322, 382);
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawHeader();
    drawQueue();
    drawGrid();
    drawScore();
    drawFooter();
    if (state.mode === "title") drawTitleOverlay();
    if (state.mode === "won" || state.mode === "lost") drawEndOverlay();
  }

  function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function hitGrid(point) {
    const gx = Math.floor((point.x - grid.x) / (grid.cell + grid.gap));
    const gy = Math.floor((point.y - grid.y) / (grid.cell + grid.gap));
    const inBounds = gx >= 0 && gy >= 0 && gx < grid.cols && gy < grid.rows;
    if (!inBounds) return null;
    const localX = (point.x - grid.x) % (grid.cell + grid.gap);
    const localY = (point.y - grid.y) % (grid.cell + grid.gap);
    if (localX > grid.cell || localY > grid.cell) return null;
    return { kind: "grid", x: gx, y: gy };
  }

  function hitTx(point) {
    return txQueueLayout().find(({ x, y, w, h }) => point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h);
  }

  function hitPlacement(point) {
    for (let i = state.placements.length - 1; i >= 0; i -= 1) {
      const p = state.placements[i];
      const tx = state.txs.find((item) => item.id === p.id);
      if (!tx) continue;
      const px = grid.x + p.x * (grid.cell + grid.gap);
      const py = grid.y + p.y * (grid.cell + grid.gap);
      const w = tx.w * grid.cell + (tx.w - 1) * grid.gap;
      const h = tx.h * grid.cell + (tx.h - 1) * grid.gap;
      if (point.x >= px && point.x <= px + w && point.y >= py && point.y <= py + h) return tx;
    }
    return null;
  }

  function updateHover(point) {
    state.hover = hitGrid(point) || null;
    canvas.style.cursor = hitTx(point) || hitPlacement(point) || state.hover ? "pointer" : "default";
  }

  function onPointerDown(event) {
    const point = toCanvasPoint(event);
    state.pointer = { ...point, down: true };

    if (state.mode === "title") {
      newRound(false);
      render();
      return;
    }

    if (state.mode !== "playing") return;
    const card = hitTx(point);
    if (card && !card.tx.placed) {
      state.selectedId = card.tx.id;
      state.message = `${card.tx.label} selected.`;
      render();
      return;
    }

    const placed = hitPlacement(point);
    if (placed) {
      state.selectedId = placed.id;
      state.message = `${placed.label} selected. Press R to remove.`;
      render();
      return;
    }

    const cell = hitGrid(point);
    const selected = state.txs.find((tx) => tx.id === state.selectedId);
    if (cell && selected) {
      placeTx(selected, cell.x, cell.y);
      render();
    }
  }

  function onPointerMove(event) {
    const point = toCanvasPoint(event);
    state.pointer = { ...point, down: state.pointer.down };
    updateHover(point);
    if (state.selectedId) render();
  }

  function onPointerUp() {
    state.pointer.down = false;
  }

  function onKey(event) {
    const key = event.key.toLowerCase();
    if (key === "enter" && state.mode === "title") newRound(false);
    if (key === " " && state.mode === "playing") {
      event.preventDefault();
      mineBlock(false);
    }
    if (key === "r" && state.selectedId) {
      removeTx(state.selectedId);
      state.selectedId = null;
      state.message = "Transaction removed from the block.";
    }
    if (key === "f") {
      if (!document.fullscreenElement) {
        canvas.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
    render();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  startBtn.addEventListener("click", () => {
    newRound(false);
    render();
  });
  mineBtn.addEventListener("click", () => {
    mineBlock(false);
    render();
  });
  resetBtn.addEventListener("click", () => {
    resetGame();
    render();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKey);
  bg.addEventListener("load", render);

  window.advanceTime = function advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) update(1 / 60);
    render();
  };

  window.render_game_to_text = function renderGameToText() {
    const payload = {
      coordinateSystem: "canvas pixels, origin top-left, x right, y down",
      mode: state.mode,
      blockIndex: state.blockIndex,
      score: state.score,
      target: state.target,
      timeLeft: Number(state.timeLeft.toFixed(2)),
      pressure: Number(state.pressure.toFixed(3)),
      selectedId: state.selectedId,
      filledCells: filledCells(),
      message: state.message,
      visibleTransactions: state.txs
        .filter((tx) => !tx.placed)
        .map((tx) => ({
          id: tx.id,
          label: tx.label,
          feeRate: tx.feeRate,
          shape: [tx.w, tx.h],
          urgency: Number(tx.urgency.toFixed(2)),
        })),
      placements: state.placements.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      mined: state.mined,
    };
    return JSON.stringify(payload);
  };

  resetGame();
  render();
  requestAnimationFrame(loop);
})();
