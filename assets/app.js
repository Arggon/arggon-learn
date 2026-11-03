/* Arggon Learn — app shell: state (storage + migrations), track registry, home, onboarding, routing,
   prerequisite graph, concept pages, quizzes, glossary, settings, progress. */
(function () {
  const C = window.CONCEPTS, BY = Object.fromEntries(C.map((c) => [c.id, c]));
  // Storage: Arggon Learn keeps everything under KEY. Older builds (AI Learning Hub) used aiHub.v2 and, before
  // that, aiHub.v1. On first load we copy the old data over once; the old keys are left untouched.
  const KEY = "arggonLearn.v1", LEGACY_V2 = "aiHub.v2", V1 = "aiHub.v1";
  const LANGS = { pseudo: "Pseudocode", python: "Python", ts: "JavaScript / TypeScript", csharp: "C#", any: "Template" };
  const LANG_ORDER = ["pseudo", "python", "ts", "csharp", "any"];
  const FOUNDATIONS = ["chatbot_use", "prog_basics", "vars_functions", "data_json", "web_apis", "math_basics", "db_basics"];
  const TRACKS = { beginner: [...FOUNDATIONS, ...window.FAST_PATH, ...window.THEORY_PATH], builder: [...window.FAST_PATH, ...window.THEORY_PATH], theory: [...window.THEORY_PATH, ...window.FAST_PATH] };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  // For short authored strings that may carry inline formatting (exercise tasks): escape everything, then
  // restore only a small allowlist of attribute-free tags. Existing entities like &lt; are kept.
  const safeHtml = (s) => String(s).replace(/&(?!(?:[a-z]+|#\d+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/&lt;(\/?)(code|b|i|em|strong|kbd)&gt;|&lt;br\s*\/?&gt;/g, (m, sl, tag) => (tag ? `<${sl}${tag}>` : "<br>"));

  /* ---------- state ---------- */
  const fresh = () => ({ version: 2, profile: null, skipped: false, manualKnown: {}, done: {}, quiz: {}, settings: { codeLang: "pseudo", uiLang: "en", theme: "light", track: "auto" }, view: {} });
  function sanitize(raw) {
    const s = fresh(); if (!raw || typeof raw !== "object") return s;
    if (raw.profile && typeof raw.profile === "object" && raw.profile.answers) s.profile = { answers: { ...raw.profile.answers }, at: raw.profile.at || null };
    s.skipped = !!raw.skipped;
    for (const [id, v] of Object.entries(raw.manualKnown || {})) if (BY[id] && typeof v === "boolean") s.manualKnown[id] = v;
    for (const [id, v] of Object.entries(raw.done || {})) if (BY[id] && v === true) s.done[id] = true;
    for (const [id, q] of Object.entries(raw.quiz || {})) if (BY[id] && q && Number.isFinite(q.best)) s.quiz[id] = { best: Math.min(q.best, BY[id].quiz.length), last: Number.isFinite(q.last) ? q.last : q.best, at: q.at || null };
    const st = raw.settings || {};
    if (LANGS[st.codeLang] && st.codeLang !== "any") s.settings.codeLang = st.codeLang;
    if (st.uiLang === "es" || st.uiLang === "en") s.settings.uiLang = st.uiLang;
    if (st.theme === "dark" || st.theme === "light") s.settings.theme = st.theme;
    if (["auto", "beginner", "builder", "theory"].includes(st.track)) s.settings.track = st.track;
    if (raw.view && typeof raw.view === "object") s.view = { subgraphs: !!raw.view.subgraphs, zoom: Number.isFinite(raw.view.zoom) ? raw.view.zoom : undefined };
    // Optional historical metadata is untrusted on both import and load. Invalid metadata must not discard progress.
    const mf = raw.migratedFrom;
    if (mf && typeof mf === "object" && !Array.isArray(mf) && mf.key === V1 &&
        [mf.done, mf.quiz].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= C.length)) {
      s.migratedFrom = { key: V1, at: typeof mf.at === "string" ? mf.at : null, done: mf.done, quiz: mf.quiz,
        dropped: Array.isArray(mf.dropped) ? mf.dropped.filter((id) => typeof id === "string") : [] };
    }
    // Kept on purpose: records the one-time copy from aiHub.v2 (only the known fields survive).
    const cf = raw.copiedFrom; if (cf && typeof cf === "object" && typeof cf.key === "string") s.copiedFrom = { key: cf.key, at: typeof cf.at === "string" ? cf.at : null };
    if (typeof raw.trackId === "string") s.trackId = raw.trackId;
    return s;
  }
  /* v1 stored {done, quiz, theme, glosses, subgraphs, zoom}; its "k_*" nodes were assumed knowledge and no longer exist. */
  function migrateV1(v1) {
    const s = fresh(), dropped = [];
    for (const [id, v] of Object.entries(v1.done || {})) { if (BY[id] && v) s.done[id] = true; else dropped.push(id); }
    for (const [id, q] of Object.entries(v1.quiz || {})) { if (BY[id] && q && Number.isFinite(q.best)) s.quiz[id] = { best: q.best, last: q.last ?? q.best, at: q.at || null }; else dropped.push("quiz:" + id); }
    if (v1.theme === "dark") s.settings.theme = "dark";
    s.view = { subgraphs: !!v1.subgraphs, zoom: Number.isFinite(v1.zoom) ? v1.zoom : undefined };
    s.migratedFrom = { key: V1, at: new Date().toISOString(), done: Object.keys(s.done).length, quiz: Object.keys(s.quiz).length, dropped };
    return s;
  }
  const readJson = (k) => { const raw = localStorage.getItem(k); if (raw == null) return { raw }; try { const v = JSON.parse(raw); return { raw, v: v && typeof v === "object" && !Array.isArray(v) ? v : undefined }; } catch { return { raw }; } };
  function load() {
    try {
      const cur = readJson(KEY); if (cur.v) return sanitize(cur.v);
      // arggonLearn.v1 exists but is not a JSON object: keep the raw text for recovery and fall back to the old keys.
      if (cur.raw != null) { console.warn(`Saved progress under ${KEY} is corrupt; trying older data.`); try { localStorage.setItem(KEY + ".corrupt", cur.raw); } catch {} }
      // One-time copy from the AI Learning Hub key. Runs only while KEY is empty or corrupt, so it never overwrites valid progress.
      const old = readJson(LEGACY_V2);
      if (old.v) { const s = sanitize(old.v); s.copiedFrom = { key: LEGACY_V2, at: new Date().toISOString() }; localStorage.setItem(KEY, JSON.stringify(s)); return s; }
      const v1 = readJson(V1); if (v1.v) { const s = migrateV1(v1.v); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
    } catch (e) { console.warn("Could not read saved progress; starting fresh.", e); }
    return fresh();
  }
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { console.warn("Could not save progress", e); } };

  /* ---------- tracks ---------- */
  // window.LEARN_TRACKS (assets/tracks.js) lists the subjects. Track-specific copy comes from the active track.
  const TRACK_LIST = window.LEARN_TRACKS || [];
  const activeTrack = () => TRACK_LIST.find((tr) => tr.id === S.trackId) || TRACK_LIST[0];
  const tc = (k) => { const tr = activeTrack(), c = (tr && tr.copy) || {}; return (c[S.settings.uiLang] || {})[k] ?? (c.en || {})[k] ?? ""; };

  /* ---------- i18n ---------- */
  const t = (k, vars = {}) => { const L = window.I18N[S.settings.uiLang] || window.I18N.en; let s = L[k] ?? window.I18N.en[k] ?? k; for (const [a, b] of Object.entries(vars)) s = s.split("{" + a + "}").join(b); return s; };
  // Count phrases: "<key>_one" for exactly 1, "<key>_other" otherwise (same rule in EN and ES).
  const tn = (k, n) => t(k + (n === 1 ? "_one" : "_other"), { n });
  const tl = (obj) => (obj && (obj[S.settings.uiLang] || obj.en)) || "";
  const isEs = () => S.settings.uiLang === "es";
  /* Localized content: concept fields read the Spanish overlay (window.ES) when the UI is in Spanish. */
  const ESD = window.ES || { concepts: {}, glossary: {}, groups: {}, short: {}, comments: {} };
  for (const c of C) {
    const en = { title: c.title, summary: c.summary, why: c.why, body: c.body, quiz: c.quiz, resources: c.resources, diagram: c.diagram };
    c._en = en;
    const es = () => (isEs() && ESD.concepts[c.id]) || null;
    const def = (k, f) => Object.defineProperty(c, k, { get: () => { const e = es(); return e ? f(e) : en[k]; }, configurable: true });
    def("title", (e) => e.title); def("summary", (e) => e.summary); def("why", (e) => e.why); def("body", (e) => e.body); def("diagram", (e) => e.diagram || en.diagram);
    def("quiz", (e) => en.quiz.map((q, i) => ({ ...q, q: e.quiz[i][0], options: e.quiz[i][1], why: e.quiz[i][2] })));
    def("resources", (e) => en.resources.map((r, i) => ({ ...r, note: e.res[i] })));
  }
  for (const [g, info] of Object.entries(window.GROUPS)) { const en = info.label; Object.defineProperty(info, "label", { get: () => (isEs() && ESD.groups && ESD.groups[g]) || en, configurable: true }); }
  const LANG_LABEL = (k) => (k === "pseudo" ? t("lang_pseudo") : k === "any" ? t("lang_any") : LANGS[k]);
  /* Translate prose comments inside code samples (code itself stays as written). */
  function localizeCode(code) {
    if (!isEs() || !ESD.comments) return code;
    return code.split("\n").map((line) => line.replace(/(^|\s)(\/\/|#)(\s?)(.+)$/, (m, pre, mark, sp, txt) => { const tr = ESD.comments[txt.trim()]; return tr ? pre + mark + sp + tr : m; })).join("\n");
  }

  /* ---------- profile → known, track, language ---------- */
  function profileKnown(a) {
    const k = new Set(); if (!a) return k;
    if (a.prog === "little") k.add("prog_basics");
    if (a.prog === "comfortable" || a.prog === "pro") ["prog_basics", "vars_functions", "data_json"].forEach((x) => k.add(x));
    if (a.web === "built") ["web_apis", "data_json"].forEach((x) => k.add(x));
    if (a.db === "sql") k.add("db_basics");
    if (a.math === "strong") k.add("math_basics");
    if (a.ai === "daily" || a.ai === "build") k.add("chatbot_use");
    return k;
  }
  const trackFromAnswers = (a) => !a ? "beginner" : a.goal === "basics" ? "beginner" : a.goal === "build" ? "builder" : a.goal === "theory" ? "theory" : (a.prog === "comfortable" || a.prog === "pro") ? "builder" : "beginner";
  const langFromAnswers = (a) => (a && ["python", "ts", "csharp"].includes(a.lang) ? a.lang : "pseudo");
  const track = () => (S.settings.track !== "auto" ? S.settings.track : trackFromAnswers(S.profile && S.profile.answers));
  const fromProfile = (id) => profileKnown(S.profile && S.profile.answers).has(id);
  const isKnown = (id) => (id in S.manualKnown ? S.manualKnown[id] : fromProfile(id));
  const isDone = (id) => isKnown(id) || !!S.done[id];
  const ready = (id) => BY[id].prereqs.every(isDone);
  const status = (id) => (isKnown(id) ? "known" : S.done[id] ? "done" : ready(id) ? "ready" : "locked");
  const learnable = () => C.filter((c) => !isKnown(c.id));
  // One definition for "x/y concepts" in the header, the home cards and the progress page: concepts of the track
  // that aren't already known, and how many of those are done.
  const trackProgress = (tr) => { const ids = (tr ? tr.concepts() : C.map((c) => c.id)).filter((id) => BY[id] && !isKnown(id)); return { done: ids.filter((id) => S.done[id]).length, n: ids.length }; };
  function ancestors(id, acc = new Set()) { for (const p of BY[id].prereqs) if (!acc.has(p)) { acc.add(p); ancestors(p, acc); } return acc; }
  /* Personal order: walk the track; before each target insert its not-yet-known prerequisites (depth-first, prerequisites first). */
  function personalOrder() {
    const out = [], seen = new Set();
    const visit = (id) => { if (seen.has(id) || isKnown(id)) return; seen.add(id); for (const p of BY[id].prereqs) visit(p); out.push(id); };
    for (const id of TRACKS[track()]) visit(id);
    for (const c of C) visit(c.id);
    return out;
  }
  function nextBest() { return personalOrder().find((id) => !S.done[id]) || null; }
  function missingChain(id) { const order = personalOrder(); return [...ancestors(id)].filter((a) => !isDone(a)).sort((a, b) => order.indexOf(a) - order.indexOf(b)); }
  const ICON = { known: "🟢", done: "✅", ready: "▶️", locked: "🔒" };
  const LABEL = (st) => t("st_" + st);
  const title = (c) => esc(c.title);

  /* ---------- glossary links ---------- */
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const GL = (() => {
    const m = {};
    for (const [k, v] of Object.entries(window.GLOSSARY)) m[k] = { key: k, defEn: typeof v === "string" ? v : v.def, es: typeof v === "string" ? "" : v.es || "", display: k, in: [] };
    for (const c of C) for (const x of c._en.body.matchAll(/\[\[([^|\]]+)\|([^\]]+)\]\]/g)) {
      const k = x[1].trim().toLowerCase(); const e = m[k]; if (!e) continue;
      if (!e.in.includes(c.id)) e.in.push(c.id); if (!e.es) e.es = x[2]; if (e.display === k) e.display = x[1].trim();
    }
    for (const e of Object.values(m)) {
      e.displayEn = e.display.charAt(0).toUpperCase() + e.display.slice(1); delete e.display;
      const g = (ESD.glossary || {})[e.key];
      Object.defineProperty(e, "display", { get: () => (isEs() && g ? g[0] : e.displayEn) });
      Object.defineProperty(e, "def", { get: () => (isEs() && g ? g[1] : e.defEn) });
    }
    return m;
  })();
  // Glossary link text (English term or Spanish translation) is escaped before it goes into innerHTML.
  function gloss(html) {
    const seen = new Set();
    return html.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_, term, es) => {
      const k = term.trim().toLowerCase(), e = GL[k];
      if (isEs()) { const shown = esc(es); if (!e || seen.has(k)) return `<span class="term-plain">${shown}</span>`; seen.add(k); return `<a class="term" href="#/glossary/${slug(k)}" title="${esc(e.def)}">${shown}</a>`; }
      const esSpan = "";
      if (!e || seen.has(k)) return `<span class="term-plain">${esc(term)}</span>${esSpan}`;
      seen.add(k);
      return `<a class="term" href="#/glossary/${slug(k)}" title="${esc(e.def)}">${esc(term)}</a>${esSpan}`;
    });
  }

  /* ---------- mermaid ---------- */
  let mmReady = false, mmCount = 0;
  function initMermaid() {
    if (!window.mermaid) return false;
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: S.settings.theme === "dark" ? "dark" : "default", flowchart: { htmlLabels: true, curve: "basis", nodeSpacing: 14, rankSpacing: 38, wrappingWidth: 110, padding: 6 }, fontFamily: "system-ui, sans-serif" });
    mmReady = true; return true;
  }
  async function renderMermaid(container, code) {
    if (!mmReady && !initMermaid()) { container.innerHTML = `<pre class="code small">${esc(code)}</pre><p class="muted small">${t("mm_fallback")}</p>`; return null; }
    try { const { svg, bindFunctions } = await window.mermaid.render("mm" + ++mmCount, code); container.innerHTML = svg; bindFunctions && bindFunctions(container); return container.querySelector("svg"); }
    catch (e) { console.warn("mermaid render failed", e); container.innerHTML = `<pre class="code small">${esc(code)}</pre>`; return null; }
  }
  const SHORT = { prog_basics: "What programming is", vars_functions: "Variables & functions", data_json: "Data & JSON", web_apis: "How the web & APIs work", db_basics: "Databases basics", math_basics: "The math you need", chatbot_use: "Using a chatbot well", model: "What is a model?", probability: "Probability", vectors: "Vectors & matrices", optimization: "Gradient descent", ml_basics: "ML basics", neural_nets: "Neural networks", backprop: "Backpropagation", embeddings: "Embeddings", tokenization: "Tokenization", next_token: "Next-token prediction", attention: "Attention", transformers: "Transformer", pretraining: "Pretraining", finetuning: "Finetuning (SFT, LoRA)", rlhf: "RLHF & preferences", reasoning: "Reasoning models", llm_api: "Calling LLM APIs", prompting: "Prompting & context", vector_db: "Vector databases", rag: "RAG", tool_use: "Tool use", agents: "Agents", multi_agent: "Multi-agent", mcp: "MCP", evals: "Evals", safety: "Safety & injection", cost: "Cost & latency" };
  const mmLabel = (s) => s.replace(/"/g, "'").replace(/&/g, "and");
  function graphCode(ids, opts = {}) {
    const set = new Set(ids), lines = ["flowchart " + (opts.dir || "TD")], order = personalOrder();
    const groups = {}; for (const id of ids) (groups[BY[id].group] ||= []).push(id);
    const nodeLine = (id) => { const st = status(id), pos = order.indexOf(id); const tag = st === "known" ? t("st_known") : opts.nums && pos >= 0 && st !== "done" ? "#" + (pos + 1) : ""; return `  ${id}["${ICON[st]} ${mmLabel((isEs() && ESD.short && ESD.short[id]) || (isEs() ? BY[id].title : SHORT[id] || BY[id].title))}${tag ? "<br/><small>" + mmLabel(tag) + "</small>" : ""}"]:::${st}${id === opts.focus ? "Focus" : ""}`; };
    if (opts.subgraphs) for (const [g, list] of Object.entries(groups)) { lines.push(`  subgraph G_${g}["${mmLabel(window.GROUPS[g].label)}"]`); list.forEach((id) => lines.push("  " + nodeLine(id))); lines.push("  end"); }
    else ids.forEach((id) => lines.push(nodeLine(id)));
    for (const id of ids) for (const p of BY[id].prereqs) if (set.has(p)) lines.push(`  ${p} --> ${id}`);
    for (const id of ids) if (id !== opts.focus) lines.push(`  style ${id} stroke:${window.GROUPS[BY[id].group].color}`);
    const dark = S.settings.theme === "dark";
    lines.push(`  classDef known fill:${dark ? "#1b3a20" : "#e8f5e9"},stroke:#2e7d32,stroke-width:2px,color:${dark ? "#d7f5da" : "#1b4d1f"}`);
    lines.push(`  classDef done fill:${dark ? "#14532d" : "#c8e6c9"},stroke:#1b5e20,stroke-width:3px,color:${dark ? "#e6ffe9" : "#0b3d12"}`);
    lines.push(`  classDef ready fill:${dark ? "#0d2a4a" : "#e3f2fd"},stroke:#1565c0,stroke-width:3px,color:${dark ? "#dbeafe" : "#0d2a4a"}`);
    lines.push(`  classDef locked fill:${dark ? "#222" : "#f3f3f3"},stroke:#9e9e9e,stroke-width:1px,stroke-dasharray:4 3,color:${dark ? "#bbb" : "#555"}`);
    for (const st of ["known", "done", "ready", "locked"]) lines.push(`  classDef ${st}Focus fill:#fff3e0,stroke:#ef6c00,stroke-width:4px,color:#000`);
    return lines.join("\n");
  }
  function wireGraphClicks(svg) {
    if (!svg) return;
    svg.querySelectorAll("g.node").forEach((g) => {
      const m = (g.id || "").match(/flowchart-([a-z_]+)-\d+$/); if (!m || !BY[m[1]]) return;
      g.style.cursor = "pointer"; g.setAttribute("tabindex", "0"); g.setAttribute("role", "link"); g.setAttribute("aria-label", BY[m[1]].title);
      g.addEventListener("click", () => (location.hash = "#/c/" + m[1]));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = "#/c/" + m[1]; });
    });
  }

  /* ---------- shell ---------- */
  function header() {
    const { done: doneN, n: totalN } = trackProgress(activeTrack());
    $("#progress-mini").innerHTML = `<span>${doneN}/${totalN} ${t("concepts")}</span><span class="pbar"><span style="width:${totalN ? (100 * doneN) / totalN : 100}%"></span></span>`;
    const h = location.hash || "#/home";
    document.querySelectorAll("header nav a").forEach((a) => { a.classList.toggle("active", h.startsWith(a.getAttribute("href"))); a.textContent = t(a.dataset.i18n); });
    $(".brand small").textContent = t("tagline");
    const de = document.documentElement; de.dataset.theme = S.settings.theme; de.dataset.codeLang = S.settings.codeLang; de.lang = S.settings.uiLang;
    $("#lang-toggle").textContent = "🌐 " + t("lang_btn"); $("#lang-toggle").title = t("ui_lang");
    $("#theme-toggle").title = t("theme_toggle"); document.title = t("doc_title"); for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) { const m = $(sel); if (m) m.content = t("meta_desc"); } { const m = $('meta[property="og:title"]'); if (m) m.content = t("doc_title"); } const ft = $("footer"); if (ft) ft.textContent = t("footer");
  }
  const trackName = () => t("track_" + track());
  function nextCard() {
    const n = nextBest();
    if (!n) return `<div class="card next"><h3>${t("all_done")}</h3><p>${t("all_done_p")}</p></div>`;
    const c = BY[n], miss = missingChain(n);
    return `<div class="card next"><div class="kicker">${t("next_kicker")}</div><h3><a href="#/c/${n}">${ICON[status(n)]} ${esc(c.title)}</a></h3><p>${esc(c.summary)}</p>
      <p class="muted small">${miss.length ? t("needs_first", { list: miss.map((m) => esc(BY[m].title)).join(" → ") }) : t("why_next", { track: esc(trackName()) })} ≈ ${c.minutes} min.</p>
      <a class="btn" href="#/c/${n}">${t("start")}</a></div>`;
  }
  function personalizeBanner() {
    if (S.profile) return "";
    return `<div class="card banner"><b>${t("personalize")}</b> — ${t("personalize_p")} <a class="btn small" href="#/welcome">${t("personalize")} →</a></div>`;
  }

  /* ---------- onboarding & profile form ---------- */
  function profileForm(answers) {
    return window.ONBOARDING.map((q) => `<fieldset class="q ob" data-q="${q.id}"><legend>${esc(tl(q.q))}</legend>${q.opts.map(([v, lab]) => `<label class="radio"><input type="radio" name="ob_${q.id}" value="${v}" ${answers && answers[q.id] === v ? "checked" : ""}> ${esc(tl(lab))}</label>`).join("")}</fieldset>`).join("");
  }
  const readForm = (root) => { const a = {}; for (const q of window.ONBOARDING) { const r = root.querySelector(`input[name="ob_${q.id}"]:checked`); if (r) a[q.id] = r.value; } return a; };
  function previewText(a) {
    const k = [...profileKnown(a)]; const tr = trackFromAnswers(a);
    return t("preview", { n: k.length, list: k.length ? k.map((id) => esc(BY[id].title)).join(", ") : t("none"), track: esc(t("track_" + tr)), lang: esc(LANG_LABEL(langFromAnswers(a))) });
  }
  function applyProfile(a) {
    S.profile = { answers: a, at: new Date().toISOString() }; S.skipped = false;
    S.settings.codeLang = langFromAnswers(a); S.settings.track = "auto";
    save();
  }
  function viewWelcome(main) {
    const a = (S.profile && S.profile.answers) || { goal: "auto" };
    main.innerHTML = `<section class="card welcome"><h1>${t("welcome_title")}</h1><p>${tc("welcome_p1")}</p><p>${t("welcome_p2")}</p>
      ${S.migratedFrom ? `<p class="tip">${esc(t("migrated", { done: S.migratedFrom.done, quiz: S.migratedFrom.quiz }))}</p>` : ""}
      <form id="ob" class="ob-form">${profileForm(a)}</form>
      <p id="ob-preview" class="preview" aria-live="polite"></p>
      <div class="pn"><button class="btn" id="ob-save" type="button">${t("save_start")}</button><button class="btn ghost" id="ob-skip" type="button">${t("skip")}</button></div></section>`;
    const upd = () => ($("#ob-preview").innerHTML = previewText(readForm($("#ob"))));
    $("#ob").addEventListener("change", upd); upd();
    $("#ob-save").onclick = () => { applyProfile(readForm($("#ob"))); location.hash = "#/map"; };
    $("#ob-skip").onclick = () => { S.skipped = true; save(); location.hash = "#/map"; };
  }

  /* ---------- map ---------- */
  async function viewMap(main) {
    main.innerHTML = `${personalizeBanner()}
      <section class="intro card"><h2>${tc("map_title")}</h2><p>${t("map_p")}</p>
        <p class="legend">${["known", "done", "ready", "locked"].map((k) => `<span>${ICON[k]} ${LABEL(k)}</span>`).join("")}</p></section>
      ${nextCard()}
      <section class="card"><div class="graph-tools"><b>${t("graph_title")}</b><span class="legend small"><span class="muted">${t("border_topic")}</span>${Object.values(window.GROUPS).map((g) => `<span><span class="gdot" style="background:${g.color}"></span>${esc(g.label)}</span>`).join("")}</span><span class="spacer"></span>
        <label class="check"><input type="checkbox" id="sg" ${S.view.subgraphs ? "checked" : ""}> ${t("group_by")}</label>
        <button class="btn ghost small" id="zout" type="button" aria-label="${t("zoom_out")}">−</button><button class="btn ghost small" id="zin" type="button" aria-label="${t("zoom_in")}">+</button><button class="btn ghost small" id="zfit" type="button">${t("zoom_fit")}</button></div>
        <p class="muted small">${t("map_hint")}</p>
        <div id="graph" class="graph" aria-label="${t("graph_aria")}"></div></section>`;
    const draw = async () => {
      const svg = await renderMermaid($("#graph"), graphCode(C.map((c) => c.id), { subgraphs: S.view.subgraphs, nums: true }));
      if (!svg) { $("#graph").insertAdjacentHTML("beforeend", fallbackList()); return; }
      wireGraphClicks(svg); svg.style.maxWidth = "none"; svg.dataset.w = svg.viewBox.baseVal.width;
      setZoom(S.view.zoom || Math.min(1, Math.max(0.72, ($("#graph").clientWidth - 16) / +svg.dataset.w)), false);
      $("#graph").scrollLeft = ($("#graph").scrollWidth - $("#graph").clientWidth) / 2;
    };
    const setZoom = (z, persist = true) => { z = Math.max(0.25, Math.min(2.5, z)); if (persist) { S.view.zoom = z; save(); } const svg = $("#graph svg"); if (svg) svg.style.width = +svg.dataset.w * z + "px"; };
    const cur = () => { const svg = $("#graph svg"); return svg ? svg.getBoundingClientRect().width / +svg.dataset.w : 1; };
    $("#zin").onclick = () => setZoom(cur() * 1.2); $("#zout").onclick = () => setZoom(cur() / 1.2);
    $("#zfit").onclick = () => { const svg = $("#graph svg"); if (svg) { delete S.view.zoom; save(); setZoom(($("#graph").clientWidth - 16) / +svg.dataset.w, false); } };
    $("#sg").onchange = (e) => { S.view.subgraphs = e.target.checked; save(); draw(); };
    await draw();
  }
  function fallbackList() { return `<ul>${personalOrder().map((id) => `<li>${ICON[status(id)]} <a href="#/c/${id}">${esc(BY[id].title)}</a>${BY[id].prereqs.length ? " ← " + BY[id].prereqs.map((p) => esc(BY[p].title)).join(", ") : ""}</li>`).join("")}</ul>`; }

  /* ---------- path ---------- */
  function viewPath(main) {
    const order = personalOrder(), known = C.filter((c) => isKnown(c.id));
    const left = order.filter((id) => !S.done[id]).reduce((s, id) => s + BY[id].minutes, 0);
    const row = (id, i) => { const c = BY[id], st = status(id), q = S.quiz[id]; return `<li class="path-item ${st}"><span class="num">${i + 1}</span><span class="st" title="${LABEL(st)}">${ICON[st]}</span><div><a href="#/c/${id}">${title(c)}</a> <span class="muted small">· ${esc(window.GROUPS[c.group].label)} · ${c.minutes} min${q ? ` · ${t("quiz_short")} ${q.best}/${c.quiz.length}` : ""}</span>${c.prereqs.length ? `<div class="muted small">${t("needs_label")} ${c.prereqs.map((p) => `<a href="#/c/${p}">${esc(BY[p].title)}</a>${isKnown(p) ? " 🟢" : ""}`).join(", ")}</div>` : ""}</div></li>`; };
    main.innerHTML = `${personalizeBanner()}${nextCard()}
      <div class="two-col path">
      <section class="card"><h2>${t("path_title")}</h2><p class="muted">${t("path_p")}</p>
        <p><label class="slider"><span class="slabel">${t("track")}</span><select id="track-sel">${["auto", "beginner", "builder", "theory"].map((k) => `<option value="${k}" ${S.settings.track === k ? "selected" : ""}>${esc(t("track_" + k))}</option>`).join("")}</select></label> <span class="muted small">${t("path_hours", { h: Math.round(left / 6) / 10 })}</span></p>
        <ol class="path-list">${order.map(row).join("")}</ol></section>
      <section class="card"><h2>${t("why_order")}</h2><ul class="small">
        ${[1, 2, 3, 4, 5].map((i) => `<li>${t("why_order_" + i)}</li>`).join("")}</ul>
        ${known.length ? `<h3>${t("path_known")}</h3><div class="chips">${known.map((c) => `<a class="chip st-known" href="#/c/${c.id}">🟢 ${esc(c.title)}</a>`).join("")}</div>` : ""}
        <p class="small"><a href="#/settings">${t("nav_settings")} →</a></p></section></div>`;
    $("#track-sel").onchange = (e) => { S.settings.track = e.target.value; save(); route(); };
  }

  /* ---------- progress ---------- */
  function viewProgress(main) {
    const L = learnable(), doneN = L.filter((c) => S.done[c.id]).length, qs = Object.entries(S.quiz);
    main.innerHTML = `${nextCard()}<section class="card"><h2>${t("progress_title")}</h2><p>${doneN} / ${L.length} · ${qs.length} ${t("quizzes")} · ${qs.length ? Math.round((100 * qs.reduce((s, [id, q]) => s + q.best / BY[id].quiz.length, 0)) / qs.length) : 0}%</p>
      <table class="ptable"><thead><tr><th>${t("concept_col")}</th><th>${t("group")}</th><th>${t("status")}</th><th>${t("quiz_col")}</th><th>${t("done_col")}</th></tr></thead><tbody>
      ${personalOrder().concat(C.filter((c) => isKnown(c.id)).map((c) => c.id)).map((id) => { const c = BY[id], st = status(id), q = S.quiz[id]; return `<tr><td><a href="#/c/${id}">${title(c)}</a></td><td><span class="gdot" style="background:${window.GROUPS[c.group].color}"></span>${esc(window.GROUPS[c.group].label)}</td><td>${ICON[st]} ${LABEL(st)}</td><td>${q ? `${q.best}/${c.quiz.length} · ${q.last}/${c.quiz.length}` : "—"}</td><td>${isKnown(id) ? "—" : `<input type="checkbox" data-done="${id}" ${S.done[id] ? "checked" : ""} aria-label="${t("done_col")}: ${esc(c.title)}">`}</td></tr>`; }).join("")}
      </tbody></table>${dataTools()}</section>`;
    main.querySelectorAll("[data-done]").forEach((cb) => cb.addEventListener("change", () => { if (cb.checked) S.done[cb.dataset.done] = true; else delete S.done[cb.dataset.done]; save(); route(); }));
    wireDataTools(main);
  }
  function dataTools() {
    return `<div class="datatools"><h3>${t("data_title")}</h3><p class="muted small">${t("data_p", { key: KEY })}</p>
      <p class="tools"><button class="btn ghost" id="export" type="button">${t("export")}</button> <label class="btn ghost" for="import-file">${t("import")}</label><input type="file" id="import-file" accept="application/json,.json" hidden>
      <button class="btn ghost danger" id="reset" type="button">${t("reset_progress")}</button> <button class="btn ghost danger" id="reset-all" type="button">${t("reset_all")}</button></p><p id="data-msg" class="small" aria-live="polite"></p></div>`;
  }
  // Import validation. Rejections throw an ImportError whose key is a localized message; the current state is
  // only replaced after a file passes every check.
  class ImportError extends Error { constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; } }
  const plain = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const knownIds = (o) => (plain(o) ? Object.keys(o).filter((id) => BY[id]) : []);
  const validProfile = (p) => plain(p) && plain(p.answers) && Object.keys(p.answers).length > 0;
  function importState(obj) {
    if (!plain(obj)) throw new ImportError("imp_err_obj");
    // Accepts arggon-learn-progress.json and files exported by AI Learning Hub (ai-hub-progress.json, same v2 shape, no "app" field)
    // and its v1 format. The file name doesn't matter; only the content is checked.
    if (obj.app !== undefined && obj.app !== "arggon-learn") { const a = String(obj.app); throw new ImportError("imp_err_app", { app: a.length > 80 ? a.slice(0, 79) + "…" : a }); }
    for (const f of ["done", "quiz", "manualKnown", "settings", "view"]) if (obj[f] !== undefined && !plain(obj[f])) throw new ImportError("imp_err_shape", { field: f });
    if (obj.profile != null && !validProfile(obj.profile)) throw new ImportError("imp_err_shape", { field: "profile" });
    if (typeof obj.version === "string" && obj.version.trim() === "2") throw new ImportError("imp_err_version_str");
    if (obj.version !== undefined && obj.version !== 2) { const v = String(obj.version); throw new ImportError("imp_err_version", { v: v.length > 40 ? v.slice(0, 39) + "…" : v }); }
    const hasData = knownIds(obj.done).length || knownIds(obj.quiz).length || knownIds(obj.manualKnown).length || validProfile(obj.profile);
    // Empty backups need the complete v2 export envelope, not just a version/app marker.
    // AI Learning Hub exported the same state + exportedAt without the app field.
    const emptyExport = obj.version === 2 && obj.profile === null && typeof obj.skipped === "boolean" &&
      ["done", "quiz", "manualKnown"].every((f) => plain(obj[f]) && Object.keys(obj[f]).length === 0) &&
      plain(obj.settings) && ["pseudo", "python", "ts", "csharp"].includes(obj.settings.codeLang) &&
      ["en", "es"].includes(obj.settings.uiLang) && ["light", "dark"].includes(obj.settings.theme) &&
      ["auto", "beginner", "builder", "theory"].includes(obj.settings.track) && plain(obj.view) &&
      (obj.view.subgraphs === undefined || typeof obj.view.subgraphs === "boolean") &&
      (obj.view.zoom === undefined || Number.isFinite(obj.view.zoom)) &&
      typeof obj.exportedAt === "string" && Number.isFinite(Date.parse(obj.exportedAt));
    if (!hasData && !emptyExport) throw new ImportError("imp_err_empty");
    if (obj.version === 2) return sanitize(obj);
    return migrateV1(obj); // v1: no version field, done / quiz are plain objects
  }
  // #data-msg can contain text from the imported file (e.g. its "app" value), so it is written as text, never as HTML.
  const setMsg = (el, cls, text) => { const sp = document.createElement("span"); sp.className = cls; sp.textContent = text; el.replaceChildren(sp); };
  function wireDataTools(root) {
    const msg = $("#data-msg", root);
    $("#export", root).onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: "arggon-learn", ...S, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }));
      a.download = "arggon-learn-progress.json"; document.body.append(a); a.click(); a.remove();
    };
    $("#import-file", root).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let parsed; try { parsed = JSON.parse(await f.text()); } catch { setMsg(msg, "bad", t("import_bad", { err: t("imp_err_json") })); e.target.value = ""; return; }
      let next; try { next = importState(parsed); } catch (err) { setMsg(msg, "bad", t("import_bad", { err: err instanceof ImportError ? t(err.key, err.vars) : t("imp_err_obj") })); e.target.value = ""; return; }
      // A valid file replaces the current progress: ask first. Cancelling leaves everything as it was.
      const cur = { done: Object.keys(S.done).length, quiz: Object.keys(S.quiz).length };
      const inc = { done: Object.keys(next.done).length, quiz: Object.keys(next.quiz).length };
      const counts = (c) => `${tn("n_done", c.done)}, ${tn("n_quiz", c.quiz)}`;
      if (!confirm(t("confirm_import", { cur: counts(cur), inc: counts(inc) }))) { setMsg(msg, "muted", t("import_cancelled")); e.target.value = ""; return; }
      e.target.value = ""; // reset so choosing the same file again fires change
      try { S = next; save(); mmReady = false; route().then(() => { const m = $("#data-msg"); if (m) setMsg(m, "good", t("import_ok")); }); }
      catch (err) { setMsg(msg, "bad", t("import_bad", { err: err instanceof ImportError ? t(err.key, err.vars) : t("imp_err_obj") })); }
    };
    $("#reset", root).onclick = () => { if (confirm(t("confirm_reset"))) { S.done = {}; S.quiz = {}; save(); route(); } };
    $("#reset-all", root).onclick = () => { if (confirm(t("confirm_reset_all"))) { S = fresh(); save(); mmReady = false; location.hash = "#/welcome"; route(); } };
  }

  /* ---------- settings ---------- */
  function viewSettings(main) {
    const a = (S.profile && S.profile.answers) || {};
    main.innerHTML = `<section class="card"><h1>${t("settings_title")}</h1>
      <div class="settings-grid">
        <label class="slider"><span class="slabel">${t("code_lang")}</span><select id="set-code">${["pseudo", "python", "ts", "csharp"].map((k) => `<option value="${k}" ${S.settings.codeLang === k ? "selected" : ""}>${LANG_LABEL(k)}</option>`).join("")}</select></label>
        <label class="slider"><span class="slabel">${t("ui_lang")}</span><select id="set-ui"><option value="en" ${!isEs() ? "selected" : ""}>English</option><option value="es" ${isEs() ? "selected" : ""}>Español</option></select></label>
        <label class="slider"><span class="slabel">${t("track")}</span><select id="set-track">${["auto", "beginner", "builder", "theory"].map((k) => `<option value="${k}" ${S.settings.track === k ? "selected" : ""}>${esc(t("track_" + k))}</option>`).join("")}</select></label>
        <label class="slider"><span class="slabel">${t("theme")}</span><select id="set-theme"><option value="light" ${S.settings.theme === "light" ? "selected" : ""}>${t("theme_light")}</option><option value="dark" ${S.settings.theme === "dark" ? "selected" : ""}>${t("theme_dark")}</option></select></label>
      </div></section>
      <section class="card"><h2>${t("settings_profile")}</h2><p class="muted">${t("settings_profile_p")}</p><form id="ob" class="ob-form">${profileForm(a)}</form>
        <p id="ob-preview" class="preview" aria-live="polite"></p><button class="btn" id="ob-save" type="button">${t("save")}</button> <span id="ob-msg" class="good small"></span></section>
      <section class="card"><h2>${t("known_title")}</h2><p class="muted">${t("known_p")}</p><div class="known-grid">
        ${Object.entries(window.GROUPS).map(([g, info]) => { const list = C.filter((c) => c.group === g); return list.length ? `<div><h3 class="small"><span class="gdot" style="background:${info.color}"></span>${esc(info.label)}</h3>${list.map((c) => `<label class="check"><input type="checkbox" data-known="${c.id}" ${isKnown(c.id) ? "checked" : ""}> ${esc(c.title)} ${c.id in S.manualKnown ? `<span class="muted small">(${t("marked_by_you")})</span>` : fromProfile(c.id) ? `<span class="muted small">(${t("from_answers")})</span>` : ""}</label>`).join("")}</div>` : ""; }).join("")}
      </div></section>
      <section class="card">${dataTools()}</section>`;
    $("#set-code").onchange = (e) => { S.settings.codeLang = e.target.value; save(); header(); };
    $("#set-ui").onchange = (e) => { S.settings.uiLang = e.target.value; save(); route(); };
    $("#set-track").onchange = (e) => { S.settings.track = e.target.value; save(); header(); };
    $("#set-theme").onchange = (e) => { S.settings.theme = e.target.value; save(); mmReady = false; header(); };
    const upd = () => ($("#ob-preview").innerHTML = previewText(readForm($("#ob"))));
    $("#ob").addEventListener("change", upd); upd();
    $("#ob-save").onclick = () => { const keepLang = S.profile ? S.settings.codeLang : null; const ans = readForm($("#ob")); const prevLang = S.profile && langFromAnswers(S.profile.answers); applyProfile(ans); if (keepLang && prevLang === langFromAnswers(ans)) S.settings.codeLang = keepLang; save(); route().then(() => { const m = $("#ob-msg"); if (m) m.textContent = t("saved"); }); };
    main.querySelectorAll("[data-known]").forEach((cb) => cb.addEventListener("change", () => { const id = cb.dataset.known; if (cb.checked === fromProfile(id)) delete S.manualKnown[id]; else S.manualKnown[id] = cb.checked; save(); route(); }));
    wireDataTools(main);
  }

  /* ---------- glossary ---------- */
  function viewGlossary(main, focus) {
    const entries = Object.values(GL).sort((a, b) => a.display.localeCompare(b.display, isEs() ? "es" : "en", { sensitivity: "base" }));
    main.innerHTML = `<section class="card"><h1>${t("glossary_title")}</h1><p class="muted">${t("glossary_p")}</p>
      <input type="search" id="gsearch" class="search" placeholder="${esc(t("search"))}" aria-label="${esc(t("search"))}"> <span class="muted small" id="gcount"></span>
      <dl class="glossary">${entries.map((e) => `<div class="gentry" id="g-${slug(e.key)}" data-text="${esc((e.display + " " + e.def + " " + e.displayEn).toLowerCase())}"><dt>${esc(e.display)}${isEs() ? ` <span class="es">(${esc(e.displayEn)})</span>` : ""}</dt><dd>${esc(e.def)}${e.in.length ? `<div class="small muted">${t("appears_in")}: ${e.in.map((id) => `<a href="#/c/${id}">${esc(BY[id].title)}</a>`).join(", ")}</div>` : ""}</dd></div>`).join("")}</dl>
      <p id="gnone" class="muted" hidden>${t("no_terms")}</p></section>`;
    const filter = () => { const q = $("#gsearch").value.trim().toLowerCase(); let n = 0; main.querySelectorAll(".gentry").forEach((d) => { const show = !q || d.dataset.text.includes(q); d.hidden = !show; if (show) n++; }); $("#gcount").textContent = n + " / " + entries.length; $("#gnone").hidden = n > 0; };
    $("#gsearch").addEventListener("input", filter); filter();
    if (focus) { const el = document.getElementById("g-" + focus); if (el) { el.classList.add("hl"); setTimeout(() => el.scrollIntoView({ block: "center" }), 0); } }
  }

  /* ---------- concept page ---------- */
  function treeHtml(id, seen, depth) {
    const c = BY[id], st = status(id);
    const head = `${ICON[st]} <a href="#/c/${id}">${esc(c.title)}</a>`;
    if (depth > 0 && isKnown(id)) return `<li class="t-known">${head} <span class="muted small">${t("stop_here")}</span></li>`;
    if (depth > 0 && seen.has(id)) return `<li>${head} <span class="muted small">${t("listed_above")}</span></li>`;
    seen.add(id);
    if (!c.prereqs.length) return `<li>${depth === 0 ? `<b>${head}</b>` : head}</li>`;
    return `<li>${depth === 0 ? `<b>${head}</b>` : head} <span class="muted small">${t("needs")}</span><ul>${c.prereqs.map((p) => treeHtml(p, seen, depth + 1)).join("")}</ul></li>`;
  }
  function exerciseCode(c) {
    const base = c.exercise.code, code = typeof base === "string" ? { [c.exercise.lang === "TypeScript" ? "ts" : "csharp"]: base } : { ...base };
    const extra = (window.EXERCISES || {})[c.id]; if (extra) Object.assign(code, extra.code);
    const es = isEs() && ESD.concepts[c.id];
    for (const k of Object.keys(code)) code[k] = localizeCode(code[k]);
    return { task: (es && es.task) || (extra && extra.task) || c.exercise.task, code };
  }
  const RUN_HINT = new Proxy({}, { get: (_, k) => t("run_" + String(k)) });
  function renderExercise(box, c) {
    const { task, code } = exerciseCode(c);
    const langs = LANG_ORDER.filter((l) => code[l]);
    const want = S.settings.codeLang; let cur = code[want] ? want : code.pseudo ? "pseudo" : langs[0];
    box.innerHTML = `<h2>${t("hands_on")}</h2><p>${safeHtml(task)}</p>
      ${langs.length > 1 ? `<div class="tabs" role="tablist">${langs.map((l) => `<button type="button" role="tab" class="tab" data-lang="${l}">${LANG_LABEL(l)}</button>`).join("")}</div>` : ""}
      <p class="muted small" id="ex-note"></p>
      <div class="codewrap"><button class="btn ghost small copy" type="button">${t("copy")}</button><pre class="code"><code id="ex-code"></code></pre></div><p class="muted small" id="ex-hint"></p>`;
    const show = () => {
      $("#ex-code", box).textContent = code[cur]; $("#ex-hint", box).innerHTML = RUN_HINT[cur];
      $("#ex-note", box).textContent = !code[want] && cur !== want && want ? t("not_available", { lang: LANG_LABEL(want), shown: LANG_LABEL(cur) }) : "";
      box.querySelectorAll(".tab").forEach((b) => { b.classList.toggle("active", b.dataset.lang === cur); b.setAttribute("aria-selected", b.dataset.lang === cur); });
    };
    box.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { cur = b.dataset.lang; show(); }));
    $(".copy", box).onclick = (e) => { navigator.clipboard?.writeText(code[cur]).then(() => (e.target.textContent = t("copied")), () => (e.target.textContent = t("copy_fail"))); };
    show();
  }
  let vizObserver = null;
  async function viewConcept(main, id) {
    const c = BY[id]; if (!c) { main.innerHTML = `<p>${t("not_found")} <a href="#/map">${t("back_to_map")}</a></p>`; return; }
    const st = status(id), g = window.GROUPS[c.group], order = personalOrder(), oi = order.indexOf(id);
    const prev = oi > 0 ? order[oi - 1] : null, next = oi >= 0 && oi < order.length - 1 ? order[oi + 1] : null;
    const missing = missingChain(id), dependents = C.filter((x) => x.prereqs.includes(id));
    const resGeneral = c.resources.filter((r) => !r.lang), resLang = c.resources.filter((r) => r.lang === S.settings.codeLang);
    const resLi = (r) => `<li><span class="rtype ${r.type}">${r.type === "video" ? "▶ " + t("rt_video") : r.type === "docs" ? "📘 " + t("rt_docs") : "📄 " + t("rt_reading")}</span> <a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a>${isEs() ? ` <span class="muted small">${t("in_english")}</span>` : ""}<div class="muted small">${esc(r.note || "")} <span class="url">${esc(r.u)}</span></div></li>`;
    const knownCtl = isKnown(id)
      ? `<span class="good">🟢 ${fromProfile(id) && !(id in S.manualKnown) ? t("known_from_profile") : t("known_mark")}</span> <button class="btn ghost small" id="unknown" type="button">${t("undo_known")}</button>`
      : `<label class="check big"><input type="checkbox" id="done" ${S.done[id] ? "checked" : ""}> ${t("mark_done")}</label> <button class="btn ghost small" id="iknow" type="button">🟢 ${t("known_mark")}</button>`;
    main.innerHTML = `
      <nav class="crumbs"><a href="#/map">${t("nav_map")}</a> › <span style="color:${g.color}">${esc(g.label)}</span> › ${esc(c.title)}</nav>
      <article class="concept">
      <header class="c-head" style="border-color:${g.color}"><h1>${esc(c.title)}</h1>
        <div class="badges"><span class="badge st-${st}">${ICON[st]} ${LABEL(st)}</span><span class="badge">⏱ ≈ ${c.minutes} min</span>${oi >= 0 ? `<span class="badge fast">${t("on_path", { n: oi + 1 })}</span>` : ""}</div>
        <p class="summary">${esc(c.summary)}</p><p class="why"><b>${t("why_learn")}</b> ${esc(c.why)}</p></header>
      <section class="card prereq"><h2>${t("before_this")}</h2>
        ${c.prereqs.length ? `<div class="chips">${c.prereqs.map((p) => `<a class="chip st-${status(p)}" href="#/c/${p}">${ICON[status(p)]} ${esc(BY[p].title)}</a>`).join("")}</div>` : `<p>${t("nothing_needed")}</p>`}
        ${missing.length ? `<p class="warnbox">${t("learn_first")} ${missing.map((m) => `<a href="#/c/${m}">${esc(BY[m].title)}</a>`).join(" → ")}</p>` : c.prereqs.length ? `<p class="good small">${t("all_covered")}</p>` : ""}
        ${c.prereqs.length ? `<details ${missing.length ? "open" : ""}><summary>${t("show_tree")}</summary><ul class="tree">${treeHtml(id, new Set(), 0)}</ul><div id="mini" class="graph mini"></div></details>` : ""}
        ${dependents.length ? `<p class="muted small">${t("unlocks")} ${dependents.map((d) => `<a href="#/c/${d.id}">${esc(d.title)}</a>`).join(", ")}</p>` : ""}
      </section>
      <section class="card body">${gloss(c.body)}</section>
      ${c.diagram ? `<section class="card"><h2>${t("diagram")}</h2><div class="diagram" id="diagram"></div></section>` : ""}
      ${c.viz ? `<section class="card viz"><h2>${t("try_it")}</h2><div id="viz"></div></section>` : ""}
      <section class="card res"><h2>${t("resources")}</h2><ul class="resources">${resGeneral.map(resLi).join("")}</ul>
        ${resLang.length ? `<h3 class="small">${t("for_lang", { lang: LANG_LABEL(S.settings.codeLang) })}</h3><ul class="resources">${resLang.map(resLi).join("")}</ul>` : ""}</section>
      <section class="card quiz" id="quiz"></section>
      <section class="card ex" id="exercise"></section>
      <section class="card done-row"><div>${knownCtl}</div>
        <div class="pn">${prev ? `<a class="btn ghost" href="#/c/${prev}">← ${esc(BY[prev].title)}</a>` : ""}${next ? `<a class="btn ghost" href="#/c/${next}">${esc(BY[next].title)} →</a>` : ""}</div></section>
      ${nextCard()}
      </article>`;
    const doneBox = $("#done"); if (doneBox) doneBox.onchange = () => { if (doneBox.checked) S.done[id] = true; else delete S.done[id]; save(); route(); };
    const ik = $("#iknow"); if (ik) ik.onclick = () => { if (fromProfile(id)) delete S.manualKnown[id]; else S.manualKnown[id] = true; save(); route(); };
    const uk = $("#unknown"); if (uk) uk.onclick = () => { if (fromProfile(id)) S.manualKnown[id] = false; else delete S.manualKnown[id]; save(); route(); };
    renderQuiz($("#quiz"), c);
    renderExercise($("#exercise"), c);
    if (vizObserver) { vizObserver.disconnect(); vizObserver = null; }
    if (c.viz && window.VIZ[c.viz] && isEs() && window.VIZ_I18N) vizObserver = window.VIZ_I18N.watch($("#viz"));
    if (c.viz && window.VIZ[c.viz]) { try { window.VIZ[c.viz]($("#viz")); } catch (e) { console.error(e); $("#viz").textContent = t("viz_error") + e.message; } }
    if (c.diagram) await renderMermaid($("#diagram"), c.diagram);
    if ($("#mini")) { const ids = [...ancestors(id), id]; const svg = await renderMermaid($("#mini"), graphCode(ids, { dir: "LR", focus: id })); wireGraphClicks(svg); }
  }
  function renderQuiz(box, c) {
    const answers = {}; let score = 0;
    const prevQ = S.quiz[c.id];
    box.innerHTML = `<h2>${t("quiz")}</h2><p class="muted small">${t("quiz_meta", { n: c.quiz.length })}${prevQ ? t("quiz_best", { b: prevQ.best, n: c.quiz.length }) : ""}</p>`;
    c.quiz.forEach((q, qi) => {
      const fs = document.createElement("fieldset"); fs.className = "q";
      fs.innerHTML = `<legend>${qi + 1}. ${esc(q.q)}</legend>` + q.options.map((o, oi) => `<button type="button" class="opt" data-oi="${oi}">${esc(o)}</button>`).join("") + `<div class="fb" aria-live="polite"></div>`;
      fs.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
        if (qi in answers) return; const oi = +b.dataset.oi; answers[qi] = oi; const ok = oi === q.a; if (ok) score++;
        fs.querySelectorAll(".opt").forEach((x) => { x.disabled = true; if (+x.dataset.oi === q.a) x.classList.add("correct"); });
        if (!ok) b.classList.add("wrong");
        fs.querySelector(".fb").innerHTML = (ok ? `<span class="good">${t("q_correct")}</span> ` : `<span class="bad">${t("q_wrong")}</span> `) + esc(q.why);
        if (Object.keys(answers).length === c.quiz.length) finish();
      }));
      box.append(fs);
    });
    const res = document.createElement("div"); res.className = "quiz-result"; box.append(res);
    function finish() {
      const best = Math.max(score, S.quiz[c.id]?.best || 0); S.quiz[c.id] = { best, last: score, at: new Date().toISOString() }; save(); header();
      const pass = score / c.quiz.length >= 0.75;
      res.innerHTML = `<b>${t("q_score", { s: score, n: c.quiz.length })}</b> ${pass ? t("q_great") + " " + (isDone(c.id) ? "" : `<button class="btn small" type="button" id="qdone">${t("q_mark_done")}</button>`) : t("q_review")} <button class="btn ghost small" type="button" id="qretry">${t("q_retry")}</button>`;
      res.querySelector("#qretry").onclick = () => renderQuiz(box, c);
      const qd = res.querySelector("#qdone"); if (qd) qd.onclick = () => { S.done[c.id] = true; save(); route(); };
    }
  }

  /* ---------- router ---------- */
  /* Home: the track picker. Works with one track today; each new entry in LEARN_TRACKS adds a card. */
  function viewHome(main) {
    const cards = TRACK_LIST.map((tr) => {
      const { done, n } = trackProgress(tr), cp = tr.copy[S.settings.uiLang] || tr.copy.en;
      return `<a class="card track-card" href="#/track/${esc(tr.id)}" style="border-color:${esc(tr.color)}"><div class="track-icon" aria-hidden="true">${esc(tr.icon)}</div>
        <div><h2>${esc(cp.name)}</h2><p class="muted">${esc(cp.tagline)}</p><p>${esc(cp.card)}</p>
        <p class="small"><b>${t("track_concepts", { done, n })}</b> · <span class="btn small">${t("track_open")} →</span></p></div></a>`;
    }).join("");
    main.innerHTML = `<section class="card intro"><h1>${t("home_title")}</h1><p>${t("home_p")}</p></section>
      <div class="track-grid">${cards}</div><p class="muted small">${t("tracks_soon")}</p>`;
  }

  async function route() {
    const main = $("#main"); let h = location.hash || "#/home";
    if (h === "#/" ) h = "#/home";
    // Picking a track remembers it and opens its map.
    if (h.startsWith("#/track/")) { const id = h.split("/")[2]; if (TRACK_LIST.some((tr) => tr.id === id)) { S.trackId = id; save(); } history.replaceState(null, "", "#/map"); h = "#/map"; }
    if (!S.profile && !S.skipped && (h === "#/map" || h === "#/path")) { if (location.hash !== "#/welcome") { history.replaceState(null, "", "#/welcome"); } h = "#/welcome"; }
    header(); window.scrollTo(0, 0);
    if (h.startsWith("#/c/")) await viewConcept(main, h.slice(4));
    else if (h.startsWith("#/welcome")) viewWelcome(main);
    else if (h.startsWith("#/path")) viewPath(main);
    else if (h.startsWith("#/progress")) viewProgress(main);
    else if (h.startsWith("#/settings")) viewSettings(main);
    else if (h.startsWith("#/glossary")) viewGlossary(main, h.split("/")[2]);
    else if (h.startsWith("#/home")) viewHome(main);
    else await viewMap(main);
    header();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", () => {
    $("#theme-toggle").onclick = () => { S.settings.theme = S.settings.theme === "dark" ? "light" : "dark"; save(); mmReady = false; route(); };
    $("#lang-toggle").onclick = () => { S.settings.uiLang = isEs() ? "en" : "es"; save(); route(); };
    route();
  });
  window.HUB = { KEY, activeTrack, status, nextBest, personalOrder, isKnown, track, get S() { return S; }, BY, GL };
})();
