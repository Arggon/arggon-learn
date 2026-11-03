/* Browser test for storage (aiHub.v2 → arggonLearn.v1 migration, corrupt-storage fallback), progress import/export,
   and the home / track picker.
   Every section runs in its own fresh browser context with its own seeded localStorage, and a failing or crashing
   section is reported and does not affect the others.
   Run: npm run test:migration   (or PW_CORE=<playwright-core path> CHROME=<chrome binary> node scripts/test-storage-migration.cjs) */
const { chromium } = require(process.env.PW_CORE || "playwright");
const path = require("path");
const fs = require("fs");
const URL = "file://" + path.resolve(__dirname, "..", "index.html");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fails++; };

const OLD = { version: 2, profile: { answers: { prog: "little", lang: "python", web: "idea", db: "none", math: "basic", ai: "some", goal: "use" }, at: "2026-10-01T00:00:00Z" }, skipped: false, manualKnown: { math_basics: true },
  done: { chatbot_use: true, prog_basics: true }, quiz: { chatbot_use: { best: 3, last: 2, at: "2026-10-02T00:00:00Z" } }, settings: { codeLang: "python", uiLang: "es", theme: "dark", track: "beginner" }, view: { subgraphs: true } };
// Current progress used by the import sections: differs from every imported file below.
const BASE = { version: 2, skipped: true, done: { web_apis: true }, quiz: { web_apis: { best: 2, last: 2 } }, settings: { uiLang: "en", theme: "light" } };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME });

  // Runs fn in a fresh context. dialog: "accept" | "dismiss" decides confirm() answers; the texts are collected in s.dialogs.
  async function section(name, seed, fn, { dialog = "accept" } = {}) {
    console.log(name);
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const s = { ctx, errs: [], dialogs: [] };
    const open = async () => {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => s.errs.push(String(e)));
      p.on("dialog", (d) => { s.dialogs.push(d.message()); dialog === "accept" ? d.accept() : d.dismiss(); });
      await p.goto(URL); await p.waitForFunction(() => window.HUB && window.HUB.S); await p.waitForTimeout(250);
      return p;
    };
    s.open = open;
    try {
      // Seed the context's localStorage once, before the app ever loads in it.
      const seedPage = await ctx.newPage(); await seedPage.goto(URL + "#seed");
      await seedPage.evaluate((data) => { localStorage.clear(); for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v); }, seed);
      await seedPage.close();
      s.p = await open();
      await fn(s);
      ok(s.errs.length === 0, "no page errors" + (s.errs.length ? " (" + s.errs.join("; ") + ")" : ""));
    } catch (e) { ok(false, "section crashed: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
    finally { await ctx.close().catch(() => {}); }
  }
  const state = (p) => p.evaluate(() => ({ S: JSON.stringify(HUB.S), stored: localStorage.getItem("arggonLearn.v1"), lang: document.documentElement.lang }));
  async function importFile(p, name, text) {
    await p.evaluate(() => (location.hash = "#/settings")); await p.waitForSelector("#import-file", { state: "attached" });
    await p.evaluate(() => document.querySelector("#data-msg").replaceChildren());
    await p.setInputFiles("#import-file", { name, mimeType: "application/json", buffer: Buffer.from(text) });
    await p.waitForSelector("#data-msg span", { timeout: 5000 });
    return p.evaluate(() => ({ msg: document.querySelector("#data-msg").textContent, cls: document.querySelector("#data-msg span").className }));
  }
  // Seeds that the app must read but this seeding step itself writes; the page (not the seed) does the migration.
  const seeded = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

  await section("1. aiHub.v2 is copied once to arggonLearn.v1", seeded({ "aiHub.v2": OLD }), async ({ p }) => {
    const st = await p.evaluate(() => ({ cur: JSON.parse(localStorage.getItem("arggonLearn.v1") || "null"), old: localStorage.getItem("aiHub.v2"), lang: document.documentElement.lang, theme: document.documentElement.dataset.theme }));
    ok(st.cur && st.cur.done.chatbot_use && st.cur.done.prog_basics, "done concepts copied");
    ok(st.cur && st.cur.quiz.chatbot_use.best === 3 && st.cur.quiz.chatbot_use.last === 2, "quiz scores copied");
    ok(st.cur && st.cur.profile && st.cur.profile.answers.prog === "little" && st.cur.manualKnown.math_basics === true, "profile and known concepts copied");
    ok(st.cur && st.cur.settings.uiLang === "es" && st.cur.settings.theme === "dark" && st.cur.settings.codeLang === "python" && st.cur.settings.track === "beginner", "settings copied");
    ok(st.cur && st.cur.copiedFrom && st.cur.copiedFrom.key === "aiHub.v2", "copy is recorded (copiedFrom)");
    ok(st.old === JSON.stringify(OLD), "old aiHub.v2 key left untouched");
    ok(st.lang === "es" && st.theme === "dark", "copied settings applied on first load");
  });

  await section("2. The copy runs only once; copiedFrom is kept", seeded({ "aiHub.v2": OLD }), async (s) => {
    await s.p.evaluate(() => { const x = JSON.parse(localStorage.getItem("arggonLearn.v1")); x.done.vars_functions = true; localStorage.setItem("arggonLearn.v1", JSON.stringify(x)); });
    await s.p.close(); const p = await s.open(); // next load in a new tab, same localStorage
    let st = await p.evaluate(() => ({ S: HUB.S, cur: JSON.parse(localStorage.getItem("arggonLearn.v1")) }));
    ok(st.S.done.vars_functions === true && st.cur.done.vars_functions === true, "next load keeps new progress (no second copy)");
    ok(st.S.copiedFrom && st.S.copiedFrom.key === "aiHub.v2" && typeof st.S.copiedFrom.at === "string", "copiedFrom survives sanitize on the next load");
    await p.click("#theme-toggle"); await p.waitForTimeout(300);
    st = await p.evaluate(() => JSON.parse(localStorage.getItem("arggonLearn.v1")));
    ok(st.copiedFrom && st.copiedFrom.key === "aiHub.v2" && Object.keys(st.copiedFrom).sort().join() === "at,key", "copiedFrom is written back on save, with only key and at");
  });

  await section("3. Existing arggonLearn.v1 wins over aiHub.v2", seeded({ "aiHub.v2": OLD, "arggonLearn.v1": BASE }), async ({ p }) => {
    const S = await p.evaluate(() => HUB.S);
    ok(S.done.web_apis === true && !S.done.chatbot_use, "arggonLearn.v1 used, old data not merged in");
  });

  await section("4. Corrupt arggonLearn.v1 falls back to aiHub.v2", seeded({ "aiHub.v2": OLD, "arggonLearn.v1": "{not json" }), async ({ p }) => {
    const st = await p.evaluate(() => ({ S: HUB.S, cur: JSON.parse(localStorage.getItem("arggonLearn.v1")), bak: localStorage.getItem("arggonLearn.v1.corrupt"), old: localStorage.getItem("aiHub.v2") }));
    ok(st.S.done.chatbot_use && st.S.quiz.chatbot_use.best === 3 && st.cur.done.prog_basics, "progress recovered from aiHub.v2");
    ok(st.cur.copiedFrom && st.cur.copiedFrom.key === "aiHub.v2", "replaced with valid data (copiedFrom recorded)");
    ok(st.bak === "{not json" && st.old === JSON.stringify(OLD), "corrupt text kept in arggonLearn.v1.corrupt; aiHub.v2 untouched");
  });
  for (const bad of ["[1,2]", "null", "42"]) {
    await section(`4b. Non-object arggonLearn.v1 (${bad}) falls back to aiHub.v2`, seeded({ "aiHub.v2": OLD, "arggonLearn.v1": bad }), async ({ p }) => {
      ok(await p.evaluate(() => HUB.S.done.chatbot_use === true), "falls back to aiHub.v2");
    });
  }

  await section("5. Export file name and marker", seeded({ "arggonLearn.v1": BASE }), async ({ p }) => {
    await p.evaluate(() => (location.hash = "#/settings")); await p.waitForSelector("#export");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#export")]);
    const exp = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    ok(dl.suggestedFilename() === "arggon-learn-progress.json" && exp.app === "arggon-learn" && exp.done.web_apis === true, `export file is ${dl.suggestedFilename()} with app marker`);
  });

  async function exportFile(p) {
    await p.evaluate(() => (location.hash = "#/settings")); await p.waitForSelector("#export");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#export")]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") };
  }

  await section("5b. Fresh app-generated empty backup restores over populated progress", {}, async (s) => {
    const file = await exportFile(s.p);
    await importFile(s.p, "populated.json", JSON.stringify(BASE));
    s.dialogs.length = 0;
    const r = await importFile(s.p, file.name, file.text);
    ok(r.cls === "good", "fresh exported empty backup is accepted");
    ok(s.dialogs.length === 1 && s.dialogs[0].includes("(0 concepts done, 0 quiz scores)?"), "empty replacement still requires explicit confirmation");
    ok(await s.p.evaluate(() => Object.keys(HUB.S.done).length === 0 && Object.keys(HUB.S.quiz).length === 0 && HUB.S.profile === null && HUB.S.settings.codeLang === "pseudo"), "empty backup replaces populated progress");
    await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
    ok(await s.p.evaluate(() => Object.keys(HUB.S.done).length === 0 && Object.keys(HUB.S.quiz).length === 0 && JSON.parse(localStorage.getItem("arggonLearn.v1")).version === 2), "empty replacement persists under arggonLearn.v1 across reload");
  });

  // Exercise real downloads and file uploads, not a hand-written empty fixture.
  for (const [name, seed, prefs] of [
    ["preferences EN / TypeScript", { version: 2, skipped: true, trackId: "ai", view: { subgraphs: true, zoom: 1.25 }, copiedFrom: { key: "aiHub.v2", at: "2026-10-01T00:00:00Z" }, migratedFrom: { key: "aiHub.v1", at: "2026-10-01T00:00:00Z", done: 0, quiz: 0, dropped: ["k_old"] } }, { uiLang: "en", codeLang: "ts", theme: "dark", track: "theory" }],
    ["preferences ES / C#", { version: 2, view: { subgraphs: false, zoom: 0.75 } }, { uiLang: "es", codeLang: "csharp", theme: "dark", track: "builder" }],
    ["populated with safe migration metadata", { ...OLD, manualKnown: { math_basics: true, db_basics: false }, trackId: "ai", copiedFrom: { key: "aiHub.v2", at: "2026-10-01T00:00:00Z" }, migratedFrom: { key: "aiHub.v1", at: "2026-10-01T00:00:00Z", done: 2, quiz: 1, dropped: ["k_old"] } }, null],
  ]) {
    await section(`5c. Actual export → import → save/reload: ${name}`, seeded({ "arggonLearn.v1": seed }), async (s) => {
      await s.p.evaluate(() => (location.hash = "#/settings")); await s.p.waitForSelector("#set-code");
      if (prefs) {
        await s.p.selectOption("#set-code", prefs.codeLang);
        await s.p.selectOption("#set-ui", prefs.uiLang);
        await s.p.selectOption("#set-theme", prefs.theme);
        await s.p.selectOption("#set-track", prefs.track);
        ok(await s.p.evaluate((want) => HUB.S.settings.uiLang === want.uiLang && HUB.S.settings.codeLang === want.codeLang && HUB.S.profile === null && Object.keys(HUB.S.done).length === 0, prefs), "UI and code language preferences are independent without learning progress");
      }
      const file = await exportFile(s.p);
      const expected = JSON.parse(file.text); delete expected.app; delete expected.exportedAt;
      await importFile(s.p, "populated-target.json", JSON.stringify(BASE));
      s.dialogs.length = 0;
      const r = await importFile(s.p, file.name, file.text);
      ok(r.cls === "good" && s.dialogs.length === 1, "actual exported backup accepted only after confirmation");
      const equal = async () => require("util").isDeepStrictEqual(await s.p.evaluate(() => JSON.parse(JSON.stringify(HUB.S))), expected);
      ok(await equal(), "all exported learning state, preferences, view and safe metadata restored");
      ok(await s.p.evaluate((want) => document.documentElement.lang === want.uiLang && document.documentElement.dataset.theme === want.theme && document.querySelector("#set-code").value === want.codeLang && document.querySelector("#set-track").value === want.track, expected.settings), "restored locale/theme/code-language/approach applied to UI");
      ok(require("util").isDeepStrictEqual(JSON.parse((await state(s.p)).stored), expected), "replacement saved with payload version 2");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(await equal(), "complete restored state survives reload");
      await s.p.click("#theme-toggle"); await s.p.click("#theme-toggle");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(await equal(), "subsequent save/reload retains state and migration metadata");
    });
  }

  for (const lang of ["en", "es"]) {
    await section(`5d. Cancel actual empty backup replacement (${lang})`, {}, async (s) => {
      const file = await exportFile(s.p);
      await s.p.evaluate((current) => localStorage.setItem("arggonLearn.v1", JSON.stringify(current)), { ...BASE, settings: { uiLang: lang, codeLang: "python", theme: "dark", track: "builder" } });
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      const before = await state(s.p);
      const r = await importFile(s.p, file.name, file.text);
      const after = await state(s.p);
      const want = lang === "en" ? "(0 concepts done, 0 quiz scores)?" : "(0 conceptos hechos, 0 puntajes de quiz)?";
      ok(s.dialogs.length === 1 && s.dialogs[0].includes(want), "clear localized confirmation identifies empty incoming progress");
      ok(require("util").isDeepStrictEqual(before, after) && r.cls === "muted", "cancel leaves state, exact stored bytes and locale unchanged");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(require("util").isDeepStrictEqual(before, await state(s.p)), "cancel remains unchanged after reload");
    }, { dialog: "dismiss" });
  }

  await section("5e. Recognizable empty v2 legacy export remains supported", {}, async (s) => {
    const file = await exportFile(s.p);
    const legacy = JSON.parse(file.text); delete legacy.app;
    await importFile(s.p, "target.json", JSON.stringify(BASE)); s.dialogs.length = 0;
    const r = await importFile(s.p, "ai-hub-progress.json", JSON.stringify(legacy));
    ok(r.cls === "good" && s.dialogs.length === 1, "complete unmarked legacy v2 empty export is accepted with confirmation");
    await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
    ok(await s.p.evaluate(() => Object.keys(HUB.S.done).length === 0 && HUB.S.profile === null), "legacy empty replacement survives reload");
  });

  await section("5f. Partial/invalid empty envelopes cannot erase progress", {}, async (s) => {
    const file = await exportFile(s.p), empty = JSON.parse(file.text);
    await importFile(s.p, "target.json", JSON.stringify(BASE)); s.dialogs.length = 0;
    await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
    const before = await state(s.p);
    const cases = [
      ["marker alone", { app: "arggon-learn", version: 2 }],
      ["unrelated v2", { version: 2, name: "unrelated document", settings: {} }],
      ["other app", { ...empty, app: "other" }],
      ["unknown done id", { ...empty, done: { unrelated: true } }],
      ["unknown quiz id", { ...empty, quiz: { unrelated: { best: 1 } } }],
      ["unknown known id", { ...empty, manualKnown: { unrelated: true } }],
      ["versionless empty", { ...empty, version: undefined }],
      ["unsupported version", { ...empty, version: 3 }],
      ["string version", { ...empty, version: "2" }],
    ];
    for (const field of ["profile", "skipped", "done", "quiz", "manualKnown", "settings", "view", "exportedAt"]) {
      cases.push([`missing ${field}`, { ...empty, [field]: undefined }]);
    }
    for (const [field, value] of [["profile", {}], ["skipped", "false"], ["done", []], ["quiz", null], ["manualKnown", []], ["settings", []], ["view", []], ["exportedAt", "not a date"], ["exportedAt", 123]]) {
      cases.push([`invalid ${field}: ${JSON.stringify(value)}`, { ...empty, [field]: value }]);
    }
    for (const field of ["codeLang", "uiLang", "theme", "track"]) {
      cases.push([`missing settings.${field}`, { ...empty, settings: { ...empty.settings, [field]: undefined } }]);
      cases.push([`invalid settings.${field}`, { ...empty, settings: { ...empty.settings, [field]: "unrecognized" } }]);
    }
    cases.push(["wrong subgraphs type", { ...empty, view: { subgraphs: "true" } }], ["wrong zoom type", { ...empty, view: { zoom: "1" } }]);
    for (const [name, value] of cases) {
      const r = await importFile(s.p, "invalid-empty.json", JSON.stringify(value));
      ok(r.cls === "bad" && s.dialogs.length === 0 && require("util").isDeepStrictEqual(before, await state(s.p)), `${name}: rejected without confirmation or mutation`);
    }
    await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
    ok(require("util").isDeepStrictEqual(before, await state(s.p)), "rejected empty lookalikes leave persisted progress intact");
  });

  await section("5g. Inherited constructor is not a concept in a partial backup", seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const before = await state(s.p);
    const r = await importFile(s.p, "inherited.json", '{"version":2,"done":{"constructor":false}}');
    ok(r.cls === "bad", "partial constructor-only backup is rejected");
    ok(s.dialogs.length === 0, "invalid inherited-name backup never asks for replacement");
    ok(require("util").isDeepStrictEqual(before, await state(s.p)), "invalid inherited-name import preserves state, storage and locale");
    await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
    ok(require("util").isDeepStrictEqual(before, await state(s.p)), "invalid inherited-name import preserves progress after reload");
  });

  // Parse raw JSON so __proto__ is an own fixture key, not object-literal prototype syntax.
  for (const lang of ["en", "es"]) {
    await section(`5h. Inherited-only maps never recognize a backup (${lang})`, seeded({ "arggonLearn.v1": { ...BASE, settings: { uiLang: lang, codeLang: "python", theme: "dark", track: "builder" } } }), async (s) => {
      const before = await state(s.p);
      for (const id of ["constructor", "toString", "__proto__"]) {
        for (const [field, values] of [["done", [false, true]], ["manualKnown", [false, true]], ["quiz", [{ best: 1, last: 1 }]]]) {
          for (const value of values) {
            for (const version of ['"version":2,', ""]) {
              const text = `{${version}"${field}":{"${id}":${JSON.stringify(value)}}}`;
              const r = await importFile(s.p, "inherited-only.json", text);
              ok(r.cls === "bad" && s.dialogs.length === 0 && require("util").isDeepStrictEqual(before, await state(s.p)), `${version ? "v2" : "v1"} ${field}.${id}=${JSON.stringify(value)}: rejected without confirmation/state/storage/locale mutation`);
            }
          }
        }
      }
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(require("util").isDeepStrictEqual(before, await state(s.p)), "rejected inherited-only files leave progress intact across reload");
    });
  }

  const mixed = JSON.parse('{"done":{"web_apis":true,"constructor":true,"toString":false,"__proto__":true},"manualKnown":{"math_basics":false,"db_basics":true,"constructor":false,"toString":true,"__proto__":false},"quiz":{"web_apis":{"best":2,"last":1},"constructor":{"best":1},"toString":{"best":1},"__proto__":{"best":1}}}');
  const onlyRealConcepts = (S, v1) => Object.keys(S.done).join() === "web_apis" && Object.keys(S.quiz).join() === "web_apis" && S.quiz.web_apis.best === 2 && S.quiz.web_apis.last === 1 && (v1 ? Object.keys(S.manualKnown).length === 0 : Object.keys(S.manualKnown).sort().join() === "db_basics,math_basics" && S.manualKnown.math_basics === false && S.manualKnown.db_basics === true);
  for (const v1 of [false, true]) {
    await section(`5i. Mixed legitimate/inherited maps import safely (${v1 ? "v1" : "v2"})`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const r = await importFile(s.p, "mixed.json", JSON.stringify(v1 ? mixed : { ...mixed, version: 2 }));
      ok(r.cls === "good" && s.dialogs.length === 1, "mixed backup retains populated compatibility and confirmation");
      ok(onlyRealConcepts(await s.p.evaluate(() => HUB.S), v1), "only legitimate done/quiz/manualKnown survive mixed import");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(onlyRealConcepts(await s.p.evaluate(() => HUB.S), v1), "clean mixed replacement survives save/reload");
    });
  }
  for (const key of ["arggonLearn.v1", "aiHub.v2", "aiHub.v1"]) {
    const v1 = key === "aiHub.v1", raw = JSON.stringify(v1 ? mixed : { ...mixed, version: 2 });
    await section(`5j. Own concept membership on load/migration from ${key}`, { [key]: raw }, async (s) => {
      ok(onlyRealConcepts(await s.p.evaluate(() => HUB.S), v1), "load/migration retains legitimate maps and discards inherited names");
      if (v1) {
        const dropped = await s.p.evaluate(() => HUB.S.migratedFrom.dropped);
        ok(["constructor", "toString", "__proto__"].every((id) => dropped.includes(id) && dropped.includes("quiz:" + id)), "v1 migration records inherited names as dropped, not concepts");
      }
      await s.p.click("#theme-toggle"); await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(onlyRealConcepts(await s.p.evaluate(() => HUB.S), v1), "loaded legitimate progress survives subsequent save/reload");
      if (key !== "arggonLearn.v1") ok(await s.p.evaluate(({ key, raw }) => localStorage.getItem(key) === raw, { key, raw }), "original legacy key bytes retained");
    });
  }

  const valid = [
    ["old ai-hub-progress.json (v2, no app field)", "ai-hub-progress.json", JSON.stringify({ ...OLD, exportedAt: "2026-10-10T00:00:00Z" }), (S) => S.done.chatbot_use && S.quiz.chatbot_use.best === 3 && !S.done.web_apis],
    ["arggon-learn-progress.json", "arggon-learn-progress.json", JSON.stringify({ app: "arggon-learn", version: 2, done: { db_basics: true }, quiz: {} }), (S) => S.done.db_basics && !S.done.web_apis],
    ["v1 format", "v1.json", JSON.stringify({ done: { prog_basics: true }, quiz: {} }), (S) => S.done.prog_basics && !S.done.web_apis],
  ];
  for (const [name, file, text, check] of valid) {
    await section(`6. Import ${name}: confirm → replaced`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const r = await importFile(s.p, file, text);
      const S = await s.p.evaluate(() => HUB.S);
      ok(s.dialogs.length === 1 && /Replace your current progress \(1 concept done, 1 quiz score\)/.test(s.dialogs[0]), "asks for confirmation first: " + (s.dialogs[0] || "(no dialog)").slice(0, 90));
      ok(check(S) && r.cls === "good" && /Imported ✔|Importado ✔/.test(r.msg), `progress replaced and success shown (in the imported file's language): "${r.msg}"`);
    });
  }

  for (const lang of ["en", "es"]) {
    await section(`7. Import cancelled (${lang}) → nothing changes`, seeded({ "arggonLearn.v1": { ...BASE, settings: { ...BASE.settings, uiLang: lang } } }), async (s) => {
      const before = await state(s.p);
      const r = await importFile(s.p, "arggon-learn-progress.json", JSON.stringify({ app: "arggon-learn", version: 2, done: { db_basics: true, chatbot_use: true }, quiz: {}, settings: { uiLang: lang === "en" ? "es" : "en", theme: "dark" } }));
      const after = await state(s.p);
      const want = lang === "en" ? /^Replace your current progress \(1 concept done, 1 quiz score\) with the file's \(2 concepts done, 0 quiz scores\)\?/ : /^¿Reemplazar tu progreso actual \(1 concepto hecho, 1 puntaje de quiz\) por el del archivo \(2 conceptos hechos, 0 puntajes de quiz\)\?/;
      ok(s.dialogs.length === 1 && want.test(s.dialogs[0]), `confirmation is in ${lang}: ` + (s.dialogs[0] || "(no dialog)").slice(0, 90));
      ok(after.S === before.S && after.stored === before.stored && after.lang === before.lang, "state, storage and language unchanged after cancelling");
      ok(lang === "en" ? r.msg === "Import cancelled. Your progress was not changed." : r.msg === "Importación cancelada. Tu progreso no cambió.", `cancel message: "${r.msg}"`);
    }, { dialog: "dismiss" });
  }

  // Singular/plural in the confirmation, EN and ES: current state 1/1, file 1 / 2 / 0.
  for (const lang of ["en", "es"]) {
    const cases = [
      [{ done: { db_basics: true }, quiz: { db_basics: { best: 1, last: 1 } } }, lang === "en" ? "(1 concept done, 1 quiz score)?" : "(1 concepto hecho, 1 puntaje de quiz)?"],
      [{ done: { db_basics: true, chatbot_use: true }, quiz: { db_basics: { best: 1, last: 1 }, chatbot_use: { best: 1, last: 1 } } }, lang === "en" ? "(2 concepts done, 2 quiz scores)?" : "(2 conceptos hechos, 2 puntajes de quiz)?"],
      [{ done: {}, quiz: {}, manualKnown: { db_basics: true } }, lang === "en" ? "(0 concepts done, 0 quiz scores)?" : "(0 conceptos hechos, 0 puntajes de quiz)?"],
    ];
    for (const [file, want] of cases) {
      await section(`7b. Confirmation plurals (${lang}): ${want}`, seeded({ "arggonLearn.v1": { ...BASE, settings: { uiLang: lang } } }), async (s) => {
        await importFile(s.p, "f.json", JSON.stringify({ app: "arggon-learn", version: 2, ...file }));
        const cur = lang === "en" ? "(1 concept done, 1 quiz score)" : "(1 concepto hecho, 1 puntaje de quiz)";
        ok(s.dialogs.length === 1 && s.dialogs[0].includes(cur) && s.dialogs[0].includes(want), "dialog: " + (s.dialogs[0] || "(none)"));
      }, { dialog: "dismiss" });
    }
  }

  await section("7c. File input is reset after a successful import", seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const text = JSON.stringify({ app: "arggon-learn", version: 2, done: { db_basics: true }, quiz: {} });
    await s.p.evaluate(() => (location.hash = "#/settings")); await s.p.waitForSelector("#import-file", { state: "attached" });
    await s.p.evaluate(() => (window.__inp = document.querySelector("#import-file"))); // keep the element that receives the file
    const r = await importFile(s.p, "same.json", text);
    ok(r.cls === "good", "import succeeded");
    ok(await s.p.evaluate(() => window.__inp.value === "" && window.__inp.files.length === 0), "the input that received the file was cleared after success");
  });

  await section("7d. ES wording fixes", {}, async ({ p }) => {
    const w = await p.evaluate(() => JSON.stringify(window.ES.concepts));
    ok(w.includes("Revisás la fuente por tu cuenta") && !w.includes("vos mismo"), "'por tu cuenta' replaces 'vos mismo'");
    ok((w.match(/quienes programan en \.NET/g) || []).length === 2 && !w.includes("desarrolladores .NET"), "'quienes programan en .NET' replaces 'desarrolladores .NET' (2 places)");
  });

  await section('8. app:"other" is rejected', seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const before = await state(s.p);
    const r = await importFile(s.p, "other.json", JSON.stringify({ app: "other", version: 2, done: { chatbot_use: true }, quiz: {} }));
    const after = await state(s.p);
    ok(after.S === before.S && after.stored === before.stored && r.cls === "bad" && r.msg.includes("exported by another app: other"), `rejected, progress unchanged: "${r.msg}"`);
    ok(s.dialogs.length === 0, "no confirmation asked for a rejected file");
  });

  await section("9. HTML app value: rejected, shown as text", seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const before = await state(s.p);
    await s.p.evaluate(() => (window.__xss = false));
    const evil = '<img src=x onerror="window.__xss=true">';
    const r = await importFile(s.p, "other.json", JSON.stringify({ app: evil, version: 2, done: { chatbot_use: true, db_basics: true }, quiz: { chatbot_use: { best: 1, last: 1 } }, settings: { uiLang: "es", theme: "dark" } }));
    const after = await state(s.p), A = JSON.parse(after.S);
    ok(after.S === before.S && after.stored === before.stored && !A.done.chatbot_use && !A.done.db_basics && !A.quiz.chatbot_use && A.done.web_apis && A.settings.uiLang === "en" && A.settings.theme === "light",
      "progress, settings and storage unchanged (the file's data differs on every field)");
    ok(r.cls === "bad" && r.msg.includes("exported by another app: " + evil), `error shown: "${r.msg.slice(0, 100)}"`);
    ok(await s.p.evaluate(() => !document.querySelector("#data-msg img") && window.__xss === false), "the app value is text, not HTML");
  });

  await section("10. Long app value is truncated to about 80 characters", seeded({ "arggonLearn.v1": BASE }), async ({ p }) => {
    const r = await importFile(p, "other.json", JSON.stringify({ app: "x".repeat(500), version: 2, done: { chatbot_use: true } }));
    const shown = r.msg.split("exported by another app: ")[1] || "";
    ok(shown.length === 80 && shown.endsWith("…") && shown.startsWith("x".repeat(79)), `app shown as ${shown.length} characters ending in "…"`);
  });

  const junk = [
    ['{"done":"x"}', '{"done":"x"}', 'the "done" field has the wrong format'],
    ['{"quiz":1}', '{"quiz":1}', 'the "quiz" field has the wrong format'],
    ['{"done":[1]}', '{"done":[1]}', 'the "done" field has the wrong format'],
    ["version 3", JSON.stringify({ version: 3, done: { chatbot_use: true }, settings: { uiLang: "es" } }), "unsupported version 3"],
    ['version "2" (string)', JSON.stringify({ version: "2", done: { chatbot_use: true } }), '"version" must be the number 2, not the text "2"'],
    ["v2 with settings as a string", JSON.stringify({ version: 2, done: { chatbot_use: true }, settings: "es" }), 'the "settings" field has the wrong format'],
    ["profile without answers", JSON.stringify({ version: 2, profile: { at: "x" } }), 'the "profile" field has the wrong format'],
    ["no known concept ids", JSON.stringify({ done: { nope: true }, quiz: {} }), "it has no known concepts or profile"],
    ["empty v2", JSON.stringify({ version: 2 }), "it has no known concepts or profile"],
    ["empty object", "{}", "it has no known concepts or profile"],
    ["array", "[1,2]", "the file is not a progress object"],
    ["null", "null", "the file is not a progress object"],
    ["string", '"hello"', "the file is not a progress object"],
    ["malformed JSON", "{not json", "the file is not valid JSON"],
  ];
  for (const [name, text, want] of junk) {
    await section(`11. Junk import rejected: ${name}`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const before = await state(s.p);
      const r = await importFile(s.p, "junk.json", text);
      const after = await state(s.p);
      ok(after.S === before.S && after.stored === before.stored && after.lang === before.lang, "state, storage and language unchanged");
      ok(r.cls === "bad" && r.msg.includes(want) && !/Imported/i.test(r.msg) && s.dialogs.length === 0, `message: "${r.msg}"`);
    });
  }

  await section("12. ES import errors are localized", seeded({ "arggonLearn.v1": { ...BASE, settings: { uiLang: "es" } } }), async ({ p }) => {
    let r = await importFile(p, "junk.json", "{not json");
    ok(r.msg.includes("el archivo no es JSON válido") && !/Unexpected|JSON\.parse|position/i.test(r.msg), `malformed JSON: "${r.msg}"`);
    r = await importFile(p, "junk.json", JSON.stringify({ version: "2", done: { chatbot_use: true } }));
    ok(r.msg.includes('"version" tiene que ser el número 2, no el texto "2"'), `version "2": "${r.msg}"`);
  });

  await section("13. Header count matches the home card count", seeded({ "aiHub.v2": OLD }), async ({ p }) => {
    await p.evaluate(() => (location.hash = "#/home")); await p.waitForSelector(".track-card");
    const c = await p.evaluate(() => ({ head: document.querySelector("#progress-mini span").textContent.match(/\d+\/\d+/)[0], card: document.querySelector(".track-card").textContent.match(/\d+\/\d+/)[0] }));
    ok(c.head === c.card, `header ${c.head} equals home card ${c.card}`);
  });

  await section("14. Fresh visitor: home with one track, then onboarding and map", {}, async ({ p }) => {
    ok((await p.evaluate(() => location.hash || "")) === "" && (await p.locator(".track-card").count()) === 1, "home shows 1 track card");
    ok(await p.evaluate(() => !localStorage.getItem("aiHub.v2")), "no legacy key written");
    for (const lang of ["en", "es"]) {
      if (lang === "es") { await p.click("#lang-toggle"); await p.waitForTimeout(300); }
      const h = await p.evaluate(() => ({ t: document.title, brand: document.querySelector(".brand").textContent, h1: document.querySelector("main h1").textContent, card: document.querySelector(".track-card h2").textContent, desc: document.querySelector('meta[name="description"]').content, sw: document.documentElement.scrollWidth }));
      ok(h.t.startsWith("Arggon Learn") && h.brand.includes("Arggon Learn") && h.desc.startsWith("Arggon Learn"), `${lang}: title, brand and meta say Arggon Learn`);
      ok(lang === "en" ? h.h1 === "What do you want to learn?" && h.card === "Artificial intelligence" : h.h1 === "¿Qué querés aprender?" && h.card === "Inteligencia artificial", `${lang}: home translated (${h.h1} / ${h.card})`);
      ok(h.sw <= 390, `${lang}: home fits 390px (scrollWidth ${h.sw})`);
    }
    await p.click(".track-card"); await p.waitForTimeout(400);
    ok((await p.evaluate(() => location.hash)) === "#/welcome" && (await p.evaluate(() => HUB.S.trackId)) === "ai", "picking AI opens its onboarding and remembers the track");
    ok((await p.locator("main").innerText()).includes("Esta ruta enseña cómo funciona la IA moderna"), "welcome text comes from the track copy");
    await p.click("#ob-skip"); await p.waitForTimeout(800);
    ok((await p.locator("main h2").first().innerText()) === "Tu mapa de IA, armado a partir de requisitos", "map title comes from the track copy");
  });

  for (const lang of ["en", "es"]) {
    await section(`15. Imported migration notice is text-safe (${lang})`, seeded({ "arggonLearn.v1": BASE }), async ({ p }) => {
      const marker = '<strong data-migration-marker="untrusted">123</strong>';
      const r = await importFile(p, "metadata.json", JSON.stringify({ ...OLD, settings: { ...OLD.settings, uiLang: lang }, migratedFrom: { key: "aiHub.v1", at: "2026-10-01T00:00:00Z", done: marker, quiz: marker, dropped: [] } }));
      ok(r.cls === "good", "malformed optional metadata does not reject valid progress");
      await p.evaluate(() => (location.hash = "#/welcome")); await p.waitForSelector("#ob");
      ok(await p.locator("[data-migration-marker]").count() === 0, "import → Welcome never creates imported HTML elements");
      // Exercise the rendering boundary separately from decoding (HUB.S is mutable diagnostic state).
      await p.evaluate((value) => { HUB.S.migratedFrom = { done: value, quiz: value }; location.hash = "#/home"; }, marker);
      await p.waitForSelector(".track-card");
      await p.evaluate(() => (location.hash = "#/welcome")); await p.waitForSelector("#ob");
      ok(await p.locator("[data-migration-marker]").count() === 0 && (await p.locator(".welcome .tip").textContent()).includes(marker), "notice renders state-derived values literally as defense in depth");
    });
  }

  const META = { key: "aiHub.v1", at: "2026-10-01T00:00:00Z", done: 2, quiz: 1, dropped: ["k_old", "quiz:k_old"] };
  await section("16. Migration metadata is reconstructed at import/load boundaries", seeded({ "arggonLearn.v1": BASE }), async ({ p }) => {
    const n = await p.evaluate(() => window.CONCEPTS.length);
    const invalid = [null, true, "legacy", [], {}, { ...META, key: "aiHub.v2" }, { ...META, key: "other" }];
    for (const field of ["done", "quiz"]) for (const value of [-1, 1.5, "1", null, true, {}, [], n + 1, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ ...META, [field]: value });
    for (const migratedFrom of invalid) {
      const r = await importFile(p, "metadata.json", JSON.stringify({ ...OLD, migratedFrom }));
      const S = await p.evaluate(() => HUB.S);
      ok(r.cls === "good" && S.done.prog_basics && S.quiz.chatbot_use.best === 3 && S.profile.answers.prog === "little" && S.manualKnown.math_basics === true && S.settings.codeLang === "python", "invalid optional metadata preserves valid learning state");
      ok(!Object.hasOwn(S, "migratedFrom"), `discard invalid metadata: ${JSON.stringify(migratedFrom)}`);
    }
    const cases = [
      [META, META],
      [{ ...META, done: 0, quiz: n, extra: "not retained" }, { ...META, done: 0, quiz: n }],
      [{ ...META, at: { html: "untrusted" }, dropped: ["k_old", 1, null, {}, ["nested"]], extra: true }, { ...META, at: null, dropped: ["k_old"] }],
      [{ ...META, at: 123, dropped: "not a list" }, { ...META, at: null, dropped: [] }],
    ];
    for (const [migratedFrom, expected] of cases) {
      const r = await importFile(p, "legacy-metadata.json", JSON.stringify({ ...OLD, migratedFrom }));
      ok(r.cls === "good" && await p.evaluate((want) => JSON.stringify(HUB.S.migratedFrom) === JSON.stringify(want), expected), "known fields reconstructed; typed timestamp/list repaired without rejecting progress");
      await p.reload(); await p.waitForFunction(() => window.HUB);
      await p.click("#theme-toggle");
      ok(await p.evaluate((want) => JSON.stringify(JSON.parse(localStorage.getItem("arggonLearn.v1")).migratedFrom) === JSON.stringify(want), expected), "metadata survives load/sanitize/save");
      await p.reload(); await p.waitForFunction(() => window.HUB);
      ok(await p.evaluate((want) => JSON.stringify(HUB.S.migratedFrom) === JSON.stringify(want) && HUB.S.manualKnown.math_basics === true && HUB.S.done.prog_basics && HUB.S.quiz.chatbot_use.best === 3, expected), "metadata and progress survive reload");
    }
  });

  for (const key of ["arggonLearn.v1", "aiHub.v2"]) {
    await section(`17. Stored ${key} metadata sanitized before use`, seeded({ [key]: { ...OLD, migratedFrom: { ...META, done: "<b>2</b>" } } }), async ({ p }) => {
      ok(await p.evaluate(() => !Object.hasOwn(HUB.S, "migratedFrom") && HUB.S.done.prog_basics && HUB.S.settings.uiLang === "es"), "bad stored metadata discarded without losing progress/settings");
      await p.click("#theme-toggle"); await p.reload(); await p.waitForFunction(() => window.HUB);
      ok(await p.evaluate(() => !Object.hasOwn(HUB.S, "migratedFrom") && !Object.hasOwn(JSON.parse(localStorage.getItem("arggonLearn.v1")), "migratedFrom")), "sanitized metadata stays absent after save/reload");
    });
  }

  const V1 = { done: { prog_basics: true, k_old: true }, quiz: { chatbot_use: { best: 2, last: 1 }, k_old: { best: 1 } }, theme: "dark", subgraphs: true, zoom: 1.25 };
  for (const source of ["storage", "backup"]) {
    await section(`18. aiHub.v1 ${source} migration remains compatible`, source === "storage" ? seeded({ "aiHub.v1": V1 }) : seeded({ "arggonLearn.v1": BASE }), async ({ p }) => {
      if (source === "backup") ok((await importFile(p, "ai-hub-progress.json", JSON.stringify(V1))).cls === "good", "legacy backup accepted");
      const S = await p.evaluate(() => HUB.S);
      ok(S.migratedFrom.key === "aiHub.v1" && typeof S.migratedFrom.at === "string" && S.migratedFrom.done === 1 && S.migratedFrom.quiz === 1 && S.migratedFrom.dropped.join() === "k_old,quiz:k_old", "legacy migration produces valid metadata");
      ok(S.done.prog_basics && S.quiz.chatbot_use.best === 2 && S.quiz.chatbot_use.last === 1 && S.settings.theme === "dark" && S.view.subgraphs && S.view.zoom === 1.25, "legacy progress/view/settings preserved");
      await p.reload(); await p.waitForFunction(() => window.HUB);
      ok(await p.evaluate((want) => JSON.stringify(HUB.S.migratedFrom) === JSON.stringify(want), S.migratedFrom), "legacy metadata survives sanitization on reload");
      if (source === "storage") ok(await p.evaluate((want) => localStorage.getItem("aiHub.v1") === JSON.stringify(want), V1), "old key remains untouched");
      await p.evaluate(() => (location.hash = "#/c/prog_basics")); await p.waitForSelector("main h1");
      ok((await p.locator("main h1").textContent()).includes("programming"), "direct-file concept deep link still works");
    });
  }

  await section("19. Invalid imported best cannot become mastery", seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const r = await importFile(s.p, "scores.json", JSON.stringify({ version: 2, done: { prog_basics: true }, quiz: { prog_basics: { best: 999, last: 1 } } }));
    ok(r.cls === "good" && s.dialogs.length === 1, "valid unrelated progress still imports with confirmation");
    ok(await s.p.evaluate(() => HUB.S.done.prog_basics === true && !Object.hasOwn(HUB.S.quiz, "prog_basics")), "impossible best discarded instead of clamped into a perfect score");
  });

  for (const v1 of [false, true]) {
  await section(`20. ${v1 ? "Legacy v1" : "Current v2"} scores validate best and last independently`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
    const n = await s.p.evaluate(() => CONCEPTS.find((c) => c.id === "prog_basics").quiz.length);
    const invalid = [-1, 0.5, n + 1, 999999999, "2", true, false, null, {}, [], undefined];
    for (const field of ["best", "last"]) {
      for (const value of [...new Set([0, 1, n - 1, n]), ...invalid]) {
        const good = Number.isInteger(value) && value >= 0 && value <= n;
        const q = { best: 1, last: 0, at: "2026-10-02T00:00:00Z", [field]: value };
        const input = { ...OLD, ...(v1 ? { version: undefined, theme: "dark" } : {}), quiz: { prog_basics: q } };
        const r = await importFile(s.p, "scores.json", JSON.stringify(input));
        const S = await s.p.evaluate(() => HUB.S), actual = S.quiz.prog_basics;
        const want = field === "best" && !good ? undefined : { ...q, last: field === "last" && !good ? q.best : q.last };
        ok(r.cls === "good" && require("util").isDeepStrictEqual(actual, want), `${field}=${JSON.stringify(value)}: valid exact scores retained, invalid best dropped/last falls back`);
        ok(S.done.chatbot_use && (v1 ? S.settings.theme === "dark" : S.profile.answers.prog === "little" && S.manualKnown.math_basics === true && S.settings.codeLang === "python"), "score repair does not discard unrelated learning/preferences");
      }
    }
  });
  }

  for (const version of [2, undefined]) {
    await section(`21. Malformed quiz-only import cannot erase state (${version || "v1"})`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const before = await state(s.p);
      for (const q of [{ best: -1 }, { best: 999 }, { best: 0.5 }, { best: "2" }, { last: 1 }, null, []]) {
        const r = await importFile(s.p, "invalid-only.json", JSON.stringify({ version, quiz: { prog_basics: q } }));
        ok(r.cls === "bad" && s.dialogs.length === 0, "malformed-only quiz rejected before replacement confirmation");
        ok(require("util").isDeepStrictEqual(before, await state(s.p)), "rejected scores leave exact stored bytes, state and locale unchanged");
      }
    });
  }

  for (const key of ["arggonLearn.v1", "aiHub.v2", "aiHub.v1"]) {
    await section(`22. Score boundaries through actual ${key} loads/save/reload`, {}, async (s) => {
      const counts = await s.p.evaluate(() => CONCEPTS.map((c) => [c.id, c.quiz.length]));
      for (const field of ["best", "last"]) {
        // Raw JSON overflow is representable in storage and parses to +/-Infinity; JSON.stringify cannot encode it.
        const values = ["0", "1", "-1", "0.5", "999999999", '"2"', "true", "false", "null", "{}", "[]", "1e400", "-1e400", undefined, "upper", "above"];
        for (const token of values) {
          const quiz = {}, expected = {};
          for (const [id, n] of counts) {
            const value = token === "upper" ? n : token === "above" ? n + 1 : token === undefined ? undefined : JSON.parse(token);
            const q = { best: 1, last: 0, at: "2026-10-02T00:00:00Z", [field]: value };
            quiz[id] = q;
            const good = Number.isInteger(value) && value >= 0 && value <= n;
            if (field !== "best" || good) expected[id] = { ...q, last: field === "last" && !good ? q.best : q.last };
          }
          const input = { ...OLD, ...(key === "aiHub.v1" ? { version: undefined, theme: "dark" } : {}), manualKnown: { math_basics: true, db_basics: false }, quiz };
          let text = JSON.stringify(input);
          if (token === "1e400" || token === "-1e400") text = text.replaceAll(`"${field}":null`, `"${field}":${token}`);
          await s.p.evaluate(({ key, text }) => { localStorage.clear(); localStorage.setItem(key, text); }, { key, text });
          await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
          const actual = await s.p.evaluate(() => HUB.S);
          ok(require("util").isDeepStrictEqual(actual.quiz, expected), `${field}=${token}: all concept cardinalities validated on load`);
          ok(actual.done.chatbot_use && (key === "aiHub.v1" ? actual.settings.theme === "dark" : actual.profile.answers.prog === "little" && actual.manualKnown.db_basics === false && actual.settings.codeLang === "python" && actual.settings.uiLang === "es"), "unrelated historical state preserved on load");
          if (key !== "arggonLearn.v1") ok(await s.p.evaluate(({ key, text }) => localStorage.getItem(key) === text, { key, text }), "legacy source bytes retained");
          await s.p.click("#theme-toggle");
          await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
          ok(require("util").isDeepStrictEqual(await s.p.evaluate(() => HUB.S.quiz), expected), "normalized scores survive actual save/reload");
        }
      }
    });
  }

  for (const version of [2, undefined]) {
    const incoming = { version, quiz: { prog_basics: { best: 1, last: 4, at: "2026-10-02T00:00:00Z" }, chatbot_use: { best: -1 }, unknown: { best: 1 }, toString: { best: 1 }, constructor: { best: 1 } } };
    await section(`23. Mixed quiz-only import/confirmation/export/reload (${version || "v1"})`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const r = await importFile(s.p, "mixed.json", JSON.stringify(incoming));
      ok(r.cls === "good" && s.dialogs.length === 1 && s.dialogs[0].includes("0 concepts done, 1 quiz score"), "confirmation counts only surviving valid quiz record");
      const expected = { prog_basics: incoming.quiz.prog_basics };
      ok(require("util").isDeepStrictEqual(await s.p.evaluate(() => HUB.S.quiz), expected), "valid last greater than best retained exactly; unknown/inherited IDs dropped");
      const file = await exportFile(s.p);
      ok(require("util").isDeepStrictEqual(JSON.parse(file.text).quiz, expected), "real export retains valid score history");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(require("util").isDeepStrictEqual(await s.p.evaluate(() => HUB.S.quiz), expected), "confirmed mixed replacement persists");
    });
    await section(`24. Cancel mixed score replacement (${version || "v1"})`, seeded({ "arggonLearn.v1": BASE }), async (s) => {
      const before = await state(s.p);
      const r = await importFile(s.p, "mixed.json", JSON.stringify(incoming));
      ok(r.cls === "muted" && s.dialogs.length === 1 && require("util").isDeepStrictEqual(before, await state(s.p)), "cancel preserves exact state/storage despite incoming score repairs");
      await s.p.reload(); await s.p.waitForFunction(() => window.HUB);
      ok(require("util").isDeepStrictEqual(before, await state(s.p)), "cancel remains unchanged after reload");
    }, { dialog: "dismiss" });
  }

  await b.close();
  console.log(fails ? `\n${fails} failed` : "\nall passed"); process.exit(fails ? 1 : 0);
})();
