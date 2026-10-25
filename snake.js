(() => {
  'use strict';


  const SIZE = 600;
  const COLS = 24;
  const ROWS = 24;
  const BORDER = 24;
  const PLAY = SIZE - BORDER * 2;
  const CELL = PLAY / COLS;

  const BASE_TICK = 140; // ms per move at the start
  const MIN_TICK = 70;   // fastest speed
  const SPEEDUP = 3;     // ms shaved off per apple
  const STORAGE_KEY = 'snake-best';

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayEyebrow = document.getElementById('overlayEyebrow');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const actionBtn = document.getElementById('actionBtn');
  const boardWrap = document.querySelector('.board-wrap');
  const gameLogo = document.getElementById('gameLogo');

  // Keep the canvas crisp on high-density screens.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const KEY_DIRECTIONS = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    KeyW: [0, -1],
    KeyS: [0, 1],
    KeyA: [-1, 0],
    KeyD: [1, 0],
  };

  const COLORS = {
    background: '#dcefd2',
    field: '#eaf7e2',
    grid: 'rgba(23, 61, 48, 0.07)',
    ink: '#173d30',
    shadow: 'rgba(21, 54, 42, 0.18)',
    border: { face: '#1b4437', light: '#4a8067', dark: '#0a241b', edge: '#0c2b20' },
    logo: { face: '#153a2d', light: '#4f8a70', dark: '#071f17', edge: '#061a13' },
    snake: { face: '#245343', light: '#5a9a7c', dark: '#0f3024', edge: '#0b261c' },
    head: { face: '#2f6b54', light: '#72b596', dark: '#143a2b', edge: '#0c2b20' },
    food: { face: '#c25a43', light: '#f0a184', dark: '#7c2d20', edge: '#5b2017' },
    leaf: { face: '#2f6b4f', light: '#6aab86', dark: '#173d2d', edge: '#0e2b20' },
    eye: '#f4fbed',
    pupil: '#0d2a21',
  };

  const PIXEL_FONT = {
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  };

  // ---------- State ----------

  let snake;
  let dir;
  let dirQueue;
  let food;
  let score;
  let best = loadBest();
  let tickMs;
  let state;          // ready | playing | paused | over | won
  let acc = 0;
  let lastTime = 0;
  let pointerStart = null;

  function loadBest() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem(STORAGE_KEY, String(best));
    } catch {
      // Storage may be unavailable; the game still works without a saved best.
    }
  }

  // ---------- Game flow ----------

  function resetRound() {
    snake = [
      { x: 12, y: 12 },
      { x: 11, y: 12 },
      { x: 10, y: 12 },
    ];
    dir = { x: 1, y: 0 };
    dirQueue = [];
    food = null;
    score = 0;
    tickMs = BASE_TICK;
    acc = 0;
    state = 'ready';

    boardWrap.classList.remove('shake');
    placeFood();
    updateHud();
    showOverlay({
      eyebrow: 'Classic mode',
      title: 'Snake',
      text: "Eat the apples, grow longer, and don't hit the walls or yourself.",
      button: 'Play',
    });
  }

  function startNewGame() {
    resetRound();
    state = 'playing';
    lastTime = performance.now();
    hideOverlay();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    showOverlay({
      eyebrow: 'Game paused',
      title: 'Take a breath',
      text: 'Your game is waiting. Press Space or hit Resume to keep going.',
      button: 'Resume',
    });
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    acc = 0;
    lastTime = performance.now();
    hideOverlay();
  }

  function togglePause() {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
    else startNewGame();
  }

  function gameOver() {
    state = 'over';

    boardWrap.classList.remove('shake');
    // Restart the CSS animation even if it just played.
    void boardWrap.offsetWidth;
    boardWrap.classList.add('shake');

    showOverlay({
      eyebrow: 'Round over',
      title: 'Game over',
      text: `You scored ${score} ${score === 1 ? 'point' : 'points'}. Best: ${best}.`,
      button: 'Play again',
    });
  }

  function winGame() {
    state = 'won';
    showOverlay({
      eyebrow: 'Board cleared',
      title: 'You win!',
      text: `Incredible — you filled the whole board with a score of ${score}.`,
      button: 'Play again',
    });
  }

  function step() {
    if (dirQueue.length > 0) {
      dir = dirQueue.shift();
    }

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Walls.
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      gameOver();
      return;
    }

    const willEat = food !== null && head.x === food.x && head.y === food.y;

    // The tail moves away on a normal step, so following it is legal.
    const body = willEat ? snake : snake.slice(0, -1);
    if (body.some((segment) => segment.x === head.x && segment.y === head.y)) {
      gameOver();
      return;
    }

    snake.unshift(head);

    if (willEat) {
      // Don't remove the tail: the snake grows by one.
      score += 1;

      if (score > best) {
        best = score;
        saveBest();
      }

      bump(scoreEl);
      updateHud();
      tickMs = Math.max(MIN_TICK, BASE_TICK - score * SPEEDUP);

      if (!placeFood()) {
        winGame();
      }

      return;
    }

    snake.pop();
  }

  function placeFood() {
    const occupied = new Set(snake.map((segment) => segment.y * COLS + segment.x));
    const free = [];

    for (let i = 0; i < COLS * ROWS; i += 1) {
      if (!occupied.has(i)) free.push(i);
    }

    if (free.length === 0) {
      food = null;
      return false;
    }

    const cell = free[Math.floor(Math.random() * free.length)];
    food = { x: cell % COLS, y: Math.floor(cell / COLS) };
    return true;
  }

  function queueDirection(dx, dy) {
    if (state === 'ready') startNewGame();
    if (state !== 'playing') return;

    const last = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : dir;

    // Ignore no-ops and 180° turns.
    if (dx === last.x && dy === last.y) return;
    if (dx === -last.x && dy === -last.y) return;

    if (dirQueue.length < 2) {
      dirQueue.push({ x: dx, y: dy });
    }
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(4, '0');
    bestEl.textContent = String(best).padStart(4, '0');
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  // ---------- Overlay ----------

  function showOverlay({ eyebrow, title, text, button }) {
    overlayEyebrow.textContent = eyebrow;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    actionBtn.textContent = button;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  // ---------- Drawing ----------

  function paintTile(context, x, y, size, palette, bevel, withShadow = false) {
    const b = Math.max(1, Math.min(bevel, Math.floor(size / 3)));

    if (withShadow) {
      const offset = Math.max(1, Math.round(size * 0.1));
      context.fillStyle = COLORS.shadow;
      context.fillRect(x + offset, y + offset, size, size);
    }

    context.fillStyle = palette.face;
    context.fillRect(x, y, size, size);

    // Raised top/left edges.
    context.fillStyle = palette.light;
    context.fillRect(x, y, size, b);
    context.fillRect(x, y, b, size);

    // Recessed bottom/right edges.
    context.fillStyle = palette.dark;
    context.fillRect(x, y + size - b, size, b);
    context.fillRect(x + size - b, y, b, size);

    if (size >= 8) {
      context.fillStyle = 'rgba(255, 255, 255, 0.1)';
      context.fillRect(x + b, y + b, size - b * 2, 1);
      context.fillRect(x + b, y + b, 1, size - b * 2);
    }

    context.strokeStyle = palette.edge;
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  function draw() {
    drawBoard();
    drawFood();
    drawSnake();
  }

  function drawBoard() {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = COLORS.field;
    ctx.fillRect(BORDER, BORDER, PLAY, PLAY);

    // Faint construction grid.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < COLS; i += 1) {
      const p = BORDER + i * CELL + 0.5;
      ctx.moveTo(p, BORDER);
      ctx.lineTo(p, BORDER + PLAY);
      ctx.moveTo(BORDER, p);
      ctx.lineTo(BORDER + PLAY, p);
    }
    ctx.stroke();

    // A little depth around the playfield edge.
    const edge = 7;
    const shade = ctx.createLinearGradient(0, BORDER, 0, BORDER + edge);
    shade.addColorStop(0, 'rgba(23, 61, 48, 0.07)');
    shade.addColorStop(1, 'rgba(23, 61, 48, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(BORDER, BORDER, PLAY, edge);

    const shadeBottom = ctx.createLinearGradient(0, BORDER + PLAY, 0, BORDER + PLAY - edge);
    shadeBottom.addColorStop(0, 'rgba(23, 61, 48, 0.07)');
    shadeBottom.addColorStop(1, 'rgba(23, 61, 48, 0)');
    ctx.fillStyle = shadeBottom;
    ctx.fillRect(BORDER, BORDER + PLAY - edge, PLAY, edge);

    const shadeLeft = ctx.createLinearGradient(BORDER, 0, BORDER + edge, 0);
    shadeLeft.addColorStop(0, 'rgba(23, 61, 48, 0.07)');
    shadeLeft.addColorStop(1, 'rgba(23, 61, 48, 0)');
    ctx.fillStyle = shadeLeft;
    ctx.fillRect(BORDER, BORDER, edge, PLAY);

    const shadeRight = ctx.createLinearGradient(BORDER + PLAY, 0, BORDER + PLAY - edge, 0);
    shadeRight.addColorStop(0, 'rgba(23, 61, 48, 0.07)');
    shadeRight.addColorStop(1, 'rgba(23, 61, 48, 0)');
    ctx.fillStyle = shadeRight;
    ctx.fillRect(BORDER + PLAY - edge, BORDER, edge, PLAY);

    // Tiled frame, two tiles thick.
    const pitch = 12;
    const gap = 2;
    const tile = pitch - gap;
    const count = SIZE / pitch;
    const ring = BORDER / pitch;

    for (let ty = 0; ty < count; ty += 1) {
      for (let tx = 0; tx < count; tx += 1) {
        const onFrame =
          tx < ring || tx >= count - ring || ty < ring || ty >= count - ring;
        if (!onFrame) continue;
        paintTile(ctx, tx * pitch + gap / 2, ty * pitch + gap / 2, tile, COLORS.border, 2);
      }
    }

    // Crisp inner frame over the tiles.
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(BORDER - 1, BORDER - 1, PLAY + 2, PLAY + 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(BORDER + 0.5, BORDER + 0.5, PLAY - 1, PLAY - 1);
  }


  function drawFood() {
    if (food === null) return;

    const size = 18;
    const x = Math.round(BORDER + food.x * CELL + (CELL - size) / 2);
    const y = Math.round(BORDER + food.y * CELL + (CELL - size) / 2);

    paintTile(ctx, x, y, size, COLORS.food, 3, true);

    const leaf = 6;
    paintTile(ctx, x + size - leaf, Math.max(BORDER + 1, y - 3), leaf, COLORS.leaf, 1);
  }

  function drawSnake() {
    const len = snake.length;
    const inset = 1;
    const size = CELL - inset * 2;

    for (let i = len - 1; i >= 0; i -= 1) {
      const segment = snake[i];
      const x = BORDER + segment.x * CELL + inset;
      const y = BORDER + segment.y * CELL + inset;
      const palette = i === 0 ? COLORS.head : COLORS.snake;

      paintTile(ctx, x, y, size, palette, 3, true);
    }

    drawEyes();
  }

  function drawEyes() {
    const head = snake[0];
    const cx = BORDER + head.x * CELL + CELL / 2;
    const cy = BORDER + head.y * CELL + CELL / 2;
    const dx = dir.x;
    const dy = dir.y;
    const px = -dy;
    const py = dx;

    const eye = 4;
    const forward = 3;
    const side = 4;

    const eyes = [
      [cx + dx * forward + px * side, cy + dy * forward + py * side],
      [cx + dx * forward - px * side, cy + dy * forward - py * side],
    ];

    for (const [ex, ey] of eyes) {
      ctx.fillStyle = COLORS.eye;
      ctx.fillRect(Math.round(ex - eye / 2), Math.round(ey - eye / 2), eye, eye);
    }

    if (state === 'over') {
      const xPixels = [
        [0, 0], [3, 0],
        [1, 1], [2, 1],
        [1, 2], [2, 2],
        [0, 3], [3, 3],
      ];
      ctx.fillStyle = COLORS.pupil;
      for (const [ex, ey] of eyes) {
        const x = Math.round(ex - eye / 2);
        const y = Math.round(ey - eye / 2);
        for (const [ox, oy] of xPixels) {
          ctx.fillRect(x + ox, y + oy, 1, 1);
        }
      }
      return;
    }

    ctx.fillStyle = COLORS.pupil;
    for (const [ex, ey] of eyes) {
      ctx.fillRect(Math.round(ex - 1 + dx), Math.round(ey - 1 + dy), 2, 2);
    }
  }

  // ---------- Main loop ----------

  function renderLogo(canvasEl) {
    if (!canvasEl) return;

    const tile = 7;
    const gap = 1;
    const pitch = tile + gap;
    const word = 'SNAKE';
    const glyphWidth = 5;
    const glyphHeight = 7;
    const spacing = 1;
    const columns = word.length * glyphWidth + (word.length - 1) * spacing;
    const width = columns * pitch - gap;
    const height = glyphHeight * pitch - gap;
    const scale = Math.min(window.devicePixelRatio || 1, 2);

    canvasEl.width = width * scale;
    canvasEl.height = height * scale;

    const logo = canvasEl.getContext('2d');
    logo.setTransform(scale, 0, 0, scale, 0, 0);
    logo.clearRect(0, 0, width, height);

    let column = 0;
    for (const letter of word) {
      const glyph = PIXEL_FONT[letter];
      if (!glyph) {
        column += glyphWidth + spacing;
        continue;
      }

      for (let row = 0; row < glyphHeight; row += 1) {
        for (let x = 0; x < glyphWidth; x += 1) {
          if (glyph[row][x] !== '1') continue;
          paintTile(logo, (column + x) * pitch, row * pitch, tile, COLORS.logo, 1);
        }
      }

      column += glyphWidth + spacing;
    }
  }

  function frame(now) {
    if (lastTime === 0) lastTime = now;

    const dt = Math.min(now - lastTime, 200);
    lastTime = now;

    if (state === 'playing') {
      acc += dt;

      let steps = 0;
      while (acc >= tickMs && steps < 5) {
        acc -= tickMs;
        steps += 1;
        step();
        if (state !== 'playing') {
          acc = 0;
          break;
        }
      }
    } else {
      acc = 0;
    }

    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) togglePause();
      return;
    }

    if (event.code === 'KeyR') {
      event.preventDefault();
      if (!event.repeat) startNewGame();
      return;
    }

    if (event.code === 'Enter') {
      event.preventDefault();
      if (!event.repeat) {
        if (state === 'paused') resumeGame();
        else if (state === 'over' || state === 'won' || state === 'ready') startNewGame();
      }
      return;
    }

    const direction = KEY_DIRECTIONS[event.code];
    if (!direction) return;

    event.preventDefault();
    queueDirection(direction[0], direction[1]);
  });

  actionBtn.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startNewGame();
  });

  document.querySelectorAll('.dpad [data-dir]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const [dx, dy] = button.dataset.dir.split(',').map(Number);
      queueDirection(dx, dy);
    });
  });

  // Swipe on the board.
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!pointerStart) return;

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      queueDirection(Math.sign(dx), 0);
    } else {
      queueDirection(0, Math.sign(dy));
    }
  });

  canvas.addEventListener('pointercancel', () => {
    pointerStart = null;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') pauseGame();
  });

  window.addEventListener('blur', () => {
    if (state === 'playing') pauseGame();
  });

  // ---------- Go ----------

  renderLogo(gameLogo);
  resetRound();
  draw();
  requestAnimationFrame(frame);
})();
