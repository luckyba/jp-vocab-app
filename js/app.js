    /***********************
     * i18n
     ***********************/
const STORAGE_KEY_LANG = "jp_vocab_app_lang";
const STORAGE_KEY_AUTO_SPEAK = "jp_vocab_app_auto_speak";
const STORAGE_KEY_VOICE = "jp_vocab_app_voice";
const STORAGE_KEY_VISIT_LAST = "jp_vocab_app_visit_last";
const STORAGE_KEY_VISIT_COUNT = "jp_vocab_app_visit_count";
    const DEFAULT_LANG = document.documentElement.getAttribute("lang") || "en";
    let i18n = {};

    function t(key, fallback = "") {
      return i18n[key] ?? fallback ?? key;
    }
    function tf(key, vars = {}, fallback = "") {
      let msg = t(key, fallback);
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
      return msg;
    }
    async function loadI18n(lang) {
      const target = lang || loadFromStorage(STORAGE_KEY_LANG, DEFAULT_LANG);
      const inline = window.I18N && window.I18N[target];
      if (inline) {
        i18n = inline;
        saveToStorage(STORAGE_KEY_LANG, target);
        applyI18n(target);
        return target;
      }
      try {
        const res = await fetch(`lang/${target}.json`);
        if (!res.ok) throw new Error("i18n load failed");
        i18n = await res.json();
        saveToStorage(STORAGE_KEY_LANG, target);
        applyI18n(target);
        return target;
      } catch {
        if (target !== "en") return loadI18n("en");
        applyI18n("en");
        return "en";
      }
    }
    function applyI18n(lang) {
      document.querySelectorAll("[data-i18n]").forEach(elm => {
        const key = elm.getAttribute("data-i18n");
        const fallback = elm.textContent || "";
        elm.textContent = t(key, fallback);
      });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(elm => {
    const key = elm.getAttribute("data-i18n-placeholder");
    const fallback = elm.getAttribute("placeholder") || "";
    elm.setAttribute("placeholder", t(key, fallback));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(elm => {
    const key = elm.getAttribute("data-i18n-aria");
    const fallback = elm.getAttribute("aria-label") || "";
    elm.setAttribute("aria-label", t(key, fallback));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(elm => {
    const key = elm.getAttribute("data-i18n-title");
    const fallback = elm.getAttribute("title") || "";
    elm.setAttribute("title", t(key, fallback));
  });
  if (lang) {
    document.documentElement.setAttribute("lang", lang);
    const select = document.getElementById("langSelect");
        if (select) select.value = lang;
      }
      updateAIPrompt();
      document.title = t("app_title", document.title);
    }

    /***********************
     * Storage
     ***********************/
    const STORAGE_KEY_DATA = "jp_vocab_app_data_v2";
    const STORAGE_KEY_PROGRESS = "jp_vocab_app_progress_v2";

    function safeJSONParse(str) {
      try { return { ok: true, value: JSON.parse(str) }; }
      catch (e) { return { ok: false, error: e }; }
    }
    function loadFromStorage(key, fallback=null) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch { return fallback; }
    }
    function saveToStorage(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    /***********************
     * State
     ***********************/
    const state = {
      data: { decks: [] },
      deckId: null,
      filteredFlashItems: [],
      filteredQuizItems: [],
      mode: "jp_to_vi",
      quizType: "mc",
  progress: loadFromStorage(STORAGE_KEY_PROGRESS, {}),
  score: { right: 0, wrong: 0 },
  currentQuiz: null,
  swiper: null,
  autoSpeak: loadFromStorage(STORAGE_KEY_AUTO_SPEAK, false),
  voiceName: loadFromStorage(STORAGE_KEY_VOICE, ""),
  voices: [],
  flashFilter: "all"
};

    /***********************
     * Data normalization (flexible but clean)
     ***********************/
    function normalizeData(raw) {
      let decks = [];
      if (raw && Array.isArray(raw.decks)) decks = raw.decks;
      else if (raw && Array.isArray(raw.items)) {
        decks = [{
          id: raw.id || "default",
          title: raw.title || t("default_deck_single", "Deck"),
          description: raw.description || "",
          items: raw.items
        }];
      } else decks = [];

      decks = decks
        .filter(d => d && Array.isArray(d.items))
        .map((d, idx) => ({
          id: String(d.id ?? `deck_${idx+1}`),
          title: String(d.title ?? tf("default_deck_title", { n: idx + 1 }, `Deck ${idx+1}`)),
          description: String(d.description ?? ""),
          items: d.items
            .filter(it => it && (it.jp || it.vi))
            .map((it, j) => ({
              id: String(it.id ?? `${String(d.id ?? `deck_${idx+1}`)}_${String(j+1).padStart(3,"0")}`),
              jp: String(it.jp ?? ""),
              reading: String(it.reading ?? ""),
              vi: String(it.vi ?? ""),
              tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
              examples: Array.isArray(it.examples) ? it.examples.map(ex => ({
                jp: String(ex.jp ?? ""),
                vi: String(ex.vi ?? "")
              })) : []
            }))
        }));

      return { decks };
    }

    function getDeck() {
      return state.data.decks.find(d => d.id === state.deckId) || null;
    }

    function ensureProgressDeck(deckId) {
      if (!state.progress[deckId]) state.progress[deckId] = { known: [], learning: [] };
      state.progress[deckId].known = [...new Set(state.progress[deckId].known)];
      state.progress[deckId].learning = [...new Set(state.progress[deckId].learning)];
    }

    function mark(deckId, itemId, status) {
      ensureProgressDeck(deckId);
      const p = state.progress[deckId];
      const known = new Set(p.known);
      const learning = new Set(p.learning);

      if (status === "known") { known.add(itemId); learning.delete(itemId); }
      else if (status === "learning") { learning.add(itemId); known.delete(itemId); }
      else if (status === "clear") { known.delete(itemId); learning.delete(itemId); }

      state.progress[deckId] = { known: [...known], learning: [...learning] };
      saveToStorage(STORAGE_KEY_PROGRESS, state.progress);
      renderStats();
      renderCardFooterButtons();
    }
    function isKnown(deckId, itemId) { ensureProgressDeck(deckId); return state.progress[deckId].known.includes(itemId); }
    function isLearning(deckId, itemId) { ensureProgressDeck(deckId); return state.progress[deckId].learning.includes(itemId); }

    /***********************
     * Auto ID + Import helpers
     ***********************/
    function nextItemId(deck) {
      const re = /_(\d+)$/;
      let maxN = 0;
      for (const it of (deck.items || [])) {
        const m = String(it.id || "").match(re);
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
      }
      const n = maxN + 1;
      const prefix = deck.id;
      return `${prefix}_${String(n).padStart(3, "0")}`;
    }

    function slugifyId(s) {
      return String(s || "deck")
        .trim()
        .toLowerCase()
        .replace(/[\s]+/g, "_")
        .replace(/[^\w\u00C0-\u024f_]+/g, "")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "deck";
    }

    function makeUniqueDeckId(baseId) {
      const existing = new Set(state.data.decks.map(d => d.id));
      let id = baseId;
      let i = 2;
      while (existing.has(id)) id = `${baseId}_${i++}`;
      return id;
    }

    // Accept:
    //  - {items:[...]}
    //  - [...]
    //  - {decks:[{items:[...]}]} (take first deck)
    function extractImportItems(parsed) {
      let items = [];
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed && Array.isArray(parsed.items)) items = parsed.items;
      else if (parsed && Array.isArray(parsed.decks) && parsed.decks[0] && Array.isArray(parsed.decks[0].items)) items = parsed.decks[0].items;

      return (items || [])
        .filter(it => it && (it.jp || it.vi))
        .map(it => ({
          jp: String(it.jp ?? ""),
          reading: String(it.reading ?? ""),
          vi: String(it.vi ?? ""),
          tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
          examples: Array.isArray(it.examples) ? it.examples.map(ex => ({
            jp: String(ex.jp ?? ""),
            vi: String(ex.vi ?? "")
          })) : []
        }));
    }

    /***********************
     * DOM refs
     ***********************/
    const el = {
      deckSelect: document.getElementById("deckSelect"),
      searchInput: document.getElementById("searchInput"),
      modeSelect: document.getElementById("modeSelect"),
      quizType: document.getElementById("quizType"),
      langSelect: document.getElementById("langSelect"),

      statTotal: document.getElementById("statTotal"),
      statKnown: document.getElementById("statKnown"),
      statLearning: document.getElementById("statLearning"),
      statTotalWrap: document.getElementById("statTotalWrap"),
      statKnownWrap: document.getElementById("statKnownWrap"),
      statLearningWrap: document.getElementById("statLearningWrap"),

      btnFlash: document.getElementById("btnFlash"),
      btnQuiz: document.getElementById("btnQuiz"),
      btnShuffle: document.getElementById("btnShuffle"),
  btnResetProgress: document.getElementById("btnResetProgress"),
  btnHelperToggle: document.getElementById("btnHelperToggle"),

      flashEmpty: document.getElementById("flashEmpty"),
      flashArea: document.getElementById("flashArea"),
      swiperWrapper: document.getElementById("swiperWrapper"),
      cardIndex: document.getElementById("cardIndex"),
      cardCount: document.getElementById("cardCount"),
      btnPrev: document.getElementById("btnPrev"),
      btnNext: document.getElementById("btnNext"),
      btnMarkKnown: document.getElementById("btnMarkKnown"),
      btnMarkLearning: document.getElementById("btnMarkLearning"),
      btnSpeak: document.getElementById("btnSpeak"),

      quizEmpty: document.getElementById("quizEmpty"),
      quizArea: document.getElementById("quizArea"),
      quizMeta: document.getElementById("quizMeta"),
      quizPrompt: document.getElementById("quizPrompt"),
      quizHint: document.getElementById("quizHint"),
      quizMC: document.getElementById("quizMC"),
      quizOptions: document.getElementById("quizOptions"),
      quizTypeBox: document.getElementById("quizTypeBox"),
      typeInput: document.getElementById("typeInput"),
      btnTypeSubmit: document.getElementById("btnTypeSubmit"),
      btnTypeShow: document.getElementById("btnTypeShow"),
      typeFeedback: document.getElementById("typeFeedback"),
      btnNewQuestion: document.getElementById("btnNewQuestion"),
      btnQuizSpeak: document.getElementById("btnQuizSpeak"),

      scoreRight: document.getElementById("scoreRight"),
      scoreWrong: document.getElementById("scoreWrong"),

      // modal
      importMode: document.getElementById("importMode"),
      importDeckSelect: document.getElementById("importDeckSelect"),
      newDeckTitle: document.getElementById("newDeckTitle"),
      btnDeleteSelectedDeck: document.getElementById("btnDeleteSelectedDeck"),
      btnCopyAiPrompt: document.getElementById("btnCopyAiPrompt"),
      jsonAiPrompt: document.getElementById("jsonAiPrompt"),

      jsonTextarea: document.getElementById("jsonTextarea"),
      btnLoadSample: document.getElementById("btnLoadSample"),
      btnPasteJSON: document.getElementById("btnPasteJSON"),
      btnClearJSON: document.getElementById("btnClearJSON"),
      btnApplyJSON: document.getElementById("btnApplyJSON"),
      jsonError: document.getElementById("jsonError"),

      // export
      btnExportData: document.getElementById("btnExportData"),
      btnExportAll: document.getElementById("btnExportAll"),
  autoSpeakToggle: document.getElementById("autoSpeakToggle"),
  visitCount: document.getElementById("visitCount"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceStatus: document.getElementById("voiceStatus"),
  audioControlsWrap: document.getElementById("audioControlsWrap")
};

    /***********************
     * Render
     ***********************/
    function renderDeckSelect() {
      const decks = state.data.decks;

      // Main deck select
      el.deckSelect.innerHTML = "";
      if (!decks.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = t("no_deck", "-- No deck --");
        el.deckSelect.appendChild(opt);
        el.deckSelect.disabled = true;
      } else {
        el.deckSelect.disabled = false;
        for (const d of decks) {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.textContent = d.title;
          el.deckSelect.appendChild(opt);
        }
        if (!state.deckId || !decks.some(d => d.id === state.deckId)) state.deckId = decks[0].id;
        el.deckSelect.value = state.deckId;
      }

      // Import deck select
      el.importDeckSelect.innerHTML = "";
      if (!decks.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = t("no_deck_import", "-- No deck --");
        el.importDeckSelect.appendChild(opt);
        el.importDeckSelect.disabled = true;
      } else {
        el.importDeckSelect.disabled = false;
        for (const d of decks) {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.textContent = d.title;
          el.importDeckSelect.appendChild(opt);
        }
        el.importDeckSelect.value = state.deckId || decks[0].id;
      }
    }

    function applyFilters() {
      const deck = getDeck();
      const q = (el.searchInput.value || "").trim().toLowerCase();
      if (!deck) return [];
      const items = deck.items || [];
      if (!q) return items.slice();

      return items.filter(it => {
        const hay = [
          it.jp, it.reading, it.vi,
          ...(it.tags || []),
          ...((it.examples||[]).flatMap(ex => [ex.jp, ex.vi]))
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    function updateFlashFilterButtons() {
      const setStat = (elm, active) => {
        if (!elm) return;
        elm.classList.toggle("active", active);
      };
      setStat(el.statTotalWrap, state.flashFilter === "all");
      setStat(el.statLearningWrap, state.flashFilter === "learning");
      setStat(el.statKnownWrap, state.flashFilter === "known");
    }

    function renderStats() {
      const deck = getDeck();
      if (!deck) {
        el.statTotal.textContent = "0";
        el.statKnown.textContent = "0";
        el.statLearning.textContent = "0";
        return;
      }
      ensureProgressDeck(deck.id);
      el.statTotal.textContent = String(deck.items.length);
      el.statKnown.textContent = String(state.progress[deck.id].known.length);
      el.statLearning.textContent = String(state.progress[deck.id].learning.length);
    }

    function isMobile() {
      return window.matchMedia("(max-width: 576px)").matches;
    }

    function renderFlashcards() {
      let items = applyFilters();
      const deck = getDeck();
      if (deck) {
        if (state.flashFilter === "known") items = items.filter(it => isKnown(deck.id, it.id));
        if (state.flashFilter === "learning") items = items.filter(it => isLearning(deck.id, it.id));
      }
      state.filteredFlashItems = items;
      updateFlashFilterButtons();
      const hasData = items.length > 0;

      el.flashEmpty.classList.toggle("d-none", hasData);
      el.flashArea.classList.toggle("d-none", !hasData);

      if (state.swiper) {
        state.swiper.destroy(true, true);
        state.swiper = null;
      }
      el.swiperWrapper.innerHTML = "";

      if (!hasData) {
        el.cardIndex.textContent = "0";
        el.cardCount.textContent = "0";
        return;
      }

      const emptyValue = t("empty_value", "-");
      const tagsSep = t("card_tags_sep", " - ");
      items.forEach((it, idx) => {
        const slide = document.createElement("div");
        slide.className = "swiper-slide";
        slide.innerHTML = `
          <div class="flip-wrap" data-item-id="${escapeHTML(it.id)}">
            <div class="flip-card">
              <div class="flip-face flip-front">
                <div class="card-top">
                  <span class="chip"><i class="bi bi-lightning-fill text-primary"></i> ${escapeHTML(t("card_front", "Front"))}</span>
                  <span class="chip"><i class="bi bi-hash"></i> ${idx+1}</span>
                </div>
                <div class="card-mid">
                  <div class="jp">${escapeHTML(state.mode === "jp_to_vi" ? (it.jp || emptyValue) : (it.vi || emptyValue))}</div>
                  ${state.mode === "jp_to_vi"
                    ? (it.reading ? `<div class="reading">${escapeHTML(it.reading)}</div>` : ``)
                    : (it.jp ? `<div class="reading">${escapeHTML(it.reading ? `${it.jp}（${it.reading}）` : it.jp)}</div>` : ``)
                  }
                  <div class="hint">${escapeHTML(t("card_hint_flip", "Tap to flip"))}</div>
                </div>
                <div class="card-bot">
                  <span class="small-muted">${escapeHTML((it.tags||[]).slice(0,3).join(tagsSep))}</span>
                  <span class="small-muted"><i class="bi bi-space-bar"></i> Space</span>
                </div>
              </div>

              <div class="flip-face flip-back">
                <div class="card-top">
                  <span class="chip"><i class="bi bi-stars text-success"></i> ${escapeHTML(t("card_back", "Back"))}</span>
                  <span class="chip"><i class="bi bi-tag"></i> ${escapeHTML(it.id)}</span>
                </div>

                <div class="card-mid">
                  <div class="meaning">${escapeHTML(state.mode === "jp_to_vi" ? (it.vi || emptyValue) : (it.jp || emptyValue))}</div>
                  ${state.mode === "jp_to_vi"
                    ? (it.jp ? `<div class="reading">${escapeHTML(it.reading ? `${it.jp}（${it.reading}）` : it.jp)}</div>` : ``)
                    : (it.vi ? `<div class="reading">${escapeHTML(it.vi)}</div>` : ``)
                  }
                  ${renderExampleHint(it)}
                </div>

                <div class="card-bot">
                  <span class="small-muted">${escapeHTML(renderMiniExample(it))}</span>
                  <span class="small-muted"><i class="bi bi-arrow-left-right"></i> ← →</span>
                </div>
              </div>
            </div>
          </div>
        `;
        el.swiperWrapper.appendChild(slide);
      });

      const paginationType = isMobile() ? "progressbar" : "fraction";

      state.swiper = new Swiper("#cardSwiper", {
        slidesPerView: 1,
        spaceBetween: 16,
        centeredSlides: true,
        keyboard: { enabled: true },
        pagination: { el: ".swiper-pagination", type: paginationType },
        scrollbar: { el: ".swiper-scrollbar", draggable: true }
      });

      document.querySelectorAll(".flip-wrap").forEach(w => {
        w.addEventListener("click", () => w.classList.toggle("is-flipped"));
      });

      state.swiper.on("slideChange", () => {
        updateCardCounter();
        resetFlipOnActive();
        renderCardFooterButtons();
        if (state.autoSpeak) {
          const it = getActiveItem();
          if (it) speakAuto(getFrontText(it));
        }
      });

      updateCardCounter();
      resetFlipOnActive();
      renderCardFooterButtons();
    }

    function resetFlipOnActive() {
      document.querySelectorAll(".flip-wrap.is-flipped").forEach(w => w.classList.remove("is-flipped"));
    }
    function updateCardCounter() {
      const total = state.filteredFlashItems.length;
      const idx = (state.swiper ? state.swiper.activeIndex : 0) + 1;
      el.cardIndex.textContent = String(Math.min(idx, total));
      el.cardCount.textContent = String(total);
    }
    function getActiveItem() {
      const items = state.filteredFlashItems;
      if (!items.length) return null;
      const i = state.swiper ? state.swiper.activeIndex : 0;
      return items[i] || null;
    }
    function renderCardFooterButtons() {
      const deck = getDeck();
      const it = getActiveItem();
      if (!deck || !it) return;

      const known = isKnown(deck.id, it.id);
      const learning = isLearning(deck.id, it.id);

      el.btnMarkKnown.classList.toggle("btn-success", known);
      el.btnMarkKnown.classList.toggle("btn-outline-success", !known);

      el.btnMarkLearning.classList.toggle("btn-warning", learning);
      el.btnMarkLearning.classList.toggle("btn-outline-warning", !learning);
    }

    function renderMiniExample(it) {
      const ex = (it.examples || [])[0];
      return ex?.jp ? ex.jp : "";
    }
    function renderExampleHint(it) {
      const ex = (it.examples || [])[0];
      if (!ex || !ex.jp) return `<div class="hint">${escapeHTML(t("hint_add_examples", "Tip: add examples in JSON to show sample sentences."))}</div>`;
      const vi = ex.vi ? `<div class="small-muted mt-1">${escapeHTML(ex.vi)}</div>` : "";
      return `
        <div class="mt-2 w-100" style="max-width: 720px;">
          <div class="hint"><i class="bi bi-quote"></i> ${escapeHTML(t("hint_example", "Example"))}</div>
          <div class="mt-1" style="font-weight:700">${escapeHTML(ex.jp)}</div>
          ${vi}
        </div>
      `;
    }

    function renderQuizArea() {
      const items = applyFilters();
      state.filteredQuizItems = items;
      const hasData = items.length > 0;

      el.quizEmpty.classList.toggle("d-none", hasData);
      el.quizArea.classList.toggle("d-none", !hasData);
      if (!hasData) return;

      state.quizType = el.quizType.value;
      el.quizMC.classList.toggle("d-none", state.quizType !== "mc");
      el.quizTypeBox.classList.toggle("d-none", state.quizType !== "type");

      makeNewQuestion();
      renderScore();
    }

    function renderScore() {
      el.scoreRight.textContent = String(state.score.right);
      el.scoreWrong.textContent = String(state.score.wrong);
    }

    /***********************
     * Quiz
     ***********************/
    function makeNewQuestion() {
      const deck = getDeck();
      const items = state.filteredQuizItems;
      if (!deck || !items.length) return;

      const answerItem = items[Math.floor(Math.random() * items.length)];
      const mode = state.mode;

      const emptyValue = t("empty_value", "-");
      const prompt = (mode === "jp_to_vi") ? (answerItem.jp || emptyValue) : (answerItem.vi || emptyValue);
      const answer = (mode === "jp_to_vi") ? (answerItem.vi || "") : (answerItem.jp || "");

      state.currentQuiz = { mode, answerItem, prompt, answer };

      const metaMode = mode === "jp_to_vi" ? t("quiz_meta_jp_to_vi", "JP->VI") : t("quiz_meta_vi_to_jp", "VI->JP");
      const metaType = state.quizType === "mc" ? t("quiz_meta_mc", "Multiple choice") : t("quiz_meta_type", "Type answer");
      el.quizMeta.textContent = `${deck.title} - ${metaMode} - ${metaType}`;
      el.quizPrompt.textContent = prompt;
      el.quizHint.classList.add("d-none");
      el.quizHint.textContent = "";

      if (state.quizType === "mc") buildMCOptions(mode, answerItem, items);
      else { el.typeInput.value = ""; el.typeFeedback.innerHTML = ""; el.typeInput.focus(); }

      if (state.autoSpeak) speakAuto(prompt);
    }

    function buildMCOptions(mode, answerItem, items) {
      const pool = items.filter(x => x.id !== answerItem.id);
      shuffleInPlace(pool);
      const distractors = pool.slice(0, 3);

      const options = [answerItem, ...distractors];
      shuffleInPlace(options);

      el.quizOptions.innerHTML = "";
      options.forEach(opt => {
        const emptyValue = t("empty_value", "-");
        const text = (mode === "jp_to_vi") ? (opt.vi || emptyValue) : (opt.jp || emptyValue);
        const btn = document.createElement("button");
        btn.className = "option-btn";
        btn.type = "button";
        btn.innerHTML = `
          <div class="d-flex align-items-start gap-2">
            <i class="bi bi-circle text-secondary" style="margin-top:.2rem"></i>
            <div>
              <div class="fw-semibold">${escapeHTML(text)}</div>
              ${(mode === "vi_to_jp" && opt.reading) ? `<div class="small-muted">${escapeHTML(opt.reading)}</div>` : ``}
            </div>
          </div>
        `;
        btn.addEventListener("click", () => {
          const isCorrect = (opt.id === answerItem.id);
          handleMCAnswer(btn, isCorrect, answerItem, mode);
        });
        el.quizOptions.appendChild(btn);
      });
    }

    function handleMCAnswer(btn, isCorrect, answerItem, mode) {
      [...el.quizOptions.querySelectorAll("button")].forEach(b => b.disabled = true);

      if (isCorrect) {
        btn.classList.add("correct");
        state.score.right++;
        mark(getDeck().id, answerItem.id, "known");
        celebrate();
      } else {
        btn.classList.add("wrong");
        state.score.wrong++;
        mark(getDeck().id, answerItem.id, "learning");
        // highlight correct
        const correctText = (mode === "jp_to_vi") ? (answerItem.vi || "") : (answerItem.jp || "");
        [...el.quizOptions.querySelectorAll("button")].forEach(b => {
          if (b.textContent.includes(correctText)) b.classList.add("correct");
        });
      }
      renderScore();

      el.quizHint.classList.remove("d-none");
      el.quizHint.innerHTML = `
        <div><b>${escapeHTML(t("answer_label", "Answer"))}:</b> ${escapeHTML(mode === "jp_to_vi" ? answerItem.vi : answerItem.jp)}</div>
        ${(mode === "vi_to_jp" && answerItem.reading) ? `<div class="small-muted">${escapeHTML(t("reading_label", "Reading"))}: ${escapeHTML(answerItem.reading)}</div>` : ``}
      `;
    }

    function handleTypeSubmit() {
      const q = state.currentQuiz;
      if (!q) return;

      const user = (el.typeInput.value || "").trim();
      if (!user) return;

      const correct = (q.answer || "").trim();
      const normalize = (s) => s.replace(/\s+/g," ").trim().toLowerCase();

      const ok = (q.mode === "jp_to_vi")
        ? normalize(user) === normalize(correct)
        : user.replace(/\s+/g,"") === correct.replace(/\s+/g,"");

      if (ok) {
        state.score.right++;
        mark(getDeck().id, q.answerItem.id, "known");
        el.typeFeedback.innerHTML = `<div class="alert alert-success py-2 mb-0"><b>${escapeHTML(t("feedback_correct", "Correct!"))}</b> ${escapeHTML(correct)}</div>`;
        celebrate();
      } else {
        state.score.wrong++;
        mark(getDeck().id, q.answerItem.id, "learning");
        el.typeFeedback.innerHTML = `
          <div class="alert alert-danger py-2 mb-0">
            <b>${escapeHTML(t("feedback_wrong", "Wrong."))}</b> ${escapeHTML(t("answer_label", "Answer"))}: <b>${escapeHTML(correct)}</b>
            ${(q.mode === "vi_to_jp" && q.answerItem.reading) ? `<div class="small-muted">${escapeHTML(t("reading_label", "Reading"))}: ${escapeHTML(q.answerItem.reading)}</div>` : ``}
          </div>
        `;
      }
      renderScore();
    }

    function showTypeAnswer() {
      const q = state.currentQuiz;
      if (!q) return;
      el.typeFeedback.innerHTML = `
        <div class="alert alert-secondary py-2 mb-0">
          ${escapeHTML(t("answer_label", "Answer"))}: <b>${escapeHTML(q.answer)}</b>
          ${(q.mode === "vi_to_jp" && q.answerItem.reading) ? `<div class="small-muted">${escapeHTML(t("reading_label", "Reading"))}: ${escapeHTML(q.answerItem.reading)}</div>` : ``}
        </div>
      `;
    }

    /***********************
     * TTS
     ***********************/
function speak(text, lang = "ja-JP") {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.95;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
    function speakAuto(text) {
      if (!text) return;
      const isJP = /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
      speak(text, isJP ? "ja-JP" : "vi-VN");
    }
function getFrontText(it) {
  const emptyValue = t("empty_value", "-");
  return state.mode === "jp_to_vi" ? (it.jp || emptyValue) : (it.vi || emptyValue);
}
function getSpeechVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices() || [];
}
function updateAudioAvailability(hasVoices) {
  const disabled = !hasVoices;
  if (el.btnSpeak) el.btnSpeak.disabled = disabled;
  if (el.btnQuizSpeak) el.btnQuizSpeak.disabled = disabled;
  if (el.autoSpeakToggle) {
    el.autoSpeakToggle.disabled = disabled;
    if (disabled && state.autoSpeak) {
      state.autoSpeak = false;
      el.autoSpeakToggle.checked = false;
      saveToStorage(STORAGE_KEY_AUTO_SPEAK, false);
    }
  }
  if (el.voiceSelect) el.voiceSelect.disabled = disabled;
  if (el.audioControlsWrap) el.audioControlsWrap.classList.toggle("audio-disabled", disabled);
  if (el.voiceStatus) el.voiceStatus.textContent = disabled ? t("voice_unavailable", "No voices available") : "";
}
function refreshVoices() {
  if (!el.voiceSelect) return;
  const voices = getSpeechVoices();
  const allowed = new Set(["ja", "en", "vi"]);
  const filtered = voices.filter(v => allowed.has(String(v.lang || "").split("-")[0].toLowerCase()));
  state.voices = filtered;
  el.voiceSelect.innerHTML = "";
  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("voice_unavailable", "No voices available");
    el.voiceSelect.appendChild(opt);
    updateAudioAvailability(false);
    return;
  }
  updateAudioAvailability(true);
  filtered.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang || "unknown"})`;
    el.voiceSelect.appendChild(opt);
  });
  let selected = state.voiceName;
  if (!selected || !filtered.some(v => v.name === selected)) {
    const jpVoice = filtered.find(v => String(v.lang || "").toLowerCase().startsWith("ja"));
    selected = jpVoice?.name || filtered[0].name;
  }
  state.voiceName = selected;
  el.voiceSelect.value = selected;
  saveToStorage(STORAGE_KEY_VOICE, selected);
}
function pickVoice(lang) {
  const voices = state.voices || [];
  if (!voices.length) return null;
  if (state.voiceName) {
    const chosen = voices.find(v => v.name === state.voiceName);
    if (chosen) return chosen;
  }
  const lower = String(lang || "").toLowerCase();
  const exact = voices.find(v => String(v.lang || "").toLowerCase() === lower);
  if (exact) return exact;
  const short = lower.split("-")[0];
  const partial = voices.find(v => String(v.lang || "").toLowerCase().startsWith(short));
  return partial || voices[0] || null;
}

    /***********************
     * Utils
     ***********************/
    function escapeHTML(s) {
      return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
      }[c]));
    }
    function shuffleInPlace(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    function celebrate() {
      try {
        if (window.confetti) window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.65 } });
      } catch {}
    }
    function getCounterClient() {
      if (window.__counterClient) return window.__counterClient;
      const CounterCtor = window.Counter || window.CounterAPI?.Counter || window.counterapi?.Counter;
      if (!CounterCtor) {
        console.log("[counterapi] Counter ctor not ready", {
          hasCounter: !!window.Counter,
          hasCounterAPI: !!window.CounterAPI,
          hasCounterAPI_Counter: !!window.CounterAPI?.Counter,
          hasCounterapi: !!window.counterapi,
          hasCounterapi_Counter: !!window.counterapi?.Counter
        });
        return null;
      }
      console.log("[counterapi] Counter ctor ready", CounterCtor);
      window.__counterClient = new CounterCtor({
        version: "v1",
        namespace: "luckyba",
        debug: false,
        timeout: 5000
      });
      return window.__counterClient;
    }
    async function loadVisitCount() {
      if (!el.visitCount) return;
      el.visitCount.textContent = t("visits_loading", "Loading...");
      const today = new Date().toISOString().slice(0, 10);
      const last = loadFromStorage(STORAGE_KEY_VISIT_LAST, "");
      const cachedCount = loadFromStorage(STORAGE_KEY_VISIT_COUNT, null);
      if (last === today && typeof cachedCount === "number") {
        el.visitCount.textContent = tf("visits_text", { n: cachedCount }, `Visits: ${cachedCount}`);
        return;
      }
      try {
        const client = getCounterClient();
        if (!client) throw new Error("counter client missing");
        const key = "jp-vocab-visits";
        const result = (last === today)
          ? await client.get(key)
          : await client.up(key);
        const total = result?.value ?? result?.count ?? result?.data?.count ?? result?.data?.value;
        if (typeof total !== "number") throw new Error("visit count missing");
        el.visitCount.textContent = tf("visits_text", { n: total }, `Visits: ${total}`);
        saveToStorage(STORAGE_KEY_VISIT_LAST, today);
        saveToStorage(STORAGE_KEY_VISIT_COUNT, total);
      } catch {
        el.visitCount.textContent = t("visits_failed", "Unavailable");
      }
    }

    /***********************
     * Import UI sync
     ***********************/
    function syncImportUI() {
      const mode = el.importMode.value;
      const isAppend = mode === "append_existing";
      el.importDeckSelect.disabled = !isAppend || !state.data.decks.length;
      el.newDeckTitle.disabled = isAppend;
      updateAIPrompt();
    }

    function getSelectedDeckTitle() {
      const deckId = el.importDeckSelect.value || state.deckId;
      const deck = state.data.decks.find(d => d.id === deckId);
      return deck?.title || "";
    }

    function buildAIPrompt() {
      const topic = (el.importMode.value === "append_existing")
        ? (getSelectedDeckTitle() || t("ai_topic_placeholder", "[YOUR TOPIC]"))
        : t("ai_topic_placeholder", "[YOUR TOPIC]");

      const count = t("ai_count_placeholder", "[NUMBER]");

      return tf("json_ai_prompt_template", { topic, count }, "");
    }

    function updateAIPrompt() {
      if (!el.jsonAiPrompt) return;
      el.jsonAiPrompt.textContent = buildAIPrompt();
    }

    /***********************
     * Export
     ***********************/
    function downloadJSON(filename, obj) {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    function stripItemIds(items) {
      return (items || []).map(it => {
        const { id, ...rest } = it || {};
        return { ...rest };
      });
    }
    function exportDecksNoIds() {
      const decks = state.data.decks || [];
      if (!decks.length) {
        downloadJSON("jp_vocab_data.json", { decks: [] });
        return;
      }
      decks.forEach((d, idx) => {
        const slug = slugifyId(d.title || `deck_${idx + 1}`) || `deck_${idx + 1}`;
        const data = {
          title: d.title || `Deck ${idx + 1}`,
          description: d.description || "",
          items: stripItemIds(d.items)
        };
        downloadJSON(`jp_vocab_${slug}.json`, data);
      });
    }

    /***********************
     * Init load
     ***********************/
    function loadInitialData() {
      const stored = loadFromStorage(STORAGE_KEY_DATA, null);
      if (stored) state.data = normalizeData(stored);
      else {
        // build from sample but auto-id
        const normalized = normalizeData(sampleData);
        // ensure ids exist and nice incremental per deck
        for (const d of normalized.decks) {
          const deck = { ...d, items: [] };
          for (const it of d.items) deck.items.push({ id: nextItemId(deck), ...it });
          d.items = deck.items;
        }
        state.data = normalized;
        saveToStorage(STORAGE_KEY_DATA, state.data);
      }

      renderDeckSelect();
      renderStats();
      renderFlashcards();
      renderQuizArea();

      // default textarea shows quick import structure (not full app data)
      el.jsonTextarea.value = JSON.stringify({ items: [] }, null, 2);
      syncImportUI();
    }

    /***********************
     * Events
     ***********************/
    el.deckSelect.addEventListener("change", () => {
      state.deckId = el.deckSelect.value || null;
      renderStats();
      renderFlashcards();
      renderQuizArea();
    });

    el.searchInput.addEventListener("input", () => {
      renderFlashcards();
      renderQuizArea();
    });

    el.modeSelect.addEventListener("change", () => {
      state.mode = el.modeSelect.value;
      renderFlashcards();
      renderQuizArea();
    });

    el.quizType.addEventListener("change", () => {
      state.quizType = el.quizType.value;
      renderQuizArea();
    });

  if (el.langSelect) {
    el.langSelect.addEventListener("change", async () => {
      await loadI18n(el.langSelect.value);
      renderDeckSelect();
      renderStats();
      renderFlashcards();
      renderQuizArea();
      refreshVoices();
    });
  }

    el.btnPrev.addEventListener("click", () => state.swiper?.slidePrev());
    el.btnNext.addEventListener("click", () => state.swiper?.slideNext());

    el.btnMarkKnown.addEventListener("click", () => {
      const deck = getDeck(); const it = getActiveItem();
      if (!deck || !it) return;
      mark(deck.id, it.id, isKnown(deck.id, it.id) ? "clear" : "known");
    });

    el.btnMarkLearning.addEventListener("click", () => {
      const deck = getDeck(); const it = getActiveItem();
      if (!deck || !it) return;
      mark(deck.id, it.id, isLearning(deck.id, it.id) ? "clear" : "learning");
    });

    el.btnSpeak.addEventListener("click", () => {
      const it = getActiveItem();
      if (!it) return;
      const text = it.jp || it.reading || "";
      if (text) speak(text, "ja-JP");
    });

    el.btnQuizSpeak.addEventListener("click", () => {
      const q = state.currentQuiz;
      if (!q) return;
      speakAuto(q.prompt);
    });

    el.btnNewQuestion.addEventListener("click", () => makeNewQuestion());

    el.btnTypeSubmit.addEventListener("click", () => handleTypeSubmit());
    el.btnTypeShow.addEventListener("click", () => showTypeAnswer());
    el.typeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleTypeSubmit();
    });

    el.btnShuffle.addEventListener("click", () => {
      const deck = getDeck();
      if (!deck) return;
      shuffleInPlace(deck.items);
      saveToStorage(STORAGE_KEY_DATA, state.data);
      renderFlashcards();
      renderQuizArea();
    });

el.btnResetProgress.addEventListener("click", () => {
  const deck = getDeck();
  if (!deck) return;
  if (!confirm(t("confirm_reset_progress", "Reset progress (Known/Learning) for the current deck?"))) return;
  state.progress[deck.id] = { known: [], learning: [] };
  saveToStorage(STORAGE_KEY_PROGRESS, state.progress);
  renderStats();
  renderCardFooterButtons();
});

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.code === "Space") {
        e.preventDefault();
        const active = document.querySelector(".swiper-slide-active .flip-wrap");
        if (active) active.classList.toggle("is-flipped");
      }
      if (e.key === "ArrowLeft") state.swiper?.slidePrev();
      if (e.key === "ArrowRight") state.swiper?.slideNext();
    });

    // Modal import UI
    el.importMode.addEventListener("change", syncImportUI);
    el.importDeckSelect.addEventListener("change", updateAIPrompt);
    el.newDeckTitle.addEventListener("input", updateAIPrompt);
    document.getElementById("dataModal").addEventListener("shown.bs.modal", () => {
      if (state.deckId) el.importDeckSelect.value = state.deckId;
      el.jsonError.classList.add("d-none");
      syncImportUI();
    });

    el.btnLoadSample.addEventListener("click", () => {
      // sample quick-import items
      el.jsonTextarea.value = JSON.stringify({
        items: [
          { jp: "フロントガラス", reading: "", vi: "windshield", tags: ["oto"] },
          { jp: "ワイパー", reading: "", vi: "wiper", tags: ["oto"] }
        ]
      }, null, 2);
      el.jsonError.classList.add("d-none");
    });

    if (el.btnPasteJSON) {
      el.btnPasteJSON.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            el.jsonTextarea.value = text;
            el.jsonError.classList.add("d-none");
          }
        } catch {
          el.jsonError.textContent = t("paste_failed", "Cannot read clipboard. Please paste manually.");
          el.jsonError.classList.remove("d-none");
        }
      });
    }

    el.btnClearJSON.addEventListener("click", () => {
      el.jsonTextarea.value = JSON.stringify({ items: [] }, null, 2);
      el.jsonError.classList.add("d-none");
    });

    function setFlashFilter(next) {
      state.flashFilter = next;
      renderFlashcards();
    }
    [el.statTotalWrap, el.statKnownWrap, el.statLearningWrap].forEach(elm => {
      if (!elm) return;
      elm.addEventListener("click", () => setFlashFilter(elm.getAttribute("data-filter") || "all"));
      elm.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlashFilter(elm.getAttribute("data-filter") || "all");
        }
      });
    });

    if (el.btnCopyAiPrompt) {
      el.btnCopyAiPrompt.addEventListener("click", async () => {
        const text = buildAIPrompt();
        const originalLabel = el.btnCopyAiPrompt.querySelector("[data-i18n]")?.textContent || "";
        const setButtonState = (key) => {
          const label = el.btnCopyAiPrompt.querySelector("[data-i18n]");
          if (label) label.textContent = t(key, label.textContent);
        };
        try {
          await navigator.clipboard.writeText(text);
          setButtonState("copy_success");
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "true");
          ta.style.position = "absolute";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          setButtonState("copy_success");
        }
        setTimeout(() => {
          const label = el.btnCopyAiPrompt.querySelector("[data-i18n]");
          if (label) label.textContent = originalLabel || t("btn_copy_prompt", "Copy");
        }, 1500);
      });
    }
  if (el.autoSpeakToggle) {
    el.autoSpeakToggle.checked = !!state.autoSpeak;
    el.autoSpeakToggle.addEventListener("change", () => {
      state.autoSpeak = el.autoSpeakToggle.checked;
      saveToStorage(STORAGE_KEY_AUTO_SPEAK, state.autoSpeak);
    });
  }
  if (el.voiceSelect) {
    el.voiceSelect.addEventListener("change", () => {
      state.voiceName = el.voiceSelect.value || "";
      saveToStorage(STORAGE_KEY_VOICE, state.voiceName);
    });
  }

    // Delete selected deck
    el.btnDeleteSelectedDeck.addEventListener("click", () => {
      const deckId = el.importDeckSelect.value;
      if (!deckId) return;

      const deck = state.data.decks.find(d => d.id === deckId);
      if (!deck) return;

      if (!confirm(tf("confirm_delete_deck", { title: deck.title }, `Delete deck "${deck.title}"? (This will also remove its progress)`))) return;

      state.data.decks = state.data.decks.filter(d => d.id !== deckId);
      delete state.progress[deckId];

      saveToStorage(STORAGE_KEY_DATA, state.data);
      saveToStorage(STORAGE_KEY_PROGRESS, state.progress);

      state.deckId = state.data.decks[0]?.id || null;

      renderDeckSelect();
      renderStats();
      renderFlashcards();
      renderQuizArea();
    });

    // Import (append/create) WITHOUT overwrite
    el.btnApplyJSON.addEventListener("click", () => {
      const raw = el.jsonTextarea.value.trim();
      const parsed = safeJSONParse(raw);

      if (!parsed.ok) {
        el.jsonError.textContent = tf("json_error_invalid", { error: parsed.error.message }, "Invalid JSON: {error}");
        el.jsonError.classList.remove("d-none");
        return;
      }

      const importItems = extractImportItems(parsed.value);
      if (!importItems.length) {
        el.jsonError.textContent = t("json_error_no_items", "Valid JSON but no items found. Use {items:[...]} or an array.");
        el.jsonError.classList.remove("d-none");
        return;
      }

      const mode = el.importMode.value;

      if (mode === "append_existing") {
        const deckId = el.importDeckSelect.value || state.deckId;
        const deck = state.data.decks.find(d => d.id === deckId);
        if (!deck) {
          el.jsonError.textContent = t("json_error_no_deck_append", "No deck to append to. Choose \"Create new deck\".");
          el.jsonError.classList.remove("d-none");
          return;
        }
        for (const it of importItems) deck.items.push({ id: nextItemId(deck), ...it });
        state.deckId = deck.id;

      } else {
        const title = (el.newDeckTitle.value || "").trim();
        if (!title) {
          el.jsonError.textContent = t("json_error_title_required", "You have not entered a title for the new deck.");
          el.jsonError.classList.remove("d-none");
          return;
        }
        const baseId = slugifyId(title);
        const deckId = makeUniqueDeckId(baseId);

        const newDeck = { id: deckId, title, description: "", items: [] };
        for (const it of importItems) newDeck.items.push({ id: nextItemId(newDeck), ...it });

        state.data.decks.push(newDeck);
        state.deckId = newDeck.id;
        el.newDeckTitle.value = "";
      }

      saveToStorage(STORAGE_KEY_DATA, state.data);
      el.jsonError.classList.add("d-none");

      const modalEl = document.getElementById("dataModal");
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal?.hide();

      renderDeckSelect();
      renderStats();
      renderFlashcards();
      renderQuizArea();
    });

    // Export
    el.btnExportData.addEventListener("click", () => {
      exportDecksNoIds();
    });
    el.btnExportAll.addEventListener("click", () => {
      downloadJSON("jp_vocab_data_plus_progress.json", { data: state.data, progress: state.progress });
    });

    // Responsive: re-init swiper pagination type on resize breakpoint changes
    let lastMobile = isMobile();
    window.addEventListener("resize", () => {
      const now = isMobile();
      if (now !== lastMobile) {
        lastMobile = now;
        renderFlashcards();
      }
    });

    /***********************
     * Start
     ***********************/
async function startApp() {
  await loadI18n();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    refreshVoices();
  } else {
    updateAudioAvailability(false);
  }
  loadInitialData();
  updateAIPrompt();
  loadVisitCount();
}

    startApp();
