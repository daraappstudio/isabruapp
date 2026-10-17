// Preferências visuais (ficam salvas neste aparelho). Carregado no <head> pra não piscar.
(function () {
  var KEY = "bunny:prefs";
  var PHOTO = "bunny:photo";
  var MODS = ["compras", "tarefas", "lembretes", "mural", "desejos", "juntos", "info", "atalhos", "cofre"];
  var defaults = { theme: "auto", accent: "#2f55e6", bg: "neutral", hero: "white", logo: "white", private: false, homeNext: true, homeNote: true, mods: {} };
  MODS.forEach(function (m) { defaults.mods[m] = true; });
  var prefs;
  try { prefs = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { prefs = Object.assign({}, defaults); }
  prefs.mods = Object.assign({}, defaults.mods, prefs.mods || {});
  if (!prefs.v3) { prefs.accent = defaults.accent; prefs.bg = "neutral"; prefs.hero = "white"; prefs.logo = "white"; prefs.v3 = true; } // migração: cor padrão nova (azul)

  function onAccent(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var L = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var lum = 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(b);
    return lum > 0.42 ? "#101418" : "#ffffff";
  }
  function getPhoto() { try { return localStorage.getItem(PHOTO); } catch (e) { return null; } }

  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function apply() {
    var r = document.documentElement;
    var dark = prefs.theme === "dark" || (prefs.theme === "auto" && mq && mq.matches);
    var photo = prefs.bg === "photo" ? getPhoto() : null;
    r.dataset.theme = dark ? "dark" : "light";
    r.dataset.bg = photo ? "photo" : prefs.bg === "plain" ? "plain" : "neutral";
    r.dataset.private = prefs.private ? "on" : "off";
    r.dataset.hero = prefs.hero === "glass" ? "glass" : "white";
    r.dataset.logo = ["ink", "accent"].includes(prefs.logo) ? prefs.logo : "white";
    r.style.setProperty("--accent", prefs.accent);
    r.style.setProperty("--on-accent", onAccent(prefs.accent));
    r.style.setProperty("--photo", photo ? 'url("' + photo + '")' : "none");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#1d2427" : prefs.bg === "plain" ? "#eeeeec" : "#c9d3d7");
  }
  function save(patch) {
    Object.assign(prefs, patch || {});
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
    apply();
  }
  function setPhoto(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(PHOTO, dataUrl); else localStorage.removeItem(PHOTO);
      return true;
    } catch (e) { return false; }
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", apply);
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
  apply();
  window.PREFS = { get: function () { return prefs; }, save: save, apply: apply, setPhoto: setPhoto, getPhoto: getPhoto, MODS: MODS };
  window.LOGO_SVG = '<svg viewBox="0 0 135.52 164.24" aria-hidden="true"><path d="M117.65,66.9c-1.05,2.25-2.16,4.44-3.29,6.55,8.75,8.9,14.17,21.09,14.17,34.53,0,27.16-22.1,49.26-49.26,49.26h-23.01c-27.16,0-49.26-22.1-49.26-49.26,0-13.44,5.41-25.63,14.17-34.53-1.14-2.11-2.24-4.3-3.29-6.55C6.89,77.18,0,91.79,0,107.98c0,31.02,25.24,56.26,56.26,56.26h23.01c31.02,0,56.26-25.24,56.26-56.26,0-16.19-6.89-30.8-17.87-41.08Z"/><path d="M107.58.3h0c-.8-.2-1.62-.3-2.46-.3-2.52,0-5.2.9-7.88,2.67-9.06,5.99-15.92,20.06-18.81,38.61-1.47,9.41-1.57,19.02-.77,27.32-.43-.01-.86-.03-1.3-.03h-17.18c-.44,0-.87.02-1.3.03.8-8.3.69-17.91-.77-27.32-2.89-18.55-9.75-32.62-18.81-38.61-2.68-1.77-5.36-2.67-7.88-2.67-.84,0-1.66.1-2.46.3h0c-9.14,2.32-16.45,14.14-12.19,35.34,3.26,16.19,10.32,31.86,17.57,42.59-8.31,7.22-13.57,17.87-13.57,29.74,0,21.76,17.64,39.41,39.41,39.41h17.18c21.76,0,39.41-17.64,39.41-39.41,0-11.88-5.26-22.52-13.57-29.74,7.26-10.74,14.32-26.41,17.57-42.59,4.27-21.2-3.05-33.02-12.19-35.34ZM63.19,109.19c0,1.83-1.49,3.32-3.32,3.32h-4.7c-1.26,0-2.29,1.03-2.29,2.29v4.7c0,1.83-1.49,3.32-3.32,3.32h-.49c-1.83,0-3.32-1.49-3.32-3.32v-4.7c0-1.26-1.03-2.29-2.29-2.29h-4.7c-1.83,0-3.32-1.49-3.32-3.32v-.49c0-1.83,1.49-3.32,3.32-3.32h4.7c1.26,0,2.29-1.03,2.29-2.29v-4.7c0-1.83,1.49-3.32,3.32-3.32h.49c1.83,0,3.32,1.49,3.32,3.32v4.7c0,1.26,1.03,2.29,2.29,2.29h4.7c1.83,0,3.32,1.49,3.32,3.32v.49ZM100.08,109.19c0,1.83-1.49,3.32-3.32,3.32h-4.7c-1.26,0-2.29,1.03-2.29,2.29v4.7c0,1.83-1.49,3.32-3.32,3.32h-.49c-1.83,0-3.32-1.49-3.32-3.32v-4.7c0-1.26-1.03-2.29-2.29-2.29h-4.7c-1.83,0-3.32-1.49-3.32-3.32v-.49c0-1.83,1.49-3.32,3.32-3.32h4.7c1.26,0,2.29-1.03,2.29-2.29v-4.7c0-1.83,1.49-3.32,3.32-3.32h.49c1.83,0,3.32,1.49,3.32,3.32v4.7c0,1.26,1.03,2.29,2.29,2.29h4.7c1.83,0,3.32,1.49,3.32,3.32v.49Z"/></svg>';
})();
