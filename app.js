// Интерфейс веб-версии. Логика расчётов повторяет Windows-версию (src/MainForm.cs, src/CalcTab.cs).
"use strict";

// ================= помощники =================

function el(tag, props, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value" || (k in e && typeof v !== "string")) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

const store = {
  get(k, def) {
    try { const v = localStorage.getItem("uc." + k); return v === null ? def : JSON.parse(v); } catch (_) { return def; }
  },
  set(k, v) { try { localStorage.setItem("uc." + k, JSON.stringify(v)); } catch (_) { } }
};

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
}

function copyText(s) {
  if (!s || s === "—") return;
  const done = () => toast("Скопировано");
  const fallback = () => {
    const ta = el("textarea", { value: s, style: "position:fixed;opacity:0" });
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (_) { toast("Не удалось скопировать"); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, fallback);
  else fallback();
}

function field(label, control, hint) {
  return el("div", { class: "field" }, el("label", { text: label }), control, hint ? el("div", { class: "hint", text: hint }) : null);
}

// Числовое поле с кнопкой ± (на цифровой клавиатуре iPhone нет минуса)
function numField(value, onInput) {
  const input = el("input", { type: "text", inputmode: "decimal", autocomplete: "off", value: value });
  input.addEventListener("input", onInput);
  const pm = el("button", {
    class: "btn pm", type: "button", text: "±", title: "Сменить знак",
    onclick: () => {
      const v = input.value.trim();
      input.value = v.startsWith("-") || v.startsWith("−") ? v.slice(1) : "-" + v;
      input.dispatchEvent(new Event("input"));
    }
  });
  const wrap = el("div", { class: "row" }, el("div", { class: "grow" }, input), pm);
  wrap.input = input;
  return wrap;
}

function select(options, onChange) {
  const s = el("select", { onchange: onChange });
  for (const o of options) {
    if (o.group) {
      const g = el("optgroup", { label: o.group });
      for (const x of o.items) g.append(el("option", { value: x.value, text: x.text }));
      s.append(g);
    } else s.append(el("option", { value: o.value, text: o.text }));
  }
  return s;
}

function unitOptions(cat) { return cat.units.map((u, i) => ({ value: String(i), text: u.name })); }

function resultBox(label) {
  const val = el("div", { class: "val" });
  const box = el("div", { class: "result" },
    el("div", { class: "grow" }, el("div", { class: "lbl", text: label }), val),
    el("button", { class: "btn small", type: "button", text: "Копировать", onclick: () => copyText(box.copy) }));
  box.set = (text, copy) => { val.textContent = text; box.copy = copy; };
  return box;
}

const settings = store.get("settings", {});
function saveSettings() { store.set("settings", settings); }

// ================= вкладки =================

const tabButtons = [...document.querySelectorAll(".tabbar button")];
function showTab(id) {
  for (const b of tabButtons) {
    const on = b.dataset.tab === id;
    b.classList.toggle("on", on);
    document.getElementById(b.dataset.tab).hidden = !on;
    if (on) document.getElementById("title").textContent = b.dataset.title;
  }
  settings.tab = id;
  saveSettings();
  window.scrollTo(0, 0);
}
for (const b of tabButtons) b.addEventListener("click", () => showTab(b.dataset.tab));

const digitsOf = () => settings.digits || 8;

// ================= 1. Конвертер =================

const conv = {};
(function buildConverter() {
  const sec = document.getElementById("conv");
  conv.memory = settings.units || {};
  conv.cat = select(AllCategories.map((c, i) => ({ value: String(i), text: c.name })), () => loadCategory());
  conv.value = numField("1", () => recalcConv());
  conv.from = select([], () => recalcConv());
  conv.to = select([], () => recalcConv());
  conv.result = resultBox("Результат");
  conv.info = el("div", { class: "info" });
  conv.digits = select(Array.from({ length: 13 }, (_, i) => ({ value: String(i + 3), text: (i + 3) + " значащих цифр" })), () => {
    settings.digits = Number(conv.digits.value);
    saveSettings();
    recalcAll();
  });
  conv.digits.value = String(digitsOf());
  conv.list = el("ul", { class: "list" });

  sec.append(
    field("Величина", conv.cat),
    field("Значение", conv.value),
    field("Из", conv.from),
    el("div", { class: "swap" }, el("button", {
      class: "btn small", type: "button", text: "⇅ Поменять", onclick: () => {
        const a = conv.from.value; conv.from.value = conv.to.value; conv.to.value = a; recalcConv();
      }
    })),
    field("В", conv.to),
    conv.result,
    conv.info,
    field("Точность", conv.digits),
    conv.list,
    el("div", { class: "hint", text: "Нажмите на строку списка, чтобы перевести в эту единицу." })
  );

  const idx = AllCategories.findIndex(c => c.name === settings.category);
  conv.cat.value = String(idx >= 0 ? idx : 0);
  loadCategory();
})();

function loadCategory() {
  const c = AllCategories[Number(conv.cat.value)];
  conv.current = c;
  for (const s of [conv.from, conv.to]) {
    s.replaceChildren(...unitOptions(c).map(o => el("option", { value: o.value, text: o.text })));
  }
  const sel = conv.memory[c.name] || [c.defaultFrom, c.defaultTo];
  conv.from.value = String(Math.min(sel[0], c.units.length - 1));
  conv.to.value = String(Math.min(sel[1], c.units.length - 1));
  conv.list.replaceChildren(...c.units.map((u, i) => {
    const li = el("li", { onclick: () => { conv.to.value = String(i); recalcConv(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
      el("span", { class: "n", text: u.name }), el("span", { class: "v" }));
    return li;
  }));
  settings.category = c.name;
  saveSettings();
  recalcConv();
}

function recalcConv() {
  const c = conv.current;
  const fromIndex = Number(conv.from.value), toIndex = Number(conv.to.value);
  const from = c.units[fromIndex], to = c.units[toIndex];
  conv.memory[c.name] = [fromIndex, toIndex];
  settings.units = conv.memory;
  saveSettings();
  const d = digitsOf();
  const v = parseNum(conv.value.input.value);
  const info = [];
  let b = null;
  if (v !== null) {
    b = from.toBase(v);
    const r = to.fromBase(b);
    conv.result.set(fmt(r, d, true) + " " + to.symbol, fmt(r, d, false));
    if (b < c.minBase) info.push("⚠ " + c.minMessage);
  } else {
    conv.result.set("", "");
    info.push(conv.value.input.value.trim() === "" ? "Введите значение." : "⚠ Не удалось распознать число. Примеры: 12,5   -40   1,5e-3");
  }
  info.push("1 " + from.symbol + " = " + fmt(to.fromBase(from.toBase(1)), d, true) + " " + to.symbol);
  if (c.note) info.push(c.note);
  conv.info.textContent = info.join("\n");
  [...conv.list.children].forEach((li, i) => {
    const u = c.units[i];
    li.hidden = i === toIndex;
    li.lastChild.textContent = b !== null ? fmt(u.fromBase(b), d, true) : "";
    li.className = i === fromIndex ? "from" : "";
  });
}

// ================= 2. Объёмный ↔ массовый расход =================

const flow = {};
(function buildFlow() {
  const sec = document.getElementById("flow");
  flow.items = [
    ...VolumeFlow.units.map(u => ({ u, mass: false })),
    ...MassFlow.units.map(u => ({ u, mass: true }))
  ];
  flow.value = numField("10", () => recalcFlow());
  flow.unit = select([
    { group: "Объёмный расход", items: VolumeFlow.units.map((u, i) => ({ value: String(i), text: u.name })) },
    { group: "Массовый расход", items: MassFlow.units.map((u, i) => ({ value: String(VolumeFlow.units.length + i), text: u.name })) }
  ], () => recalcFlow());
  flow.rho = numField("998,2", () => { flow.subst.value = "0"; recalcFlow(); });
  flow.rhoUnit = select(unitOptions(Density), () => recalcFlow());
  flow.subst = select(Substances.map((s, i) => ({ value: String(i), text: s[0] })), () => {
    const s = Substances[Number(flow.subst.value)];
    if (s[1] <= 0) return;
    flow.rhoUnit.value = "0";
    flow.rho.input.value = fmt(s[1], 6, false);
    recalcFlow();
  });
  flow.subst.value = "2";
  flow.info = el("div", { class: "info" });
  flow.list = el("ul", { class: "list" });

  let lastMass = null;
  const rows = [];
  for (const it of flow.items) {
    if (it.mass !== lastMass) {
      rows.push(el("li", { class: "head", text: it.mass ? "МАССОВЫЙ РАСХОД" : "ОБЪЁМНЫЙ РАСХОД" }));
      lastMass = it.mass;
    }
    const li = el("li", { onclick: () => copyText(li.copy) }, el("span", { class: "n", text: it.u.name }), el("span", { class: "v" }));
    li.item = it;
    rows.push(li);
  }
  flow.list.append(...rows);

  sec.append(
    el("div", { class: "info", text: "Пересчёт через плотность среды:  G = Q · ρ,   Q = G / ρ" }),
    field("Расход", flow.value), field("Единица расхода", flow.unit),
    field("Плотность", flow.rho), field("Единица плотности", flow.rhoUnit),
    field("Среда", flow.subst, "Плотности сред — справочные ориентировочные значения."),
    flow.info, flow.list,
    el("div", { class: "hint", text: "Нажмите на строку, чтобы скопировать значение." })
  );
  recalcFlow();
})();

function recalcFlow() {
  const d = digitsOf();
  const it = flow.items[Number(flow.unit.value)];
  const q = parseNum(flow.value.input.value);
  const rhoIn = parseNum(flow.rho.input.value);
  const rho = rhoIn !== null ? Density.units[Number(flow.rhoUnit.value)].toBase(rhoIn) : null;
  const ok = q !== null && rho !== null && rho > 0;
  let vol = null, mass = null;
  if (ok) {
    const b = it.u.toBase(q);
    if (it.mass) { mass = b; vol = b / rho; } else { vol = b; mass = b * rho; }
    flow.info.textContent = "ρ = " + fmt(rho, d, true) + " кг/м³   →   " + (it.mass
      ? "Q = " + fmt(VolumeFlow.units[0].fromBase(vol), d, true) + " м³/ч"
      : "G = " + fmt(MassFlow.units[0].fromBase(mass), d, true) + " кг/ч");
  } else flow.info.textContent = q === null ? "⚠ Введите значение расхода." : "⚠ Плотность должна быть положительным числом.";
  for (const li of flow.list.children) {
    if (!li.item) continue;
    const f = li.item;
    const v = ok ? f.u.fromBase(f.mass ? mass : vol) : null;
    li.lastChild.textContent = ok ? fmt(v, d, true) : "";
    li.copy = ok ? fmt(v, d, false) : "";
    li.className = f.u === it.u ? "from" : "";
  }
}

// ================= 3. Расход газа: рабочие ↔ стандартные условия =================

const gas = { toStd: true };
(function buildGas() {
  const sec = document.getElementById("gas");
  const seg = el("div", { class: "seg" });
  const b1 = el("button", { type: "button", text: "Рабочий → стандартный", class: "on" });
  const b2 = el("button", { type: "button", text: "Стандартный → рабочий" });
  b1.onclick = () => { gas.toStd = true; b1.className = "on"; b2.className = ""; recalcGas(); };
  b2.onclick = () => { gas.toStd = false; b2.className = "on"; b1.className = ""; recalcGas(); };
  seg.append(b1, b2);

  gas.q = numField("100", () => recalcGas());
  gas.qUnit = select(unitOptions(VolumeFlow), () => recalcGas());
  gas.p = numField("5", () => recalcGas());
  gas.pUnit = select(unitOptions(Pressure), () => recalcGas());
  gas.pUnit.value = String(Pressure.indexOf("бар (изб.)"));
  gas.t = numField("20", () => recalcGas());
  gas.tUnit = select(unitOptions(Temperature), () => recalcGas());
  gas.z = numField("1", () => recalcGas());
  gas.cond = select(GasConditions.map((c, i) => ({ value: String(i), text: c[0] })), () => recalcGas());
  gas.result = resultBox("Результат");
  gas.info = el("div", { class: "info" });

  sec.append(
    el("div", { class: "info", text: "Приведение объёмного расхода газа к стандартным (нормальным) условиям." }),
    field("Расход задан при", seg),
    field("Расход Q", gas.q), field("Единица расхода", gas.qUnit),
    field("Рабочее давление", gas.p), field("Единица давления", gas.pUnit, "Для избыточного давления выберите единицу с пометкой «изб.»."),
    field("Рабочая температура", gas.t), field("Единица температуры", gas.tUnit),
    field("Коэффициент сжимаемости Z", gas.z, "Z = Zраб / Zст;  1 — идеальный газ"),
    field("Условия приведения", gas.cond),
    gas.result, gas.info
  );
  recalcGas();
})();

function recalcGas() {
  const d = digitsOf();
  const qu = VolumeFlow.units[Number(gas.qUnit.value)];
  const pu = Pressure.units[Number(gas.pUnit.value)];
  const tu = Temperature.units[Number(gas.tUnit.value)];
  const [, condT, condP] = GasConditions[Number(gas.cond.value)];
  gas.result.set("", "");
  const fail = msg => { gas.info.textContent = "⚠ " + msg; };
  const q = parseNum(gas.q.input.value), p = parseNum(gas.p.input.value), t = parseNum(gas.t.input.value), z = parseNum(gas.z.input.value);
  if (q === null) return fail("Введите расход.");
  if (p === null) return fail("Введите рабочее давление.");
  if (t === null) return fail("Введите рабочую температуру.");
  if (z === null || z <= 0) return fail("Коэффициент сжимаемости должен быть положительным.");
  const pAbs = pu.toBase(p), tAbs = tu.toBase(t);
  if (pAbs <= 0) return fail("Абсолютное давление должно быть больше нуля.");
  if (tAbs <= 0) return fail("Температура должна быть выше абсолютного нуля.");
  const k = (pAbs / condP) * (condT / tAbs) / z;   // K = Qст / Qраб
  const r = gas.toStd ? q * k : q / k;
  gas.result.set(fmt(r, d, true) + " " + qu.symbol + (gas.toStd ? " (ст. усл.)" : " (раб. усл.)"), fmt(r, d, false));
  gas.info.textContent =
    "Pабс = " + fmt(pAbs / 1000, d, true) + " кПа;   T = " + fmt(tAbs, d, true) + " K\n" +
    "Pст = " + fmt(condP / 1000, d, true) + " кПа;   Tст = " + fmt(condT, d, true) + " K\n" +
    "Qст = Qраб · (Pабс / Pст) · (Tст / T) / Z\nK = Qст / Qраб = " + fmt(k, d, true);
}

// ================= 4. Поверка =================

const signed = (v, d) => (v > 0 ? "+" : "") + fmt(v, d, true);

function soundSpeedCramer(t, humidity, pressureKPa) {
  // O. Cramer (1993), eq. 15 and appendix A, DOI 10.1121/1.405827.
  const co2 = 0.0004;
  const p = pressureKPa * 1000;
  const kelvin = t + 273.15;
  const t2 = t * t;
  const saturation = Math.exp(1.2811805e-5 * kelvin * kelvin - 0.019509874 * kelvin
      + 34.04926034 - 6353.6311 / kelvin);
  const water = humidity / 100 * (1.00062 + 3.14e-8 * p + 5.6e-7 * t2) * saturation / p;
  return 331.5024 + 0.603055 * t - 0.000528 * t2
      + (51.471935 + 0.1495874 * t - 0.000782 * t2) * water
      + (-1.82e-7 + 3.73e-8 * t - 2.93e-10 * t2) * p
      + (-85.20931 - 0.228525 * t + 5.91e-5 * t2) * co2
      - 2.835149 * water * water - 2.15e-13 * p * p + 29.179762 * co2 * co2
      + 0.000486 * water * p * co2;
}

const verifyCalcs = [
  {
    name: "Относительная погрешность",
    title: "δ = (СИ − Эталон) / Эталон · 100 %",
    fields: [["si", "Показание СИ", "100,5", "значение поверяемого средства измерений"],
             ["ref", "Эталон", "100", "действительное значение по эталону"],
             ["lim", "Допуск ±, %", "", "необязательно — для заключения «годен / не годен»"]],
    compute(v, d, raw) {
      if (v.si === null) return { info: "⚠ Введите показание СИ." };
      if (v.ref === null) return { info: "⚠ Введите значение эталона." };
      if (v.ref === 0) return { info: "⚠ Значение эталона не может быть равно нулю (деление на ноль)." };
      const delta = v.si - v.ref, rel = delta / v.ref * 100;
      const res = { outs: [["Погрешность δ, %", rel, signed(rel, d) + " %"]], info: "Абсолютная погрешность Δ = СИ − Эталон = " + signed(delta, d) };
      if (raw.lim.trim() !== "") {
        if (v.lim !== null && v.lim > 0) {
          // сравнение по округлённому значению, чтобы не браковать из-за ошибок округления
          const fit = roundDec(Math.abs(rel), 10) <= roundDec(v.lim, 10);
          res.verdict = (fit ? "✔ ГОДЕН: |δ| = " : "✘ НЕ ГОДЕН: |δ| = ") + fmt(Math.abs(rel), d, true) + " % " + (fit ? "≤ " : "> ") + fmt(v.lim, d, true) + " %";
          res.status = fit ? "ok" : "bad";
        } else res.info += "\n⚠ Допуск должен быть положительным числом.";
      }
      return res;
    }
  },
  {
    name: "Эмис-Вихрь 200 (имитация)",
    title: "Имитационная поверка Эмис-Вихрь 200",
    fields: [["k", "К-фактор", "1"], ["f", "Задаваемая частота, Гц", "100"], ["qmax", "Qmax", "500", "в тех же единицах, что и имитируемый расход"]],
    compute(v, d) {
      if (v.k === null) return { info: "⚠ Введите К-фактор." };
      if (v.f === null) return { info: "⚠ Введите задаваемую частоту." };
      const q = 3.6 * v.k * v.f;
      const outs = [["Имитируемый расход", q, fmt(q, d, true)]];
      let info = "Имитируемый расход = 3,6 · К-фактор · Fзад = 3,6 · " + fmt(v.k, d, true) + " · " + fmt(v.f, d, true) + " = " + fmt(q, d, true);
      if (v.qmax === null || v.qmax <= 0) return { outs, info: info + "\n⚠ Введите Qmax (положительное число)." };
      const fout = q / v.qmax * 1000;
      outs.push(["Выходная частота, Гц", fout, fmt(fout, d, true)]);
      info += "\nВыходная частота = Имитируемый расход / Qmax · 1000 = " + fmt(q, d, true) + " / " + fmt(v.qmax, d, true) + " · 1000 = " + fmt(fout, d, true) + " Гц" +
        "\nРасход составляет " + fmt(q / v.qmax * 100, d, true) + " % от Qmax" + (q > v.qmax ? "   ⚠ превышает Qmax" : "");
      return { outs, info };
    }
  },
  {
    name: "Старт-Стоп",
    title: "Объём = Стоп − Старт",
    fields: [["start", "Старт", "0", "показание в начале измерения"], ["stop", "Стоп", "0", "показание в конце измерения"]],
    compute(v, d) {
      if (v.start === null) return { info: "⚠ Введите показание «Старт»." };
      if (v.stop === null) return { info: "⚠ Введите показание «Стоп»." };
      const vol = v.stop - v.start;
      return {
        outs: [["Объём", vol, fmt(vol, d, true)]],
        info: "Объём = " + fmt(v.stop, d, true) + " − " + fmt(v.start, d, true) + " = " + fmt(vol, d, true) +
          (vol < 0 ? "\n⚠ «Стоп» меньше «Старт» — объём отрицательный, проверьте показания." : "")
      };
    }
  },
  {
    name: "Вес импульса, имп/м³",
    title: "имп/м³ = Частота (Гц) × 3600 / Qmax (м³/ч)",
    fields: [["qmax", "Максимальный расход Qmax, м³/ч", "500"], ["f", "Частота, Гц", "1000", "частота при Qmax"]],
    compute(v, d) {
      if (v.qmax === null || v.qmax <= 0) return { info: "⚠ Введите Qmax (положительное число)." };
      if (v.f === null) return { info: "⚠ Введите частоту." };
      const k = v.f * 3600 / v.qmax;
      return {
        outs: [["имп/м³", k, fmt(k, d, true)]],
        info: "имп/м³ = " + fmt(v.f, d, true) + " × 3600 / " + fmt(v.qmax, d, true) + " = " + fmt(k, d, true) +
          "\nЭто " + fmt(k / 1000, d, true) + " имп/л; цена импульса " + (k !== 0 ? fmt(1000 / k, d, true) + " л/имп" : "—")
      };
    }
  },
  {
    name: "Ирга-РВ",
    title: "Ирга-РВ: коэффициент K, имп/м³",
    fields: [["fmax", "Максимальная частота Fmax, Гц", "1100"],
             ["fmin", "Минимальная частота Fmin, Гц", "100", "смещение — частота при нулевом расходе"],
             ["qmax", "Максимальный расход Qmax, м³/ч", "50"],
             ["q", "Точка расхода Qточки, м³/ч", "25"]],
    compute(v, d) {
      if (v.fmax === null) return { info: "⚠ Введите максимальную частоту." };
      if (v.fmin === null) return { info: "⚠ Введите минимальную частоту." };
      if (v.qmax === null || v.qmax <= 0) return { info: "⚠ Введите максимальный расход (положительное число)." };
      if (v.q === null || v.q <= 0) return { info: "⚠ Введите точку расхода (положительное число)." };
      const f = (v.fmax - v.fmin) / v.qmax * v.q + v.fmin;   // линейная шкала Fmin…Fmax на 0…Qmax
      const k = f * 3600 / v.q;                                // K = 1 / (Qточки / (F · 3600))
      return {
        outs: [["Частота F в точке, Гц", f, fmt(f, d, true)], ["K, имп/м³", k, fmt(k, d, true)]],
        info: "F = (" + fmt(v.fmax, d, true) + " − " + fmt(v.fmin, d, true) + ") / " + fmt(v.qmax, d, true) + " × " + fmt(v.q, d, true) +
          " + " + fmt(v.fmin, d, true) + " = " + fmt(f, d, true) + " Гц" +
          "\nK = 1 / (Qточки / (F × 3600)) = 1 / (" + fmt(v.q, d, true) + " / (" + fmt(f, d, true) + " × 3600)) = " + fmt(k, d, true) + " имп/м³" +
          (v.fmax <= v.fmin ? "\n⚠ Максимальная частота должна быть больше минимальной." : "") +
          (v.q > v.qmax ? "\n⚠ Точка расхода больше Qmax." : "")
      };
    }
  },
  {
    name: "Скорость звука в воздухе",
    title: "Расчёт скорости звука и сравнение с показанием расходомера",
    methods: [{ value: "cramer", text: "Формула Крамера" },
              { value: "dry", text: "Сухой воздух (идеальный газ)", hiddenFields: ["humidity", "pressure"] }],
    fields: [["temp", "Температура воздуха, °C", "20"],
             ["humidity", "Относительная влажность, %", ""],
             ["pressure", "Абсолютное давление, кПа", "101,325"],
             ["measured", "Показание расходомера, м/с", "", "Для сравнения с расчётной скоростью"],
             ["limit", "Допуск ±, % (необязательно)", ""]],
    compute(v, d, raw, method) {
      if (v.temp === null) return { info: "Введите температуру воздуха в °C." };
      if (v.temp <= -273.15) return { info: "Температура должна быть выше −273,15 °C." };
      let speed, info;
      if (method === "dry") {
        speed = Math.sqrt(1.4 * 287.05) * Math.sqrt(v.temp + 273.15);
        info = "Оценка для сухого воздуха по модели идеального газа.";
      } else {
        if (v.humidity === null || v.humidity < 0 || v.humidity > 100)
          return { info: "Введите относительную влажность от 0 до 100 %." };
        if (v.temp < 0 || v.temp > 30)
          return { info: "Формула Крамера применима при температуре от 0 до 30 °C." };
        if (v.pressure === null || v.pressure < 75 || v.pressure > 102)
          return { info: "Введите абсолютное атмосферное давление от 75 до 102 кПа." };
        speed = soundSpeedCramer(v.temp, v.humidity, v.pressure);
        info = "Формула Крамера. Принята концентрация CO₂ 400 ppm.";
      }
      const result = { outs: [["Расчётная скорость звука, м/с", speed, fmt(speed, d, true)]], info };
      const hasLimit = raw.limit.trim() !== "";
      if (raw.measured.trim() === "" && !hasLimit) return result;
      if (v.measured === null || v.measured < 0) {
        result.info += "\nВведите показание расходомера в м/с (0 или больше).";
        return result;
      }
      const delta = v.measured - speed, relative = delta / speed * 100;
      result.outs.push(["Отклонение (показание − расчёт), м/с", delta, fmt(delta, d, true)],
                       ["Относительная погрешность, %", relative, fmt(relative, d, true)]);
      if (!hasLimit) return result;
      if (v.limit === null || v.limit <= 0) {
        result.info += "\nДопуск должен быть положительным числом.";
        return result;
      }
      const withinLimit = roundDec(Math.abs(relative), 10) <= roundDec(v.limit, 10);
      result.verdict = withinLimit ? "В пределах допуска" : "Допуск превышен";
      result.status = withinLimit ? "ok" : "bad";
      return result;
    }
  }
];

const verify = { panels: [] };
(function buildVerify() {
  const sec = document.getElementById("verify");
  const saved = store.get("verifyValues", {});
  verify.sel = select(verifyCalcs.map((c, i) => ({ value: String(i), text: c.name })), () => {
    settings.verify = Number(verify.sel.value);
    saveSettings();
    showVerify();
  });
  sec.append(field("Расчёт", verify.sel));

  verifyCalcs.forEach((calc, ci) => {
    const panel = el("div", { hidden: true });
    panel.append(el("div", { class: "info", text: calc.title }));
    const inputs = {}, rows = {};
    let method;
    if (calc.methods) {
      const key = ci + ".method";
      method = select(calc.methods, () => {
        saved[key] = method.value;
        store.set("verifyValues", saved);
        recalc();
      });
      if (calc.methods.some(m => m.value === saved[key])) method.value = saved[key];
      panel.append(field("Метод расчёта", method));
    }
    for (const [id, label, def, hint] of calc.fields) {
      const key = ci + "." + id;
      const f = numField(saved[key] != null ? saved[key] : def, () => {
        saved[key] = f.input.value;
        store.set("verifyValues", saved);
        recalc();
      });
      inputs[id] = f.input;
      rows[id] = field(label, f, hint);
      panel.append(rows[id]);
    }
    const outBox = el("div");
    const verdict = el("div", { class: "info" });
    const info = el("div", { class: "info" });
    panel.append(outBox, verdict, info);
    const recalc = () => {
      const d = digitsOf(), v = {}, raw = {};
      for (const id in inputs) { raw[id] = inputs[id].value; v[id] = parseNum(raw[id]); }
      if (method) {
        const hidden = calc.methods[method.selectedIndex].hiddenFields || [];
        for (const id in rows) rows[id].hidden = hidden.includes(id);
      }
      const r = calc.compute(v, d, raw, method && method.value);
      outBox.replaceChildren(...(r.outs || []).map(([label, val, text]) => {
        const b = resultBox(label);
        b.set(text, fmt(val, d, false));
        return b;
      }));
      verdict.textContent = r.verdict || "";
      verdict.className = "info " + (r.status || "");
      verdict.hidden = !r.verdict;
      info.textContent = r.info || "";
    };
    panel.recalc = recalc;
    recalc();
    verify.panels.push(panel);
    sec.append(panel);
  });

  verify.sel.value = String(Math.min(settings.verify || 0, verifyCalcs.length - 1));
  showVerify();
})();

function showVerify() {
  verify.panels.forEach((p, i) => { p.hidden = i !== Number(verify.sel.value); });
}

// ================= 5. Калькулятор-лента =================

const EXAMPLE_TAPE = [
  ["Пример ленты", ""],
  ["Цена за м³, руб.", "цена = 45,8"],
  ["Объём, м³", "объём = 120"],
  ["Стоимость", "цена * объём"],
  ["Скидка 5 %", "-5%"],
  ["НДС 20 %", "+20%"],
  ["", ""],
  ["Аренда", "25000"],
  ["Электричество", "3200,50"],
  ["Интернет", "900"],
  ["Итого за месяц", "итого"],
  ["", ""],
  ["Ссылка на строку 4 и функции", "sqrt(@4) + round(pi; 2)"]
].map(([note, expr]) => ({ note, expr }));

const TAPE_HELP =
  "Каждая строка ленты считается отдельно, сверху вниз.\n\n" +
  "Числа: 12,5 или 12.5;  1,5e3 = 1500\n" +
  "Операции: +  −  ×  ÷  ^ (степень)  ²  ³  √  !  ( )\n" +
  "Проценты: 200 + 15% = 230;  200 − 15% = 170;  200 × 15% = 30\n\n" +
  "ЛЕНТА\n" +
  "• Строка, которая начинается с операции (+5, −3, ×2, /4, +20%), продолжает результат строки выше. " +
  "Чтобы начать новую строку с отрицательного числа, пишите (−5).\n" +
  "• итого (или =, сумма) — сумма результатов блока.\n" +
  "• Пустая строка (без заметки) начинает новый блок.\n\n" +
  "ПЕРЕМЕННЫЕ И ССЫЛКИ\n" +
  "• Заметка — это имя результата строки. Заметка «скорость звука» → переменная скорость_звука; " +
  "в выражениях можно писать и с пробелом: скорость звука2 − скорость звука.\n" +
  "• цена = 45,8 — задать переменную прямо в выражении. Такие строки в итог не входят.\n" +
  "• ans — результат предыдущей строки;  @3 — результат строки № 3.\n\n" +
  "ФУНКЦИИ (аргументы через ;)\n" +
  "sqrt, cbrt, root(x; n) — корень степени n, abs, ln, lg, log(x; основание), log2, exp, round(x; знаков), " +
  "floor, ceil, trunc, min, max, sum, avg, hypot(a; b), pow(x; y), fact, " +
  "sin, cos, tg, arcsin, arccos, arctg — в градусах;  rad(x), deg(x).  Константы: pi (π), e.\n\n" +
  "КЛАВИАТУРА\n" +
  "• Кнопки вставляют текст в позицию курсора. Функция забирает в скобки число перед курсором (81 → ⁿ√x → root(81; ), " +
  "остаётся набрать степень) или выделенную часть выражения.\n" +
  "• ABC — обычная клавиатура (для имён переменных), ⏎ — следующая строка, ▾ — скрыть клавиатуру.\n" +
  "• «+строка» вставляет строку выше текущей, «−строка» удаляет текущую.\n\n" +
  "«Знаков» меняет только показ: дальше считается по точным значениям. Лента сохраняется на телефоне автоматически.";

// { надпись, вставляемый текст («|» — курсор/выделение, «¦» — место второго аргумента), класс }
const KEY_GRID = [
  ["7"], ["8"], ["9"], ["÷", "÷", "op"], ["(", "(", "op"], ["⌫", "BKSP", "op"],
  ["4"], ["5"], ["6"], ["×", "×", "op"], [")", ")", "op"], ["ABC", "ABC", "op"],
  ["1"], ["2"], ["3"], ["−", "-", "op"], ["^", "^", "op"], ["%", "%", "op"],
  ["0"], [",", ","], ["√", "√", "op"], ["+", "+", "op"], ["▾", "HIDE", "op"], ["⏎", "ENTER", "enter"]
];
const KEY_STRIP = [
  ["x²", "²"], ["x³", "³"], ["ⁿ√x", "root(|; ¦)"], ["∛", "cbrt(|)"], ["1/x", "1/(|)"], ["|x|", "abs(|)"], ["n!", "!"],
  ["π", "π"], ["e", "e"], ["sin", "sin(|)"], ["cos", "cos(|)"], ["tg", "tg(|)"], ["ln", "ln(|)"], ["lg", "lg(|)"],
  ["round", "round(|; 2)"], ["ans", "ans"], ["итого", "итого"], ["=", " = "], [";", "; "], ["@", "@"],
  ["+строка", "ROWADD"], ["−строка", "ROWDEL"]
];

const tape = { engine: new CalcEngine(), lines: [], results: [], active: null, abc: false };

(function buildCalc() {
  const sec = document.getElementById("calc");
  const bar = el("div", { class: "calc-bar" },
    el("button", { class: "btn small", type: "button", text: "Новая", onclick: newTape }),
    el("button", { class: "btn small", type: "button", text: "Открыть…", onclick: openTapeSheet }),
    el("button", { class: "btn small", type: "button", text: "Сохранить…", onclick: saveTapeAs }),
    el("button", { class: "btn small", type: "button", text: "Копировать", onclick: () => copyText(tapeAsText()) }),
    el("button", { class: "btn small", type: "button", text: "?", onclick: () => showSheet("Калькулятор — справка", el("pre", { text: TAPE_HELP })) })
  );
  tape.decimals = select([{ value: "-1", text: "Знаков: авто" }, ...Array.from({ length: 11 }, (_, i) => ({ value: String(i), text: "Знаков: " + i }))], () => {
    settings.calcDecimals = Number(tape.decimals.value);
    saveSettings();
    recalcTape();
  });
  tape.decimals.value = String(settings.calcDecimals != null ? settings.calcDecimals : -1);
  bar.prepend(tape.decimals);
  tape.sumVal = el("div", { class: "val" });
  const sum = el("div", { class: "calc-sum" }, tape.sumVal,
    el("button", { class: "btn small", type: "button", text: "Копировать", onclick: () => copyText(tapeCopyText(tape.last)) }));
  tape.box = el("div", { class: "tape" });
  tape.varsCount = el("span");
  tape.chips = el("div", { class: "chips" });
  const vars = el("details", { class: "vars" }, el("summary", {}, "Переменные ", tape.varsCount), tape.chips,
    el("div", { class: "hint", text: "Нажмите на имя, чтобы вставить его в выражение." }));
  sec.append(bar, sum, tape.box, vars,
    el("div", { class: "hint", text: "Заметка = имя результата строки · +5, ×2, +20% в начале — продолжить результат выше · итого — сумма блока · @3 — строка № 3" }));

  buildKeypad();
  const saved = store.get("tape", null);
  tape.lines = Array.isArray(saved) ? saved : EXAMPLE_TAPE.map(l => ({ ...l }));
  renderTape();
})();

function calcDecimals() { return Number(tape.decimals.value); }

// Округление только для показа: в вычислениях следующих строк участвуют точные значения
function fmtCalc(v, group) {
  return calcDecimals() < 0 ? fmt(v, 12, group) : fmtFixed(v, calcDecimals(), group);
}
function tapeCopyText(v) {
  if (v == null) return "";
  return calcDecimals() < 0 ? fmt(v, 15, false) : fmtFixed(v, calcDecimals(), false);
}

function makeRow(i) {
  const note = el("input", { class: "tnote", type: "text", placeholder: "заметка", autocomplete: "off", enterkeyhint: "next" });
  const expr = el("input", {
    class: "texpr", type: "text", inputmode: "none", autocomplete: "off", autocapitalize: "off",
    autocorrect: "off", spellcheck: "false", enterkeyhint: "next", placeholder: i === tape.lines.length ? "…" : ""
  });
  const row = el("div", { class: "trow" }, el("div", { class: "tnum" }), note, el("div", { class: "tres" }), expr);
  const line = tape.lines[i];
  if (line) { note.value = line.note; expr.value = line.expr; }
  const onEdit = () => {
    const idx = rowIndex(row);
    if (idx === tape.lines.length) {          // печатают в строке-заготовке — она становится настоящей
      tape.lines.push({ note: "", expr: "" });
      expr.placeholder = "";
      tape.box.append(makeRow(tape.lines.length));
      numberRows();
    }
    tape.lines[idx].note = note.value;
    tape.lines[idx].expr = expr.value;
    recalcTape();
    saveTape();
  };
  note.addEventListener("input", onEdit);
  expr.addEventListener("input", onEdit);
  note.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); expr.focus(); } });
  expr.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); nextRow(); } });
  expr.addEventListener("focus", () => onExprFocus(expr));
  expr.addEventListener("blur", () => setTimeout(onExprBlur, 0));
  return row;
}

const rowIndex = row => [...tape.box.children].indexOf(row);

function numberRows() {
  [...tape.box.children].forEach((r, i) => { r.firstChild.textContent = i < tape.lines.length ? String(i + 1) : ""; });
}

function renderTape(focusIndex) {
  tape.box.replaceChildren();
  for (let i = 0; i <= tape.lines.length; i++) tape.box.append(makeRow(i));
  numberRows();
  recalcTape();
  if (focusIndex != null) {
    const r = tape.box.children[Math.min(focusIndex, tape.lines.length)];
    if (r) r.lastChild.focus();
  }
}

function recalcTape() {
  tape.results = tape.engine.run(tape.lines);
  tape.last = null;
  [...tape.box.children].forEach((row, i) => {
    const res = row.children[2];
    const r = tape.results[i];
    res.className = "tres";
    res.textContent = "";
    res.title = "";
    if (!r) return;
    if (r.error) {
      res.textContent = "⚠ " + r.error;
      res.classList.add("err");
    } else if (r.value !== null) {
      res.textContent = (r.variable ? r.variable + " = " : r.isTotal ? "Σ " : "") + fmtCalc(r.value, true);
      if (r.variable) res.classList.add("var");
      if (r.isTotal) res.classList.add("total");
      tape.last = r.value;
    }
  });
  tape.sumVal.textContent = tape.last == null ? "" : "= " + fmtCalc(tape.last, true);
  const vars = [...tape.engine.vars.values()];
  tape.varsCount.textContent = "(" + vars.length + ")";
  tape.chips.replaceChildren(...vars.map(v => {
    const chip = el("button", { class: "chip", type: "button" }, v.name, el("b", { text: fmtCalc(v.value, true) }));
    chip.addEventListener("pointerdown", e => e.preventDefault());   // не забирать фокус у выражения
    chip.addEventListener("click", () => insertIntoExpr(v.name));
    return chip;
  }));
}

let saveTimer;
function trimmedLines() {
  const lines = tape.lines.map(l => ({ note: l.note, expr: l.expr }));
  while (lines.length && !lines[lines.length - 1].note.trim() && !lines[lines.length - 1].expr.trim()) lines.pop();
  return lines;
}
function saveTape() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("tape", trimmedLines()), 300);
}

function tapeAsText() {
  const out = [];
  tape.lines.forEach((l, i) => {
    if (!l.note.trim() && !l.expr.trim()) { out.push(""); return; }
    const res = tape.box.children[i] ? tape.box.children[i].children[2].textContent.replace(/ /g, " ") : "";
    out.push((l.note.trim() ? l.note.trim() + ": " : "") + l.expr.trim() + (res && l.expr.trim() ? "  →  " + res : ""));
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// ---------- работа со строками ----------

function activeIndex() {
  return tape.active ? rowIndex(tape.active.closest(".trow")) : tape.lines.length;
}

function nextRow() {
  const i = activeIndex();
  const next = tape.box.children[i + 1] || tape.box.children[tape.lines.length];
  if (next) { next.lastChild.focus(); next.scrollIntoView({ block: "nearest" }); }
}

function insertRowAbove() {
  const i = Math.min(activeIndex(), tape.lines.length);
  tape.lines.splice(i, 0, { note: "", expr: "" });
  renderTape(i);
  saveTape();
}

function deleteRow() {
  const i = activeIndex();
  if (i >= tape.lines.length) return;
  tape.lines.splice(i, 1);
  renderTape(i);
  saveTape();
}

// ---------- клавиатура ----------

function buildKeypad() {
  const kp = document.getElementById("keypad");
  const strip = el("div", { class: "strip" });
  const grid = el("div", { class: "grid" });
  const key = (label, action, cls, parent) => {
    const b = el("button", { type: "button", text: label, class: cls || "" });
    b.addEventListener("pointerdown", e => e.preventDefault());   // фокус остаётся в выражении
    b.addEventListener("click", () => keyAction(action || label));
    parent.append(b);
  };
  for (const [label, action] of KEY_STRIP) key(label, action, "", strip);
  for (const [label, action, cls] of KEY_GRID) key(label, action, cls, grid);
  kp.append(strip, grid);
}

function keyAction(a) {
  const input = tape.active;
  switch (a) {
    case "HIDE": if (input) input.blur(); return;
    case "ENTER": nextRow(); return;
    case "ROWADD": insertRowAbove(); return;
    case "ROWDEL": deleteRow(); return;
    case "ABC":
      if (!input) return;
      tape.abc = true;
      input.setAttribute("inputmode", "text");
      showKeypad(false);
      input.blur();
      input.focus();
      return;
    case "BKSP": {
      if (!input) return;
      let s = input.selectionStart, e = input.selectionEnd;
      if (s === e && s > 0) s--;
      input.setRangeText("", s, e, "end");
      input.dispatchEvent(new Event("input"));
      return;
    }
  }
  insertIntoExpr(a);
}

// Вставляет текст в позицию курсора; выделенный текст попадает внутрь скобок
function insertIntoExpr(template) {
  let input = tape.active;
  if (!input) {
    const row = tape.box.children[tape.lines.length];
    input = row.lastChild;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  let start = input.selectionStart, end = input.selectionEnd;
  const mark = template.indexOf("|");
  // число или имя прямо перед курсором попадает внутрь функции: 81 → ⁿ√x → root(81; )
  if (start === end && mark >= 0) {
    const m = /[\p{L}\p{Nd}_]+(?:[.,]\d+)?$/u.exec(input.value.slice(0, start));
    if (m) start -= m[0].length;
  }
  const selected = input.value.slice(start, end);
  let text = template.replace("|", selected);
  const second = text.indexOf("¦");
  text = text.replace("¦", "");
  input.setRangeText(text, start, end, "end");
  let caret = start + text.length;
  if (mark >= 0 && selected === "") caret = start + mark;
  else if (second >= 0) caret = start + second;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input"));
}

function showKeypad(on) {
  const kp = document.getElementById("keypad");
  kp.hidden = !on;
  document.body.classList.toggle("keypad-open", on);
  if (on) document.documentElement.style.setProperty("--keypad-h", kp.offsetHeight + "px");
}

function onExprFocus(input) {
  if (tape.active && tape.active !== input) {
    tape.active.closest(".trow").classList.remove("active");
    tape.active.setAttribute("inputmode", "none");
    tape.abc = false;   // в другой строке снова своя клавиатура
  }
  tape.active = input;
  input.closest(".trow").classList.add("active");
  if (!tape.abc) { input.setAttribute("inputmode", "none"); showKeypad(true); }
  setTimeout(() => input.closest(".trow").scrollIntoView({ block: "nearest" }), 50);
}

function onExprBlur() {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("texpr")) return;   // фокус перешёл в другое выражение
  if (tape.abc && a === tape.active) return;                         // переключение на обычную клавиатуру
  if (tape.active) {
    tape.active.closest(".trow").classList.remove("active");
    tape.active.setAttribute("inputmode", "none");
  }
  tape.active = null;
  tape.abc = false;
  showKeypad(false);
}

// ---------- ленты: новая, открыть, сохранить ----------

function newTape() {
  if (trimmedLines().length && !confirm("Очистить текущую ленту?")) return;
  tape.lines = [];
  renderTape();
  saveTape();
}

function saveTapeAs() {
  const lines = trimmedLines();
  if (!lines.length) { toast("Лента пустая"); return; }
  const name = (prompt("Название ленты:", "Лента " + new Date().toLocaleDateString("ru-RU")) || "").trim();
  if (!name) return;
  const lib = store.get("tapes", {});
  if (lib[name] && !confirm("Лента «" + name + "» уже есть. Заменить?")) return;
  lib[name] = lines;
  store.set("tapes", lib);
  toast("Сохранено: " + name);
}

function openTapeSheet() {
  const lib = store.get("tapes", {});
  const names = Object.keys(lib).sort((a, b) => a.localeCompare(b, "ru"));
  const list = el("div");
  if (!names.length) list.append(el("div", { class: "hint", text: "Сохранённых лент пока нет. Нажмите «Сохранить…», чтобы сохранить текущую." }));
  for (const name of names) {
    list.append(el("div", { class: "tape-item" },
      el("span", { text: name + " (" + lib[name].length + " стр.)" }),
      el("button", {
        class: "btn small", type: "button", text: "Открыть", onclick: () => {
          if (trimmedLines().length && !confirm("Заменить текущую ленту лентой «" + name + "»?")) return;
          tape.lines = lib[name].map(l => ({ note: l.note || "", expr: l.expr || "" }));
          renderTape();
          saveTape();
          hideSheet();
        }
      }),
      el("button", {
        class: "btn small", type: "button", text: "Удалить", onclick: () => {
          if (!confirm("Удалить ленту «" + name + "»?")) return;
          delete lib[name];
          store.set("tapes", lib);
          openTapeSheet();
        }
      })));
  }
  showSheet("Сохранённые ленты", list);
}

function showSheet(title, content) {
  const m = document.getElementById("modal");
  m.firstElementChild.replaceChildren(el("h2", { text: title }), content,
    el("button", { class: "btn", type: "button", text: "Закрыть", style: "width:100%;margin-top:8px", onclick: hideSheet }));
  m.hidden = false;
}
function hideSheet() { document.getElementById("modal").hidden = true; }
document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") hideSheet(); });

// ================= общее =================

function recalcAll() {
  recalcConv();
  recalcFlow();
  recalcGas();
  verify.panels.forEach(p => p.recalc());
}

showTab(document.getElementById(settings.tab) ? settings.tab : "conv");

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => { });
}
