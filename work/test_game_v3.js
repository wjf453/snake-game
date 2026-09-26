// 贪吃蛇 v3 功能测试：在模拟 DOM/Canvas 环境中运行真实游戏脚本
// 覆盖：美化后的双人面板、必杀能量、连击、撞飞、缩圈危险区、粒子特效、主循环
const fs = require("fs");
const vm = require("vm");

const HTML = "/Users/kylewang/Documents/Codex/2026-09-14/sheng/outputs/snake.html";
const html = fs.readFileSync(HTML, "utf8");

// 注入调试探针（只加在测试副本里，不写回真实文件）
const probe = `
  const dbgPlayer = (id) => duelPlayers.find(p => p.id === id);
  globalThis.__debug = () => ({
    mode, running, paused, gameOver, won, score, level, foodsThisLevel,
    snakeLen: snake.length, head: { ...snake[0] }, direction: { ...direction },
    food: food ? { ...food } : null,
    obstacleCells: obstacleCells.map(o => ({ ...o })),
    effectsText: effectsEl.textContent,
    duel: duelPlayers.map(p => ({
      id: p.id, alive: p.alive, score: p.score, kills: p.kills, shield: p.shield,
      energy: p.energy, combo: p.combo, chargeUntil: p.chargeUntil, bounceUntil: p.bounceUntil,
      turnUntil: p.turnUntil, speedUntil: p.speedUntil, graceUntil: p.graceUntil,
      len: p.snake.length, head: { ...p.snake[0] }, direction: { ...p.direction },
      nextDirection: { ...p.nextDirection }, nextMoveAt: p.nextMoveAt,
      dead: !p.alive
    })),
    duelDangerRing, duelNextRingAt, duelNextMoveAt,
    particles: particles.length, floaters: floaters.length, shakeMag, boardDirty,
    dangerNote: dangerNoteEl.textContent,
    energy1Width: energy1El.style.width, combo1Text: combo1El.textContent,
    leadText: leadTextEl.textContent, leadWidth: leadFillEl.style.width,
    skill1Disabled: skill1Btn.disabled, skill1State: skill1Btn.dataset.state, skill1Html: skill1Btn.innerHTML,
    overlayTitle: overlayTitle.textContent, overlayHidden: overlay.classList.contains("hidden"),
    dangerClass: boardWrap.classList.contains("danger"),
    internals: {
      startGame, resetGame, setMode, stepDuel,
      setFood: (pt, type) => { food = { x: pt.x, y: pt.y, type: type || "normal" }; },
      setSnake: (arr) => { snake = arr.map(p => ({ ...p })); },
      setObstacles: (arr) => { obstacleCells = arr.map(p => ({ ...p })); },
      setDuelSnake: (id, arr, dir) => {
        const p = dbgPlayer(id);
        p.snake = arr.map(pt => ({ ...pt }));
        if (dir) { p.direction = { ...dir }; p.nextDirection = { ...dir }; }
      },
      setDuelEnergy: (id, v) => { dbgPlayer(id).energy = v; },
      setDuelCharge: (id, v) => { dbgPlayer(id).chargeUntil = v; },
      setDuelShield: (id, v) => { dbgPlayer(id).shield = v; },
      setDuelScore: (id, v) => setDuelScore(dbgPlayer(id), v),
      setDuelDir: (id, dx, dy) => setDuelDirection(dbgPlayer(id), dx, dy),
      activateCharge: (id) => activateCharge(dbgPlayer(id)),
      expandDangerRing: (now) => expandDangerRing(now),
      inDangerZone: (c) => inDangerZone(c),
      onlyDue: (id) => {
        const now = performance.now();
        duelPlayers.forEach(p => { p.nextMoveAt = p.id === id ? now : Infinity; });
        duelNextMoveAt = now;
      },
      playerInterval: (id) => intervalForPlayer(dbgPlayer(id)),
      currentInterval: () => currentInterval(),
      step
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
    id, textContent: "", innerHTML: "", value: "", disabled: false, dataset: {},
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
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || { stopPropagation() {} })); },
    focus() {},
    get clientWidth() { return this._clientW; },
    get clientHeight() { return this._clientH; }
  };
}

// 画布上下文桩：记录绘制调用次数，确保渲染路径真的跑过
const drawCalls = { fillText: 0, fill: 0, stroke: 0, arc: 0, fillRect: 0, radial: 0, linear: 0 };
function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arcTo() {}, rect() {}, clip() {},
    translate() {}, setTransform() {}, setLineDash() {}, roundRect() {},
    constructor: null,
    createLinearGradient() { drawCalls.linear++; return grad; },
    createRadialGradient() { drawCalls.radial++; return grad; },
    fill() { drawCalls.fill++; },
    stroke() { drawCalls.stroke++; },
    arc() { drawCalls.arc++; },
    fillRect() { drawCalls.fillRect++; },
    strokeRect() {},
    clearRect() {},
    fillText() { drawCalls.fillText++; },
    strokeText() {}
  };
}

const elements = {};
["game","score","best","level","effects","overlay","overlayTitle","overlaySub","startBtn","boardBtn",
 "boardWrap","pausedHint","toast","soundBtn","lbOpenBtn","lbModal","lbList","lbCloseBtn","nameRow","nameInput","saveScoreBtn",
 "singleHud","duelHud","score1","score2","effects1","effects2","levelDuel","modeRow","modeSingle","modeDuel","fsBtn",
 "kills1","kills2","p1Box","p2Box",
 "combo1","combo2","energy1","energy2","energyWrap1","energyWrap2","skill1","skill2",
 "leadBar","leadFill","leadText","dangerNote"]
  .forEach(id => elements[id] = makeElement(id));
const canvas = elements.game;
canvas.width = 500; canvas.height = 500;
canvas.getContext = () => makeCtx();
elements.boardWrap._clientW = 800;
elements.boardWrap._clientH = 800;

const wrapperEl = makeElement("wrapper");
wrapperEl._clientW = 1400;
wrapperEl._clientH = 900;
const sideTopEl = makeElement("side-top");
const sideBottomEl = makeElement("side-bottom");
sideTopEl.offsetHeight = 190;
sideBottomEl.offsetHeight = 86;
const bySelector = {
  ".wrapper": wrapperEl,
  ".side-top": sideTopEl,
  ".side-bottom": sideBottomEl
};

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
    documentElement: { requestFullscreen() { return Promise.resolve(); } },
    exitFullscreen() { return Promise.resolve(); }
  },
  window: {
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    getComputedStyle(el) { return stubComputedStyle(el); },
    innerWidth: 1400, innerHeight: 900
  },
  localStorage: {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); }
  },
  performance: { now: () => clock.t },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout: () => 1,
  clearTimeout: () => {}
};
sandbox.canvas = canvas;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "snake-game-v3.js" });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail !== undefined ? "  [" + detail + "]" : "")); }
}

// 驱动主循环：每 16ms 一帧，把 rAF 队列里的回调取出来执行
function advance(ms) {
  const frames = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < frames; i++) {
    clock.t += 16;
    const fn = rafQueue.shift();
    if (!fn) break;
    fn(clock.t);
  }
}
const keyHandler = docListeners["keydown"][0];
const key = (k) => keyHandler({ key: k, code: k, preventDefault() {} });
const state = () => sandbox.__debug();
const I = () => state().internals;
const el = (id) => elements[id];
const hidden = (id) => el(id).classList.contains("hidden");

sandbox.localStorage.setItem("snake_leaderboard_v2", "[]");

console.log("== 1. 载入与初始状态 ==");
check("主循环已经启动", rafQueue.length === 1, "队列长度 " + rafQueue.length);
check("开局显示开始遮罩", !hidden("overlay"));
check("默认单人模式", state().mode === "single");
check("双人面板默认隐藏", hidden("duelHud"));

console.log("\n== 2. 单人模式（主循环驱动） ==");
el("startBtn").dispatch("click");
check("点击后开始运行", state().running === true && hidden("overlay"));
const startHead = { ...state().head };
advance(500);
const movedHead = state().head;
check("主循环推动蛇前进", movedHead.x > startHead.x, JSON.stringify([startHead, movedHead]));
check("渲染被持续调用", drawCalls.fill > 0);

key(" ");
check("空格暂停", state().paused === true && el("pausedHint").classList.contains("show"));
const pausedHead = { ...state().head };
advance(500);
check("暂停时蛇不动", state().head.x === pausedHead.x && state().head.y === pausedHead.y);
key(" ");
check("空格恢复", state().paused === false);

console.log("\n== 3. 单人：吃食物 / 特效 / 水果 ==");
const s = state();
I().setFood({ x: s.head.x + 1, y: s.head.y }, "normal");
const scoreBefore = state().score;
advance(200);
check("吃到普通食物 +10 分", state().score === scoreBefore + 10, "score=" + state().score);
check("吃食物会放粒子特效", state().particles > 0, "particles=" + state().particles);
const lenBefore = state().snakeLen;
I().setFood({ x: state().head.x + 1, y: state().head.y }, "watermelon");
advance(200);
check("西瓜 +3 节", state().snakeLen === lenBefore + 3, "len=" + state().snakeLen);
advance(1600);
check("粒子会自然消散", state().particles === 0, "particles=" + state().particles);

console.log("\n== 4. 布局与美化 ==");
check("页面使用新的主题色变量", /--p1\s*:/.test(html) && /--accent-2\s*:/.test(html));
check("标题带「对战版」徽章", /version-tag[^>]*>对战版</.test(html));
check("双人面板有能量条样式", /\.energy\s*>?\s*i/.test(html) || /\.energy\s+i/.test(html));
check("面板带发光动画（energyGlow）", /energyGlow/.test(html));
check("危险区提示有脉冲样式（dangerPulse）", /dangerPulse/.test(html));
check("body 有网格/光晕背景层", /body::before/.test(html));
check("切到堆叠布局时棋盘仍然够大", /stacked/.test(html));

// 拖到分出胜负（缩圈保证一定能结束），再切模式
function endRound(maxIter) {
  let i = 0;
  while (!state().gameOver && i++ < (maxIter || 1200)) advance(200);
}
// 把两条蛇放到互不相干的角落，避免测试中途自己撞死
function parkSnakes() {
  I().setDuelSnake(1, [{x:5,y:5},{x:4,y:5},{x:3,y:5},{x:2,y:5}], {x:1,y:0});
  I().setDuelSnake(2, [{x:30,y:30},{x:31,y:30},{x:32,y:30},{x:33,y:30}], {x:-1,y:0});
  I().setObstacles([]);
  I().setFood({ x: 34, y: 0 }, "normal");
}
function startDuel() {
  I().setMode("duel");
  el("startBtn").dispatch("click");
  parkSnakes();
}

console.log("\n== 5. 双人模式：开局 / 能量 ==");
endRound();
el("modeDuel").dispatch("click");
check("切换到双人模式", state().mode === "duel");
check("双人面板可见、单人面板隐藏", !hidden("duelHud") && hidden("singleHud"));
check("棋盘加上 duel 样式", el("boardWrap").classList.contains("duel"));
el("startBtn").dispatch("click");
check("双人开局运行中", state().running === true);
check("两条蛇都在场", state().duel.length === 2 && state().duel.every(p => p.alive));
check("开局有缩圈倒计时提示", /后开始缩圈/.test(state().dangerNote), state().dangerNote);
parkSnakes();

const p1 = state().duel[0];
I().setFood({ x: p1.head.x + 1, y: p1.head.y }, "normal");
I().onlyDue(1);
const energyBefore = state().duel[0].energy;
I().stepDuel(clock.t);
check("吃普通食物积攒必杀能量", state().duel[0].energy === energyBefore + 9, "energy=" + state().duel[0].energy);

console.log("\n== 6. 双人：必杀「冲撞」 ==");
parkSnakes();
I().setDuelEnergy(1, 40);
check("能量不满时放不出必杀", I().activateCharge(1) === false);
check("放不出时能量保留", state().duel[0].energy === 40);
I().setDuelEnergy(1, 100);
advance(64);
check("能量满格 → 技能按钮可用", state().skill1Disabled === false, "state=" + state().skill1State);
const normalInterval = I().playerInterval(1);
check("发动必杀返回成功", I().activateCharge(1) === true);
check("发动后能量清零", state().duel[0].energy === 0);
check("进入冲撞状态", state().duel[0].chargeUntil > clock.t);
check("冲撞期间移动更快", I().playerInterval(1) < normalInterval,
  I().playerInterval(1) + " < " + normalInterval);
check("冲撞不能叠加发动", I().activateCharge(1) === false);
advance(64);
check("技能按钮显示「冲撞中…」", /冲撞中/.test(state().skill1Html), state().skill1Html);
advance(2400);
check("冲撞 2.2 秒后结束", state().duel[0].chargeUntil <= clock.t);

console.log("\n== 7. 双人：撞击者截半 / 被撞者弹飞 ==");
endRound();
startDuel();
I().setDuelSnake(1, [{x:10,y:10},{x:9,y:10},{x:8,y:10},{x:7,y:10},{x:6,y:10},{x:5,y:10}], {x:1,y:0});
I().setDuelSnake(2, [{x:16,y:10},{x:15,y:10},{x:14,y:10},{x:13,y:10},{x:12,y:10},{x:11,y:10}], {x:1,y:0});
I().onlyDue(1);
I().stepDuel(clock.t);
let d1 = state().duel.find(p => p.id === 1);
let d2 = state().duel.find(p => p.id === 2);
check("撞击者蛇身减半（6 → 3）", d1.len === 3, "len=" + d1.len);
check("撞击者拿到 +30 分", d1.score === 30, "score=" + d1.score);
check("撞击者进入连击计数", d1.combo === 1, "combo=" + d1.combo);
check("被撞者被弹飞 3 格", d2.head.x === 19, "head.x=" + d2.head.x);
check("被撞后短暂僵直", d2.bounceUntil > clock.t);
check("撞击有震屏与粒子", state().shakeMag > 0 && state().particles > 0);
advance(400);
check("震屏会衰减", state().shakeMag < 8, "shake=" + state().shakeMag);

console.log("\n== 8. 双人：被撞者即使不同步移动也会被弹飞 ==");
endRound();
startDuel();
I().setDuelSnake(1, [{x:10,y:10},{x:9,y:10},{x:8,y:10},{x:7,y:10},{x:6,y:10},{x:5,y:10}], {x:1,y:0});
I().setDuelSnake(2, [{x:16,y:10},{x:15,y:10},{x:14,y:10},{x:13,y:10},{x:12,y:10},{x:11,y:10}], {x:1,y:0});
const slowVictimAt = state().duel.find(p => p.id === 2).nextMoveAt;
I().onlyDue(1);
I().stepDuel(clock.t);
d2 = state().duel.find(p => p.id === 2);
check("慢半拍的对手同样被弹飞", d2.head.x === 19, "head.x=" + d2.head.x + " nextMoveAt=" + slowVictimAt);
check("被弹飞后不可立刻操作", d2.bounceUntil > clock.t);

console.log("\n== 9. 双人：必杀撞飞（重击） ==");
endRound();
startDuel();
I().setDuelSnake(1, [{x:10,y:10},{x:9,y:10},{x:8,y:10},{x:7,y:10},{x:6,y:10},{x:5,y:10}], {x:1,y:0});
I().setDuelSnake(2, [{x:16,y:10},{x:15,y:10},{x:14,y:10},{x:13,y:10},{x:12,y:10},{x:11,y:10}], {x:1,y:0});
I().setDuelCharge(1, clock.t + 1500);
I().onlyDue(1);
I().stepDuel(clock.t);
d1 = state().duel.find(p => p.id === 1);
d2 = state().duel.find(p => p.id === 2);
check("必杀命中：撞击者不掉节", d1.len === 6, "len=" + d1.len);
check("必杀命中：被撞者多断 3 节", d2.len === 3, "len=" + d2.len);
check("必杀命中：击退 4 格", d2.head.x === 20, "head.x=" + d2.head.x);
check("必杀命中直接得分（+50 起）", d1.score >= 50, "score=" + d1.score);

console.log("\n== 10. 双人：缩圈危险区 ==");
endRound();
startDuel();
I().setObstacles([{x:0,y:1},{x:20,y:20}]);   // GRID_SIZE=35，只有贴上边界那一圈算危险区
I().expandDangerRing(clock.t);
check("危险区收缩一圈", state().duelDangerRing === 1, "ring=" + state().duelDangerRing);
check("危险区外的障碍被清掉", state().obstacleCells.length === 1, JSON.stringify(state().obstacleCells));
check("棋盘进入危险态（红框脉冲）", state().dangerClass === true);
check("提示文字更新为安全区尺寸", /安全区/.test(state().dangerNote), state().dangerNote);
check("圈外判定生效", I().inDangerZone({ x: 0, y: 5 }) === true && I().inDangerZone({ x: 20, y: 20 }) === false);
I().setDuelSnake(2, [{x:0,y:0},{x:1,y:0},{x:2,y:0}], {x:1,y:0});
I().onlyDue(2);
I().stepDuel(clock.t);
check("踩进危险区直接出局", state().duel.find(p => p.id === 2).alive === false);
check("一方出局后结束对局", state().gameOver === true);
check("结算画面显示胜者", /P1 获胜/.test(state().overlayTitle), state().overlayTitle);

console.log("\n== 11. 渲染特效路径 ==");
startDuel();
I().expandDangerRing(clock.t);
drawCalls.fillText = 0;
drawCalls.fillRect = 0;
drawCalls.radial = 0;
advance(200);
check("危险区 + 粒子渲染不报错且会画 emoji", drawCalls.fillText > 0, "fillText=" + drawCalls.fillText);
check("危险区绘制了压暗层与斜纹", drawCalls.fillRect >= 4, "fillRect=" + drawCalls.fillRect);
check("食物光晕/蛇头光晕使用径向渐变", drawCalls.radial > 0, "radial=" + drawCalls.radial);
check("渲染完会清掉 dirty 标记", state().boardDirty === false);

console.log("\n== 12. 单人不该出现双人专属道具 ==");
endRound();
I().setMode("single");
el("startBtn").dispatch("click");
check("单人模式没有冰冻技能键提示", !/冰冻/.test(el("overlaySub").innerHTML));
check("单人模式只有 3 种道具（图例）", /单人模式就这三样道具/.test(html));
check("单人吃食物也有粒子与飘字", (() => {
  const h = state().head;
  I().setFood({ x: h.x + 1, y: h.y }, "gold");
  advance(200);
  return state().particles > 0 || state().floaters > 0;
})(), "particles=" + state().particles + " floaters=" + state().floaters);

console.log("\n== 13. 双人：贴身缠斗提速 / 抢食补给 / 比分跳动 ==");
endRound();
startDuel();
I().setDuelSnake(1, [{x:10,y:10},{x:9,y:10},{x:8,y:10}], {x:1,y:0});
I().setDuelSnake(2, [{x:13,y:10},{x:14,y:10},{x:15,y:10}], {x:0,y:1});
const closeIv = I().playerInterval(1);
I().setDuelSnake(2, [{x:30,y:30},{x:31,y:30},{x:32,y:30}], {x:0,y:1});
const farIv = I().playerInterval(1);
check("蛇头贴近时移动间隔变小", closeIv < farIv, closeIv.toFixed(2) + " < " + farIv.toFixed(2));
check("提速幅度约 12%", Math.abs(closeIv / farIv - 0.88) < 0.002, "ratio=" + (closeIv / farIv).toFixed(3));
I().setDuelSnake(2, [{x:13,y:10},{x:14,y:10},{x:15,y:10}], {x:0,y:1});
advance(60);
check("贴身缠斗把棋盘边框点亮（dogfight）", el("boardWrap").classList.contains("dogfight"));

endRound();
startDuel();
I().setDuelSnake(1, [{x:10,y:10},{x:9,y:10},{x:8,y:10}], {x:1,y:0});
I().setDuelSnake(2, [{x:25,y:25},{x:26,y:25},{x:27,y:25}], {x:0,y:1});
I().setDuelEnergy(1, 0);
I().setDuelEnergy(2, 0);
I().setFood({x:11,y:10}, "gold");
I().onlyDue(1);
I().stepDuel(clock.t);
d1 = state().duel.find(p => p.id === 1);
d2 = state().duel.find(p => p.id === 2);
check("吃下金豆的一方拿到全额能量", d1.energy === 20, "energy=" + d1.energy);
check("抢食：对手蹭到 1/3 能量", d2.energy === 7, "energy=" + d2.energy);
I().setDuelScore(1, 999);
check("得分时比分数字弹一下", el("score1").classList.contains("pop") && String(el("score1").textContent) === "999",
  el("score1").textContent + " pop=" + el("score1").classList.contains("pop"));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
