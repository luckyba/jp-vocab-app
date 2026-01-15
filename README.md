# JP Vocab App

Single-page flashcards + quiz app split into HTML, CSS, JS, and data files. Includes i18n, import/export, and localStorage progress.

## Structure
- index.html: Main markup and library includes
- css/style.css: App styles
- js/app.js: App logic
- data/sample-data.js: Sample deck data (loaded before app.js)
- lang/en.json, lang/vi.json: i18n strings
- lang/i18n.js: Preloaded i18n bundle for file:// usage
- favicon.svg: App icon

## Run
Open `index.html` in a browser.

If you run via `file://`, i18n is loaded from `lang/i18n.js`. If you run a local server, it can use `lang/*.json` directly.

## Data
- The app saves decks and progress in `localStorage`.
- Import/export uses JSON from the UI.

### Import JSON format (recommended)
```json
{
  "items": [
    { "jp": "furonto garasu", "reading": "", "vi": "windshield", "tags": ["auto"], "examples": [{ "jp": "", "vi": "" }] },
    { "jp": "waipa", "vi": "wiper" }
  ]
}
```

### Export
- Export Data: one file per deck, items without `id`.
- Export Data + Progress: full data + progress (keeps `id`).

### Notes
- Flashcard filters can be applied by clicking Total/Known/Learning stats.
- Auto speak (optional) reads the front side and quiz questions.
- Visit counter uses CounterAPI (JS client).
