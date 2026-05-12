# Drop Desk V2 Game Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing DevDay `Drop Desk` submission more fun while preserving the same public URL.

**Architecture:** Keep the current static canvas implementation in `public/devday/drop-desk/`. Add game-loop depth inside `game.js`, with state exposed through `window.render_game_to_text` so the existing Playwright verifier can prove the new behaviors.

**Tech Stack:** Vanilla HTML/CSS/JS canvas, Vite static build, Playwright verification.

---

### Task 1: Verifier Contract

**Files:**
- Modify: `scripts/verify-drop-desk.mjs`

- [ ] Add expectations for daily scout briefs, combo metadata, streak/momentum, event history, final grade, and replay/end-state fields.
- [ ] Run the verifier before implementation and confirm it fails on missing v2 fields.

### Task 2: Game Loop

**Files:**
- Modify: `public/devday/drop-desk/game.js`
- Modify: `public/devday/drop-desk/index.html`
- Modify: `public/devday/drop-desk/styles.css`

- [ ] Add daily scout briefs with featured labels and bonuses.
- [ ] Add combo scoring for focused, diversified, and brief-matching picks.
- [ ] Add deterministic risk events that can boost or dent a drop.
- [ ] Add streak/momentum and a final grade on the end screen.
- [ ] Refresh copy and controls without changing the submitted URL.

### Task 3: Verification And Deploy

**Files:**
- Modify: `tasks/todo.md`
- Modify: `progress.md`

- [ ] Run local Playwright verifier and inspect screenshots.
- [ ] Run Vite build.
- [ ] Commit and push only Drop Desk v2 files and verifier.
- [ ] Verify the public URL returns `200` and the live verifier passes.
- [ ] Update task/progress notes with evidence.
