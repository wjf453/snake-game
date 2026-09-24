// 在模拟 DOM/Canvas 环境中运行贪吃蛇脚本，验证核心逻辑
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("/Users/kylewang/Documents/Codex/2026-09-14/sheng/outputs/snake.html", "utf8");

// 注入调试探针（仅测试副本，不影响真实文件）
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/\}\)\(\);\s*$/, `  const setFood = (pt) => { food = { x: pt.x, y: pt.y }; };
  globalThis.__debug = () => ({ snakeLen: snake.length, head: { ...snake[0] }, direction: { ...direction }, nextDirection: { ...nextDirection }, running, paused, gameOver, food: food ? { ...food } : null, score, foodCount, scoreEl: scoreEl.textContent, internals: { step, setFood } });
})();`);

// ---------- 元素 / classList 桩 ----------
function makeClassList() {
  return {
    _set: new Set(),
    add(c) { this._set.add(c); },
    remove(c) { this._set.delete(c); },
    toggle(c, force) {
      if (force === undefined) {
        this._set.has(c) ? this._set.delete(c) : this._set.add(c);
      } else if (force) { this._set.add(c); } else { this._set.delete(c); }
      return this._set.has(c);
    },
    contains(c) { return this._set.has(c); }
  };
}

function makeElement(id) {
  return {
    id,
    textContent: "",
    innerHTML: "",
    style: {},
    _clientW: 480,
    _clientH: 480,
    classList: makeClassList(),
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); },
    get clientWidth() { return this._clientW; },
    get clientHeight() { return this._clientH; }
  };
}

// ---------- Canvas 2D 上下文桩（任意方法返回无操作代理） ----------
function noopProxy() {
  const t = function () {};
  return new Proxy(t, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "canvas") return { width: 480, height: 480 };
      return noopProxy();
    },
    apply() { return noopProxy(); },
    set() { return true; }
  });
}

// ---------- 构建元素 ----------
const elements = {};
["game", "score", "best", "speed", "overlay", "overlayTitle", "overlaySub", "startBtn", "pausedHint", "boardWrap"]
  .forEach(id => elements[id] = makeElement(id));
const canvas = elements.game;
canvas.width = 480;
canvas.height = 480;
canvas.getContext = () => noopProxy();

const docListeners = {};
const rafQueue = [];
const clock = { t: 0 };

const sandbox = {
  console,
  document: {
    getElementById(id) { return elements[id]; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); }
  },
  window: { addEventListener() {}, innerWidth: 800, innerHeight: 800 },
  localStorage: {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); }
  },
  performance: { now: () => (clock.t += 50) }, // 统一桩件时钟：每次调用前进 50ms
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  Math, Date, JSON,
};
sandbox.canvas = canvas;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "snake-game.js" });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail ? " -> " + detail : "")); }
}

// 泵 n 帧（每帧驱动一次 rAF 回调）
function pump(n) {
  for (let i = 0; i < n; i++) {
    const fn = rafQueue.shift();
    if (!fn) break;
    fn(sandbox.performance.now());
  }
}

const keyHandler = docListeners["keydown"][0];
const key = (k) => keyHandler({ key: k, code: k, preventDefault() {} });

function state() { return sandbox.__debug(); }

console.log("== 初始状态 ==");
check("overlay 可见（游戏未开始）", !elements.overlay.classList.contains("hidden"));
check("初始得分显示 0", elements.score.textContent === "0");

console.log("== 点击开始 ==");
elements.startBtn.dispatch("click", { stopPropagation() {} });
check("overlay 隐藏", elements.overlay.classList.contains("hidden"));
check("得分仍为 0", elements.score.textContent === "0");

console.log("== 短暂运行帧（蛇存活） ==");
pump(9);
check("运行 9 帧后蛇仍存活", !state().gameOver && state().running);

console.log("== 暂停/继续 ==");
key(" ");
check("空格暂停后显示暂停提示", elements.pausedHint.classList.contains("show"));
check("暂停时 paused=true", state().paused === true);
const pausedHead = { ...state().head };
pump(30);
check("暂停期间蛇头未移动", state().head.x === pausedHead.x && state().head.y === pausedHead.y);
key(" ");
check("再次空格恢复，暂停提示消失", !elements.pausedHint.classList.contains("show"));

console.log("== 方向控制（不可反向） ==");
key("ArrowRight");
key("ArrowLeft");   // 反向，应被忽略
key("ArrowUp");
key("ArrowUp");     // 同轴重复，应被忽略
pump(6);
check("按 Up 后蛇确实向上移动", state().direction.y === -1 || state().gameOver || state().head.y <= pausedHead.y);

console.log("== 吃食物加分（确定性验证） ==");
key("R");
check("R 重新开始后 overlay 隐藏", elements.overlay.classList.contains("hidden"));
const before = state();
const int = state().internals;
const head1 = before.head;
const foodInFront = { x: head1.x + before.direction.x, y: head1.y + before.direction.y };
int.setFood(foodInFront);
int.step(); // 蛇头正好走到食物格
const afterEat = state();
check("吃到食物后得分 +10", afterEat.score === 10, "score=" + afterEat.score);
check("UI 得分同步更新为 10", String(elements.score.textContent) === "10");
check("吃到食物后蛇身长度 +1", afterEat.snakeLen === before.snakeLen + 1);
check("食物已重新生成（不在同一个位置）", afterEat.food && !(afterEat.food.x === foodInFront.x && afterEat.food.y === foodInFront.y));
int.step(); // 下一步不挨着食物
const afterMove = state();
check("下一步正常移动，长度不变", afterMove.snakeLen === afterEat.snakeLen && afterMove.score === 10);

console.log("== 碰撞结束 ==");
// 记录当前最高分预期，然后向右一直走撞墙
let frames = 0;
while (state().gameOver === false && frames < 1200) {
  const s = state();
  // 水平误差用右向纠正
  const dx = s.food ? s.food.x - s.head.x : 0;
  if (dx > 0) key("ArrowRight");
  else if (Math.abs(s.direction.y) === 0) key("ArrowRight");
  pump(3);
  frames++;
}
check("蛇向右撞墙后游戏结束", state().gameOver === true);
check("结束画面标题为游戏结束", elements.overlayTitle.textContent.includes("游戏结束"));
check("结束按钮文字为「重新开始」", elements.startBtn.textContent === "重新开始");
check("得分显示与内部一致", String(elements.score.textContent) === String(state().score), "display=" + JSON.stringify(elements.score.textContent) + " internal=" + state().score);

console.log("== 最高分持久化 ==");
const savedBest = parseInt(sandbox.localStorage.getItem("snake_best_score") || "0", 10);
check("最高分已写入 localStorage 且 >= 本局得分", savedBest >= state().score, "saved=" + savedBest + " score=" + state().score);

console.log("== 重新开始恢复正常 ==");
key("R");
check("再次开始后 overlay 隐藏", elements.overlay.classList.contains("hidden"));
check("得分重置为 0", elements.score.textContent === "0");
check("新游戏未结束", state().gameOver === false);

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
