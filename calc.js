// Калькулятор-лента (в духе CalcTape). Перенесено из src/Calc.cs.
"use strict";

class CalcError extends Error {}

const TOTAL_WORDS = ["=", "итого", "итог", "сумма", "всего", "sum", "total"];
const RESERVED = ["ans", "pi", "π", "e"];
const ASSIGN_RX = /^([\p{L}_][\p{L}\p{Nd}_]*)\s*=(?!=)\s*(.+)$/u;
const CHAIN_OPS = "+-−*×·/÷:^";
const isLetter = c => /[\p{L}_]/u.test(c);
const isLetterOrDigit = c => /[\p{L}\p{Nd}_]/u.test(c);
const isDigit = c => c >= "0" && c <= "9";

class CalcEngine {
  constructor() {
    this.vars = new Map();       // ключ — имя в нижнем регистре: { name, value }
    this.prev = null;            // результат предыдущей строки (ans)
    this.lineValues = [];
  }

  hasVar(name) { return this.vars.has(name.toLowerCase()); }
  setVar(name, value) { this.vars.set(name.toLowerCase(), { name, value }); }

  // lines: [{ note, expr }] → [{ value, error, isTotal, variable }]
  run(lines) {
    this.vars.clear();
    this.lineValues = [];
    this.prev = null;
    const results = [];
    let block = [];
    let prevInBlock = false, prevFailed = false;

    for (const line of lines) {
      const r = { value: null, error: null, isTotal: false, variable: null };
      results.push(r);
      let expr = (line.expr || "").trim();

      if (expr === "") {
        // пустая строка без заметки начинает новый блок; строка с одной заметкой — комментарий
        if ((line.note || "").trim() === "") { this.prev = null; block = []; prevInBlock = false; prevFailed = false; }
        this.lineValues.push(null);
        continue;
      }

      if (TOTAL_WORDS.includes(expr.toLowerCase())) {
        const sum = block.reduce((s, x) => s + x, 0);
        r.value = sum;
        r.isTotal = true;
        this.prev = sum;
        block = [];
        prevInBlock = false;
        prevFailed = false;
        this.setNoteVar(line.note, sum);
        this.lineValues.push(sum);
        continue;
      }

      const m = ASSIGN_RX.exec(expr);
      if (m) { r.variable = m[1]; expr = m[2].trim(); }

      const startsWithOp = CHAIN_OPS.includes(expr[0]);
      const chain = this.prev !== null && startsWithOp;
      try {
        if (startsWithOp && prevFailed) throw new CalcError("Продолжение строки с ошибкой — исправьте строку выше");
        if (r.variable && RESERVED.includes(r.variable.toLowerCase())) throw new CalcError("Имя «" + r.variable + "» зарезервировано");
        const v = this.evaluate(chain ? "ans " + expr : expr);
        r.value = v;
        if (r.variable) this.setVar(r.variable, v);
        else if (chain && prevInBlock) block[block.length - 1] = v;
        else block.push(v);
        prevInBlock = !r.variable;
        this.prev = v;
        prevFailed = false;
        this.setNoteVar(line.note, v);
        this.lineValues.push(v);
      } catch (ex) {
        if (!(ex instanceof CalcError)) throw ex;
        r.error = ex.message;
        this.prev = null;
        prevFailed = true;
        prevInBlock = false;
        this.lineValues.push(null);
      }
    }
    return results;
  }

  // Заметка строки становится именем её результата: «Скорость звука» → Скорость_звука
  setNoteVar(note, value) {
    const name = CalcEngine.nameFromNote(note);
    if (name) this.setVar(name, value);
  }

  static nameFromNote(note) {
    let name = "";
    for (const c of (note || "").trim()) name += isLetterOrDigit(c) ? c : "_";
    name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (name === "" || isDigit(name[0])) return null;
    const lower = name.toLowerCase();
    if (RESERVED.includes(lower) || TOTAL_WORDS.includes(lower)) return null;
    return name;
  }

  evaluate(s) { return new Parser(s, this).parse(); }

  lineValue(n) {
    if (n < 1 || n > this.lineValues.length) throw new CalcError("Строка @" + n + " ещё не посчитана (ссылаться можно только на строки выше)");
    const v = this.lineValues[n - 1];
    if (v === null) throw new CalcError("В строке @" + n + " нет результата");
    return v;
  }

  getVar(name) {
    const v = this.vars.get(name.toLowerCase());
    if (v) return v.value;
    switch (name.toLowerCase()) {
      case "ans":
        if (this.prev === null) throw new CalcError("Нет результата предыдущей строки");
        return this.prev;
      case "pi": case "π": return Math.PI;
      case "e": return Math.E;
    }
    throw new CalcError("Неизвестная переменная «" + name + "»");
  }

  call(name, a) {
    const f = name.toLowerCase();
    const need = n => { if (a.length !== n) throw new CalcError(f + ": нужно аргументов — " + n + " (разделитель «;»)"); };
    const atLeast = n => { if (a.length < n) throw new CalcError(f + ": нужен хотя бы " + n + " аргумент"); };
    const positive = x => { if (x <= 0) throw new CalcError(f + ": аргумент должен быть больше нуля"); };
    const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;

    switch (f) {
      case "min": atLeast(1); return Math.min(...a);
      case "max": atLeast(1); return Math.max(...a);
      case "sum": atLeast(1); return a.reduce((s, x) => s + x, 0);
      case "avg": case "среднее": atLeast(1); return a.reduce((s, x) => s + x, 0) / a.length;
      case "round": {
        if (a.length === 1) return roundDec(a[0], 0);
        need(2);
        const digits = Math.trunc(a[1]);
        if (digits < 0 || digits > 15) throw new CalcError("round: число знаков 0…15");
        return roundDec(a[0], digits);
      }
      case "log":
        if (a.length === 2) { positive(a[0]); positive(a[1]); return Math.log(a[0]) / Math.log(a[1]); }
        need(1); positive(a[0]); return Math.log10(a[0]);
      case "pow": need(2); return Math.pow(a[0], a[1]);
      case "hypot": need(2); return Math.hypot(a[0], a[1]);
      case "root": case "корень":
        if (a.length === 2) return root(a[0], a[1]);
        break;   // root(x) — квадратный, ниже
    }

    need(1);
    const x = a[0];
    switch (f) {
      case "sqrt": case "root": case "корень":
        if (x < 0) throw new CalcError("Корень из отрицательного числа");
        return Math.sqrt(x);
      case "cbrt": return Math.cbrt(x);
      case "abs": case "модуль": return Math.abs(x);
      case "ln": positive(x); return Math.log(x);
      case "lg": positive(x); return Math.log10(x);
      case "log2": positive(x); return Math.log2(x);
      case "exp": return Math.exp(x);
      case "sin": return Math.sin(rad(x));
      case "cos": return Math.cos(rad(x));
      case "tan": case "tg": return Math.tan(rad(x));
      case "asin": case "arcsin": return deg(Math.asin(x));
      case "acos": case "arccos": return deg(Math.acos(x));
      case "atan": case "arctg": return deg(Math.atan(x));
      case "floor": return Math.floor(x);
      case "ceil": return Math.ceil(x);
      case "trunc": return Math.trunc(x);
      case "rad": return rad(x);
      case "deg": return deg(x);
      case "fact": return factorial(x);
    }
    throw new CalcError("Неизвестная функция «" + name + "»");
  }
}

// Корень степени n из x; для нечётной целой степени допускается отрицательное x: root(-8; 3) = -2
function root(x, n) {
  if (n === 0) throw new CalcError("root: степень корня не может быть 0");
  if (x >= 0) return Math.pow(x, 1 / n);
  const oddInteger = Number.isInteger(n) && Math.abs(n) % 2 === 1;
  if (!oddInteger) throw new CalcError("root: корень чётной степени из отрицательного числа");
  return -Math.pow(-x, 1 / n);
}

function factorial(x) {
  if (x < 0 || x !== Math.floor(x)) throw new CalcError("Факториал — только для целых чисел ≥ 0");
  if (x > 170) throw new CalcError("Слишком большой факториал");
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return r;
}

// Рекурсивный спуск. Процент: a + b% = a·(1 + b/100), a − b% = a·(1 − b/100), a × b% = a·b/100.
class Parser {
  constructor(s, eng) { this.s = s; this.eng = eng; this.pos = 0; this.pct = false; }

  parse() {
    let v = this.add();
    if (this.pct) { v /= 100; this.pct = false; }
    this.skip();
    if (this.pos < this.s.length)
      throw new CalcError(this.s[this.pos] === ")" ? "Лишняя закрывающая скобка" : "Непонятный символ «" + this.s[this.pos] + "»");
    return check(v);
  }

  peek(k = 0) { return this.pos + k < this.s.length ? this.s[this.pos + k] : "\0"; }
  skip() { while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++; }

  add() {
    let left = this.mul();
    if (this.pct) { left /= 100; this.pct = false; }
    for (;;) {
      this.skip();
      const c = this.peek();
      if (c !== "+" && c !== "-" && c !== "−") break;
      this.pos++;
      let r = this.mul();
      if (this.pct) { r = left * r / 100; this.pct = false; }
      left = c === "+" ? left + r : left - r;
    }
    return left;
  }

  mul() {
    let left = this.unary();
    let single = true, p = this.pct;
    this.pct = false;
    for (;;) {
      this.skip();
      const c = this.peek();
      const div = c === "/" || c === "÷" || c === ":";
      if (!div && c !== "*" && c !== "×" && c !== "·") break;
      this.pos++;
      if (p) { left /= 100; p = false; }
      single = false;
      let r = this.unary();
      if (this.pct) { r /= 100; this.pct = false; }
      if (div) {
        if (r === 0) throw new CalcError("Деление на ноль");
        left /= r;
      } else left *= r;
    }
    this.pct = single && p;
    return left;
  }

  unary() {
    this.skip();
    const c = this.peek();
    if (c === "-" || c === "−") { this.pos++; return -this.unary(); }
    if (c === "+") { this.pos++; return this.unary(); }
    if (c === "√") {
      this.pos++;
      let v = this.unary();
      if (this.pct) { v /= 100; this.pct = false; }
      if (v < 0) throw new CalcError("Корень из отрицательного числа");
      return Math.sqrt(v);
    }
    return this.pow();
  }

  pow() {
    let b = this.postfix();
    this.skip();
    if (this.peek() !== "^") return b;
    this.pos++;
    if (this.pct) { b /= 100; this.pct = false; }
    let ex = this.unary();
    if (this.pct) { ex /= 100; this.pct = false; }
    return check(Math.pow(b, ex));
  }

  postfix() {
    let v = this.primary();
    for (;;) {
      this.skip();
      const c = this.peek();
      if (c === "%") { this.pos++; this.pct = true; }
      else if (c === "²") { this.pos++; v = v * v; }
      else if (c === "³") { this.pos++; v = v * v * v; }
      else if (c === "!") { this.pos++; v = factorial(v); }
      else break;
    }
    return v;
  }

  primary() {
    this.skip();
    const c = this.peek();
    if (c === "(") {
      this.pos++;
      let v = this.add();
      if (this.pct) { v /= 100; this.pct = false; }
      this.expect(")");
      return v;
    }
    if (isDigit(c) || ((c === "." || c === ",") && isDigit(this.peek(1)))) return this.number();
    if (c === "@") {
      this.pos++;
      const start = this.pos;
      while (isDigit(this.peek())) this.pos++;
      if (this.pos === start) throw new CalcError("После @ нужен номер строки, например @3");
      return this.eng.lineValue(Number(this.s.slice(start, this.pos)));
    }
    if (isLetter(c)) {
      const start = this.pos;
      while (isLetterOrDigit(this.peek())) this.pos++;
      const id = this.multiWordName(this.s.slice(start, this.pos));
      this.skip();
      if (this.peek() !== "(") return this.eng.getVar(id);
      this.pos++;
      const args = [];
      this.skip();
      if (this.peek() !== ")") {
        for (;;) {
          let a = this.add();
          if (this.pct) { a /= 100; this.pct = false; }
          args.push(a);
          this.skip();
          if (this.peek() === ";" || this.peek() === ",") { this.pos++; continue; }
          break;
        }
      }
      this.expect(")");
      return check(this.eng.call(id, args));
    }
    if (this.pos >= this.s.length) throw new CalcError("Выражение не закончено");
    throw new CalcError("Непонятный символ «" + c + "»");
  }

  // Имя можно писать с пробелами, как в заметке: «скорость звука» найдёт переменную скорость_звука.
  multiWordName(first) {
    const words = [first], ends = [this.pos];
    let p = this.pos;
    const s = this.s;
    while (words.length < 10) {
      let q = p;
      while (q < s.length && /\s/.test(s[q])) q++;
      if (q === p || q >= s.length || !isLetterOrDigit(s[q])) break;
      const ws = q;
      while (q < s.length && isLetterOrDigit(s[q])) q++;
      words.push(s.slice(ws, q));
      ends.push(q);
      p = q;
    }
    for (let k = words.length; k >= 2; k--) {
      const candidate = words.slice(0, k).join("_");
      if (this.eng.hasVar(candidate)) { this.pos = ends[k - 1]; return candidate; }
    }
    return first;
  }

  number() {
    const start = this.pos;
    while (isDigit(this.peek())) this.pos++;
    if ((this.peek() === "." || this.peek() === ",") && isDigit(this.peek(1))) {
      this.pos++;
      while (isDigit(this.peek())) this.pos++;
    }
    if ((this.peek() === "e" || this.peek() === "E") &&
        (isDigit(this.peek(1)) || ((this.peek(1) === "+" || this.peek(1) === "-") && isDigit(this.peek(2))))) {
      this.pos += 2;
      while (isDigit(this.peek())) this.pos++;
    }
    return Number(this.s.slice(start, this.pos).replace(",", "."));
  }

  expect(c) {
    this.skip();
    if (this.peek() !== c) throw new CalcError("Не хватает «" + c + "»");
    this.pos++;
  }
}

function check(v) {
  if (Number.isNaN(v)) throw new CalcError("Результат не определён");
  if (!isFinite(v)) throw new CalcError("Слишком большое число");
  return v;
}
