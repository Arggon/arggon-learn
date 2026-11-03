# Arggon Learn

A prerequisite-first, interactive learning platform. Every lesson starts by asking "what do I need to know before this?", and progress stays in your browser. The interface is in English and in Spanish (Argentina, voseo).

**Tracks**
- **Artificial intelligence** (available): programming and math basics through language models, agents, MCP, evals and safety.
- More subjects will follow. Each one is a new entry in `assets/tracks.js`.

---

Plataforma de aprendizaje interactiva pensada desde los requisitos: cada lección empieza preguntando "¿qué necesito saber antes?", y tu progreso queda en tu navegador. La primera ruta es **inteligencia artificial**; se vienen más temas.

## Run locally

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Progress is stored only in your browser (localStorage key `arggonLearn.v1`). On first load, progress saved by the previous name (AI Learning Hub, key `aiHub.v2`) is copied over once; the old key is left untouched. Diagrams load Mermaid from the jsDelivr CDN.

## Backups

Settings → Export downloads `arggon-learn-progress.json`. Import asks before **replacing**, not merging, current progress—even when the incoming backup has zero completed concepts and zero quiz scores. Cancel leaves current progress and preferences untouched. UI language and code-example language remain independent.

Fresh and preferences-only backups use the same payload version 2 as populated backups. To recognize an empty backup without accepting arbitrary JSON, import requires the complete exported envelope: numeric `version: 2`, `profile: null`, boolean `skipped`, empty object maps for `done`, `quiz` and `manualKnown`, all four supported settings (`codeLang`, `uiLang`, `theme`, `track`), an object `view` (optional boolean `subgraphs` and finite numeric `zoom`), and a string `exportedAt` that parses as a date. The `app` marker must be `arggon-learn` if present; its absence is supported for older AI Learning Hub v2 exports of this same shape. A marker or version alone is not enough. This is format recognition, not proof of file provenance.

Existing imports containing recognized learning data and supported versionless v1 backups retain their compatibility behavior. This does not newly accept ambiguous empty versionless objects or incomplete hand-written empty objects. Storage keys/migration are unchanged: payload version 2 still lives under `arggonLearn.v1`, and old `aiHub.v2` / `aiHub.v1` keys are retained. Keep a backup when moving between browser origins (including local files and hosted sites); browser-local progress does not move automatically.

## Adding a track

Add an entry to `window.LEARN_TRACKS` in `assets/tracks.js` with an `id`, `icon`, `color`, a `concepts()` list and `copy` in every UI language (`en` and `es`). The home page shows one card per track. `scripts/check-i18n.mjs` checks the track copy too.

## Translations

Spanish (Argentina, voseo) lives in `assets/es/`. English is the source of truth.

- `node scripts/check-i18n.mjs` — static check (also runs in CI): every English UI string, track copy, concept field, quiz item, resource note, glossary term, diagram and code comment must have a Spanish value that is not a copy of the English prose.
- `node scripts/check-i18n-browser.cjs` — optional headless scan of the live page in Spanish mode (needs `playwright-core` and Chrome; set `PW_CORE` and `CHROME`).

## Tests

`npm ci && npx playwright install chromium`, then `npm run test:migration` (storage migration and home page) and `npm run check:i18n:browser`. CI runs both on every pull request.
