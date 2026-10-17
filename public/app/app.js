/* Casa — PWA de finanças e organização da casa */
"use strict";

const sb = supabase.createClient(CONFIG.url, CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
const app = document.getElementById("app");
const nav = document.getElementById("nav");
const side = document.getElementById("side");

/* ---------- utilidades ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + Number(f(x) || 0), 0);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const clampDate = (y, m, day) => { const d = new Date(y, m, 1); return new Date(d.getFullYear(), d.getMonth(), Math.min(day, daysIn(d.getFullYear(), d.getMonth()))); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const monthName = (d, opts = { month: "long" }) => d.toLocaleDateString("pt-BR", opts);
const diffDays = (d) => Math.round((d - today0()) / 864e5);
const rel = (d) => {
  const n = diffDays(d);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
};
const shortDate = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const parseMoney = (s) => {
  s = String(s ?? "").trim().replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const normUrl = (u) => (!u ? u : /^[a-z]+:/i.test(u) ? u : "https://" + u);
const initials = (name) => (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
async function copy(text, label = "Copiado") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Não deu pra copiar"); }
}
function drawIcons() {
  lucide.createIcons({ icons: lucide.icons, attrs: { "stroke-width": 1.25 } });
}

function shrinkImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- dados ---------- */
const ERRORS = {
  "Invalid login credentials": "E-mail ou senha errados",
  "User already registered": "Esse e-mail já tem conta",
  "Email not confirmed": "Confirme seu e-mail primeiro (veja sua caixa de entrada)",
};
async function q(promise) {
  const { data, error } = await promise;
  if (error) {
    const msg = ERRORS[error.message] || error.message || "Algo deu errado";
    toast(/fetch|network/i.test(msg) ? "Sem conexão" : msg);
    throw error;
  }
  return data;
}
const cacheKey = (k) => `casa:${state.household?.id}:${k}`;
const db = {
  async list(table, build = (x) => x, cacheName) {
    try {
      const data = await q(build(sb.from(table).select("*")));
      if (cacheName) { try { localStorage.setItem(cacheKey(cacheName), JSON.stringify(data)); } catch {} }
      return data;
    } catch (e) {
      if (cacheName) {
        try { const c = localStorage.getItem(cacheKey(cacheName)); if (c) { state.offline = true; return JSON.parse(c); } } catch {}
      }
      throw e;
    }
  },
  add: (t, row) => q(sb.from(t).insert(row).select().single()),
  set: (t, id, row) => q(sb.from(t).update(row).eq("id", id)),
  del: (t, id) => q(sb.from(t).delete().eq("id", id)),
};

const state = { user: null, member: null, household: null, members: [], cats: [], month: monthStart(new Date()), offline: false };
const memberName = (uid) => state.members.find((m) => m.user_id === uid)?.display_name || "";
const catById = (id) => state.cats.find((c) => c.id === id);

async function loadHouse() {
  const me = await q(sb.from("household_members").select("*, households(*)").eq("user_id", state.user.id).maybeSingle());
  state.member = me;
  state.household = me?.households || null;
  if (state.household) {
    const [members, cats] = await Promise.all([
      q(sb.from("household_members").select("*").order("joined_at")),
      q(sb.from("categories").select("*").order("sort")),
    ]);
    state.members = members;
    state.cats = cats;
  }
}

/* ---------- sheet (gaveta) e formulários ---------- */
function openSheet(html, bind) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.innerHTML = `<div class="grab"></div>${html}`;
    document.body.append(scrim, sheet);
    drawIcons();
    requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("show"); });
    let closed = false;
    const close = (val) => {
      if (closed) return;
      closed = true;
      scrim.classList.remove("show");
      sheet.classList.remove("show");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { scrim.remove(); sheet.remove(); }, 260);
      resolve(val);
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    scrim.addEventListener("click", () => close());
    bind?.(sheet, close);
  });
}

function fieldHtml(f, values) {
  const v = values[f.name] ?? f.value ?? "";
  const label = f.label ? `<span>${esc(f.label)}</span>` : "";
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "";
  switch (f.type) {
    case "seg":
      return `<div class="field">${label}<div class="seg" data-name="${f.name}">${f.options.map((o) => `<button type="button" data-v="${esc(o.v)}" class="${String(v) === String(o.v) ? "on" : ""}">${esc(o.l)}</button>`).join("")}<input type="hidden" name="${f.name}" value="${esc(v)}"></div></div>`;
    case "select": {
      const opt = (o) => `<option value="${esc(o.v)}" ${String(v) === String(o.v) ? "selected" : ""}>${esc(o.l)}</option>`;
      const groups = [...new Set(f.options.map((o) => o.group || ""))];
      const body = groups.map((g) => {
        const items = f.options.filter((o) => (o.group || "") === g).map(opt).join("");
        return g ? `<optgroup label="${esc(g)}">${items}</optgroup>` : items;
      }).join("");
      return `<label class="field">${label}<select name="${f.name}">${body}</select></label>`;
    }
    case "textarea":
      return `<label class="field">${label}<textarea name="${f.name}" ${ph}>${esc(v)}</textarea></label>`;
    case "toggle":
      return `<label class="toggle"><span>${esc(f.label)}</span><input class="switch" type="checkbox" name="${f.name}" ${v ? "checked" : ""}></label>`;
    case "money":
      return `<label class="field">${label}<input name="${f.name}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${v === "" || v === null ? "" : esc(String(v).replace(".", ","))}"></label>`;
    case "secret":
      return `<div class="field">${label}<div style="display:flex;gap:8px"><input class="input secret" type="password" name="${f.name}" autocomplete="new-password" value="${esc(v)}" ${ph} style="flex:1"><button type="button" class="icon-btn" data-reveal style="width:52px;height:52px;border-radius:18px">${ic("eye")}</button>${f.generate ? `<button type="button" class="icon-btn" data-gen style="width:52px;height:52px;border-radius:18px" aria-label="Gerar senha">${ic("dices")}</button>` : ""}</div></div>`;
    default:
      return `<label class="field">${label}<input name="${f.name}" type="${f.type || "text"}" ${f.type === "number" ? 'inputmode="numeric"' : ""} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : 'autocomplete="off"'} ${ph} value="${esc(v)}" ${f.autofocus ? "autofocus" : ""}></label>`;
  }
}

function readForm(formEl, fields) {
  const out = {};
  for (const f of fields) {
    const el = formEl.elements[f.name];
    if (!el) continue;
    let v;
    if (f.type === "toggle") v = el.checked;
    else if (f.type === "money") v = parseMoney(el.value);
    else if (f.type === "number") v = el.value === "" ? null : parseInt(el.value, 10);
    else v = el.value.trim() === "" ? null : el.value.trim();
    if (f.required && (v === null || v === "")) {
      toast(`Preencha: ${f.label || f.name}`);
      el.focus?.();
      return null;
    }
    out[f.name] = v;
  }
  return out;
}

function form({ title, fields, values = {}, submit = "Salvar", onSubmit, onDelete, setup, extra = "" }) {
  const html = `<h2>${esc(title)}</h2><form novalidate>${fields.map((f) => fieldHtml(f, values)).join("")}${extra}
    <div class="actions"><button class="btn" type="submit">${esc(submit)}</button>${onDelete ? `<button class="btn danger" type="button" data-del>Excluir</button>` : ""}</div></form>`;
  return openSheet(html, (sheet, close) => {
    const f = sheet.querySelector("form");
    sheet.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      const input = seg.querySelector("input");
      input.value = b.dataset.v;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    sheet.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => {
      const input = b.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
    }));
    sheet.querySelectorAll("[data-gen]").forEach((b) => b.addEventListener("click", () => {
      const input = b.parentElement.querySelector("input");
      input.value = genPassword();
      input.type = "text";
    }));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = readForm(f, fields);
      if (!v) return;
      const btn = f.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const r = await onSubmit(v, f);
        if (r !== false) { close(true); refresh(); }
      } catch (err) { console.error(err); }
      finally { btn.disabled = false; }
    });
    const del = sheet.querySelector("[data-del]");
    del?.addEventListener("click", async () => {
      if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Toque de novo pra excluir"; return; }
      try { await onDelete(); close(true); refresh(); toast("Excluído"); } catch (err) { console.error(err); }
    });
    const first = f.querySelector("input:not([type=hidden]), textarea");
    if (first && !("ontouchstart" in window)) setTimeout(() => first.focus(), 260);
    setup?.(f, sheet, close);
  });
}

/* ---------- roteamento ---------- */
let handlers = {};
let cleanups = [];
let renderToken = 0;
const routes = {};

function go(hash, replace = false) {
  if (replace) { history.replaceState(null, "", hash); render(); }
  else location.hash = hash;
}
function routeParts() {
  const [name, ...args] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  return { name: name || "home", args };
}

async function render(keepScroll = false) {
  const token = ++renderToken;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  const keep = active && app.contains(active) && active.id ? { id: active.id, value: active.value } : null;
  cleanups.forEach((f) => f());
  cleanups = [];
  handlers = {};
  state.offline = false;

  nav.hidden = side.hidden = !(state.user && state.household);
  if (!state.user) { app.innerHTML = authView(); drawIcons(); return; }
  if (!state.household) { app.innerHTML = setupView(); drawIcons(); return; }

  const { name, args } = routeParts();
  app.dataset.route = name;
  const group = MONEY_ROUTES.includes(name) ? "dinheiro" : CASA_MODS.includes(name) || name === "casa" ? "casa" : name === "ajustes" ? "ajustes" : "home";
  nav.querySelectorAll("a[data-g]").forEach((a) => a.classList.toggle("on", a.dataset.g === group));
  side.innerHTML = sideHtml(name);
  const view = routes[name] || routes.home;
  let spinner;
  if (!keepScroll) spinner = setTimeout(() => token === renderToken && (app.innerHTML = `<div class="loading">${ic("loader", "spin")}</div>`, drawIcons()), 180);
  let html;
  try { html = await view(...args); }
  catch (e) { console.error(e); html = `${topbar("Ops")}<div class="empty">Não consegui carregar agora.<br><br><button class="btn ghost" data-a="retry">Tentar de novo</button></div>`; handlers.retry = () => render(); }
  clearTimeout(spinner);
  if (token !== renderToken) return;
  app.innerHTML = (state.offline ? `<div class="offline">${ic("wifi-off")} Offline: mostrando os últimos dados</div>` : "") + html;
  const t = app.querySelector("template[data-cta]");
  const slot = document.getElementById("topAct");
  if (t && slot) {
    slot.insertAdjacentHTML("beforeend", `<button class="round ink" data-a="${t.dataset.a}" data-m="${t.dataset.m}" aria-label="${t.dataset.label}" title="${t.dataset.label}">${ic(t.dataset.icon)}</button>`);
  }
  if (t && t.dataset.icon === "plus" && CASA_MODS.includes(name)) {
    app.insertAdjacentHTML("beforeend", `<button class="add-row" data-a="${t.dataset.a}" data-m="${t.dataset.m}">${t.dataset.label} ${ic("plus")}</button>`);
  }
  drawIcons();
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.value; el.focus(); } }
  window.scrollTo(0, keepScroll ? scrollY : 0);
}
const refresh = () => render(true);
let refreshTimer;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); };

window.addEventListener("hashchange", () => render());
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || !(app.contains(el) || nav.contains(el) || side.contains(el))) return;
  const fn = handlers[el.dataset.a] || globalActions[el.dataset.a];
  if (fn) { e.preventDefault(); e.stopPropagation(); fn(el.dataset, el, e); }
});
document.addEventListener("submit", (e) => {
  const el = e.target.closest("form[data-submit]");
  if (!el || !app.contains(el)) return;
  e.preventDefault();
  handlers[el.dataset.submit]?.(el);
});

function sideHtml(name) {
  const P = PREFS.get();
  const it = (to, icon, label) => `<a class="it ${name === (to || "home") ? "on" : ""}" href="#/${to}">${ic(icon)}${label}</a>`;
  const dark = document.documentElement.dataset.theme === "dark";
  return `<div class="brand"><span>${LOGO_SVG}</span>Bunny</div>
    <button class="new" data-a="plus">${ic("plus")} Adicionar</button>
    ${it("", "house", "Início")}
    <div class="grp">Dinheiro</div>
    ${it("financas", "wallet", "Mês")}${it("fixos", "repeat", "Fixos")}${it("caixinhas", "piggy-bank", "Caixinhas")}
    <div class="grp">${esc(state.household?.name || "Casa")}</div>
    ${CASA_MODS.filter((k) => P.mods[k] !== false).map((k) => it(k, MOD_INFO[k].i, MOD_INFO[k].t)).join("")}
    <div class="grp"></div>
    ${it("ajustes", "settings-2", "Ajustes")}
    <div class="foot">
      <div class="who">${esc(state.member?.display_name || "")}<small>${esc(state.user?.email || "")}</small></div>
      <div class="theme-pill"><button class="${dark ? "" : "on"}" data-a="themeq" data-v="light" aria-label="Claro">${ic("sun")}</button><button class="${dark ? "on" : ""}" data-a="themeq" data-v="dark" aria-label="Escuro">${ic("moon")}</button></div>
    </div>`;
}

const globalActions = {
  themeq: (d) => { PREFS.save({ theme: d.v }); refresh(); },
  back: () => go(CASA_MODS.includes(routeParts().name) ? "#/casa" : "#/"),
  nav: (d) => go(d.to),
  tab: (d) => { const { name } = routeParts(); go(`#/${name}/${d.v}`, true); },
  open: (d) => window.open(normUrl(d.url), "_blank", "noopener"),
  copy: (d) => copy(d.text),
};

const CASA_MODS = ["compras", "tarefas", "lembretes", "mural", "desejos", "juntos", "info", "atalhos", "cofre"];
const MONEY_ROUTES = ["financas", "fixos", "caixinhas"];
const HUBS = [["home", "início", "#/"], ["dinheiro", "dinheiro", "#/financas"], ["casa", "casa", "#/casa"], ["ajustes", "ajustes", "#/ajustes"]];
const hubOf = (name) => (MONEY_ROUTES.includes(name) ? "dinheiro" : ["home", "casa", "ajustes"].includes(name) ? name : null);
function topbar(title, right) {
  const { name } = routeParts();
  const hub = hubOf(name);
  if (hub) {
    const i = HUBS.findIndex((h) => h[0] === hub);
    const nx = HUBS[(i + 1) % HUBS.length];
    return `<header class="top">
      <a class="logo-btn" href="#/" aria-label="Início">${LOGO_SVG}</a>
      <span class="pill">${esc(state.household?.name || "Bunny")}</span>
      <div id="topAct">${right ?? ""}</div>
    </header>
    <h1 class="page-title">${HUBS[i][1].replace(/^./, (c) => c.toUpperCase())}</h1>`;
  }
  return `<header class="top">
    <button class="round" data-a="back" aria-label="Voltar">${ic("arrow-left")}</button>
    <span class="pill">${esc(title)}</span>
    <div id="topAct">${right ?? ""}</div>
  </header>`;
}
const moneyTabs = (cur) => `<div class="tabs-top">${[["financas", "Mês"], ["fixos", "Fixos"], ["caixinhas", "Caixinhas"]].map(([k, l]) => `<button class="${k === cur ? "on" : ""}" data-a="nav" data-to="#/${k}">${l}</button>`).join("")}</div>`;
const chips = (items, current) => `<div class="chips">${items.map(([v, l]) => `<button class="chip ${v === current ? "on" : ""}" data-a="tab" data-v="${v}">${esc(l)}</button>`).join("")}</div>`;
const cta = (label, action, icon = "plus", m = "") => `<template data-cta data-a="${action}" data-m="${m}" data-icon="${icon}" data-label="${esc(label)}"></template>`;
const empty = (msg) => `<div class="empty">${msg}</div>`;
const tile = ({ to, icon, accent, title, sub, add, wide }) => `
  <div class="card ${wide ? "wide" : ""}" data-a="nav" data-to="#/${to}" role="link">
    <div class="tile-icon">${ic(icon)}${accent ? `<span class="accent">${ic(accent)}</span>` : ""}</div>
    <div class="tile-title">${esc(title)}</div>
    <div class="tile-sub">${sub}</div>
    ${add ? `<button class="plus" data-a="quick" data-m="${add}" aria-label="Adicionar">${ic("plus")}</button>` : ""}
  </div>`;
const realtime = (tables) => {
  const ch = sb.channel("rt-" + Math.random().toString(36).slice(2));
  tables.forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `household_id=eq.${state.household.id}` }, refreshSoon));
  ch.subscribe();
  cleanups.push(() => sb.removeChannel(ch));
};

/* ---------- regras de finanças ---------- */
function inMonth(dateStr, m) { const d = parseD(dateStr); return d >= monthStart(m) && d <= monthEnd(m); }
function fixedDate(r, m) { return clampDate(m.getFullYear(), m.getMonth(), r.day); }
function monthSummary(txs, recs, m) {
  const mt = txs.filter((t) => inMonth(t.date, m));
  const income = sum(mt.filter((t) => t.kind === "income"), (t) => t.amount);
  const expense = sum(mt.filter((t) => t.kind === "expense"), (t) => t.amount);
  const paidIds = new Set(mt.map((t) => t.recurring_id).filter(Boolean));
  const active = recs.filter((r) => r.active);
  const pending = active.filter((r) => !paidIds.has(r.id));
  const pendingIn = sum(pending.filter((r) => r.kind === "income"), (r) => r.amount);
  const pendingOut = sum(pending.filter((r) => r.kind === "expense"), (r) => r.amount);
  const variable = sum(mt.filter((t) => t.kind === "expense" && !t.recurring_id), (t) => t.amount);
  const now = today0();
  let projectedVar = 0;
  if (monthStart(now).getTime() === m.getTime()) {
    const passed = now.getDate();
    const total = daysIn(m.getFullYear(), m.getMonth());
    projectedVar = passed > 0 ? (variable / passed) * (total - passed) : 0;
  }
  const forecast = income + pendingIn - expense - pendingOut - projectedVar;
  return { mt, income, expense, balance: income - expense, pending, pendingIn, pendingOut, variable, projectedVar, forecast, paidIds };
}
function nextOccurrence(dateStr, repeat) {
  const base = parseD(dateStr);
  const t = today0();
  if (repeat === "none" || base >= t) return base;
  if (repeat === "weekly") { const n = Math.ceil((t - base) / (7 * 864e5)); return addDays(base, n * 7); }
  if (repeat === "monthly") { for (let i = 1; i < 1200; i++) { const d = clampDate(base.getFullYear(), base.getMonth() + i, base.getDate()); if (d >= t) return d; } }
  if (repeat === "yearly") { for (let i = 1; i < 200; i++) { const d = clampDate(base.getFullYear() + i, base.getMonth(), base.getDate()); if (d >= t) return d; } }
  return base;
}
function advanceChore(dueStr, repeat) {
  const t = today0();
  let d = dueStr ? parseD(dueStr) : t;
  const step = (x) => repeat === "daily" ? addDays(x, 1) : repeat === "weekly" ? addDays(x, 7) : clampDate(x.getFullYear(), x.getMonth() + 1, x.getDate());
  do { d = step(d); } while (d < t);
  return iso(d);
}

/* ---------- formulários reutilizáveis (usados na tela e no "+" da home) ---------- */
const catOptions = (kind) => state.cats
  .filter((c) => !kind || c.kind === kind)
  .map((c) => ({ v: c.id, l: c.name, group: kind ? "" : c.kind === "income" ? "Entradas" : "Gastos" }));

const forms = {
  async transaction(t = {}) {
    const recent = await db.list("transactions", (b) => b.order("created_at", { ascending: false }).limit(300)).catch(() => []);
    const learned = {};
    recent.forEach((x) => { const k = x.description.toLowerCase().trim(); if (x.category_id && !learned[k]) learned[k] = x.category_id; });
    const kind = t.kind || "expense";
    return form({
      title: t.id ? "Editar lançamento" : "Novo lançamento",
      values: { kind, date: iso(today0()), category_id: catOptions(kind)[0]?.v, ...t },
      fields: [
        { name: "kind", type: "seg", options: [{ v: "expense", l: "Gasto" }, { v: "income", l: "Entrada" }] },
        { name: "amount", type: "money", label: "Valor", required: true },
        { name: "description", label: "Descrição", required: true, placeholder: "Ex: Mercado, Uber, Pix faxina" },
        { name: "category_id", type: "select", label: "Categoria", options: catOptions(kind) },
        { name: "date", type: "date", label: "Data", required: true },
      ],
      setup(f) {
        let touched = !!t.id;
        const fillCats = () => {
          const k = f.elements.kind.value;
          const sel = f.elements.category_id;
          const cur = sel.value;
          sel.innerHTML = catOptions(k).map((o) => `<option value="${o.v}">${esc(o.l)}</option>`).join("");
          if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
        };
        f.elements.kind.addEventListener("change", fillCats);
        f.elements.category_id.addEventListener("change", () => (touched = true));
        f.elements.description.addEventListener("input", () => {
          const hit = learned[f.elements.description.value.toLowerCase().trim()];
          if (!touched && hit && catById(hit)?.kind === f.elements.kind.value) f.elements.category_id.value = hit;
        });
      },
      onSubmit: (v) => (t.id ? db.set("transactions", t.id, v) : db.add("transactions", v)).then(() => toast(t.id ? "Salvo" : "Lançado")),
      onDelete: t.id ? () => db.del("transactions", t.id) : null,
    });
  },
  recurring(r = {}) {
    const kind = r.kind || "expense";
    return form({
      title: r.id ? "Editar fixo" : kind === "income" ? "Nova receita fixa" : "Novo gasto fixo",
      values: { kind, day: 5, active: true, category_id: catOptions(kind)[0]?.v, ...r },
      fields: [
        { name: "kind", type: "seg", options: [{ v: "expense", l: "Gasto fixo" }, { v: "income", l: "Receita fixa" }] },
        { name: "name", label: "Nome", required: true, placeholder: "Ex: Aluguel, Internet, Salário" },
        { name: "amount", type: "money", label: "Valor por mês", required: true },
        { name: "day", type: "number", label: "Dia do mês", required: true },
        { name: "category_id", type: "select", label: "Categoria", options: catOptions() },
        { name: "url", type: "url", label: "Link pra pagar / segunda via (opcional)", placeholder: "https://" },
        { name: "is_subscription", type: "toggle", label: "É uma assinatura" },
        { name: "active", type: "toggle", label: "Ativo" },
      ],
      onSubmit: (v) => {
        v.day = Math.min(31, Math.max(1, v.day || 1));
        v.url = normUrl(v.url);
        return r.id ? db.set("recurring", r.id, v) : db.add("recurring", v);
      },
      onDelete: r.id ? () => db.del("recurring", r.id) : null,
    });
  },
  box(b = {}) {
    return form({
      title: b.id ? "Editar caixinha" : "Nova caixinha",
      values: b,
      fields: [
        { name: "name", label: "Nome", required: true, placeholder: "Ex: Reserva, Viagem, Carro" },
        { name: "goal", type: "money", label: "Meta (opcional)" },
      ],
      onSubmit: (v) => (b.id ? db.set("savings_boxes", b.id, v) : db.add("savings_boxes", v)),
      onDelete: b.id ? () => db.del("savings_boxes", b.id) : null,
    });
  },
  move(box, sign) {
    return form({
      title: `${sign > 0 ? "Guardar em" : "Tirar de"} ${box.name}`,
      submit: sign > 0 ? "Guardar" : "Tirar",
      fields: [
        { name: "amount", type: "money", label: "Valor", required: true },
        { name: "note", label: "Nota (opcional)" },
        { name: "date", type: "date", label: "Data", value: iso(today0()) },
      ],
      onSubmit: (v) => db.add("savings_moves", { box_id: box.id, amount: Math.abs(v.amount) * sign, note: v.note, date: v.date || iso(today0()) }),
    });
  },
  shopping(s = {}) {
    return form({
      title: s.id ? "Editar item" : "Adicionar à lista",
      values: { section: "Mercado", ...s },
      fields: [
        { name: "name", label: "Item", required: true },
        { name: "qty", label: "Quantidade (opcional)", placeholder: "Ex: 2, 1kg" },
        { name: "section", type: "select", label: "Onde", options: SHOP_SECTIONS.map((x) => ({ v: x, l: x })) },
      ],
      onSubmit: (v) => (s.id ? db.set("shopping_items", s.id, v) : db.add("shopping_items", v)),
      onDelete: s.id ? () => db.del("shopping_items", s.id) : null,
    });
  },
  pantry(p = {}) {
    return form({
      title: p.id ? "Editar item da despensa" : "Novo item na despensa",
      values: { status: "ok", ...p },
      fields: [
        { name: "name", label: "Item", required: true },
        { name: "status", type: "seg", options: [{ v: "ok", l: "Tem" }, { v: "acabando", l: "Acabando" }, { v: "acabou", l: "Acabou" }] },
      ],
      onSubmit: (v) => (p.id ? db.set("pantry_items", p.id, v) : db.add("pantry_items", v)),
      onDelete: p.id ? () => db.del("pantry_items", p.id) : null,
    });
  },
  chore(c = {}) {
    return form({
      title: c.id ? "Editar tarefa" : "Nova tarefa",
      values: { repeat: "none", assignee: "", ...c, assignee: c.assignee || "" },
      fields: [
        { name: "title", label: "Tarefa", required: true, placeholder: "Ex: Trocar roupa de cama" },
        { name: "assignee", type: "select", label: "Quem faz", options: [{ v: "", l: "Qualquer um" }, ...state.members.map((m) => ({ v: m.user_id, l: m.display_name }))] },
        { name: "due", type: "date", label: "Quando (opcional)" },
        { name: "repeat", type: "select", label: "Repete", options: [{ v: "none", l: "Não repete" }, { v: "daily", l: "Todo dia" }, { v: "weekly", l: "Toda semana" }, { v: "monthly", l: "Todo mês" }] },
      ],
      onSubmit: (v) => (c.id ? db.set("chores", c.id, v) : db.add("chores", v)),
      onDelete: c.id ? () => db.del("chores", c.id) : null,
    });
  },
  reminder(r = {}) {
    return form({
      title: r.id ? "Editar lembrete" : "Novo lembrete",
      values: { kind: "vencimento", repeat: "yearly", date: iso(today0()), ...r },
      fields: [
        { name: "title", label: "O quê", required: true, placeholder: "Ex: IPVA, Aniversário da mãe, Vacina do Thor" },
        { name: "kind", type: "select", label: "Tipo", options: Object.entries(REMINDER_KINDS).map(([v, x]) => ({ v, l: x.l })) },
        { name: "date", type: "date", label: "Data", required: true },
        { name: "repeat", type: "select", label: "Repete", options: [{ v: "none", l: "Uma vez só" }, { v: "weekly", l: "Toda semana" }, { v: "monthly", l: "Todo mês" }, { v: "yearly", l: "Todo ano" }] },
        { name: "notes", type: "textarea", label: "Notas (opcional)" },
      ],
      onSubmit: (v) => (r.id ? db.set("reminders", r.id, v) : db.add("reminders", v)),
      onDelete: r.id ? () => db.del("reminders", r.id) : null,
    });
  },
  note() {
    return form({
      title: "Novo recado",
      submit: "Colar no mural",
      fields: [{ name: "text", type: "textarea", required: true, label: "Recado", placeholder: "Compra pão na volta ♥" }],
      onSubmit: (v) => db.add("notes", v),
    });
  },
  wish(w = {}) {
    return form({
      title: w.id ? "Editar desejo" : "Novo desejo",
      values: w,
      fields: [
        { name: "title", label: "O quê", required: true },
        { name: "price", type: "money", label: "Preço (opcional)" },
        { name: "url", type: "url", label: "Link (opcional)", placeholder: "https://" },
      ],
      onSubmit: (v) => { v.url = normUrl(v.url); return w.id ? db.set("wishes", w.id, v) : db.add("wishes", v); },
      onDelete: w.id ? () => db.del("wishes", w.id) : null,
    });
  },
  bucket(b = {}) {
    return form({
      title: b.id ? "Editar" : "Pra fazer juntos",
      values: { kind: "restaurante", ...b },
      fields: [
        { name: "title", label: "O quê", required: true, placeholder: "Ex: Jantar no japonês novo" },
        { name: "kind", type: "select", label: "Tipo", options: Object.entries(BUCKET_KINDS).map(([v, x]) => ({ v, l: x.l })) },
      ],
      onSubmit: (v) => (b.id ? db.set("bucket_items", b.id, v) : db.add("bucket_items", v)),
      onDelete: b.id ? () => db.del("bucket_items", b.id) : null,
    });
  },
  info(i = {}) {
    return form({
      title: i.id ? "Editar informação" : "Nova informação",
      values: { section: "Casa", ...i },
      fields: [
        { name: "section", type: "select", label: "Grupo", options: INFO_SECTIONS.map((x) => ({ v: x, l: x })) },
        { name: "label", label: "Nome", required: true, placeholder: "Ex: CEP, Código do portão" },
        { name: "value", type: "textarea", label: "Valor", required: true },
      ],
      extra: `<p class="muted" style="font-size:12px;margin:-4px 4px 0">Dica: no grupo Wi-Fi, use o nome da rede em "Nome" e a senha em "Valor" que eu gero o QR code pra visita.</p>`,
      onSubmit: (v) => (i.id ? db.set("info_items", i.id, v) : db.add("info_items", v)),
      onDelete: i.id ? () => db.del("info_items", i.id) : null,
    });
  },
  link(l = {}) {
    return form({
      title: l.id ? "Editar atalho" : "Novo atalho",
      values: { section: "Geral", ...l },
      fields: [
        { name: "title", label: "Nome", required: true, placeholder: "Ex: 2ª via da Enel" },
        { name: "url", type: "url", label: "Link", required: true, placeholder: "https://" },
        { name: "section", label: "Pasta", placeholder: "Ex: Contas, Bancos, Gov" },
      ],
      onSubmit: (v) => { v.url = normUrl(v.url); v.section = v.section || "Geral"; return l.id ? db.set("links", l.id, v) : db.add("links", v); },
      onDelete: l.id ? () => db.del("links", l.id) : null,
    });
  },
  category(c = {}) {
    return form({
      title: c.id ? "Editar categoria" : "Nova categoria",
      values: { kind: "expense", icon: "tag", ...c },
      fields: [
        { name: "kind", type: "seg", options: [{ v: "expense", l: "Gasto" }, { v: "income", l: "Entrada" }] },
        { name: "name", label: "Nome", required: true },
        { name: "budget", type: "money", label: "Orçamento por mês (opcional)" },
        { name: "icon", type: "select", label: "Ícone", options: CAT_ICONS.map((x) => ({ v: x[0], l: x[1] })) },
      ],
      onSubmit: async (v) => {
        if (c.id) await db.set("categories", c.id, v);
        else await db.add("categories", { ...v, sort: state.cats.length + 1 });
        state.cats = await q(sb.from("categories").select("*").order("sort"));
      },
      onDelete: c.id ? async () => { await db.del("categories", c.id); state.cats = state.cats.filter((x) => x.id !== c.id); } : null,
    });
  },
};

const SHOP_SECTIONS = ["Mercado", "Hortifruti", "Açougue", "Padaria", "Limpeza", "Higiene", "Farmácia", "Pet", "Casa", "Outros"];
const INFO_SECTIONS = ["Casa", "Wi-Fi", "Contatos", "Documentos", "Carro", "Saúde", "Contas", "Outros"];
const REMINDER_KINDS = {
  data: { l: "Data especial", i: "cake" },
  vencimento: { l: "Vencimento", i: "receipt" },
  manutencao: { l: "Manutenção", i: "wrench" },
  pet: { l: "Pet", i: "paw-print" },
  planta: { l: "Planta", i: "sprout" },
  documento: { l: "Documento", i: "file-text" },
};
const BUCKET_KINDS = {
  restaurante: { l: "Restaurante", i: "utensils" },
  filme: { l: "Filme / série", i: "film" },
  viagem: { l: "Viagem", i: "plane" },
  passeio: { l: "Passeio", i: "map-pin" },
  outro: { l: "Outro", i: "sparkles" },
};
const CAT_ICONS = [["tag", "Etiqueta"], ["shopping-cart", "Carrinho"], ["house", "Casa"], ["receipt", "Conta"], ["car", "Carro"], ["bike", "Delivery"], ["popcorn", "Lazer"], ["heart-pulse", "Saúde"], ["repeat", "Assinatura"], ["paw-print", "Pet"], ["wallet", "Carteira"], ["sparkles", "Extra"], ["utensils", "Restaurante"], ["graduation-cap", "Estudo"], ["shirt", "Roupa"], ["gift", "Presente"], ["plane", "Viagem"], ["fuel", "Combustível"], ["baby", "Bebê"], ["dumbbell", "Academia"]];

const quickAdd = {
  financas: () => forms.transaction(),
  fixos: () => forms.recurring(),
  caixinhas: () => forms.box(),
  compras: () => forms.shopping(),
  tarefas: () => forms.chore(),
  lembretes: () => forms.reminder(),
  mural: () => forms.note(),
  desejos: () => forms.wish(),
  juntos: () => forms.bucket(),
  info: () => forms.info(),
  atalhos: () => forms.link(),
};
globalActions.quick = (d) => quickAdd[d.m]?.();

/* ---------- telas: login e casa ---------- */
function authView() {
  const signup = authView.mode === "signup";
  handlers = {
    authmode: () => { authView.mode = signup ? "login" : "signup"; render(); },
  };
  handlers.auth = async (f) => {
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || password.length < 6) return toast("Use um e-mail e senha de 6+ caracteres");
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (signup) {
        const data = await q(sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + "/app/" } }));
        if (!data.session) { toast("Conta criada! Confirme pelo e-mail e depois entre."); authView.mode = "login"; render(); }
      } else {
        await q(sb.auth.signInWithPassword({ email, password }));
      }
    } catch {} finally { btn.disabled = false; }
  };
  return `<section class="auth">
    <div class="logo">${LOGO_SVG}</div>
    <h1>${signup ? "Criar conta" : "Bunny"}</h1>
    <p>${signup ? "Cada um cria a sua conta e depois vocês entram na mesma casa." : "Finanças, compras, lembretes e tudo da casa num lugar só."}</p>
    <form data-submit="auth" novalidate>
      <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="email" inputmode="email"></label>
      <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}"></label>
      <button class="btn" type="submit" style="margin-top:8px">${signup ? "Criar conta" : "Entrar"}</button>
    </form>
    <button class="link-btn" data-a="authmode">${signup ? "Já tenho conta" : "Ainda não tenho conta"}</button>
  </section>`;
}

function setupView() {
  const join = setupView.mode === "join";
  handlers = { setupmode: () => { setupView.mode = join ? "create" : "join"; render(); }, logout: () => sb.auth.signOut() };
  handlers.setup = async (f) => {
    const display = f.display.value.trim();
    if (!display) return toast("Diz seu nome");
    try {
      if (join) await q(sb.rpc("join_household", { p_code: f.code.value, p_display: display }));
      else await q(sb.rpc("create_household", { p_name: f.house.value, p_display: display }));
      await loadHouse();
      location.hash = "#/ajustes";
      render();
      if (!join) toast("Casa criada! Mande o código pra sua esposa");
    } catch {}
  };
  return `<section class="auth">
    <div class="logo">${join ? ic("key-round") : LOGO_SVG}</div>
    <h1>${join ? "Entrar na casa" : "Criar a casa"}</h1>
    <p>${join ? "Peça o código de 6 letras pra quem criou a casa (fica em Ajustes)." : "Quem cria a casa recebe um código pra outra pessoa entrar."}</p>
    <form data-submit="setup" novalidate>
      <label class="field"><span>Seu nome</span><input name="display" autocomplete="given-name"></label>
      ${join
        ? `<label class="field"><span>Código</span><input name="code" autocapitalize="characters" maxlength="6" style="letter-spacing:.2em;text-transform:uppercase"></label>`
        : `<label class="field"><span>Nome da casa</span><input name="house" placeholder="Nossa casa"></label>`}
      <button class="btn" type="submit" style="margin-top:8px">${join ? "Entrar" : "Criar casa"}</button>
    </form>
    <button class="link-btn" data-a="setupmode">${join ? "Quero criar uma casa nova" : "Já tenho um código"}</button>
    <button class="link-btn muted" data-a="logout">Sair</button>
  </section>`;
}

/* ---------- home ---------- */
routes.home = async () => {
  const m = monthStart(new Date());
  const t0 = today0();
  const P = PREFS.get();
  const [txs, recs, rems, chores, notes, shop] = await Promise.all([
    db.list("transactions", (b) => b.gte("date", iso(m)).lte("date", iso(monthEnd(m))), "home-tx"),
    db.list("recurring", (b) => b, "recurring"),
    db.list("reminders", (b) => b, "reminders"),
    db.list("chores", (b) => b.eq("done", false).order("due", { ascending: true, nullsFirst: false }), "home-chores"),
    db.list("notes", (b) => b.order("created_at", { ascending: false }).limit(1), "home-notes"),
    db.list("shopping_items", (b) => b.eq("checked", false).order("created_at"), "home-shop"),
  ]);
  const s = monthSummary(txs, recs, m);

  const upcoming = [];
  s.pending.forEach((r) => {
    const d = fixedDate(r, m);
    const n = diffDays(d);
    if (n <= 7) upcoming.push({ d, t: r.name, sub: n < 0 ? `Atrasado · ${rel(d)}` : r.kind === "income" ? "Receita fixa" : "Conta fixa", v: brl(r.amount), cls: n < 0 && r.kind === "expense" ? "neg" : "", to: "#/fixos" });
  });
  rems.forEach((r) => {
    const d = nextOccurrence(r.date, r.repeat);
    const n = diffDays(d);
    if (n >= 0 && n <= 14) upcoming.push({ d, t: r.title, sub: REMINDER_KINDS[r.kind]?.l, v: "", to: "#/lembretes" });
  });
  chores.filter((c) => c.due && diffDays(parseD(c.due)) <= 2).forEach((c) => {
    const d = parseD(c.due);
    upcoming.push({ d, t: c.title, sub: `Tarefa${c.assignee ? " · " + memberName(c.assignee) : ""}`, v: "", cls: d < t0 ? "warn" : "", to: "#/tarefas" });
  });
  upcoming.sort((a, b) => a.d - b.d);

  const hour = new Date().getHours();
  const hello = hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const spentPct = s.income > 0 ? Math.min(100, Math.round((s.expense / s.income) * 100)) : null;
  const left = daysIn(m.getFullYear(), m.getMonth()) - t0.getDate();
  const note = notes[0];

  handlers.privacy = () => { PREFS.save({ private: !PREFS.get().private }); refresh(); };
  handlers.shopToggle = async (d) => { await db.set("shopping_items", d.id, { checked: true }); toast("Comprado ✓"); refresh(); };
  handlers.choreDone = async (d) => {
    const c = chores.find((x) => x.id === d.id);
    if (c.repeat !== "none") await db.set("chores", c.id, { due: advanceChore(c.due, c.repeat) });
    else await db.set("chores", c.id, { done: true });
    toast("Feito ✓"); refresh();
  };
  handlers.qshop = async (f) => {
    const names = f.qname.value.split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.length) return;
    await q(sb.from("shopping_items").insert(names.map((name) => ({ name }))));
    refresh();
  };

  const shortD = (d) => `${d.getDate()} ${monthName(d, { month: "short" }).replace(".", "")}`;
  const nextRows = upcoming.slice(0, 3).map((u) => {
    const n = diffDays(u.d);
    return `<div class="row" data-a="nav" data-to="${u.to}">
      <div class="main"><div class="t">${esc(u.t)}</div></div>
      <span class="datechip ${n < 0 ? "late" : n <= 1 ? "soon" : ""}">${n === 0 ? "hoje" : n === 1 ? "amanhã" : n < 0 ? "atrasado" : shortD(u.d)}</span>
    </div>`;
  }).join("");
  return `${topbar("Início", `<a class="count-pill" href="#/lembretes" aria-label="Lembretes"><b>${upcoming.length}</b>${ic("calendar")}</a>`)}
  <div class="home-wrap"><div>
    <div class="sheet-card">
      <div class="sec row-sec"><span class="tag blue">${monthName(m).replace(/^./, (c) => c.toUpperCase())}</span><span class="tag beige">${left} dias</span>${spentPct === null ? "" : `<span class="right muted">${spentPct}% gasto</span>`}</div>
      <div class="sec">
        <div class="lbl">Sobra prevista <button class="eye" data-a="privacy" aria-label="Esconder valores" style="margin-left:auto">${ic(P.private ? "eye-off" : "eye")}</button></div>
        <div class="big">${brl0(s.forecast)}</div>
        ${spentPct === null ? "" : `<div class="hc-bar"><i style="width:${spentPct}%"></i></div>`}
      </div>
      <div class="sec two">
        <div><div class="lbl">Entrou</div><div class="val">${brl0(s.income)}</div></div>
        <div><div class="lbl">Saiu</div><div class="val">${brl0(s.expense)}</div></div>
      </div>
      ${P.homeNext && upcoming.length ? `<div class="sec"><div class="lbl">Próximos</div>${nextRows}</div>` : ""}
      <div class="card-foot">
        <button data-a="newtx">${ic("minus")} Gasto</button>
        <button data-a="newin">${ic("plus")} Entrada</button>
        <button class="go" data-a="plus" aria-label="Adicionar"><span>${ic("plus")}</span></button>
      </div>
    </div>
  </div>
  <div class="board desk-only">
    <div class="col">
      <div class="col-head">Compras <a href="#/compras">abrir</a></div>
      <form data-submit="qshop" class="quick-add"><input id="qname" name="qname" class="input" placeholder="Adicionar item" autocomplete="off"><button class="round" aria-label="Adicionar">${ic("plus")}</button></form>
      <div class="list">${shop.slice(0, 8).map((i) => `<div class="row" data-a="shopToggle" data-id="${i.id}"><span class="check">${ic("check")}</span><div class="main"><div class="t">${esc(i.name)}</div></div></div>`).join("") || `<div class="empty">Lista vazia</div>`}</div>
    </div>
    <div class="col">
      <div class="col-head">Tarefas <a href="#/tarefas">abrir</a></div>
      <div class="list">${chores.slice(0, 8).map((c) => `<div class="row" data-a="choreDone" data-id="${c.id}"><span class="check">${ic("check")}</span><div class="main"><div class="t">${esc(c.title)}</div></div></div>`).join("") || `<div class="empty">Nada pendente</div>`}</div>
    </div>
  </div></div>`;
};
globalActions.newtx = () => forms.transaction();globalActions.newtx = () => forms.transaction();
globalActions.newin = () => forms.transaction({ kind: "income" });

/* ---------- aba Casa ---------- */
const MOD_INFO = {
  compras: { t: "Compras", i: "shopping-bag" },
  tarefas: { t: "Tarefas", i: "list-checks" },
  lembretes: { t: "Lembretes", i: "calendar-heart" },
  mural: { t: "Mural", i: "message-circle-heart" },
  desejos: { t: "Desejos", i: "gift" },
  juntos: { t: "Juntos", i: "heart-handshake" },
  info: { t: "Informações", i: "info" },
  atalhos: { t: "Atalhos", i: "link" },
  cofre: { t: "Senhas", i: "key-round" },
};
routes.casa = async () => {
  const P = PREFS.get();
  const [shop, chores, rems] = await Promise.all([
    db.list("shopping_items", (b) => b.select("id").eq("checked", false), "casa-shop"),
    db.list("chores", (b) => b.select("id,due").eq("done", false), "casa-chores"),
    db.list("reminders", (b) => b, "reminders"),
  ]);
  const week = rems.filter((r) => { const n = diffDays(nextOccurrence(r.date, r.repeat)); return n >= 0 && n <= 7; }).length;
  const sub = {
    compras: shop.length ? `${shop.length} ${shop.length === 1 ? "item" : "itens"} na lista` : "Lista vazia",
    tarefas: chores.length ? `${chores.length} pendente${chores.length > 1 ? "s" : ""}` : "Nada pendente",
    lembretes: week ? `${week} nesta semana` : "Datas e vencimentos",
    mural: "Recados da casa", desejos: "O que queremos comprar", juntos: "Lugares, filmes, viagens",
    info: "CEP, Wi-Fi, contatos", atalhos: "Links úteis", cofre: "Cofre criptografado",
  };
  const visible = CASA_MODS.filter((k) => P.mods[k] !== false);
  const counts = { compras: shop.length, tarefas: chores.length, lembretes: week };
  return `${topbar(esc(state.household.name))}
  <div class="tiles3">${visible.map((k) => `
    <a class="tile" href="#/${k}">${counts[k] ? `<span class="count">${counts[k]}</span>` : ""}${ic(MOD_INFO[k].i)}${MOD_INFO[k].t}</a>`).join("")}</div>`;
};

/* ---------- menu do + ---------- */
globalActions.plus = () => openSheet(`<h2>Adicionar</h2><div class="sheet-grid">
  ${[["newtx", "", "minus-circle", "Gasto"], ["newin", "", "plus-circle", "Entrada"], ["quick", "compras", "shopping-bag", "Compra"], ["quick", "tarefas", "list-checks", "Tarefa"], ["quick", "lembretes", "calendar-heart", "Lembrete"], ["quick", "mural", "message-circle-heart", "Recado"], ["quick", "fixos", "repeat", "Fixo"], ["quick", "desejos", "gift", "Desejo"], ["quick", "atalhos", "link", "Atalho"]]
    .map(([a, m, i, l]) => `<button data-qa="${a}" data-m="${m}">${ic(i)}${l}</button>`).join("")}
  </div>`, (sheet, close) => sheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qa]");
    if (!b) return;
    close();
    setTimeout(() => globalActions[b.dataset.qa]({ m: b.dataset.m }), 120);
  }));


/* ---------- finanças ---------- */
routes.financas = async (tab = "extrato") => {
  const m = state.month;
  const from = new Date(Math.min(new Date(m.getFullYear(), m.getMonth() - 5, 1), addDays(today0(), -13)));
  const [txs, recs, moves] = await Promise.all([
    db.list("transactions", (b) => b.gte("date", iso(from)).lte("date", iso(monthEnd(m))).order("date", { ascending: false }).order("created_at", { ascending: false }), `tx-${iso(m)}`),
    db.list("recurring", (b) => b, "recurring"),
    db.list("savings_moves", (b) => b.select("amount,date"), "moves"),
  ]);
  const s = monthSummary(txs, recs, m);
  const isNow = m.getTime() === monthStart(new Date()).getTime();

  handlers.setm = (d) => { state.month = parseD(d.v); refresh(); setTimeout(() => app.querySelector(".day.on")?.scrollIntoView({ inline: "center", block: "nearest" })); };
  handlers.prev = () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); refresh(); };
  handlers.next = () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); refresh(); };
  handlers.edit = (d) => forms.transaction(txs.find((t) => t.id === d.id));
  handlers.budget = (d) => forms.category(catById(d.id));

  let body = "";
  if (tab === "extrato") {
    if (!s.mt.length) body = `<div class="list">${empty("Nenhum lançamento nesse mês ainda.")}</div>`;
    else {
      const byDay = {};
      s.mt.forEach((t) => (byDay[t.date] ||= []).push(t));
      body = Object.entries(byDay).map(([day, list]) => {
        const d = parseD(day);
        const n = diffDays(d);
        const label = n === 0 ? "Hoje" : n === -1 ? "Ontem" : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(/\./g, "");
        return `<div class="section-title">${label}</div>
        <div class="list">${list.map((t) => {
          const c = catById(t.category_id);
          return `<div class="row" data-a="edit" data-id="${t.id}">
            <div class="ic ${t.kind === "income" ? "acc" : ""}">${ic(c?.icon || "tag")}</div>
            <div class="main"><div class="t">${esc(t.description)}</div></div>
            <div class="v ${t.kind === "income" ? "pos" : ""}">${t.kind === "income" ? "+" : "−"} ${brl(t.amount)}</div>
          </div>`;
        }).join("")}</div>`;
      }).join("");
    }
  }

  if (tab === "orcamento") {
    const exp = state.cats.filter((c) => c.kind === "expense");
    const spent = (id) => sum(s.mt.filter((t) => t.kind === "expense" && t.category_id === id), (t) => t.amount);
    const totalBudget = sum(exp, (c) => c.budget);
    const totalSpent = sum(exp.filter((c) => c.budget), (c) => spent(c.id));
    body = `${totalBudget ? `<div class="card wide" style="margin-bottom:10px">
        <div class="muted" style="font-size:13px">Orçamento do mês</div>
        <div style="font-size:24px;font-weight:500;margin-top:4px">${brl(totalSpent)} <span class="muted" style="font-size:15px">de ${brl(totalBudget)}</span></div>
        <div class="bar"><i class="${totalSpent > totalBudget ? "over" : ""}" style="width:${Math.min(100, (totalSpent / totalBudget) * 100)}%"></i></div>
        ${isNow ? `<div class="muted" style="font-size:12px;margin-top:8px">Ainda dá pra gastar ${brl(Math.max(0, totalBudget - totalSpent))} nas categorias com limite.</div>` : ""}
      </div>` : `<div class="card wide" style="margin-bottom:10px"><div class="muted" style="font-size:14px">Toque numa categoria pra definir quanto vocês querem gastar nela por mês.</div></div>`}
      <div class="list">${exp.map((c) => {
        const sp = spent(c.id);
        const pct = c.budget ? (sp / c.budget) * 100 : 0;
        return `<div class="row" data-a="budget" data-id="${c.id}" style="align-items:flex-start">
          <div class="ic">${ic(c.icon)}</div>
          <div class="main"><div class="t">${esc(c.name)}</div>
            <div class="s">${c.budget ? `${brl(sp)} de ${brl(c.budget)}` : `${brl(sp)} · sem limite`}</div>
            ${c.budget ? `<div class="bar"><i class="${pct > 100 ? "over" : ""}" style="width:${Math.min(100, pct)}%"></i></div>` : ""}
          </div>
          <div class="v ${pct > 100 ? "neg" : pct > 85 ? "warn" : ""}">${c.budget ? Math.round(pct) + "%" : ""}</div>
        </div>`;
      }).join("")}</div>`;
  }

  if (tab === "resumo") {
    // semana
    const t0 = today0();
    const wk = txs.filter((t) => t.kind === "expense" && !t.recurring_id && parseD(t.date) > addDays(t0, -7) && parseD(t.date) <= t0);
    const prevWk = txs.filter((t) => t.kind === "expense" && !t.recurring_id && parseD(t.date) > addDays(t0, -14) && parseD(t.date) <= addDays(t0, -7));
    const wkTotal = sum(wk, (t) => t.amount);
    const prevTotal = sum(prevWk, (t) => t.amount);
    const byCat = {};
    wk.forEach((t) => (byCat[t.category_id] = (byCat[t.category_id] || 0) + Number(t.amount)));
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const biggest = [...wk].sort((a, b) => b.amount - a.amount)[0];
    const change = prevTotal ? ((wkTotal - prevTotal) / prevTotal) * 100 : null;

    // categorias do mês
    const monthCats = {};
    s.mt.filter((t) => t.kind === "expense").forEach((t) => (monthCats[t.category_id] = (monthCats[t.category_id] || 0) + Number(t.amount)));
    const catRows = Object.entries(monthCats).sort((a, b) => b[1] - a[1]);

    // 6 meses
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const mm = new Date(m.getFullYear(), m.getMonth() - i, 1);
      const mt = txs.filter((t) => inMonth(t.date, mm));
      months.push({ mm, inc: sum(mt.filter((t) => t.kind === "income"), (t) => t.amount), out: sum(mt.filter((t) => t.kind === "expense"), (t) => t.amount) });
    }
    const maxV = Math.max(1, ...months.map((x) => Math.max(x.inc, x.out)));
    const saved = sum(moves, (x) => x.amount);

    body = `
    <div class="card wide" style="margin-bottom:10px">
      <div class="muted" style="font-size:13px">Gastos do dia a dia, últimos 7 dias</div>
      <div style="font-size:28px;font-weight:500;margin:4px 0 10px">${brl(wkTotal)} <span style="font-size:13px" class="${change === null ? "muted" : change > 0 ? "neg" : "pos"}">${change === null ? "" : `${change > 0 ? "▲" : "▼"} ${Math.abs(Math.round(change))}% vs semana anterior`}</span></div>
      ${wk.length ? `<div class="muted" style="font-size:14px;line-height:1.5">
        ${topCat ? `${Math.round((topCat[1] / wkTotal) * 100)}% foi em <b style="color:var(--fg);font-weight:600">${esc(catById(topCat[0])?.name || "Sem categoria")}</b>.` : ""}
        ${biggest ? ` Maior gasto: <b style="color:var(--fg);font-weight:600">${esc(biggest.description)}</b> (${brl(biggest.amount)}).` : ""}
      </div>` : `<div class="muted" style="font-size:14px">Nenhum gasto nos últimos 7 dias.</div>`}
    </div>

    <div class="card wide" style="margin-bottom:10px">
      <div class="muted" style="font-size:13px;margin-bottom:14px">Entrou × saiu, 6 meses</div>
      <div style="display:flex;align-items:flex-end;gap:10px;height:120px">
        ${months.map((x) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="display:flex;gap:3px;align-items:flex-end;height:100%">
            <div title="Entrou ${brl(x.inc)}" style="width:9px;border-radius:5px;background:var(--accent);height:${Math.max(2, (x.inc / maxV) * 100)}%"></div>
            <div title="Saiu ${brl(x.out)}" style="width:9px;border-radius:5px;background:#6f7075;height:${Math.max(2, (x.out / maxV) * 100)}%"></div>
          </div>
          <div style="font-size:11px" class="muted">${monthName(x.mm, { month: "short" }).replace(".", "")}</div>
        </div>`).join("")}
      </div>
      <div style="display:flex;gap:16px;margin-top:12px;font-size:12px" class="muted">
        <span><i style="display:inline-block;width:8px;height:8px;border-radius:4px;background:var(--accent);margin-right:6px"></i>Entrou</span>
        <span><i style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#6f7075;margin-right:6px"></i>Saiu</span>
        <span style="margin-left:auto">Caixinhas: <b style="color:var(--fg);font-weight:600">${brl0(saved)}</b></span>
      </div>
    </div>

    <div class="section-title">Pra onde foi o dinheiro em ${monthName(m)}</div>
    <div class="list">${catRows.length ? catRows.map(([id, v]) => {
      const c = catById(id);
      return `<div class="row" style="align-items:flex-start"><div class="ic">${ic(c?.icon || "tag")}</div>
        <div class="main"><div class="t">${esc(c?.name || "Sem categoria")}</div><div class="bar"><i style="width:${(v / s.expense) * 100}%"></i></div></div>
        <div class="v">${brl(v)}<small>${Math.round((v / s.expense) * 100)}%</small></div></div>`;
    }).join("") : empty("Sem gastos nesse mês.")}</div>`;
  }

  return `${topbar("Dinheiro")}
  ${moneyTabs("financas")}
  <div class="days">${[-4, -3, -2, -1, 0, 1].map((k) => {
    const mm = new Date(m.getFullYear(), m.getMonth() + k, 1);
    return `<button class="day ${k === 0 ? "on" : ""}" data-a="setm" data-v="${iso(mm)}"><b>${monthName(mm, { month: "short" }).replace(".", "").replace(/^./, (c) => c.toUpperCase())}</b><small>${mm.getFullYear()}</small></button>`;
  }).join("")}</div>
  <div class="sheet-card">
    <div class="sec"><div class="lbl">Saldo do mês</div><div class="big">${brl0(s.balance)}</div></div>
    <div class="sec two">
      <div><div class="lbl">Entrou</div><div class="val">${brl0(s.income)}</div></div>
      <div><div class="lbl">Saiu</div><div class="val">${brl0(s.expense)}</div></div>
    </div>
    <div class="sec row-sec"><span class="lbl" style="margin:0">Previsão do fim do mês</span><span class="right val money">${brl0(s.forecast)}</span></div>
  </div>
  ${chips([["extrato", "Extrato"], ["orcamento", "Orçamento"], ["resumo", "Resumo"]], tab)}
  ${body}
  ${cta("Novo lançamento", "newtx")}`;
};

/* ---------- fixos ---------- */
routes.fixos = async (tab = "gastos") => {
  const m = monthStart(new Date());
  const from = new Date(m.getFullYear(), m.getMonth() - 3, 1);
  const [recs, txs] = await Promise.all([
    db.list("recurring", (b) => b.order("day"), "recurring"),
    db.list("transactions", (b) => b.gte("date", iso(from)), "fixos-tx"),
  ]);
  const s = monthSummary(txs, recs, m);
  const active = recs.filter((r) => r.active);
  const outTotal = sum(active.filter((r) => r.kind === "expense"), (r) => r.amount);
  const inTotal = sum(active.filter((r) => r.kind === "income"), (r) => r.amount);
  const subs = active.filter((r) => r.is_subscription && r.kind === "expense");

  handlers.edit = (d) => forms.recurring(recs.find((r) => r.id === d.id));
  handlers.pay = async (d) => {
    const r = recs.find((x) => x.id === d.id);
    const tx = s.mt.find((t) => t.recurring_id === r.id);
    if (tx) { await db.del("transactions", tx.id); toast("Desmarcado"); }
    else {
      await db.add("transactions", { description: r.name, amount: r.amount, kind: r.kind, category_id: r.category_id, recurring_id: r.id, date: iso(fixedDate(r, m)) });
      toast(r.kind === "income" ? "Recebido ✓" : "Pago ✓ (lançado no extrato)");
    }
    refresh();
  };

  // detector de assinaturas: mesma descrição em 2+ meses diferentes, valor parecido, ainda não cadastrada
  const groups = {};
  txs.filter((t) => t.kind === "expense" && !t.recurring_id).forEach((t) => {
    const k = t.description.toLowerCase().replace(/\d+/g, "").replace(/\s+/g, " ").trim();
    (groups[k] ||= []).push(t);
  });
  const known = new Set(recs.map((r) => r.name.toLowerCase().trim()));
  const suggestions = Object.entries(groups).filter(([k, list]) => {
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    const amts = list.map((t) => Number(t.amount));
    const spread = (Math.max(...amts) - Math.min(...amts)) / Math.max(...amts);
    return months.size >= 2 && spread <= 0.15 && !known.has(k) && k.length > 1;
  }).map(([k, list]) => list.sort((a, b) => (a.date < b.date ? 1 : -1))[0]);
  handlers.suggest = (d) => {
    const t = suggestions.find((x) => x.id === d.id);
    forms.recurring({ name: t.description, amount: t.amount, day: parseD(t.date).getDate(), category_id: t.category_id, is_subscription: true, kind: "expense" });
  };

  const row = (r) => {
    const paid = s.paidIds.has(r.id);
    const d = fixedDate(r, m);
    const late = !paid && r.active && diffDays(d) < 0;
    const c = catById(r.category_id);
    return `<div class="row ${r.active ? "" : "done"}" data-a="edit" data-id="${r.id}">
      <button class="check ${paid ? "on" : ""}" data-a="pay" data-id="${r.id}" aria-label="${paid ? "Desmarcar" : "Marcar como pago"}">${ic("check")}</button>
      <div class="main"><div class="t">${esc(r.name)}</div><div class="s ${late ? "neg" : ""}">${late ? "atrasado" : "dia " + r.day}</div></div>
      ${r.url ? `<button class="icon-btn" data-a="open" data-url="${esc(r.url)}" aria-label="Abrir link">${ic("external-link")}</button>` : ""}
      <div class="v ${r.kind === "income" ? "pos" : ""}">${brl(r.amount)}${r.is_subscription ? `<small>${brl0(r.amount * 12)}/ano</small>` : ""}</div>
    </div>`;
  };

  let list;
  if (tab === "gastos") list = recs.filter((r) => r.kind === "expense");
  else if (tab === "receitas") list = recs.filter((r) => r.kind === "income");
  else list = recs.filter((r) => r.is_subscription);

  return `${topbar("Dinheiro")}
  ${moneyTabs("fixos")}
  <div class="hero-card">
    <div class="hc-top"><span>${tab === "assinaturas" ? "Assinaturas por ano" : "Sobra fixa por mês"}</span></div>
    <div class="big">${tab === "assinaturas" ? brl0(sum(subs, (r) => r.amount) * 12) : brl0(inTotal - outTotal)}</div>
    <div class="hc-pills"><span>${ic("arrow-down-left")} ${brl0(inTotal)}</span><span>${ic("arrow-up-right")} ${brl0(outTotal)}</span></div>
  </div>
  ${chips([["gastos", "Gastos"], ["receitas", "Receitas"], ["assinaturas", "Assinaturas"]], tab)}
  <div class="list">${list.length ? list.map(row).join("") : empty(tab === "receitas" ? "Cadastre salário e outras entradas que caem todo mês." : tab === "assinaturas" ? "Marque “É uma assinatura” num gasto fixo pra ele aparecer aqui." : "Cadastre aluguel, luz, internet, condomínio…")}</div>
  ${tab !== "receitas" && suggestions.length ? `<div class="section-title">Parece assinatura</div>
  <div class="list">${suggestions.map((t) => `<div class="row" data-a="suggest" data-id="${t.id}">
    <div class="ic acc">${ic("sparkles")}</div>
    <div class="main"><div class="t">${esc(t.description)}</div></div>
    <div class="v">${brl(t.amount)}</div></div>`).join("")}</div>` : ""}
  ${cta(tab === "receitas" ? "Nova receita fixa" : "Novo gasto fixo", "newrec")}`;
};
globalActions.newrec = () => forms.recurring({ kind: routeParts().args[0] === "receitas" ? "income" : "expense", is_subscription: routeParts().args[0] === "assinaturas" });

/* ---------- caixinhas ---------- */
routes.caixinhas = async () => {
  const [boxes, moves] = await Promise.all([
    db.list("savings_boxes", (b) => b.order("created_at"), "boxes"),
    db.list("savings_moves", (b) => b.order("date", { ascending: false }), "moves-full"),
  ]);
  const bal = (id) => sum(moves.filter((x) => x.box_id === id), (x) => x.amount);
  const total = sum(moves, (x) => x.amount);
  handlers.edit = (d) => forms.box(boxes.find((b) => b.id === d.id));
  handlers.in = (d) => forms.move(boxes.find((b) => b.id === d.id), 1);
  handlers.out = (d) => forms.move(boxes.find((b) => b.id === d.id), -1);
  handlers.hist = (d) => {
    const b = boxes.find((x) => x.id === d.id);
    const ms = moves.filter((x) => x.box_id === b.id);
    openSheet(`<h2>${esc(b.name)}</h2><div class="list">${ms.length ? ms.map((x) => `<div class="row">
      <div class="ic ${x.amount > 0 ? "acc" : ""}">${ic(x.amount > 0 ? "arrow-down-left" : "arrow-up-right")}</div>
      <div class="main"><div class="t">${esc(x.note || (x.amount > 0 ? "Guardado" : "Retirado"))}</div><div class="s">${shortDate(parseD(x.date))}${x.created_by ? " · " + esc(memberName(x.created_by)) : ""}</div></div>
      <div class="v ${x.amount > 0 ? "pos" : ""}">${x.amount > 0 ? "+" : "−"} ${brl(Math.abs(x.amount))}</div>
      <button class="icon-btn" data-delmove="${x.id}" aria-label="Apagar">${ic("trash-2")}</button></div>`).join("") : empty("Nada guardado ainda.")}</div>`,
    (sheet, close) => sheet.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-delmove]");
      if (!btn) return;
      if (!btn.dataset.sure) { btn.dataset.sure = 1; btn.style.background = "var(--neg)"; toast("Toque de novo pra apagar"); return; }
      await db.del("savings_moves", btn.dataset.delmove); close(); refresh();
    }));
  };

  return `${topbar("Dinheiro")}
  ${moneyTabs("caixinhas")}
  <div class="hero-card">
    <div class="hc-top"><span>Guardado</span></div>
    <div class="big">${brl0(total)}</div>
  </div>
  ${boxes.length ? boxes.map((b) => {
    const v = bal(b.id);
    const pct = b.goal ? Math.min(100, (v / b.goal) * 100) : 0;
    return `<div class="card box-row" style="padding:16px">
      <div class="top-line" data-a="hist" data-id="${b.id}" style="cursor:pointer"><span class="name">${esc(b.name)}</span><span class="amt">${brl0(v)}</span></div>
      ${b.goal ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="sub" style="margin-top:6px">${Math.round(pct)}% de ${brl0(b.goal)}</div>` : ""}
      <div class="acts">
        <button class="pri" data-a="in" data-id="${b.id}">Guardar</button>
        <button data-a="out" data-id="${b.id}">Tirar</button>
        <button data-a="edit" data-id="${b.id}" aria-label="Editar" style="margin-left:auto;background:none">${ic("pencil")}</button>
      </div>
    </div>`;
  }).join("") : `<div class="card">${empty("Nenhuma caixinha ainda")}</div>`}
  ${cta("Nova caixinha", "quick", "plus", "caixinhas")}`;
};

/* ---------- compras e despensa ---------- */
routes.compras = async (tab = "lista") => {
  realtime(["shopping_items", "pantry_items"]);
  if (tab === "despensa") {
    const items = await db.list("pantry_items", (b) => b.order("name"), "pantry");
    const order = { acabou: 0, acabando: 1, ok: 2 };
    items.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    handlers.edit = (d) => forms.pantry(items.find((x) => x.id === d.id));
    handlers.cycle = async (d) => {
      const p = items.find((x) => x.id === d.id);
      const next = { ok: "acabando", acabando: "acabou", acabou: "ok" }[p.status];
      await db.set("pantry_items", p.id, { status: next });
      refresh();
    };
    handlers.tolist = async (d) => {
      const p = items.find((x) => x.id === d.id);
      await db.add("shopping_items", { name: p.name });
      toast(`${p.name} foi pra lista`);
    };
    handlers.qadd = async (f) => {
      const name = f.qname.value.trim();
      if (!name) return;
      await db.add("pantry_items", { name });
      f.qname.value = "";
      refresh();
    };
    const label = { ok: "Tem", acabando: "Acabando", acabou: "Acabou" };
    const cls = { ok: "", acabando: "warn", acabou: "neg" };
    return `${topbar("Compras")}
    ${chips([["lista", "Lista"], ["despensa", "Despensa"]], tab)}
    <form data-submit="qadd" class="quick-add" style="margin-bottom:12px"><input id="qname" name="qname" class="input" placeholder="Adicionar à despensa…" autocomplete="off"><button class="round" aria-label="Adicionar">${ic("plus")}</button></form>
    <div class="list">${items.length ? items.map((p) => `<div class="row" data-a="edit" data-id="${p.id}">
      <div class="main"><div class="t">${esc(p.name)}</div><div class="s ${cls[p.status]}">${label[p.status]}</div></div>
      ${p.status !== "ok" ? `<button class="icon-btn" data-a="tolist" data-id="${p.id}" aria-label="Pôr na lista">${ic("shopping-cart")}</button>` : ""}
      <button class="small-chip ${p.status === "ok" ? "" : "on"}" data-a="cycle" data-id="${p.id}" style="min-width:84px">${label[p.status]}</button>
    </div>`).join("") : empty("Cadastre o que costuma ter em casa. Toque no status quando estiver acabando.")}</div>`;
  }

  const items = await db.list("shopping_items", (b) => b.order("created_at"), "shopping");
  handlers.toggle = async (d) => {
    const it = items.find((x) => x.id === d.id);
    it.checked = !it.checked;
    document.querySelector(`[data-row="${it.id}"]`)?.classList.toggle("done", it.checked);
    document.querySelector(`[data-row="${it.id}"] .check`)?.classList.toggle("on", it.checked);
    await db.set("shopping_items", it.id, { checked: it.checked });
  };
  handlers.edit = (d) => forms.shopping(items.find((x) => x.id === d.id));
  handlers.clear = async () => {
    const ids = items.filter((x) => x.checked).map((x) => x.id);
    if (!ids.length) return toast("Nada marcado");
    await q(sb.from("shopping_items").delete().in("id", ids));
    toast(`${ids.length} ${ids.length === 1 ? "item removido" : "itens removidos"}`);
    refresh();
  };
  handlers.qadd = async (f) => {
    const raw = f.qname.value.trim();
    if (!raw) return;
    // vírgula adiciona vários de uma vez: "leite, ovos, pão"
    const names = raw.split(",").map((x) => x.trim()).filter(Boolean);
    await q(sb.from("shopping_items").insert(names.map((name) => ({ name }))));
    f.qname.value = "";
    refresh();
  };
  const sections = SHOP_SECTIONS.filter((sec) => items.some((i) => i.section === sec));
  const pending = items.filter((i) => !i.checked).length;
  return `${topbar("Compras")}
  ${chips([["lista", `Lista${pending ? " · " + pending : ""}`], ["despensa", "Despensa"]], tab)}
  <form data-submit="qadd" class="quick-add"><input id="qname" name="qname" class="input" placeholder="Leite, ovos, pão…" autocomplete="off"><button class="round" aria-label="Adicionar">${ic("plus")}</button></form>
  ${items.length ? sections.map((sec) => `<div class="section-title">${esc(sec)}</div><div class="list">${items.filter((i) => i.section === sec).map((i) => `
    <div class="row ${i.checked ? "done" : ""}" data-row="${i.id}" data-a="toggle" data-id="${i.id}">
      <span class="check ${i.checked ? "on" : ""}">${ic("check")}</span>
      <div class="main"><div class="t">${esc(i.name)}</div>${i.qty ? `<div class="s">${esc(i.qty)}</div>` : ""}</div>
      <button class="icon-btn" data-a="edit" data-id="${i.id}" aria-label="Editar">${ic("pencil")}</button>
    </div>`).join("")}</div>`).join("") : `<div class="list" style="margin-top:12px">${empty("Lista vazia. Bora encher a geladeira?")}</div>`}
  ${items.some((i) => i.checked) ? cta("Limpar comprados", "clear", "trash-2") : ""}`;
};

/* ---------- tarefas ---------- */
routes.tarefas = async () => {
  const items = await db.list("chores", (b) => b.order("due", { ascending: true, nullsFirst: false }).order("created_at"), "chores");
  handlers.edit = (d) => forms.chore(items.find((x) => x.id === d.id));
  handlers.done = async (d) => {
    const c = items.find((x) => x.id === d.id);
    if (!c.done && c.repeat !== "none") {
      await db.set("chores", c.id, { due: advanceChore(c.due, c.repeat) });
      toast("Feito! Volta na próxima vez");
    } else await db.set("chores", c.id, { done: !c.done });
    refresh();
  };
  const t0 = today0();
  const rep = { none: "", daily: "todo dia", weekly: "toda semana", monthly: "todo mês" };
  const cols = [
    ["Pra hoje", items.filter((c) => !c.done && c.due && parseD(c.due) <= t0)],
    ["Próximos dias", items.filter((c) => !c.done && c.due && parseD(c.due) > t0)],
    ["Sem data", items.filter((c) => !c.done && !c.due)],
    ["Feitas", items.filter((c) => c.done).slice(-12).reverse()],
  ];
  const card = (c) => {
    const d = c.due ? parseD(c.due) : null;
    const late = d && !c.done && d < t0;
    const bits = [c.assignee ? memberName(c.assignee) : "Qualquer um", d ? rel(d) : "", rep[c.repeat]].filter(Boolean);
    return `<div class="kcard ${c.done ? "done" : ""}" data-a="edit" data-id="${c.id}" draggable="true" data-drag="${c.id}">
      <button class="check ${c.done ? "on" : ""}" data-a="done" data-id="${c.id}" aria-label="Concluir">${ic("check")}</button>
      <div style="min-width:0"><div class="t">${esc(c.title)}</div><div class="s ${late ? "warn" : ""}">${esc(bits.join(" · "))}</div></div>
    </div>`;
  };
  // arrastar entre colunas (PC): hoje / próximos / sem data / feitas
  setTimeout(() => {
    app.querySelectorAll("[data-drag]").forEach((el) => el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", el.dataset.drag); el.style.opacity = ".5"; }));
    app.querySelectorAll("[data-drag]").forEach((el) => el.addEventListener("dragend", () => (el.style.opacity = "")));
    app.querySelectorAll("[data-col]").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", () => col.classList.remove("over"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault(); col.classList.remove("over");
        const id = e.dataTransfer.getData("text/plain");
        const i = +col.dataset.col;
        const patch = [{ done: false, due: iso(t0) }, { done: false, due: iso(addDays(t0, 1)) }, { done: false, due: null }, { done: true }][i];
        await db.set("chores", id, patch);
        refresh();
      });
    });
  });
  return `${topbar("Tarefas")}
  <div class="kanban">${cols.map(([title, list], i) => (list.length || i < 2 || window.innerWidth >= 980) ? `<div data-col="${i}">
    <div class="kcol-head">${title} <span class="badge">${list.length}</span></div>
    ${list.length ? list.map(card).join("") : `<div class="kempty">${i === 0 ? "Nada pra hoje ✨" : "Vazio"}</div>`}
  </div>` : "").join("")}</div>
  ${cta("Nova tarefa", "quick", "plus", "tarefas")}`;
};

/* ---------- lembretes ---------- */
routes.lembretes = async (tab = "todos") => {
  const items = await db.list("reminders", (b) => b, "reminders");
  handlers.edit = (d) => forms.reminder(items.find((x) => x.id === d.id));
  const rows = items
    .filter((r) => tab === "todos" || r.kind === tab)
    .map((r) => ({ ...r, next: nextOccurrence(r.date, r.repeat) }))
    .sort((a, b) => {
      const pa = a.repeat === "none" && a.next < today0(), pb = b.repeat === "none" && b.next < today0();
      return pa - pb || a.next - b.next;
    });
  const rep = { none: "", weekly: "toda semana", monthly: "todo mês", yearly: "todo ano" };
  return `${topbar("Lembretes")}
  ${chips([["todos", "Todos"], ...Object.entries(REMINDER_KINDS).map(([k, v]) => [k, v.l])], tab)}
  <div class="list">${rows.length ? rows.map((r) => {
    const n = diffDays(r.next);
    const past = n < 0;
    const years = r.kind === "data" && r.repeat === "yearly" ? r.next.getFullYear() - parseD(r.date).getFullYear() : 0;
    return `<div class="row ${past ? "done" : ""}" data-a="edit" data-id="${r.id}">
      <div class="ic ${n >= 0 && n <= 7 ? "acc" : ""}">${ic(REMINDER_KINDS[r.kind]?.i || "bell")}</div>
      <div class="main"><div class="t">${esc(r.title)}</div><div class="s">${shortDate(r.next)}${rep[r.repeat] ? " · " + rep[r.repeat] : ""}${years > 0 ? ` · ${years} ano${years > 1 ? "s" : ""}` : ""}${r.notes ? " · " + esc(r.notes) : ""}</div></div>
      <div class="v ${n >= 0 && n <= 7 ? "pos" : "muted"}" style="font-size:13px">${past ? "passou" : rel(r.next)}</div>
    </div>`;
  }).join("") : empty("Aniversários, IPVA, revisão do carro, vacina do pet, regar as plantas…")}</div>
  ${cta("Novo lembrete", "quick", "plus", "lembretes")}`;
};

/* ---------- mural ---------- */
routes.mural = async () => {
  realtime(["notes"]);
  const items = await db.list("notes", (b) => b.order("created_at", { ascending: false }).limit(100), "notes");
  handlers.del = async (d, el) => {
    if (!el.dataset.sure) { el.dataset.sure = 1; el.style.color = "var(--neg)"; toast("Toque de novo pra apagar"); return; }
    await db.del("notes", d.id);
    refresh();
  };
  handlers.post = async (f) => {
    const text = f.qtext.value.trim();
    if (!text) return;
    await db.add("notes", { text });
    f.qtext.value = "";
    refresh();
  };
  return `${topbar("Mural")}
  <form data-submit="post" class="quick-add" style="margin-bottom:14px">
    <input id="qtext" name="qtext" class="input" placeholder="Deixa um recado…" autocomplete="off">
    <button class="round" aria-label="Enviar">${ic("send")}</button>
  </form>
  ${items.length ? items.map((n) => `<div class="note-card">
    <p>${esc(n.text)}</p>
    <footer><span>${esc(memberName(n.created_by) || "Alguém")} · ${new Date(n.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "")}</span>
    <button class="icon-btn" data-a="del" data-id="${n.id}" aria-label="Apagar" style="width:28px;height:28px">${ic("trash-2")}</button></footer>
  </div>`).join("") : `<div class="list">${empty("Nenhum recado ainda.")}</div>`}`;
};

/* ---------- desejos ---------- */
routes.desejos = async (tab = "quero") => {
  const items = await db.list("wishes", (b) => b.order("created_at", { ascending: false }), "wishes");
  handlers.edit = (d) => forms.wish(items.find((x) => x.id === d.id));
  handlers.done = async (d) => { const w = items.find((x) => x.id === d.id); await db.set("wishes", w.id, { done: !w.done }); refresh(); };
  const list = items.filter((w) => (tab === "comprados" ? w.done : !w.done));
  const total = sum(items.filter((w) => !w.done), (w) => w.price);
  return `${topbar("Desejos")}
  <div class="hero-lite"><div class="label">Tudo que está na lista</div><div class="big">${brl(total)}</div><div class="note">${items.filter((w) => !w.done).length} desejos</div></div>
  ${chips([["quero", "Quero"], ["comprados", "Já comprei"]], tab)}
  <div class="list">${list.length ? list.map((w) => `<div class="row ${w.done ? "done" : ""}" data-a="edit" data-id="${w.id}">
    <button class="check ${w.done ? "on" : ""}" data-a="done" data-id="${w.id}" aria-label="Comprado">${ic("check")}</button>
    <div class="main"><div class="t">${esc(w.title)}</div><div class="s">${esc(memberName(w.created_by))}</div></div>
    ${w.url ? `<button class="icon-btn" data-a="open" data-url="${esc(w.url)}" aria-label="Abrir link">${ic("external-link")}</button>` : ""}
    <div class="v">${w.price ? brl(w.price) : ""}</div>
  </div>`).join("") : empty("Coloca aqui o que vocês querem comprar, com link e preço.")}</div>
  ${cta("Novo desejo", "quick", "plus", "desejos")}`;
};

/* ---------- pra fazer juntos ---------- */
routes.juntos = async (tab = "todos") => {
  const items = await db.list("bucket_items", (b) => b.order("created_at", { ascending: false }), "bucket");
  handlers.edit = (d) => forms.bucket(items.find((x) => x.id === d.id));
  handlers.done = async (d) => { const b = items.find((x) => x.id === d.id); await db.set("bucket_items", b.id, { done: !b.done }); if (!b.done) toast("Mais uma! 💚"); refresh(); };
  const list = items.filter((b) => tab === "todos" || b.kind === tab).sort((a, b) => a.done - b.done);
  const doneCount = items.filter((b) => b.done).length;
  return `${topbar("Pra fazer juntos")}
  <div class="hero-lite"><div class="label">Já fizemos</div><div class="big">${doneCount} <span style="font-size:18px" class="muted">de ${items.length}</span></div>
  ${items.length ? `<div class="bar"><i style="width:${(doneCount / items.length) * 100}%"></i></div>` : ""}</div>
  ${chips([["todos", "Todos"], ...Object.entries(BUCKET_KINDS).map(([k, v]) => [k, v.l])], tab)}
  <div class="list">${list.length ? list.map((b) => `<div class="row ${b.done ? "done" : ""}" data-a="edit" data-id="${b.id}">
    <button class="check ${b.done ? "on" : ""}" data-a="done" data-id="${b.id}" aria-label="Feito">${ic("check")}</button>
    <div class="main"><div class="t">${esc(b.title)}</div><div class="s">${BUCKET_KINDS[b.kind]?.l}</div></div>
    <span class="muted" style="font-size:18px">${ic(BUCKET_KINDS[b.kind]?.i || "sparkles")}</span>
  </div>`).join("") : empty("Restaurantes pra conhecer, filmes, viagens, passeios…")}</div>
  ${cta("Adicionar", "quick", "plus", "juntos")}`;
};

/* ---------- informações ---------- */
routes.info = async () => {
  const items = await db.list("info_items", (b) => b.order("created_at"), "info");
  handlers.edit = (d) => forms.info(items.find((x) => x.id === d.id));
  handlers.preset = (d) => forms.info({ section: d.section, label: d.label });
  handlers.qr = (d) => {
    const it = items.find((x) => x.id === d.id);
    const e = (s) => s.replace(/([\\;,:"])/g, "\\$1");
    const qr = qrcode(0, "M");
    qr.addData(`WIFI:T:WPA;S:${e(it.label)};P:${e(it.value)};;`);
    qr.make();
    openSheet(`<h2 class="center">${esc(it.label)}</h2><div class="qr">${qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true })}</div>
      <p class="center muted" style="margin:14px 0 4px">Aponte a câmera do celular pra conectar</p>
      <p class="center secret" style="font-size:18px">${esc(it.value)}</p>`);
  };
  const sections = INFO_SECTIONS.filter((s) => items.some((i) => i.section === s));
  const presets = [["Casa", "CEP"], ["Casa", "Endereço completo"], ["Wi-Fi", "Nome da rede"], ["Casa", "Código do portão"], ["Contatos", "Portaria"], ["Carro", "Placa e Renavam"]];
  return `${topbar("Informações")}
  ${items.length ? sections.map((sec) => `<div class="section-title">${esc(sec)}</div><div class="list">${items.filter((i) => i.section === sec).map((i) => `
    <div class="row" data-a="copy" data-text="${esc(i.value)}">
      <div class="main"><div class="s" style="margin:0 0 2px">${esc(i.label)}</div><div class="t" style="white-space:pre-wrap">${esc(i.value)}</div></div>
      ${sec === "Wi-Fi" ? `<button class="icon-btn" data-a="qr" data-id="${i.id}" aria-label="QR code">${ic("qr-code")}</button>` : ""}
      <button class="icon-btn" data-a="edit" data-id="${i.id}" aria-label="Editar">${ic("pencil")}</button>
    </div>`).join("")}</div>`).join("") + "" : `
    <p class="muted" style="margin:0 4px 14px;font-size:14px">Tudo que vocês vivem procurando. Comece por aqui:</p>
    <div class="list">${presets.map(([s, l]) => `<div class="row" data-a="preset" data-section="${s}" data-label="${l}">
      <div class="ic">${ic(s === "Wi-Fi" ? "wifi" : s === "Carro" ? "car" : s === "Contatos" ? "phone" : l === "CEP" ? "map-pin" : "house")}</div>
      <div class="main"><div class="t">${l}</div></div><span class="muted">${ic("plus")}</span></div>`).join("")}</div>`}
  ${cta("Nova informação", "quick", "plus", "info")}`;
};

/* ---------- atalhos ---------- */
routes.atalhos = async () => {
  const items = await db.list("links", (b) => b.order("section").order("title"), "links");
  handlers.edit = (d) => forms.link(items.find((x) => x.id === d.id));
  const sections = [...new Set(items.map((i) => i.section))];
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
  return `${topbar("Atalhos")}
  ${items.length ? sections.map((sec) => `<div class="section-title">${esc(sec)}</div><div class="list">${items.filter((i) => i.section === sec).map((l) => `
    <div class="row" data-a="open" data-url="${esc(l.url)}" role="link" style="cursor:pointer">
      <div class="ic acc" style="font-weight:700;font-size:15px">${esc(initials(l.title).slice(0, 1))}</div>
      <div class="main"><div class="t">${esc(l.title)}</div><div class="s">${esc(host(l.url))}</div></div>
      <button class="icon-btn" data-a="edit" data-id="${l.id}" aria-label="Editar">${ic("pencil")}</button>
      <span class="muted">${ic("arrow-up-right")}</span>
    </div>`).join("")}</div>`).join("") : `<div class="list">${empty("Segunda via da luz, site do banco, gov.br, Detran, condomínio…")}</div>`}
  ${cta("Novo atalho", "quick", "plus", "atalhos")}`;
};

/* ---------- cofre de senhas (criptografia no aparelho) ---------- */
const vault = { key: null, items: null, timer: null, hideTimer: null };
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => { let s = ""; new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function unseal(key, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(dec.decode(pt));
}
function genPassword(len = 16) {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?-_";
  const out = [];
  const buf = new Uint8Array(1);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    if (buf[0] < Math.floor(256 / chars.length) * chars.length) out.push(chars[buf[0] % chars.length]);
  }
  return out.join("");
}
function lockVault() {
  vault.key = null;
  vault.items = null;
  clearTimeout(vault.timer);
  if (routeParts().name === "cofre") render();
}
function touchVault() {
  if (!vault.key) return;
  clearTimeout(vault.timer);
  vault.timer = setTimeout(lockVault, 5 * 60 * 1000);
}
document.addEventListener("pointerdown", touchVault);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) vault.hideTimer = setTimeout(lockVault, 60 * 1000);
  else clearTimeout(vault.hideTimer);
});

routes.cofre = async () => {
  if (!window.crypto?.subtle) return `${topbar("Senhas")}<div class="list">${empty("O cofre precisa do app aberto em https.")}</div>`;
  const meta = (await q(sb.from("vault_meta").select("*").maybeSingle()));

  if (!meta) {
    handlers.create = async (f) => {
      const p1 = f.p1.value, p2 = f.p2.value;
      if (p1.length < 8) return toast("Use pelo menos 8 caracteres");
      if (p1 !== p2) return toast("As senhas não batem");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(p1, salt);
      const check = await seal(key, { ok: "casa" });
      await q(sb.from("vault_meta").insert({ salt: b64(salt), check_iv: check.iv, check_ct: check.ct }));
      vault.key = key; vault.items = null; touchVault();
      toast("Cofre criado");
      refresh();
    };
    return `${topbar("Senhas")}
    <div class="card wide" style="margin-bottom:14px">
      <div style="font-size:26px;color:var(--accent-text)">${ic("shield-check")}</div>
      <div style="font-weight:600;margin:10px 0 4px">Crie a senha mestra do cofre</div>
      <div class="muted" style="font-size:13.5px;line-height:1.45">Só vocês dois conseguem abrir. <b style="color:var(--warn);font-weight:500">Se esquecerem a senha mestra, não dá pra recuperar.</b></div>
    </div>
    <form data-submit="create" class="card" style="margin-top:8px" novalidate>
      <label class="field"><span>Senha mestra</span><input id="p1" name="p1" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repita</span><input id="p2" name="p2" type="password" autocomplete="new-password"></label>
      <button class="btn" type="submit" style="margin-top:6px">Criar cofre</button>
    </form>`;
  }

  if (!vault.key) {
    handlers.unlock = async (f) => {
      const btn = f.querySelector("button");
      btn.disabled = true; btn.textContent = "Abrindo…";
      try {
        const key = await deriveKey(f.master.value, unb64(meta.salt));
        await unseal(key, meta.check_iv, meta.check_ct);
        vault.key = key; touchVault(); refresh();
      } catch { toast("Senha mestra errada"); btn.disabled = false; btn.textContent = "Destrancar"; }
    };
    return `${topbar("Senhas")}
    <section class="auth" style="min-height:60dvh">
      <div class="logo">${ic("lock")}</div>
      <h1 style="font-size:26px">Cofre trancado</h1>
      <p>Tranca sozinho depois de 5 minutos parado.</p>
      <form data-submit="unlock" novalidate>
        <label class="field"><span>Senha mestra</span><input id="master" name="master" type="password" autocomplete="current-password" autofocus></label>
        <button class="btn" type="submit">Destrancar</button>
      </form>
    </section>`;
  }

  if (!vault.items) {
    const rows = await q(sb.from("vault_items").select("*"));
    vault.items = (await Promise.all(rows.map(async (r) => {
      try { return { id: r.id, ...(await unseal(vault.key, r.iv, r.ct)) }; } catch { return null; }
    }))).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  }
  const items = vault.items;
  const fields = [
    { name: "title", label: "Nome", required: true, placeholder: "Ex: Netflix, Prefeitura" },
    { name: "url", type: "url", label: "Site (opcional)", placeholder: "https://" },
    { name: "user", label: "Usuário / e-mail" },
    { name: "pass", type: "secret", label: "Senha", generate: true },
    { name: "notes", type: "textarea", label: "Notas (opcional)" },
  ];
  const save = (it = {}) => form({
    title: it.id ? "Editar senha" : "Nova senha",
    values: it, fields,
    onSubmit: async (v) => {
      v.url = normUrl(v.url);
      const sealed = await seal(vault.key, v);
      if (it.id) await db.set("vault_items", it.id, { ...sealed, updated_at: new Date().toISOString() });
      else await db.add("vault_items", sealed);
      vault.items = null;
    },
    onDelete: it.id ? async () => { await db.del("vault_items", it.id); vault.items = null; } : null,
  });
  handlers.add = () => save();
  handlers.lock = () => lockVault();
  handlers.show = (d) => {
    const it = items.find((x) => x.id === d.id);
    openSheet(`<h2>${esc(it.title)}</h2>
      <div class="list">
        ${it.user ? `<div class="row"><div class="main"><div class="s">Usuário</div><div class="t">${esc(it.user)}</div></div><button class="icon-btn" data-c="user">${ic("copy")}</button></div>` : ""}
        ${it.pass ? `<div class="row"><div class="main"><div class="s">Senha</div><div class="t secret" data-p>••••••••••</div></div><button class="icon-btn" data-eye>${ic("eye")}</button><button class="icon-btn" data-c="pass">${ic("copy")}</button></div>` : ""}
        ${it.url ? `<div class="row"><div class="main"><div class="s">Site</div><div class="t">${esc(it.url)}</div></div><button class="icon-btn" data-go>${ic("external-link")}</button></div>` : ""}
        ${it.notes ? `<div class="row"><div class="main"><div class="s">Notas</div><div class="t" style="white-space:pre-wrap">${esc(it.notes)}</div></div></div>` : ""}
      </div>
      <div class="actions"><button class="btn ghost" data-edit>Editar</button></div>`,
    (sheet, close) => sheet.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.c) copy(it[b.dataset.c], b.dataset.c === "pass" ? "Senha copiada" : "Copiado");
      if ("eye" in b.dataset) { const p = sheet.querySelector("[data-p]"); p.textContent = p.textContent.startsWith("•") ? it.pass : "••••••••••"; }
      if ("go" in b.dataset) window.open(it.url, "_blank", "noopener");
      if ("edit" in b.dataset) { close(); save(it); }
    }));
  };
  handlers.search = () => {};
  setTimeout(() => {
    const s = document.getElementById("vsearch");
    s?.addEventListener("input", () => {
      const term = s.value.toLowerCase();
      document.querySelectorAll("[data-vrow]").forEach((r) => (r.style.display = r.dataset.vrow.includes(term) ? "" : "none"));
    });
  });
  return `${topbar("Senhas", `<button class="round" data-a="lock" aria-label="Trancar">${ic("lock-open")}</button>`)}
  ${items.length > 5 ? `<input id="vsearch" class="input" placeholder="Buscar…" style="margin-bottom:12px" autocomplete="off">` : ""}
  <div class="list">${items.length ? items.map((it) => `<div class="row" data-a="show" data-id="${it.id}" data-vrow="${esc((it.title + " " + (it.user || "")).toLowerCase())}">
    <div class="ic acc" style="font-weight:600">${esc(initials(it.title).slice(0, 1))}</div>
    <div class="main"><div class="t">${esc(it.title)}</div><div class="s">${esc(it.user || "")}</div></div>
    <span class="muted">${ic("chevron-right")}</span>
  </div>`).join("") : empty("Nenhuma senha guardada ainda.")}</div>
  <p class="muted center" style="font-size:12px;margin-top:14px">${ic("shield-check")} Criptografado com AES-256 no seu celular</p>
  ${cta("Nova senha", "add")}`;
};

/* ---------- ajustes ---------- */
const ACCENTS = [["#2f55e6", "Azul"], ["#3a86e8", "Céu"], ["#5b6cf0", "Índigo"], ["#8b6fe0", "Lavanda"], ["#e0679c", "Rosa"], ["#ec7a5c", "Coral"], ["#d99a2b", "Âmbar"], ["#2f9e6e", "Verde"], ["#59636f", "Grafite"]];
routes.ajustes = async (tab = "geral") => {
  const h = state.household;
  const P = PREFS.get();
  handlers.name = () => form({
    title: "Seu nome", values: { display_name: state.member.display_name },
    fields: [{ name: "display_name", label: "Como aparece pra casa", required: true }],
    onSubmit: async (v) => {
      await q(sb.from("household_members").update(v).eq("user_id", state.user.id).eq("household_id", h.id));
      await loadHouse();
    },
  });
  handlers.house = () => form({
    title: "Nome da casa", values: { name: h.name },
    fields: [{ name: "name", label: "Nome", required: true }],
    onSubmit: async (v) => { await db.set("households", h.id, v); await loadHouse(); },
  });
  handlers.share = async () => {
    const text = `Entra na nossa casa no Bunny! Código: ${h.invite_code}\n${location.origin}/`;
    if (navigator.share) { try { await navigator.share({ text }); } catch {} }
    else copy(text, "Convite copiado");
  };
  handlers.cat = (d) => forms.category(catById(d.id));
  handlers.newcat = () => forms.category();
  handlers.logout = async () => { vault.key = null; await sb.auth.signOut(); };
  handlers.theme = (d) => { PREFS.save({ theme: d.v }); refresh(); };
  handlers.accent = (d) => { PREFS.save({ accent: d.v }); refresh(); };
  handlers.bg = (d) => { PREFS.save({ bg: d.v }); refresh(); };
  handlers.hero = (d) => { PREFS.save({ hero: d.v }); refresh(); };
  handlers.logo = (d) => { PREFS.save({ logo: d.v }); refresh(); };
  handlers.nophoto = () => { PREFS.setPhoto(null); PREFS.save({ bg: "neutral" }); refresh(); };
  handlers.photo = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const url = await shrinkImage(f, 1600, 0.82);
        if (!PREFS.setPhoto(url)) return toast("Foto grande demais pra guardar");
        PREFS.save({ bg: "photo" }); refresh(); toast("Fundo atualizado");
      } catch { toast("Não consegui abrir essa imagem"); }
    };
    inp.click();
  };
  handlers.pref = (d, el) => {
    const k = d.k;
    if (k.startsWith("mod:")) { const mods = { ...PREFS.get().mods, [k.slice(4)]: el.checked }; PREFS.save({ mods }); }
    else PREFS.save({ [k]: el.checked });
  };
  // checkbox não passa pelo clique delegado com preventDefault; trata no change
  setTimeout(() => app.querySelectorAll("input[data-pref]").forEach((el) => el.addEventListener("change", () => handlers.pref({ k: el.dataset.pref }, el))));

  const sw = (k, label, on, sub = "") => `<label class="toggle"><span>${label}${sub ? `<br><small class="muted" style="font-weight:400;font-size:12px">${sub}</small>` : ""}</span><input class="switch" type="checkbox" data-pref="${k}" ${on ? "checked" : ""}></label>`;

  let body;
  if (tab === "visual") {
    const seg = (key, opts, cur) => `<div class="card" style="padding:6px"><div class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-a="${key}" data-v="${v}">${l}</button>`).join("")}</div></div>`;
    body = `
    <div class="section-title">Tema</div>
    ${seg("theme", [["light", "Claro"], ["dark", "Escuro"], ["auto", "Automático"]], P.theme)}
    <div class="section-title">Cor</div>
    <div class="list"><div class="swatches">${ACCENTS.map(([c, l]) => `<button class="swatch ${P.accent === c ? "on" : ""}" style="background:${c}" data-a="accent" data-v="${c}" aria-label="${l}" title="${l}"></button>`).join("")}</div></div>
    <div class="section-title">Fundo</div>
    <div class="list"><div class="bg-opts">
      <button class="bg-opt ${P.bg === "neutral" ? "on" : ""}" data-a="bg" data-v="neutral"><i style="background:linear-gradient(180deg,#8e9fa6,#b3bab8,#d9cdc0)"></i>Neutro</button>
      <button class="bg-opt ${P.bg === "plain" ? "on" : ""}" data-a="bg" data-v="plain"><i style="background:#eeeeec"></i>Liso</button>
      <button class="bg-opt ${P.bg === "photo" ? "on" : ""}" data-a="photo"><i style="${PREFS.getPhoto() ? `background-image:url('${PREFS.getPhoto()}')` : ""};display:grid;place-items:center;color:var(--muted)">${PREFS.getPhoto() ? "" : ic("image-plus")}</i>Foto</button>
    </div>
    ${PREFS.getPhoto() ? `<div class="toggle" style="border-top:1px solid var(--line)"><span>Foto de fundo</span><span style="display:flex;gap:6px"><button class="small-chip" data-a="photo">Trocar</button><button class="small-chip" data-a="nophoto">Tirar</button></span></div>` : ""}
    </div>
    <div class="section-title">Cartões</div>
    ${seg("hero", [["white", "Branco"], ["glass", "Vidro"]], P.hero === "glass" ? "glass" : "white")}
    <div class="section-title">Logo</div>
    ${seg("logo", [["white", "Branco"], ["accent", "Cor"], ["ink", "Preto"]], P.logo || "white")}
    <div class="section-title">Mais</div>
    <div class="list">
      ${sw("private", "Esconder valores", P.private)}
      ${sw("homeNext", "Próximos na tela inicial", P.homeNext)}
    </div>
    <div class="section-title">Aba Casa</div>
    <div class="list">${CASA_MODS.map((k) => sw("mod:" + k, MOD_INFO[k].t, P.mods[k] !== false)).join("")}</div>`;
  } else if (tab === "categorias") {
    body = `<div class="list">${state.cats.map((c) => `<div class="row" data-a="cat" data-id="${c.id}">
      <div class="ic ${c.kind === "income" ? "acc" : ""}">${ic(c.icon)}</div>
      <div class="main"><div class="t">${esc(c.name)}</div><div class="s">${c.kind === "income" ? "Entrada" : c.budget ? "Limite " + brl(c.budget) : "Gasto"}</div></div>
      <span class="muted">${ic("chevron-right")}</span></div>`).join("")}</div>
      <button class="add-row" data-a="newcat">Nova categoria ${ic("plus")}</button>`;
  } else {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    body = `
    <div class="card" data-a="name"><div class="person">
      <span class="pic">${ic("user-round")}</span>
      <div class="main"><div class="t">${esc(state.member.display_name)}</div><div class="s">${esc(state.user.email)}</div></div>
      <span class="muted">${ic("pencil")}</span></div></div>
    <div class="card" data-a="house"><div class="person">
      <span class="pic">${ic("house")}</span>
      <div class="main"><div class="t">${esc(h.name)}</div><div class="s">${state.members.map((m) => esc(m.display_name)).join(" e ")}</div></div>
      <span class="muted">${ic("pencil")}</span></div></div>
    <div class="card" data-a="share">
      <div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em">Código pra entrar na casa</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px"><span class="code">${esc(h.invite_code)}</span><span class="round" style="background:var(--surface-2)">${ic("share-2")}</span></div>
    </div>
    ${standalone ? "" : `<div class="card"><div class="person"><span class="pic">${ic("download")}</span><div class="main"><div class="t">Instalar o app</div><div class="s" style="white-space:normal">${isIOS ? "Safari › Compartilhar › Adicionar à Tela de Início" : "No Chrome ou Edge: ícone de instalar na barra de endereço, ou ⋮ › Instalar app"}</div></div></div></div>`}
    <div style="margin-top:16px"><button class="btn ghost" data-a="logout">${ic("log-out")} Sair</button></div>`;
  }

  return `${topbar("Ajustes")}
  ${chips([["geral", "Conta"], ["visual", "Personalizar"], ["categorias", "Categorias"]], tab)}
  ${body}`;
};

/* ---------- início ---------- */
async function onSession(session) {
  const uid = session?.user?.id || null;
  if (uid === state.user?.id && state.household) return;
  state.user = session?.user || null;
  state.household = null;
  if (state.user) {
    try { await loadHouse(); } catch (e) { console.error(e); }
  } else {
    vault.key = null;
  }
  render();
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
  setTimeout(() => onSession(session), 0);
});
sb.auth.getSession().then(({ data }) => onSession(data.session));

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

/* atalho do ícone (segurar o ícone no Android/PC) */
routes["novo-gasto"] = async () => { setTimeout(() => { history.replaceState(null, "", "#/"); forms.transaction(); }, 0); return routes.home(); };
