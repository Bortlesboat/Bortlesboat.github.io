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
  const MAX_DAYS = 4;
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
    blue: "#8ebcff",
  };

  const lanes = [
    { name: "booster", color: colors.yellow, base: 24, spread: 22, risk: 0.18 },
    { name: "bundle", color: colors.teal, base: 34, spread: 30, risk: 0.24 },
    { name: "elite kit", color: colors.coral, base: 52, spread: 42, risk: 0.32 },
    { name: "display", color: colors.green, base: 68, spread: 54, risk: 0.4 },
  ];
  const traits = [
    { name: "queue", bonus: 0.1 },
    { name: "local", bonus: 0.04 },
    { name: "online", bonus: 0.08 },
    { name: "chase", bonus: 0.14 },
    { name: "promo", bonus: 0.12 },
  ];
  const briefDeck = [
    {
      title: "Release Radar",
      text: "Launch buzz favors bundles and elite kits.",
      featuredLabels: ["bundle", "elite kit"],
      trait: "queue",
      bonus: 58,
    },
    {
      title: "Local Arbitrage",
      text: "Local buyers are clearing boosters and displays.",
      featuredLabels: ["booster", "display"],
      trait: "local",
      bonus: 52,
    },
    {
      title: "Chase Spike",
      text: "Chase demand is hot. High risk can still pay.",
      featuredLabels: ["elite kit", "display"],
      trait: "chase",
      bonus: 64,
    },
    {
      title: "Promo Week",
      text: "Promo chatter lifts bundles and boosters.",
      featuredLabels: ["booster", "bundle"],
      trait: "promo",
      bonus: 48,
    },
  ];
  const eventDeck = [
    { name: "Queue Skip", good: true, amount: 34, text: "Early queue slot landed." },
    { name: "Cart Hold", good: true, amount: 24, text: "Checkout hold protected margin." },
    { name: "Listing Flood", good: false, amount: -32, text: "Extra listings cooled resale." },
    { name: "Shipping Drag", good: false, amount: -26, text: "Shipping fees clipped the drop." },
    { name: "Collector Ping", good: true, amount: 42, text: "Collector ping turned one pick fast." },
  ];

  const state = {
    mode: "title",
    day: 1,
    maxDays: MAX_DAYS,
    score: 0,
    target: 720,
    cash: 140,
    timeLeft: 45,
    heat: 0.24,
    momentum: 0.5,
    streak: 0,
    bestStreak: 0,
    scoutBrief: null,
    selectedId: null,
    message: "Read the scout brief. Build a combo. Lock the drop.",
    items: [],
    picks: [],
    history: [],
    lastResult: null,
    finalRank: null,
    lastFrame: performance.now(),
  };

  function rand() {
    seed.value = (seed.value * 1103515245 + 12345) >>> 0;
    return seed.value / 4294967296;
  }

  function pick(values) {
    return values[Math.floor(rand() * values.length)];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function money(value) {
    const rounded = Math.round(value);
    return rounded < 0 ? `-$${Math.abs(rounded)}` : `$${rounded}`;
  }

  function currentBrief() {
    return briefDeck[(state.day - 1) % briefDeck.length];
  }

  function startRun() {
    seed.value = 424242;
    state.mode = "playing";
    state.day = 1;
    state.score = 0;
    state.cash = 140;
    state.heat = 0.24;
    state.momentum = 0.5;
    state.streak = 0;
    state.bestStreak = 0;
    state.history = [];
    state.lastResult = null;
    state.finalRank = null;
    newDay(false);
  }

  function resetGame() {
    seed.value = 424242;
    state.mode = "title";
    state.day = 1;
    state.score = 0;
    state.cash = 140;
    state.timeLeft = 45;
    state.heat = 0.24;
    state.momentum = 0.5;
    state.streak = 0;
    state.bestStreak = 0;
    state.scoutBrief = null;
    state.selectedId = null;
    state.message = "Read the scout brief. Build a combo. Lock the drop.";
    state.items = [];
    state.picks = [];
    state.history = [];
    state.lastResult = null;
    state.finalRank = null;
  }

  function makeItem(index) {
    const lane = pick(lanes);
    const trait = pick(traits);
    const brief = state.scoutBrief || currentBrief();
    const briefFit = brief.featuredLabels.includes(lane.name) || brief.trait === trait.name;
    const heatLift = state.heat * 18 + state.momentum * 12;
    const cost = Math.round(lane.base + rand() * lane.spread + state.day * 5);
    const demand = clamp(0.18 + rand() * 0.64 + (briefFit ? 0.18 : 0) + state.momentum * 0.08, 0.08, 0.98);
    const margin = Math.round(14 + rand() * 54 + demand * 38 + trait.bonus * 70 + heatLift - cost * 0.11);
    const risk = clamp(lane.risk + rand() * 0.34 + (brief.trait === trait.name ? -0.06 : 0) + (cost > 82 ? 0.12 : 0), 0.08, 0.88);
    return {
      id: `${state.day}-${index}-${Math.round(rand() * 9999)}`,
      label: lane.name,
      trait: trait.name,
      color: lane.color,
      cost,
      demand,
      margin: Math.max(10, margin),
      risk,
      briefFit,
      picked: false,
    };
  }

  function newDay(advanceSeed = true) {
    if (!advanceSeed) seed.value += state.day * 17;
    state.mode = "playing";
    state.selectedId = null;
    state.timeLeft = Math.max(24, 45 - (state.day - 1) * 4);
    state.heat = clamp(0.2 + state.day * 0.08 + state.momentum * 0.08, 0.2, 0.94);
    state.scoutBrief = currentBrief();
    state.items = Array.from({ length: 8 }, (_, i) => makeItem(i));
    state.picks = [];
    state.message = `${state.scoutBrief.title}: ${state.scoutBrief.text}`;
  }

  function expectedProfit(item) {
    const briefLift = item.briefFit ? 18 : 0;
    const demandLift = item.margin * (0.74 + item.demand * 0.76 + state.heat * 0.16 + state.momentum * 0.18);
    const riskDrag = item.cost * item.risk * (0.22 + (1 - state.momentum) * 0.1);
    return demandLift + briefLift - riskDrag;
  }

  function pickedItems() {
    return state.items.filter((item) => state.picks.includes(item.id));
  }

  function comboFor(items) {
    if (!items.length) return { name: "No combo", bonus: 0, detail: "Pick products to build a combo." };
    const labelSet = new Set(items.map((item) => item.label));
    const traitSet = new Set(items.map((item) => item.trait));
    const briefHits = items.filter((item) => item.briefFit).length;
    if (items.length >= 3 && briefHits >= 3) {
      return { name: "Brief Sweep", bonus: state.scoutBrief.bonus + 28, detail: "All three picks match today's brief." };
    }
    if (items.length >= 3 && labelSet.size >= 3) {
      return { name: "Balanced Shelf", bonus: 46, detail: "Three product types spread risk." };
    }
    if (items.length >= 3 && labelSet.size === 1) {
      return { name: "Deep Stack", bonus: 38, detail: "One product line, full allocation." };
    }
    if (items.length >= 2 && traitSet.has(state.scoutBrief.trait)) {
      return { name: "Signal Match", bonus: 30, detail: `Two picks follow the ${state.scoutBrief.trait} signal.` };
    }
    if (briefHits >= 2) {
      return { name: "Brief Pair", bonus: 24, detail: "Two picks match the scout note." };
    }
    return { name: "Loose Picks", bonus: 8, detail: "Small execution bonus." };
  }

  function riskEvent(items, combo) {
    const avgRisk = items.reduce((sum, item) => sum + item.risk, 0) / Math.max(1, items.length);
    const roll = rand();
    if (roll < avgRisk * 0.42) {
      const event = eventDeck.find((candidate) => !candidate.good && candidate.name === (avgRisk > 0.42 ? "Listing Flood" : "Shipping Drag"));
      return { ...event, amount: Math.round(event.amount * (0.8 + avgRisk)), riskRoll: Number(roll.toFixed(2)) };
    }
    if (roll > 0.78 - state.momentum * 0.18 || combo.name === "Brief Sweep") {
      const event = pick(eventDeck.filter((candidate) => candidate.good));
      return { ...event, amount: Math.round(event.amount + state.streak * 8), riskRoll: Number(roll.toFixed(2)) };
    }
    return { name: "Clean Fill", good: true, amount: 12, text: "No surprise costs hit the desk.", riskRoll: Number(roll.toFixed(2)) };
  }

  function gradeHint(score) {
    if (score >= state.target * 1.25) return "S pace";
    if (score >= state.target) return "A pace";
    if (score >= state.target * 0.72) return "B pace";
    return "Needs a bigger drop";
  }

  function finalRank() {
    const ratio = state.score / state.target;
    if (ratio >= 1.35) return { label: "S", score: Math.round(ratio * 100), text: "Invite-worthy desk run." };
    if (ratio >= 1) return { label: "A", score: Math.round(ratio * 100), text: "Target cleared with a clean sheet." };
    if (ratio >= 0.78) return { label: "B", score: Math.round(ratio * 100), text: "Close run. Better combo timing wins it." };
    return { label: "C", score: Math.round(ratio * 100), text: "Scout signals were left on the table." };
  }

  function pickItem(item) {
    if (item.picked) {
      item.picked = false;
      state.picks = state.picks.filter((id) => id !== item.id);
      state.message = `${item.label} removed. ${comboFor(pickedItems()).detail}`;
      return;
    }
    if (state.picks.length >= 3) {
      state.message = "Desk limit is three picks. Lock or swap.";
      return;
    }
    if (item.cost > state.cash + 20) {
      state.message = "That restock strains the cash desk.";
      return;
    }
    item.picked = true;
    state.picks.push(item.id);
    const combo = comboFor(pickedItems());
    state.message = `${item.label} added. ${combo.name}: ${combo.detail}`;
  }

  function lockPicks(auto = false) {
    if (state.mode !== "playing") return;
    if (!state.picks.length) {
      state.message = "Pick at least one restock first.";
      return;
    }
    const picked = pickedItems();
    const spent = picked.reduce((sum, item) => sum + item.cost, 0);
    const base = picked.reduce((sum, item) => sum + expectedProfit(item), 0);
    const missed = state.items
      .filter((item) => !item.picked && item.briefFit && item.demand > 0.64)
      .reduce((sum, item) => sum + item.margin * 0.16, 0);
    const combo = comboFor(picked);
    const event = riskEvent(picked, combo);
    const timePenalty = auto ? 34 : Math.max(0, (12 - state.timeLeft) * 1.8);
    const momentumBonus = state.streak * 12 + Math.round(state.momentum * 18);
    const result = Math.round(Math.max(-70, base + combo.bonus + event.amount + momentumBonus - missed - timePenalty));
    state.score += result;
    state.streak = result > 45 ? state.streak + 1 : result < 0 ? 0 : state.streak;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.momentum = clamp(state.momentum + result / 520 + combo.bonus / 460 + event.amount / 600 - missed / 500, 0.12, 1);
    state.cash = Math.max(45, state.cash - spent + Math.max(0, result) + 105 + state.streak * 12);
    const row = {
      day: state.day,
      result,
      spent,
      picks: picked.length,
      combo,
      event,
      breakdown: {
        base: Math.round(base),
        combo: combo.bonus,
        event: event.amount,
        momentum: momentumBonus,
        missed: Math.round(missed),
        timePenalty: Math.round(timePenalty),
      },
    };
    state.lastResult = { ...row, gradeHint: gradeHint(state.score) };
    state.history.unshift(row);
    state.history = state.history.slice(0, 4);

    if (state.day >= MAX_DAYS) {
      state.finalRank = finalRank();
      state.mode = state.score >= state.target ? "won" : "lost";
      state.message =
        state.mode === "won"
          ? `Target cleared. Rank ${state.finalRank.label}: ${state.finalRank.text}`
          : `Run complete. Rank ${state.finalRank.label}: ${state.finalRank.text}`;
      return;
    }
    state.day += 1;
    newDay(true);
    state.message = `${row.combo.name} ${money(row.combo.bonus)} + ${row.event.name} ${money(row.event.amount)}. Next drop.`;
  }

  function update(dt) {
    if (state.mode !== "playing") return;
    state.timeLeft -= dt;
    state.heat = clamp(state.heat + dt * 0.006, 0.2, 1);
    state.items.forEach((item) => {
      if (!item.picked) item.demand = Math.max(0.05, item.demand - dt * (item.briefFit ? 0.002 : 0.0045));
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
    const brief = state.scoutBrief || briefDeck[0];
    ctx.fillStyle = colors.ink;
    ctx.font = "800 32px Cascadia Mono, Consolas, monospace";
    ctx.fillText("Drop Desk", 48, 62);
    ctx.fillStyle = colors.muted;
    ctx.font = "600 17px Aptos, Segoe UI, sans-serif";
    ctx.fillText("Read the signal. Build the combo. Survive the drop.", 50, 92);
    ctx.fillStyle = "rgba(23, 19, 15, 0.8)";
    ctx.fillRect(514, 42, 396, 50);
    ctx.strokeStyle = colors.edge;
    ctx.strokeRect(514.5, 42.5, 395, 49);
    ctx.fillStyle = colors.teal;
    ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText(brief.title.toUpperCase(), 532, 62);
    ctx.fillStyle = colors.ink;
    ctx.font = "700 15px Aptos, Segoe UI, sans-serif";
    ctx.fillText(brief.text, 532, 82);
    ctx.fillStyle = "rgba(23, 19, 15, 0.8)";
    ctx.fillRect(956, 42, 276, 50);
    ctx.strokeStyle = colors.edge;
    ctx.strokeRect(956.5, 42.5, 275, 49);
    ctx.fillStyle = colors.quiet;
    ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`DROP ${state.day}/${MAX_DAYS}`, 974, 62);
    ctx.fillStyle = state.timeLeft < 10 ? colors.red : colors.yellow;
    ctx.font = "800 22px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`${Math.max(0, Math.ceil(state.timeLeft))}s`, 1096, 68);
    ctx.fillStyle = colors.teal;
    ctx.fillText(`${Math.round(state.momentum * 100)}m`, 1158, 68);
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
    ctx.fillStyle = item.picked ? "rgba(255, 196, 79, 0.2)" : item.briefFit ? "rgba(71, 201, 180, 0.13)" : "rgba(255, 244, 223, 0.08)";
    ctx.strokeStyle = item.picked ? colors.yellow : item.briefFit ? colors.teal : "rgba(255, 244, 223, 0.18)";
    ctx.lineWidth = item.picked ? 2.4 : 1.2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = item.color;
    ctx.fillRect(x + 8, y + 9, 8, h - 18);
    ctx.fillStyle = colors.ink;
    ctx.font = compact ? "800 13px Cascadia Mono, Consolas, monospace" : "800 14px Cascadia Mono, Consolas, monospace";
    ctx.fillText(item.label.toUpperCase(), x + 24, y + 23);
    ctx.fillStyle = item.briefFit ? colors.teal : colors.muted;
    ctx.font = compact ? "700 10px Aptos, Segoe UI, sans-serif" : "700 12px Aptos, Segoe UI, sans-serif";
    ctx.fillText(`${item.trait} ${money(item.cost)}`, x + 24, y + 43);
    if (!compact) {
      ctx.fillStyle = item.demand > 0.68 ? colors.coral : colors.teal;
      ctx.fillRect(x + 24, y + 57, Math.max(8, (w - 42) * item.demand), 4);
      ctx.fillStyle = colors.quiet;
      ctx.font = "700 11px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`${money(expectedProfit(item))} EV`, x + w - 58, y + 23);
      ctx.fillText(`${Math.round(item.risk * 100)}r`, x + w - 42, y + 45);
    }
    ctx.restore();
  }

  function drawScout() {
    panel(scout.x, scout.y, scout.w, scout.h, "RESTOCK SCOUT");
    itemLayout().forEach(({ item, x, y, w, h }) => drawItem(item, x, y, w, h));
  }

  function drawBoard() {
    panel(board.x, board.y, board.w, board.h, "PICK BOARD");
    const combo = comboFor(pickedItems());
    ctx.fillStyle = "rgba(255, 244, 223, 0.06)";
    ctx.fillRect(board.x + 28, board.y + 44, board.w - 56, 44);
    ctx.fillStyle = colors.teal;
    ctx.font = "800 14px Cascadia Mono, Consolas, monospace";
    ctx.fillText(`${combo.name.toUpperCase()} ${money(combo.bonus)}`, board.x + 44, board.y + 68);
    ctx.fillStyle = colors.muted;
    ctx.font = "600 13px Aptos, Segoe UI, sans-serif";
    ctx.fillText(combo.detail, board.x + 190, board.y + 68);
    const slots = [
      { x: board.x + 28, y: board.y + 108 },
      { x: board.x + 28, y: board.y + 202 },
      { x: board.x + 28, y: board.y + 296 },
    ];
    slots.forEach((slot, i) => {
      const item = state.items.find((candidate) => candidate.id === state.picks[i]);
      ctx.fillStyle = "rgba(255, 244, 223, 0.06)";
      ctx.strokeStyle = "rgba(255, 244, 223, 0.18)";
      ctx.fillRect(slot.x, slot.y, board.w - 56, 70);
      ctx.strokeRect(slot.x + 0.5, slot.y + 0.5, board.w - 57, 69);
      ctx.fillStyle = colors.quiet;
      ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
      ctx.fillText(`PICK ${i + 1}`, slot.x + 18, slot.y + 27);
      if (item) drawItem(item, slot.x + 96, slot.y + 8, 252, 54, true);
      else {
        ctx.fillStyle = colors.muted;
        ctx.font = "600 16px Aptos, Segoe UI, sans-serif";
        ctx.fillText("choose from the scout list", slot.x + 96, slot.y + 41);
      }
    });
  }

  function drawLedger() {
    panel(ledger.x, ledger.y, ledger.w, ledger.h, "DROP LEDGER");
    const rows = [
      ["Score", money(state.score)],
      ["Target", money(state.target)],
      ["Cash", money(state.cash)],
      ["Streak", `${state.streak}x`],
      ["Momentum", `${Math.round(state.momentum * 100)}%`],
    ];
    rows.forEach(([label, value], i) => {
      const y = ledger.y + 66 + i * 38;
      ctx.fillStyle = colors.quiet;
      ctx.font = "600 15px Aptos, Segoe UI, sans-serif";
      ctx.fillText(label, ledger.x + 18, y);
      ctx.fillStyle = label === "Score" ? colors.yellow : colors.ink;
      ctx.font = label === "Score" ? "800 22px Cascadia Mono, Consolas, monospace" : "800 17px Cascadia Mono, Consolas, monospace";
      ctx.fillText(value, ledger.x + 112, y);
    });
    ctx.fillStyle = colors.muted;
    ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
    ctx.fillText("HISTORY", ledger.x + 18, ledger.y + 286);
    state.history.forEach((row, i) => {
      const y = ledger.y + 318 + i * 38;
      ctx.fillStyle = "rgba(255, 244, 223, 0.08)";
      ctx.fillRect(ledger.x + 18, y - 22, ledger.w - 36, 31);
      ctx.fillStyle = colors.quiet;
      ctx.font = "700 11px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`d${row.day} ${row.combo.name}`, ledger.x + 28, y - 5);
      ctx.fillStyle = row.result >= 0 ? colors.green : colors.red;
      ctx.font = "800 13px Cascadia Mono, Consolas, monospace";
      ctx.fillText(money(row.result), ledger.x + 144, y - 5);
      ctx.fillStyle = colors.muted;
      ctx.font = "600 10px Aptos, Segoe UI, sans-serif";
      ctx.fillText(row.event.name, ledger.x + 28, y + 8);
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
    ctx.fillText("Click cards to toggle picks. Space locks the drop. R resets. F fullscreen.", 760, y + 3);
  }

  function drawOverlay() {
    if (state.mode === "playing") return;
    ctx.save();
    ctx.fillStyle = "rgba(23, 19, 15, 0.78)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (state.mode === "title") {
      ctx.fillStyle = colors.yellow;
      ctx.font = "800 56px Cascadia Mono, Consolas, monospace";
      ctx.fillText("Drop Desk", 416, 272);
      ctx.fillStyle = colors.ink;
      ctx.font = "700 22px Aptos, Segoe UI, sans-serif";
      ctx.fillText("Four drops. Read the brief, stack combos, dodge risk.", 418, 318);
      ctx.fillStyle = colors.teal;
      ctx.font = "800 18px Cascadia Mono, Consolas, monospace";
      ctx.fillText("Press Start or Enter", 418, 368);
    } else {
      const rank = state.finalRank || finalRank();
      const won = state.mode === "won";
      ctx.fillStyle = won ? colors.green : colors.coral;
      ctx.font = "800 50px Cascadia Mono, Consolas, monospace";
      ctx.fillText(won ? "Desk cleared" : "Run graded", 374, 272);
      ctx.fillStyle = colors.yellow;
      ctx.font = "800 68px Cascadia Mono, Consolas, monospace";
      ctx.fillText(`RANK ${rank.label}`, 374, 346);
      ctx.fillStyle = colors.ink;
      ctx.font = "700 22px Aptos, Segoe UI, sans-serif";
      ctx.fillText(`${rank.text} Final score: ${money(state.score)}. Best streak: ${state.bestStreak}x.`, 376, 390);
      ctx.fillStyle = colors.teal;
      ctx.font = "800 17px Cascadia Mono, Consolas, monospace";
      ctx.fillText("Press R or click the canvas to run it back.", 376, 438);
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
    if (state.mode === "title" || state.mode === "won" || state.mode === "lost") {
      startRun();
      render();
      return;
    }
    const hit = hitItem(point);
    if (hit) {
      pickItem(hit.item);
      render();
    }
  }

  function onPointerMove(event) {
    if (state.mode !== "playing") {
      canvas.style.cursor = "pointer";
      return;
    }
    const point = toCanvasPoint(event);
    canvas.style.cursor = hitItem(point) ? "pointer" : "default";
  }

  function onKey(event) {
    const key = event.key.toLowerCase();
    if (key === "enter" && state.mode === "title") startRun();
    if (key === " " && state.mode === "playing") {
      event.preventDefault();
      lockPicks(false);
    }
    if (key === "r") startRun();
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
    startRun();
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
      maxDays: state.maxDays,
      score: state.score,
      target: state.target,
      cash: state.cash,
      timeLeft: Number(state.timeLeft.toFixed(2)),
      heat: Number(state.heat.toFixed(3)),
      momentum: Number(state.momentum.toFixed(3)),
      streak: state.streak,
      bestStreak: state.bestStreak,
      scoutBrief: state.scoutBrief,
      picks: state.picks,
      activeCombo: comboFor(pickedItems()),
      message: state.message,
      lastResult: state.lastResult,
      finalRank: state.finalRank,
      visibleItems: state.items.map((item) => ({
        id: item.id,
        label: item.label,
        trait: item.trait,
        cost: item.cost,
        demand: Number(item.demand.toFixed(2)),
        risk: Number(item.risk.toFixed(2)),
        briefFit: item.briefFit,
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
