// 贪吃蛇 v2 功能测试：在模拟 DOM/Canvas 环境中运行真实游戏脚本
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("/Users/kylewang/Documents/Codex/2026-09-14/sheng/outputs/snake.html", "utf8");

// 注入调试探针（仅测试副本，不影响真实文件）
const probe = `
  const setFood = (pt, type) => { food = { x: pt.x, y: pt.y, type: type || "normal" }; };
  const setSnake = (arr) => { snake = arr; };
  const setFoodsThisLevel = (n) => { foodsThisLevel = n; };
  const setObstacles = (arr) => { obstacleCells = arr; };
  const duelPlayer = (id) => duelPlayers.find(p => p.id === id);
  const setDuelSnake = (id, arr, dir) => {
    const p = duelPlayer(id);
    p.snake = arr.map(pt => ({ ...pt }));
    if (dir) {
      p.direction = { ...dir };
      p.nextDirection = { ...dir };
    }
  };
  const setDuelScoreDebug = (id, value) => { setDuelScore(duelPlayer(id), value); };
  const setDuelShield = (id, value) => { duelPlayer(id).shield = value; };
  const setDuelMoveAt = (value) => {
    duelPlayers.forEach(p => { if (p.alive) p.nextMoveAt = value; });
    duelNextMoveAt = value;
  };
  const setDuelTurn = (id, value) => { duelPlayer(id).turnUntil = value; };
  const eatDuel = (id, type) => eatDuelFood(duelPlayer(id), type);
  const duelDirOf = (id) => ({ ...duelPlayer(id).nextDirection });
  const setDuelFood = (pt, type) => { food = { x: pt.x, y: pt.y, type: type || "normal" }; };
  const foodTypeOf = (r) => {
    const saved = Math.random;
    Math.random = () => r;
    try { return randomFoodType(); } finally { Math.random = saved; }
  };
  const sampleFoods = (n) => {
    const res = [];
    for (let i = 0; i < n; i++) { const f = randomFood(); if (f) res.push(f); }
    return res;
  };
  const foodTypesAt = (list) => list.map(foodTypeOf);
  globalThis.__debug = () => ({
    mode,
    snakeLen: snake.length, head: { ...snake[0] }, direction: { ...direction }, nextDirection: { ...nextDirection },
    running, paused, gameOver, won, score, level, foodsThisLevel,
    obstacleCells: obstacleCells.map(o => ({ ...o })),
    food: food ? { ...food } : null,
    effectsEl: effectsEl.textContent, scoreEl: scoreEl.textContent, levelEl: levelEl.textContent,
    duelPlayers: duelPlayers.map(p => ({
      id: p.id, label: p.label, alive: p.alive, score: p.score, shield: p.shield,
      kills: p.kills, turnUntil: p.turnUntil,
      snake: p.snake.map(s => ({ ...s })), direction: { ...p.direction }, nextDirection: { ...p.nextDirection },
      speedUntil: p.speedUntil, graceUntil: p.graceUntil,
      bounceUntil: p.bounceUntil, nextMoveAt: p.nextMoveAt
    })),
    duelNextMoveAt,
    gridSize: GRID_SIZE,
    effects1El: effects1El.textContent, effects2El: effects2El.textContent,
    score1El: score1El.textContent, score2El: score2El.textContent, levelDuelEl: levelDuelEl.textContent,
    internals: {
      step, setFood, setSnake, setFoodsThisLevel, setObstacles, sampleFoods, foodTypesAt, setScore, endGame, resetGame, startGame, togglePause, addScore,
      interval: () => Math.round(currentInterval()),
      setMode, forceMode: (m) => { mode = m; }, stepDuel, setDuelSnake, setDuelScore: setDuelScoreDebug, setDuelShield, setDuelMoveAt, setDuelFood,
      setDuelTurn, eatDuel, duelDirOf,
      playerInterval: (id) => Math.round(intervalForPlayer(duelPlayer(id)))
    }
  });
`;
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/\}\)\(\);\s*$/, probe + "\n})();");

// ---------- 桩件 ----------
function makeClassList() {
  return {
    _set: new Set(),
    add(c) { this._set.add(c); },
    remove(c) { this._set.delete(c); },
    toggle(c, force) {
      if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
      else if (force) { this._set.add(c); } else { this._set.delete(c); }
      return this._set.has(c);
    },
    contains(c) { return this._set.has(c); }
  };
}

function makeElement(id) {
  return {
    id, textContent: "", innerHTML: "", value: "",
    style: {
      _v: {},
      setProperty(k, v) { this._v[k] = v; },
      getPropertyValue(k) { return this._v[k] || ""; }
    },
    _clientW: 500, _clientH: 500,
    offsetWidth: 200, offsetHeight: 40,
    classList: makeClassList(),
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); },
    focus() {},
    get clientWidth() { return this._clientW; },
    get clientHeight() { return this._clientH; }
  };
}

function noopProxy() {
  const t = function () {};
  return new Proxy(t, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "canvas") return { width: 500, height: 500 };
      return noopProxy();
    },
    apply() { return noopProxy(); },
    set() { return true; }
  });
}

const elements = {};
["game","score","best","level","effects","overlay","overlayTitle","overlaySub","startBtn","boardBtn",
 "boardWrap","pausedHint","toast","soundBtn","lbOpenBtn","lbModal","lbList","lbCloseBtn","nameRow","nameInput","saveScoreBtn",
 "singleHud","duelHud","score1","score2","effects1","effects2","levelDuel","modeRow","modeSingle","modeDuel","fsBtn",
 "kills1","kills2","p1Box","p2Box"]
  .forEach(id => elements[id] = makeElement(id));
const canvas = elements.game;
canvas.width = 500; canvas.height = 500;
canvas.getContext = () => noopProxy();

// 布局相关元素（querySelector 用）
const wrapperEl = makeElement("wrapper");
wrapperEl._clientW = 900;
wrapperEl._clientH = 900;
const h1El = makeElement("h1");
const toolbarEl = makeElement("toolbar");
const hintEl = makeElement("controls-hint");
const legendEl = makeElement("legend");
hintEl.offsetHeight = 24;
legendEl.offsetHeight = 52;
elements.singleHud.offsetHeight = 90;
elements.duelHud.offsetHeight = 90;
// 侧栏两块：顶部（标题 + 按钮 + 积分板）、底部（操作提示 + 图例）
const sideTopEl = makeElement("side-top");
const sideBottomEl = makeElement("side-bottom");
sideTopEl.offsetHeight = 190;
sideBottomEl.offsetHeight = 86;
const bySelector = {
  ".wrapper": wrapperEl,
  ".side-top": sideTopEl,
  ".side-bottom": sideBottomEl
};

// getComputedStyle 桩：只提供游戏脚本读取到的字段
function stubComputedStyle(el) {
  const hiddenEl = el.classList.contains("hidden");
  return {
    display: hiddenEl ? "none" : "block",
    paddingLeft: "12px", paddingRight: "12px", paddingTop: "12px", paddingBottom: "12px",
    rowGap: "10px", columnGap: "16px",
    marginTop: "0px", marginBottom: "0px",
    getPropertyValue(k) { return el.style.getPropertyValue(k); }
  };
}

const docListeners = {};
const rafQueue = [];
const clock = { t: 0 };

const sandbox = {
  console,
  document: {
    getElementById(id) { return elements[id]; },
    querySelector(sel) { return bySelector[sel] || null; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() {
        sandbox.document.fullscreenElement = sandbox.document.documentElement;
        (docListeners["fullscreenchange"] || []).forEach(fn => fn({}));
        return Promise.resolve();
      }
    },
    exitFullscreen() {
      sandbox.document.fullscreenElement = null;
      (docListeners["fullscreenchange"] || []).forEach(fn => fn({}));
      return Promise.resolve();
    }
  },
  window: {
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    getComputedStyle(el) { return stubComputedStyle(el); },
    innerWidth: 900, innerHeight: 900
  },
  localStorage: {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); }
  },
  performance: { now: () => (clock.t += 50) },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  Math, Date, JSON,
};
sandbox.canvas = canvas;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "snake-game-v2.js" });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail ? "  [" + detail + "]" : "")); }
}

function pump(n) {
  for (let i = 0; i < n; i++) {
    const fn = rafQueue.shift();
    if (!fn) break;
    fn(sandbox.performance.now());
  }
}
const keyHandler = docListeners["keydown"][0];
const key = (k) => keyHandler({ key: k, code: k, preventDefault() {} });
const state = () => sandbox.__debug();
const el = (id) => elements[id];
const hidden = (id) => el(id).classList.contains("hidden");

// 初始清理排行榜，保证决定性
sandbox.localStorage.setItem("snake_leaderboard_v2", "[]");

console.log("== 初始状态 ==");
check("overlay 可见（未开始）", !hidden("overlay"));
check("得分 0、关卡 1、无效果", String(el("score").textContent) === "0" && el("level").textContent === "1" && el("effects").textContent === "—");
check("音效按钮默认开启", el("soundBtn").textContent === "🔊 音效");

console.log("== 点击开始 ==");
el("startBtn").dispatch("click", { stopPropagation() {} });
check("overlay 隐藏", hidden("overlay"));
check("游戏运行中", state().running === true);

console.log("== 暂停/继续 ==");
key(" ");
check("空格暂停", state().paused === true && el("pausedHint").classList.contains("show"));
const pausedHead1 = { ...state().head };
pump(30);
check("暂停期间蛇头不动", state().head.x === pausedHead1.x && state().head.y === pausedHead1.y);
key(" ");
check("再次空格恢复", state().paused === false);

console.log("== 方向控制 ==");
key("ArrowUp");
key("ArrowUp");
key("ArrowLeft");   // 与初始右向相反，应被忽略
pump(6);
check("按 Up 后蛇向上移动", state().direction.y === -1);

console.log("== 普通食物 +10 ==");
key("R");
let s = state();
const int = s.internals;
const behind1 = { x: s.head.x + s.direction.x, y: s.head.y + s.direction.y };
int.setFood(behind1, "normal");
int.step();
s = state();
check("吃到普通食物得分 +10", s.score === 10, "score=" + s.score);
check("蛇身长度 +1", s.snakeLen === 4);
check("UI 同步", String(s.scoreEl) === "10");

console.log("== 金豆 +50 ==");
int.step();                          // 先向前一格（不挨食物）
s = state();
int.setFood({ x: s.head.x + s.direction.x, y: s.head.y + s.direction.y }, "gold");
int.step();
s = state();
check("金豆后得分 +50（共 60）", s.score === 60, "score=" + s.score);

console.log("== 加速效果 ==");
key("R");
s = state();
int.setFood({ x: s.head.x + s.direction.x, y: s.head.y + s.direction.y }, "speed");
int.step();
check("加速后速度变快（间隔变小）", int.interval() <= 90, "interval=" + int.interval());
clock.t += 6000;
check("加速 5 秒后恢复", int.interval() === 150, "interval=" + int.interval());

console.log("== 撞障碍即出局 ==");
key("R");
s = state();
int.setObstacles([{ x: s.head.x + s.direction.x, y: s.head.y + s.direction.y }]);
int.step();
s = state();
check("单人模式撞上障碍直接失败", s.gameOver === true, "gameOver=" + s.gameOver);
check("结束画面标题正确", el("overlayTitle").textContent.includes("游戏结束"));

console.log("== 水果长度效果 ==");
function eatFruitSet(len, type) {
  key("R");
  const body = [];
  for (let i = 0; i < len; i++) body.push({ x: 17 - i, y: 17 });
  int.setSnake(body);
  int.setFood({ x: body[0].x + 1, y: body[0].y }, type);
  int.step();
  return state();
}
check("西瓜 +3 节（3→6）", eatFruitSet(3, "watermelon").snakeLen === 6);
check("葡萄 +2 节（3→5）", eatFruitSet(3, "grape").snakeLen === 5);
check("榴莲 +5 节（3→8）", eatFruitSet(3, "durian").snakeLen === 8);
check("柠檬 -1 节（6→5）", eatFruitSet(6, "lemon").snakeLen === 5);
s = eatFruitSet(3, "lemon");
check("柠檬不会把蛇吃到 3 节以下", s.snakeLen === 3, "len=" + s.snakeLen);
s = eatFruitSet(3, "watermelon");
check("西瓜正常加分（+20）", s.score === 20, "score=" + s.score);
s = eatFruitSet(3, "durian");
check("榴莲正常加分（+30）", s.score === 30, "score=" + s.score);

console.log("== 关卡升级与障碍生成 ==");
key("R");
s = state();
int.setFoodsThisLevel(4);
int.setFood({ x: s.head.x + s.direction.x, y: s.head.y + s.direction.y }, "normal");
int.step();
s = state();
check("吃完第 5 个食物升到第 2 关", s.level === 2, "level=" + s.level);
check("UI 关卡显示 2", String(s.levelEl) === "2");
check("第 2 关生成了 6 个障碍物", s.obstacleCells.length === 6, "n=" + s.obstacleCells.length);
check("食物不会生成在障碍上", s.food && !s.obstacleCells.some(o => o.x === s.food.x && o.y === s.food.y));
const samples = int.sampleFoods(100);
check("随机生成 100 个食物样本均不落在障碍/蛇身上", samples.every(f => !s.obstacleCells.some(o => o.x === f.x && o.y === f.y)));

console.log("== 排行榜流 ==");
// 清除排行榜，制造确定性
sandbox.localStorage.setItem("snake_leaderboard_v2", "[]");
key("R");
s = state();
int.setScore(100);
int.endGame();
s = state();
check("游戏结束后弹名次输入", !hidden("nameRow"));
el("nameInput").value = "小张";
el("saveScoreBtn").dispatch("click");
let board = JSON.parse(sandbox.localStorage.getItem("snake_leaderboard_v2"));
check("成绩已写入排行榜", board.length === 1 && board[0].name === "小张" && board[0].score === 100);
check("保存后自动打开排行榜弹窗", el("lbModal").classList.contains("show"));
el("lbCloseBtn").dispatch("click");
check("关闭排行榜弹窗", !el("lbModal").classList.contains("show"));

console.log("== 排行榜前 10 限制 ==");
key("R"); // 重置 scoreSaved
s = state();
int.setScore(5);
for (let i = 0; i < 12; i++) {
  sandbox.localStorage.setItem("snake_leaderboard_v2", JSON.stringify(
    loadDirectBoard().concat([{ name: "刷榜" + i, score: 1, level: 1, date: "2026/9/15" }]).sort((a, b) => b.score - a.score).slice(0, 10)
  ));
}
function loadDirectBoard() {
  return JSON.parse(sandbox.localStorage.getItem("snake_leaderboard_v2") || "[]");
}
int.addScore("真玩家");
board = loadDirectBoard();
check("排行榜最多保留 10 条", board.length === 10, "len=" + board.length);
check("高分记录排在前面", board[0].name === "真玩家" || board.some(e => e.name === "真玩家"));

console.log("== 音效开关 ==");
el("soundBtn").dispatch("click");
check("点击后切换为静音", el("soundBtn").textContent === "🔇 音效");
check("静音偏好已保存", sandbox.localStorage.getItem("snake_muted") === "1");
el("soundBtn").dispatch("click");
check("再点恢复声音", el("soundBtn").textContent === "🔊 音效");

console.log("== 重新开始重置 ==");
key("R");
s = state();
check("重开后 overlay 隐藏", hidden("overlay"));
check("关卡重置为 1、无效果、无障碍", s.level === 1 && String(s.levelEl) === "1" && s.obstacleCells.length === 0 && s.effectsEl === "—");
check("得分重置为 0", String(s.scoreEl) === "0");
check("无排行榜输入框", hidden("nameRow"));
check("游戏正常运行", s.gameOver === false && s.running === true);

console.log("== 本地双人模式开关 ==");
int.endGame();
el("modeDuel").dispatch("click", { stopPropagation() {} });
s = state();
check("切换后进入双人模式", s.mode === "duel");
check("双人 HUD 显示、单人 HUD 隐藏", !hidden("duelHud") && hidden("singleHud"));
check("双人模式按钮处于选中态", el("modeDuel").classList.contains("active") && !el("modeSingle").classList.contains("active"));
check("双人模式说明正确", el("overlayTitle").textContent.includes("本地双人") && el("overlaySub").innerHTML.includes("P1"));
el("startBtn").dispatch("click", { stopPropagation() {} });
s = state();
check("双人游戏运行中", s.running === true && s.duelPlayers.length === 2);
check("双方初始长度和分数正确", s.duelPlayers.every(p => p.snake.length === 3 && p.score === 0 && p.alive));
check("场地放大到 35×35（面积约为原来 3 倍）", s.gridSize === 35, "grid=" + s.gridSize + " area=" + (s.gridSize * s.gridSize));
check("两条蛇在中线行左右对称出生",
  s.duelPlayers[0].snake[0].y === s.duelPlayers[1].snake[0].y &&
  s.duelPlayers[0].snake[0].y === Math.floor(s.gridSize / 2) &&
  Math.abs(s.duelPlayers[0].snake[0].x - s.duelPlayers[1].snake[0].x) >= 10,
  "P1=" + JSON.stringify(s.duelPlayers[0].snake[0]) + " P2=" + JSON.stringify(s.duelPlayers[1].snake[0]));

console.log("== 双人主循环推进 ==");
const duelHeadsBefore = s.duelPlayers.map(p => ({ ...p.snake[0] }));
pump(3);
s = state();
check("主循环按各自节奏自动推进双人蛇",
  s.duelPlayers.some((p, i) => p.snake[0].x !== duelHeadsBefore[i].x || p.snake[0].y !== duelHeadsBefore[i].y));

console.log("== 双人按键分流 ==");
key("w");
key("ArrowUp");
s = state();
check("W 只控制 P1 向上", s.duelPlayers[0].nextDirection.x === 0 && s.duelPlayers[0].nextDirection.y === -1);
check("方向键只控制 P2 向上", s.duelPlayers[1].nextDirection.x === 0 && s.duelPlayers[1].nextDirection.y === -1);
key("a");
key("ArrowLeft");
s = state();
check("P1 反向输入被忽略", s.duelPlayers[0].nextDirection.y === -1);
check("P2 反向输入被忽略", s.duelPlayers[1].nextDirection.y === -1);

console.log("== 双人独立移动与得分 ==");
let p1Before = { ...s.duelPlayers[0].snake[0] };
let p2Before = { ...s.duelPlayers[1].snake[0] };
int.setDuelMoveAt(0);
int.stepDuel(1000);
s = state();
check("两名玩家同一帧独立向上移动",
  s.duelPlayers[0].snake[0].y === p1Before.y - 1 && s.duelPlayers[1].snake[0].y === p2Before.y - 1);

p1Before = { ...s.duelPlayers[0].snake[0] };
int.setDuelFood({ x: p1Before.x, y: p1Before.y - 1 }, "normal");
int.setDuelMoveAt(0);
int.stepDuel(2000);
s = state();
check("P1 吃普通食物只增加 P1 分数", s.duelPlayers[0].score === 10 && s.duelPlayers[1].score === 0);
check("P1 增长时 P2 长度不变", s.duelPlayers[0].snake.length === 4 && s.duelPlayers[1].snake.length === 3);
check("双人 HUD 分数独立同步", String(s.score1El) === "10" && String(s.score2El) === "0");

console.log("== 双人技能食物归属 ==");
p1Before = { ...s.duelPlayers[0].snake[0] };
int.setDuelFood({ x: p1Before.x, y: p1Before.y - 1 }, "speed");
int.setDuelMoveAt(0);
int.stepDuel(3000);
s = state();
check("P1 吃加速只影响 P1", int.playerInterval(1) <= 90 && int.playerInterval(2) === 150,
  "p1=" + int.playerInterval(1) + ", p2=" + int.playerInterval(2));
check("双人效果栏分别显示", String(s.effects1El).includes("加速") && String(s.effects2El) === "—");

p1Before = { ...s.duelPlayers[0].snake[0] };
int.setDuelFood({ x: p1Before.x, y: p1Before.y - 1 }, "shield");
int.setDuelMoveAt(0);
int.stepDuel(4000);
s = state();
check("P1 吃护盾只归 P1 所有", s.duelPlayers[0].shield === 1 && s.duelPlayers[1].shield === 0);

console.log("== 双人暂停 ==");
key(" ");
s = state();
check("双人模式可暂停", s.paused === true && s.duelNextMoveAt === Infinity);
const pausedDuelHeads = s.duelPlayers.map(p => ({ ...p.snake[0] }));
pump(6);
s = state();
check("暂停期间双方都不移动",
  s.duelPlayers.every((p, i) => p.snake[0].x === pausedDuelHeads[i].x && p.snake[0].y === pausedDuelHeads[i].y));
key(" ");
s = state();
check("再次空格恢复双人比赛", s.paused === false && Number.isFinite(s.duelNextMoveAt));

console.log("== 双人碰撞与胜负 ==");
key("R");
int.setDuelSnake(1, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], { x: -1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(5000);
s = state();
check("P1 撞墙出局", s.duelPlayers[0].alive === false && s.duelPlayers[1].alive === true);
check("存活者 P2 获胜", s.gameOver === true && el("overlayTitle").textContent.includes("P2"));
check("双人模式不弹排行榜输入", hidden("nameRow"));

key("R");
// 撞击者（P1 撞上 P2 蛇身）应被截短一半而不是出局
int.setDuelFood({ x: 0, y: 0 });   // 食物移开，避免随机干扰
int.setDuelSnake(1, [
  { x: 11, y: 9 }, { x: 11, y: 8 }, { x: 11, y: 7 }, { x: 11, y: 6 },
  { x: 11, y: 5 }, { x: 11, y: 4 }, { x: 11, y: 3 }, { x: 11, y: 2 }
], { x: 0, y: 1 });
int.setDuelSnake(2, [
  { x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 10 }
], { x: 1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(8000);
s = state();
check("撞击者撞对方蛇身被截短一半（8→4）",
  s.duelPlayers[0].alive === true && s.duelPlayers[0].snake.length === 4,
  "P1 len=" + s.duelPlayers[0].snake.length + " alive=" + s.duelPlayers[0].alive);
check("撞击者不再因相撞直接出局", s.duelPlayers.every(p => p.alive === true));
check("被撞的一方毫发无损", s.duelPlayers[1].snake.length === 4);
check("撞击者获得短暂碰撞保护", s.duelPlayers[0].graceUntil > 8000);
check("相撞后比赛继续，未结算", s.gameOver === false);

// 正面对撞：双方都是撞击者，各截短一半后继续存活
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [
  { x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }
], { x: 1, y: 0 });
int.setDuelSnake(2, [
  { x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }, { x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 }
], { x: -1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(9000);
s = state();
check("正面对撞时双方都被截短一半（6→3）",
  s.duelPlayers.every(p => p.alive && p.snake.length === 3),
  "lens=" + s.duelPlayers.map(p => p.snake.length).join(","));
check("正面对撞后双方仍存活、比赛继续", s.gameOver === false && s.duelPlayers.every(p => p.alive));

// 长度不足以再截短（≤3）时相撞 → 出局，按比分定胜负
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }], { x: 1, y: 0 });
int.setDuelSnake(2, [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }], { x: -1, y: 0 });
int.setDuelScore(1, 30);
int.setDuelScore(2, 10);
int.setDuelMoveAt(0);
int.stepDuel(10000);
s = state();
check("长度不足无法再截短时对撞双方出局", s.duelPlayers.every(p => p.alive === false));
check("同时出局时比分高者 P1 获胜", el("overlayTitle").textContent.includes("P1"));
check("结算显示双方最终得分", el("overlaySub").innerHTML.includes("30") && el("overlaySub").innerHTML.includes("10"));

console.log("== 双人对抗道具 ==");
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], { x: 1, y: 0 });
int.setDuelSnake(2, [
  { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }
], { x: 1, y: 0 });
int.setDuelMoveAt(1000);

// ⚔️ 攻击：对手 -2 节，自己 +20 分
int.eatDuel(1, "attack");
s = state();
check("吃下「攻击」道具：对手蛇身 -2",
  s.duelPlayers[1].snake.length === 3,
  "P2 len=" + s.duelPlayers[1].snake.length);
check("攻击道具为自己加分（+20）", s.duelPlayers[0].score === 20, "P1 score=" + s.duelPlayers[0].score);

// 🧊 冰冻：对手 1.5 秒内无法转向，自己 +20 分
int.setDuelSnake(1, [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], { x: 1, y: 0 });
int.eatDuel(1, "freeze");
s = state();
check("吃下「冰冻」道具：对手进入冰冻",
  s.duelPlayers[1].turnUntil > 0,
  "turnUntil=" + s.duelPlayers[1].turnUntil);
check("冰冻道具为自己加分（+20）", s.duelPlayers[0].score === 40, "P1 score=" + s.duelPlayers[0].score);
const p2FrozenDir = int.duelDirOf(2);
key("ArrowUp");
s = state();
check("被冰冻的玩家输入被忽略（无法转向）",
  s.duelPlayers[1].nextDirection.x === p2FrozenDir.x && s.duelPlayers[1].nextDirection.y === p2FrozenDir.y,
  "dir=" + JSON.stringify(s.duelPlayers[1].nextDirection));
// 冰冻总时长应为 1.5 秒：推进 1.6 秒后应当自动解冻并可转向
const frozenRemaining = s.duelPlayers[1].turnUntil - clock.t;
check("冰冻剩余时长约 1.5 秒", frozenRemaining > 0 && frozenRemaining <= 1500,
  "remaining=" + frozenRemaining);
const p2Cur = int.duelDirOf(2);
const thawKey = p2Cur.y === 0 ? { key: "ArrowUp", x: 0, y: -1 } : { key: "ArrowLeft", x: -1, y: 0 };
clock.t += 1600;
key(thawKey.key);
s = state();
check("1.5 秒后冰冻解除、恢复转向",
  s.duelPlayers[1].nextDirection.x === thawKey.x && s.duelPlayers[1].nextDirection.y === thawKey.y,
  "dir=" + JSON.stringify(s.duelPlayers[1].nextDirection));
int.setDuelTurn(2, 0);

// 🧨 埋雷：在对手正前方 3 格生成障碍，自己 +20 分
int.setDuelSnake(1, [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], { x: 1, y: 0 });
int.setDuelSnake(2, [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], { x: 1, y: 0 });
int.setObstacles([]);
int.eatDuel(1, "mine");
s = state();
check("吃下「埋雷」道具：对手前方 3 格出现障碍",
  s.obstacleCells.some(o => o.x === 13 && o.y === 10),
  "obstacles=" + JSON.stringify(s.obstacleCells));
check("埋雷道具为自己加分（+20）", s.duelPlayers[0].score === 60, "P1 score=" + s.duelPlayers[0].score);

// 埋雷会预判：3 格被占时退到 2 格
int.setObstacles([{ x: 13, y: 10 }]);
int.eatDuel(1, "mine");
s = state();
check("前方 3 格被占用时改埋 2 格处",
  s.obstacleCells.some(o => o.x === 12 && o.y === 10),
  "obstacles=" + JSON.stringify(s.obstacleCells));

// 双人模式下才会刷出对抗道具
key("R");
int.forceMode("duel");
key(" ");
const duelFoodTypes = int.foodTypesAt([0.60, 0.70, 0.77]);
s = state();
check("双人模式食物池包含对抗道具",
  duelFoodTypes.join(",") === "attack,freeze,mine",
  "types=" + duelFoodTypes.join(","));
const duelNormalAlways = int.foodTypesAt([0.1, 0.4]);
check("双人模式仍然会刷普通食物", duelNormalAlways.every(t => t === "normal"), duelNormalAlways.join(","));
const duelFruits = int.foodTypesAt([0.82, 0.87, 0.91, 0.95]);
check("双人模式也能刷出水果",
  duelFruits.join(",") === "watermelon,grape,lemon,durian",
  "types=" + duelFruits.join(","));
const singleFruits = (() => {
  key("R");
  int.forceMode("single");
  return int.foodTypesAt([0.87, 0.91, 0.94, 0.98]);
})();
check("单人模式也会刷出水果",
  singleFruits.join(",") === "watermelon,grape,lemon,durian",
  "types=" + singleFruits.join(","));
const iceFreePools = (() => {
  const bad = [];
  ["single", "duel"].forEach(function (m) {
    int.forceMode(m);
    key("R");
    for (let i = 0; i < 100; i++) {
      const t = int.foodTypesAt([i / 100])[0];
      if (t === "ice") bad.push(m + "@" + (i / 100));
    }
  });
  return bad;
})();
check("食物池已彻底移除冰块", iceFreePools.length === 0, iceFreePools.join(","));
key("R");
int.forceMode("duel");
key(" ");

console.log("== 双人对抗得分 ==");
// 主动撞对手蛇身：撞击者 +30 分
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [
  { x: 11, y: 9 }, { x: 11, y: 8 }, { x: 11, y: 7 }, { x: 11, y: 6 }, { x: 11, y: 5 }, { x: 11, y: 4 }
], { x: 0, y: 1 });
int.setDuelSnake(2, [
  { x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 10 }
], { x: 1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(20000);
s = state();
check("撞中对手得 +30 分", s.duelPlayers[0].score === 30, "P1 score=" + s.duelPlayers[0].score);
check("撞击者自身仍然减半", s.duelPlayers[0].snake.length === 3, "P1 len=" + s.duelPlayers[0].snake.length);
check("HUD 同步显示撞击得分", String(s.score1El) === "30");

console.log("== 相撞弹飞 ==");
// P1 从上往下撞 P2 的蛇身：P1 减半，P2 被沿撞击方向弹飞 3 格
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [
  { x: 11, y: 5 }, { x: 11, y: 4 }, { x: 11, y: 3 }, { x: 11, y: 2 }, { x: 11, y: 1 }, { x: 11, y: 0 }
], { x: 0, y: 1 });
int.setDuelSnake(2, [
  { x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }, { x: 8, y: 6 }
], { x: 1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(40000);
s = state();
check("被撞者被沿撞击方向弹飞 3 格",
  s.duelPlayers[1].snake[0].x === 12 && s.duelPlayers[1].snake[0].y === 9,
  "P2 head=" + JSON.stringify(s.duelPlayers[1].snake[0]));
check("被撞者长度不变（只是被推开）",
  s.duelPlayers[1].snake.length === 4,
  "P2 len=" + s.duelPlayers[1].snake.length);
check("撞击者仍然按规则减半",
  s.duelPlayers[0].snake.length === 3,
  "P1 len=" + s.duelPlayers[0].snake.length);
check("被撞飞后进入短暂僵直",
  s.duelPlayers[1].bounceUntil > 40000,
  "bounceUntil=" + s.duelPlayers[1].bounceUntil);
check("弹飞后双方仍存活、比赛继续",
  s.gameOver === false && s.duelPlayers.every(p => p.alive));

// 被撞飞出界：撞击者直接拿下 100 分与一次击杀
key("R");
int.setDuelFood({ x: 0, y: 0 });
int.setDuelSnake(1, [
  { x: 32, y: 32 }, { x: 31, y: 32 }, { x: 30, y: 32 }, { x: 29, y: 32 }, { x: 28, y: 32 }
], { x: 1, y: 1 });
int.setDuelSnake(2, [
  { x: 32, y: 33 }, { x: 33, y: 33 }
], { x: 1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(50000);
s = state();
check("被撞飞出界直接出局", s.duelPlayers[1].alive === false, "P2 alive=" + s.duelPlayers[1].alive);
check("撞飞对手出界拿下胜利", s.gameOver === true && el("overlayTitle").textContent.includes("P1"));
check("撞飞出界同样记一次击杀",
  s.duelPlayers[0].kills === 1 && String(el("kills1").textContent).includes("1"),
  "kills1=" + el("kills1").textContent);

// 把对手打下场：胜者 +100 分并记一次击杀
key("R");
int.setDuelScore(2, 10);
int.setDuelSnake(1, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], { x: -1, y: 0 });
int.setDuelMoveAt(0);
int.stepDuel(30000);
s = state();
check("对手出局后存活者获胜", s.gameOver === true && s.duelPlayers[1].alive === true);
check("把对手打下场 +100 分",
  s.duelPlayers[1].score >= 110,
  "P2 score=" + s.duelPlayers[1].score);
check("胜者记一次击杀",
  s.duelPlayers[1].kills === 1 && String(el("kills2").textContent).includes("1"),
  "kills2=" + el("kills2").textContent);
check("结算面板显示双方击杀数", el("overlaySub").innerHTML.includes("击杀 0 : 1"));

console.log("== 场地自适应尺寸 ==");
const resizeHandlers = sandbox.window._listeners["resize"] || [];
function layoutAt(w, h) {
  wrapperEl._clientW = w;
  wrapperEl._clientH = h;
  sandbox.window.innerWidth = w;
  sandbox.window.innerHeight = h;
  resizeHandlers.forEach(fn => fn());
  return parseFloat(wrapperEl.style.getPropertyValue("--board"));
}

let boardWide = layoutAt(1440, 900);
check("宽屏并排布局", !wrapperEl.classList.contains("stacked"));
check("宽屏场地几乎占满高度（≥820）", boardWide >= 820, "board=" + boardWide);
check("场地不超过可用高度", boardWide <= 900 - 24, "board=" + boardWide);

let boardLaptop = layoutAt(1280, 800);
check("笔记本尺寸场地仍然够大（≥660）", boardLaptop >= 660, "board=" + boardLaptop);

const boardNarrow = layoutAt(700, 900);
check("窄屏自动回退为堆叠布局", wrapperEl.classList.contains("stacked"));
check("窄屏场地不溢出宽度", boardNarrow <= 700 - 24, "board=" + boardNarrow);

const boardShort = layoutAt(1440, 620);
check("矮屏场地优先占满高度", boardShort >= 540, "board=" + boardShort);
check("矮屏场地不溢出可用高度", boardShort <= 620 - 24, "board=" + boardShort);

const boardHuge = layoutAt(3200, 2400);
check("超宽屏场地会跟着变大", boardHuge >= 2000, "board=" + boardHuge);
check("场地大小有上限（2200）", boardHuge <= 2200, "board=" + boardHuge);

console.log("== 全屏 ==");
const fsBtnEl = elements.fsBtn;
check("默认按钮显示「全屏」", /全屏/.test(fsBtnEl.textContent) && !/退出/.test(fsBtnEl.textContent), fsBtnEl.textContent);
fsBtnEl.dispatch("click", { stopPropagation() {} });
check("点击后进入全屏", !!sandbox.document.fullscreenElement);
check("按钮变成「退出全屏」", /退出/.test(fsBtnEl.textContent), fsBtnEl.textContent);
fsBtnEl.dispatch("click", { stopPropagation() {} });
check("再次点击退出全屏", !sandbox.document.fullscreenElement);
check("按钮恢复「全屏」", !/退出/.test(fsBtnEl.textContent), fsBtnEl.textContent);
keyHandler({ key: "f", preventDefault() {} });
check("按 F 也能进入全屏", !!sandbox.document.fullscreenElement);
keyHandler({ key: "f", preventDefault() {} });
check("再按 F 退出全屏", !sandbox.document.fullscreenElement);

// 还原到默认视口，避免影响后续
layoutAt(900, 900);

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
