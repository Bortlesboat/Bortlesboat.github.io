(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const startBtn = document.getElementById("startBtn");
  const lockBtn = document.getElementById("lockBtn");
  const resetBtn = document.getElementById("resetBtn");
  const bg = new Image();
  bg.src = "./assets/tcg-drop-desk.png";

  const WIDTH = 1280;
  const HEIGHT = 720;
  const board = { x: 514, y: 142, w: 436, h: 384 };
  const scout = { x: 48, y: 142, w: 390, h: 456 };
  const ledger = { x: 1004, y: 142, w: 228, h: 456 };
  const seed = { value: 424242 };
  const colors = {
    ink: "#fff4df",
    muted: "#dec392",
    quiet: "#9e8460",
    panel: "rgba(28, 19, 12, 0.84)",
    panel2: "rgba(48, 31, 18, 0.88)",
    edge: "rgba(255, 196, 79, 0.34)",
    yellow: "#ffc44f",
    teal: "#47c9b4",
    coral: "#f4765c",
    green: "#8ed66f",
    red: "#ec5f52",
  };

  const state = {
    mode: "title",
    day: 1,
    score: 0,
    target: 520,
    cash: 120,
    timeLeft: 45,
    heat: 0.24,
    selectedId: null,
    message: "Scout the drop list. Pick three.",
    items: [],
    picks: [],
    history: [],
    lastFrame: performance.now(),
  };

  function rand() {
    seed.value = (seed.value * 1103515245 + 12345) >>> 0;
    return seed.value / 4294967296;
  }

  function pick(values) {
    return values[Math.floor(rand() * values.length)];
  }

  function money(value) {
    return `$${Math.round(value)}`;
  }

  function makeItem(index) {
    const lanes = [
      { name: "booster", color: colors.yellow, base: 24, spread: 22 },
      { name: "bundle", color: colors.teal, base: 34, spread: 30 },
      { name: "elite kit", color: colors.coral, base: 52, spread: 42 },
      { name: "display", color: colors.green, base: 68, spread: 54 },
    ];
    const lane = pick(lanes);
    const cost = Math.round(lane.base + rand() * lane.spread + state.day * 4);
    const demand = Math.min(1, 0.18 + rand() * 0.72 + state.heat * 0.18);
    const margin = Math.round(12 + rand() * 55 + demand * 34 - cost * 0.12);
    const risk = Math.min(1, rand() * 0.55 + (cost > 70 ? 0.2 : 0));
    return {
      id: `${state.day}-${index}-${Math.round(rand() * 9999)}`,
      label: lane.name,
      color: lane.color,
      cost,
      demand,
      margin: Math.max(8, margin),
      risk,
      picked: false,
    };
  }

  function resetGame() {
    seed.value = 424242;
    state.mode = "title";
    state.day = 1;
    state.score = 0;
    state.cash = 120;
    state.timeLeft = 45;
    state.heat = 0.24;
    state.selectedId = null;
    state.message = "Scout the drop list. Pick three.";
    state.items = [];
    state.picks = [];
    state.history = [];
  }

  function newDay(keepScore = true) {
    state.mode = "playing";
    state.selectedId = null;
    state.timeLeft = Math.max(26, 45 - (state.day - 1) * 5);
    state.heat = Math.min(0.88, 0.22 + state.day * 0.08);
    if (!keepScore) {
      state.day = 1;
      state.score = 0;
      state.cash = 120;
      state.history = [];
    }
    state.items = Array.from({ length: 8 }, (_, i) => makeItem(i));
    state.picks = [];
    state.message = "Pick up to three restocks before demand cools.";
  }

  function expectedProfit(item) {
    return item.margin * (0.72 + item.demand * 0.75 + state.heat * 0.18) - item.cost * item.risk * 0.28;
  }

  function pickItem(item) {
    if (item.picked) {
      item.picked = false;
      state.picks = state.picks.filter((id) => id !== item.id);
      state.message = `${item.label} removed from the desk.`;
      return;
    }
    if (state.picks.length >= 3) {
      state.message = "Desk limit is three picks.";
      return;
    }
    if (item.cost > state.cash) {
      state.message = "Not enough cash for that restock.";
      return;
    }
    item.picked = true;
    state.picks.push(item.id);
    state.message = `${item.label} added. Expected value ${money(expectedProfit(item))}.`;
  }

  function lockPicks(auto = false) {
    if (state.mode !== "playing") return;
    if (!state.picks.length) {
      state.message = "Pick at least one restock first.";
      return;
    }
    const picked = state.items.filter((item) => state.picks.includes(item.id));
    const spent = picked.reduce((sum, item) => sum + item.cost, 0);
    const gross = picked.reduce((sum, item) => sum + expectedProfit(item), 0);
    const missed = state.items
      .filter((item) => !item.picked && item.demand > 0.7)
      .reduce((sum, item) => sum + item.margin * 0.18, 0);
    const timePenalty = auto ? 30 : 0;
    const result = Math.round(Math.max(-50, gross - missed - timePenalty));
    state.score += result;
    state.cash = Math.max(40, state.cash - spent + Math.max(0, result) + 90);
    state.history.unshift({ day: state.day, result, spent, picks: picked.length });
    state.history = state.history.slice(0, 4);

    if (state.day >= 3) {
      state.mode = state.score >= state.target ? "won" : "lost";
      state.message = state.mode === "won" ? "The desk beat the weekly target." : "The desk missed the target.";
      return;
    }
    state.day += 1;
    newDay(true);
    state.message = `Picks locked for ${money(result)}. Next drop.`;
  }

  function update(dt) {
    if (state.mode !== "playing") return;
    state.timeLeft -= dt;
    state.heat = Math.min(1, state.heat + dt * 0.007);
    state.items.forEach((item) => {
      if (!item.picked) item.demand = Math.max(0.05, item.demand - dt * 0.004);
    });
    if (state.timeLeft <= 0) lockPicks(true);
  }

  function panel(x, y, w, h, title) {
    ctx.fillStyle = colors.panel;
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = colors.yellow;
    ctx.font = "800 18px Cascadia Mono, Consolas, monospace";
    ctx.fillText(title, x + 18, y + 31);
  }

  function drawBackground() {
    ctx.fillStyle = "#17130f";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (bg.complete && bg.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, "rgba(20, 15, 9, 0.42)");
    grad.addColorStop(0.52, "rgba(18, 11, 6, 0.14)");
    grad.addColorStop(1, "rgba(6, 5, 4, 0.58)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawHeader() {
    ctx.fillStyle = colors.ink;
    ctx.font = "800 32px Cascadia Mono, Consolas, monospace";
    ctx.fillText("Drop Desk", 48, 62);
    ctx.fillStyle = colors.muted;
    ctx.font = "600 17px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Rank restocks before demand cools.", 50, 92);
    ctx.fillStyle = "rgba(23, 19, 15, 0.8)";
    ctx.fillRect(956, 42, 276, 50);
    ctx.strokeStyle = colors.edge;
    ctx.strokeRect(956.5, 42.5, 275, 49);
    ctx.fillStyle = colors.quiet;
    ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`DROP ${state.day}/3`, 974, 62);
    ctx.fillStyle = state.timeLeft < 10 ? colors.red : colors.yellow;
    ctx.font = "800 22px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`${Math.max(0, Math.ceil(state.timeLeft))}s`, 1104, 68);
    ctx.fillStyle = colors.teal;
    ctx.fillText(`${Math.round(state.heat * 100)}%`, 1164, 68);
  }

  function itemLayout() {
    return state.items.map((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      return { item, x: scout.x + 20 + col * 174, y: scout.y + 58 + row * 86, w: 156, h: 70 };
    });
  }

  function drawItem(item, x, y, w, h, compact = false) {
    ctx.save();
    ctx.fillStyle = item.picked ? "rgba(255, 196, 79, 0.2)" : "rgba(255, 244, 223, 0.08)";
    ctx.strokeStyle = item.picked ? colors.yellow : "rgba(255, 244, 223, 0.18)";
    ctx.lineWidth = item.picked ? 2.4 : 1.2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = item.color;
    ctx.fillRect(x + 8, y + 9, 8, h - 18);
    ctx.fillStyle = colors.ink;
    ctx.font = compact ? "800 13px Cascadia Mono, Consolas, monospace" : "800 14px Cascadia Mono, Consolas, monospace";
    ctx.fillText(item.label.toUpperCase(), x + 24, y + 25);
    ctx.fillStyle = colors.muted;
    ctx.font = compact ? "600 11px Aptos, Segoe UI, sans-serif" : "600 13px Aptos, Segoe UI, sans-serif";
    ctx.fillText(`${money(item.cost)} cost`, x + 24, y + 45);
    if (!compact) {
      ctx.fillStyle = item.demand > 0.68 ? colors.coral : colors.teal;
      ctx.fillRect(x + 24, y + 57, Math.max(8, (w - 42) * item.demand), 4);
      ctx.fillStyle = colors.quiet;
      ctx.font = "700 11px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`${money(expectedProfit(item))} EV`, x + w - 56, y + 25);
    }
    ctx.restore();
  }

  function drawScout() {
    panel(scout.x, scout.y, scout.w, scout.h, "RESTOCK SCOUT");
    itemLayout().forEach(({ item, x, y, w, h }) => drawItem(item, x, y, w, h));
  }

  function drawBoard() {
    panel(board.x, board.y, board.w, board.h, "PICK BOARD");
    const slots = [
      { x: board.x + 28, y: board.y + 64 },
      { x: board.x + 28, y: board.y + 166 },
      { x: board.x + 28, y: board.y + 268 },
    ];
    slots.forEach((slot, i) => {
      const item = state.items.find((candidate) => candidate.id === state.picks[i]);
      ctx.fillStyle = "rgba(255, 244, 223, 0.06)";
      ctx.strokeStyle = "rgba(255, 244, 223, 0.18)";
      ctx.fillRect(slot.x, slot.y, board.w - 56, 78);
      ctx.strokeRect(slot.x + 0.5, slot.y + 0.5, board.w - 57, 77);
      ctx.fillStyle = colors.quiet;
      ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
      ctx.fillText(`PICK ${i + 1}`, slot.x + 18, slot.y + 28);
      if (item) drawItem(item, slot.x + 96, slot.y + 10, 252, 58, true);
      else {
        ctx.fillStyle = colors.muted;
        ctx.font = "600 16px Aptos, Segoe UI, sans-serif";
        ctx.fillText("choose from the scout list", slot.x + 96, slot.y + 44);
      }
    });
  }

  function drawLedger() {
    panel(ledger.x, ledger.y, ledger.w, ledger.h, "DROP LEDGER");
    const rows = [
      ["Score", money(state.score)],
      ["Target", money(state.target)],
      ["Cash", money(state.cash)],
      ["Picks", `${state.picks.length}/3`],
      ["Heat", `${Math.round(state.heat * 100)}%`],
    ];
    rows.forEach(([label, value], i) => {
      const y = ledger.y + 70 + i * 42;
      ctx.fillStyle = colors.quiet;
      ctx.font = "600 15px Aptos, Segoe UI, sans-serif";
      ctx.fillText(label, ledger.x + 18, y);
      ctx.fillStyle = label === "Score" ? colors.yellow : colors.ink;
      ctx.font = label === "Score" ? "800 22px Cascadia Mono, Consolas, monospace" : "800 17px Cascadia Mono, Consolas, monospace";
      ctx.fillText(value, ledger.x + 116, y);
    });
    ctx.fillStyle = colors.muted;
    ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText("HISTORY", ledger.x + 18, ledger.y + 312);
    state.history.forEach((row, i) => {
      const y = ledger.y + 344 + i * 32;
      ctx.fillStyle = "rgba(255, 244, 223, 0.08)";
      ctx.fillRect(ledger.x + 18, y - 19, ledger.w - 36, 25);
      ctx.fillStyle = colors.quiet;
      ctx.font = "600 12px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`drop ${row.day}`, ledger.x + 28, y);
      ctx.fillStyle = row.result >= 0 ? colors.green : colors.red;
      ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
      ctx.fillText(money(row.result), ledger.x + 128, y);
    });
  }

  function drawFooter() {
    const y = 656;
    ctx.fillStyle = "rgba(23, 19, 15, 0.82)";
    ctx.fillRect(48, y - 25, WIDTH - 96, 46);
    ctx.strokeStyle = "rgba(255, 244, 223, 0.14)";
    ctx.strokeRect(48.5, y - 24.5, WIDTH - 97, 45);
    ctx.fillStyle = colors.ink;
    ctx.font = "700 16px Aptos, Segoe UI, sans-serif";
    ctx.fillText(state.message, 68, y + 3);
    ctx.fillStyle = colors.quiet;
    ctx.font = "600 13px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Click cards to toggle picks. Space locks the desk.", 846, y + 3);
  }

  function drawOverlay() {
    if (state.mode === "playing") return;
    ctx.save();
    ctx.fillStyle = "rgba(23, 19, 15, 0.78)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (state.mode === "title") {
      ctx.fillStyle = colors.yellow;
      ctx.font = "800 56px Cascadia Mono, Consolas, monospace";
      ctx.fillText("Drop Desk", 448, 286);
      ctx.fillStyle = colors.ink;
      ctx.font = "700 22px Aptos, Segoe UI, sans-serif";
      ctx.fillText("Three drops. Three picks. Beat the weekly target.", 450, 330);
      ctx.fillStyle = colors.teal;
      ctx.font = "800 18px Cascadia Mono, Consolas, monospace";
      ctx.fillText("Press Start", 450, 378);
    } else {
      const won = state.mode === "won";
      ctx.fillStyle = won ? colors.green : colors.coral;
      ctx.font = "800 50px Cascadia Mono, Consolas, monospace";
      ctx.fillText(won ? "Desk cleared" : "Target missed", 382, 292);
      ctx.fillStyle = colors.ink;
      ctx.font = "700 24px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`Final score: ${money(state.score)}`, 384, 340);
    }
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawHeader();
    drawScout();
    drawBoard();
    drawLedger();
    drawFooter();
    drawOverlay();
  }

  function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function hitItem(point) {
    return itemLayout().find(({ x, y, w, h }) => point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h);
  }

  function onPointerDown(event) {
    const point = toCanvasPoint(event);
    if (state.mode === "title") {
      newDay(false);
      render();
      return;
    }
    if (state.mode !== "playing") return;
    const hit = hitItem(point);
    if (hit) {
      pickItem(hit.item);
      render();
    }
  }

  function onPointerMove(event) {
    const point = toCanvasPoint(event);
    canvas.style.cursor = hitItem(point) ? "pointer" : "default";
  }

  function onKey(event) {
    const key = event.key.toLowerCase();
    if (key === "enter" && state.mode === "title") newDay(false);
    if (key === " " && state.mode === "playing") {
      event.preventDefault();
      lockPicks(false);
    }
    if (key === "r") resetGame();
    if (key === "f") {
      if (!document.fullscreenElement) canvas.requestFullscreen?.();
      else document.exitFullscreen?.();
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
    newDay(false);
    render();
  });
  lockBtn.addEventListener("click", () => {
    lockPicks(false);
    render();
  });
  resetBtn.addEventListener("click", () => {
    resetGame();
    render();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKey);
  bg.addEventListener("load", render);

  window.advanceTime = function advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) update(1 / 60);
    render();
  };

  window.render_game_to_text = function renderGameToText() {
    return JSON.stringify({
      coordinateSystem: "canvas pixels, origin top-left, x right, y down",
      mode: state.mode,
      day: state.day,
      score: state.score,
      target: state.target,
      cash: state.cash,
      timeLeft: Number(state.timeLeft.toFixed(2)),
      heat: Number(state.heat.toFixed(3)),
      picks: state.picks,
      message: state.message,
      visibleItems: state.items.map((item) => ({
        id: item.id,
        label: item.label,
        cost: item.cost,
        demand: Number(item.demand.toFixed(2)),
        expectedProfit: Math.round(expectedProfit(item)),
        picked: item.picked,
      })),
      history: state.history,
    });
  };

  resetGame();
  render();
  requestAnimationFrame(loop);
})();
