let localProgress = JSON.parse(localStorage.getItem('archive_progress') || '{"exams":{},"bookmarks":{}}');
    if (!localProgress.bookmarks) localProgress.bookmarks = {};

    function saveProgress() {
      localStorage.setItem('archive_progress', JSON.stringify(localProgress));
    }

    function recordSeen(q) {
      if (!currentSubtopic) return;
      const stId = currentSubtopic.id;
      if (!localProgress.exams[stId]) localProgress.exams[stId] = { visited: true, seenQs: [], answeredQs: {} };
      if (!localProgress.exams[stId].seenQs.includes(q.id)) {
        localProgress.exams[stId].seenQs.push(q.id);
        saveProgress();
        updateSidebarProgressUI(stId);
      }
    }

    function recordGrade(q, isCorrect) {
      if (!currentSubtopic) return;
      const stId = currentSubtopic.id;
      if (!localProgress.exams[stId]) localProgress.exams[stId] = { visited: true, seenQs: [], answeredQs: {} };
      localProgress.exams[stId].answeredQs[q.id] = { correct: isCorrect, timestamp: Date.now() };
      saveProgress();
      updateSidebarProgressUI(stId);
    }

    function updateSidebarProgressUI(stId) {
      const p = localProgress.exams[stId];
      if (!p) return;
      const progEl = document.getElementById(`st-prog-${stId}`);
      if (progEl) {
        const total = progEl.getAttribute('data-total');
        const seen = p.seenQs ? p.seenQs.length : 0;
        const correct = p.answeredQs ? Object.values(p.answeredQs).filter(a => a.correct).length : 0;
        progEl.innerHTML = `<span>Seen: ${seen}/${total}</span><span class="st-prog-correct">Correct: ${correct}</span>`;
      }
      const itemEl = document.querySelector(`.subtopic-item[data-st-id="${stId}"]`);
      if (itemEl && p.visited) itemEl.classList.add('visited');
    }

    let DATA = null;
    let allQuestions = [];
    let filteredQs = [];
    let currentQIdx = 0;
    let currentSubtopic = null;
    let filterBookmarks = false;
    let revealedMap = {};
    let chosenMap = {};
    let quizQs = [];
    let quizAnswers = {};
    /** @type {Record<number, Set<string>>} */
    let quizSataSelections = {};
    let quizMode = false;
    /** @type {Record<number, Set<string>>} */
    let multiSelectMap = {};
    /** @type {Record<number, boolean>} */
    let multiGradedMap = {};
    let orderMap = {};
    let matchMap = {};
    let dropMap = {};
    let bowtieMap = {};
    let dynMap = {};
    let matrixMap = {};
    let fitbMap = {};

    const $ = id => document.getElementById(id);

    // ─── THEME SWITCHER ───
    const currentTheme = localStorage.getItem('archive_theme') || 'dark';
    if (currentTheme !== 'dark') {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
    const themeSwitcher = $('theme-switcher');
    if (themeSwitcher) {
      themeSwitcher.value = currentTheme;
      themeSwitcher.addEventListener('change', (e) => {
        const t = e.target.value;
        if (t === 'dark') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('archive_theme', t);
      });
    }

    // ─── SETTINGS & DATA SYNC ───
    const btnSettings = $('btn-settings-toggle');
    const menuSettings = $('settings-menu');
    if (btnSettings && menuSettings) {
      btnSettings.addEventListener('click', () => {
        menuSettings.style.display = menuSettings.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-settings-toggle') && !e.target.closest('#settings-menu')) {
          menuSettings.style.display = 'none';
        }
      });
    }

    const btnExport = $('btn-export-progress');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(localProgress));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "archive_progress_backup.json");
        dlAnchorElem.click();
        menuSettings.style.display = 'none';
      });
    }

    const btnImport = $('btn-import-progress');
    const fileImport = $('import-progress-file');
    if (btnImport && fileImport) {
      btnImport.addEventListener('click', () => fileImport.click());
      fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const parsed = JSON.parse(e.target.result);
            if (parsed && parsed.exams) {
              localStorage.setItem('archive_progress', JSON.stringify(parsed));
              alert("Progress successfully restored! The page will now reload.");
              window.location.reload();
            } else {
              alert("Invalid backup file format.");
            }
          } catch(err) {
            alert("Error reading backup file.");
          }
        };
        reader.readAsText(file);
      });
    }

    /** Parsed keys for MCQ / select-all-that-apply (archive stores JSON string arrays). */
    function parseCorrectKeys(q) {
      const raw = q.correctAnswer ?? q.correct_answer;
      if (raw == null || raw === '') return new Set();
      if (typeof raw === 'string') {
        const t = raw.trim();
        if (t.startsWith('[')) {
          try {
            const arr = JSON.parse(t);
            if (Array.isArray(arr)) return new Set(arr.map(x => String(x).trim()));
          } catch (e) { }
          return new Set();
        }
        if (t.startsWith('{')) {
          try {
            const o = JSON.parse(t);
            if (o && typeof o === 'object' && !Array.isArray(o)) {
              const vals = Object.values(o);
              if (vals.every(v => v !== null && typeof v !== 'object')) {
                return new Set(vals.map(v => String(v)));
              }
            }
          } catch (e) { }
          return new Set();
        }
        return new Set([t]);
      }
      if (Array.isArray(raw)) return new Set(raw.map(x => String(x)));
      return new Set([String(raw)]);
    }

    function isSelectAllThatApply(q) {
      return q.question_type_id === 2 || q.question_type_id === 11 || parseCorrectKeys(q).size > 1;
    }

    function setsEqual(a, b) {
      if (a.size !== b.size) return false;
      for (const x of a) if (!b.has(x)) return false;
      return true;
    }

    /** Single-answer key, or legacy string when not JSON-encoded multi-select. */
    function getSingleCorrectKey(q) {
      const ck = parseCorrectKeys(q);
      if (ck.size === 1) return [...ck][0];
      const legacy = q.correctAnswer ?? q.correct_answer;
      if (typeof legacy === 'string' && legacy.trim()) {
        const t = legacy.trim();
        if (!t.startsWith('[') && !t.startsWith('{')) return t;
      }
      return null;
    }

    /** Stable map key for per-question state (avoids 123 vs "123" bugs). */
    function storeQid(id) {
      return String(id);
    }

    function escapeHtmlAttr(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
    }

    function parseOptionKeys(q) {
      let opts = {};
      try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
      return opts;
    }

    function matchOptionKeyFromKeystroke(e, opts) {
      if (e.metaKey || e.ctrlKey || e.altKey) return null;
      const keys = Object.keys(opts);
      if (!keys.length) return null;
      const k = e.key;
      if (k.length !== 1) return null;
      let cand = k;
      if (keys.includes(cand)) return cand;
      cand = k.toUpperCase();
      if (keys.includes(cand)) return cand;
      cand = k.toLowerCase();
      if (keys.includes(cand)) return cand;
      return null;
    }

    function formatDate(val) {
      if (!val) return '—';
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ─── Parse helpers for complex types ───
    function safeParseJSON(v) {
      if (v == null) return v;
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch (e) { return v; }
    }

    function deepParseJSON(v) {
      let x = safeParseJSON(v);
      if (typeof x === 'string') x = safeParseJSON(x);
      return x;
    }

    function parseTabs(q) {
      const t = q.tabs;
      if (!t) return null;
      if (typeof t === 'object') return t;
      return safeParseJSON(t) || null;
    }

    // type 13: inline-dropdown options: { "dropdown-group-1": { A: "Sepsis", ... }, ... }
    function parseDropdownOpts(q) {
      let opts = q.options;
      if (typeof opts === 'string') opts = safeParseJSON(opts);
      if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return null;
      const keys = Object.keys(opts);
      if (!keys.length) return null;
      // detect: values are objects with A/B/C keys (dropdown groups)
      if (typeof opts[keys[0]] === 'object' && opts[keys[0]] !== null) return opts;
      return null;
    }

    // type 10: match options + match_option
    function parseMatchOpts(q) {
      let opts = q.options;
      if (typeof opts === 'string') opts = safeParseJSON(opts);
      let matchOpt = q.match_option;
      if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
      return { opts, matchOpt };
    }

    // type 16: dynamic table
    function parseDynTable(q) {
      try {
        const level1 = safeParseJSON(q.options);
        const level2 = safeParseJSON(level1);
        if (!level2 || typeof level2 !== 'object') return null;
        const cols = safeParseJSON(level2.dynamicColumns);
        const rows = safeParseJSON(level2.dataOptions);
        if (!Array.isArray(cols) || !Array.isArray(rows)) return null;
        return { cols, rows };
      } catch (e) { return null; }
    }

    function parseDynTableCA(q) {
      // correctAnswer is a JSON string array of { id, markKey (JSON string) }
      try {
        const raw = q.correctAnswer ?? q.correct_answer;
        const arr = safeParseJSON(raw);
        if (!Array.isArray(arr)) return null;
        return arr.map(item => ({ id: item.id, markKeys: safeParseJSON(item.markKey) }));
      } catch (e) { return null; }
    }

    // ─── Per-question state (extended) ───
    // ordering: orderMap[sk] = [key, key, ...] (current user order)
    // matching: matchMap[sk] = { matchKey: chosenOptionKey, ... }
    // dropdown (type13): dropMap[sk] = { "dropdown-group-1": "C", ... }
    // bowtie (type12): bowtieMap[sk] = { subId: Set<choiceKey>, ... }
    // dyntable (type16): dynMap[sk] = { rowId: Set<markKey>, ... }
    // matrix (type14): matrixMap[sk] = { optKey: Set<colKey>, ... }
    // fitb (type7): fitbMap[sk] = userAnswerString

    const TYPE_LABELS = {
      1: 'MCQ', 2: 'SATA', 5: 'Drag to order', 6: 'Ordering',
      7: 'Fill in blank', 9: 'Hotspot', 10: 'Matching',
      11: 'SATA + Exhibit', 12: 'Bow-tie', 13: 'Dropdown',
      14: 'Matrix', 16: 'Dynamic table'
    };

    // ─── STUDY: delegated clicks (no fragile inline onclick) ───
    $('q-area').addEventListener('click', (e) => {
      const opt = e.target.closest('.q-option');
      if (opt && $('q-area').contains(opt)) {
        const qidStr = opt.getAttribute('data-qid');
        const keyEnc = opt.getAttribute('data-opt-key');
        if (qidStr == null || keyEnc == null) return;
        const key = decodeURIComponent(keyEnc);
        handleOptionClick(qidStr, key);
        return;
      }
      // bowtie options
      const bowtieOpt = e.target.closest('.bowtie-option');
      if (bowtieOpt && $('q-area').contains(bowtieOpt)) {
        const sk = bowtieOpt.getAttribute('data-sk');
        const subId = bowtieOpt.getAttribute('data-sub-id');
        const choiceKey = bowtieOpt.getAttribute('data-choice-key');
        if (sk && subId && choiceKey) handleBowtieClick(sk, subId, choiceKey);
        return;
      }
      // dynrow chips
      const chip = e.target.closest('.dynrow-chip');
      if (chip && $('q-area').contains(chip)) {
        const sk = chip.getAttribute('data-sk');
        const rowId = chip.getAttribute('data-row-id');
        const mk = chip.getAttribute('data-mk');
        if (sk && rowId && mk) handleDynChip(sk, rowId, mk);
        return;
      }
      const btn = e.target.closest('button[data-study-btn]');
      if (!btn || !$('q-area').contains(btn)) return;
      const qidStr = btn.getAttribute('data-qid');
      if (qidStr == null) return;
      const act = btn.getAttribute('data-study-btn');
      if (act === 'check') checkSataAnswer(qidStr);
      else if (act === 'reveal') revealAnswer(qidStr);
      else if (act === 'reset') resetQ(qidStr);
    });

    $('quiz-area').addEventListener('click', (e) => {
      const opt = e.target.closest('.q-option');
      if (!opt || !$('quiz-area').contains(opt)) return;
      const card = opt.closest('.q-card');
      if (!card || !card.id.startsWith('qz-')) return;
      const qidStr = card.id.slice(3);
      const keyEnc = opt.getAttribute('data-opt-key');
      if (keyEnc == null) return;
      const key = decodeURIComponent(keyEnc);
      const q = quizQs.find(x => String(x.id) === String(qidStr));
      if (!q) return;
      if (parseCorrectKeys(q).size > 1) quizSataToggle(q.id, key);
      else quizPick(q.id, key);
    });

    $('quiz-area').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const opt = e.target.closest('.q-option');
      if (!opt || !$('quiz-area').contains(opt)) return;
      e.preventDefault();
      opt.click();
    });

    // ─── FILE LOADING ───
    $('drop-box').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', e => loadFile(e.target.files[0]));

    $('drop-box').addEventListener('dragover', e => { e.preventDefault(); $('drop-box').classList.add('drag-over'); });
    $('drop-box').addEventListener('dragleave', () => $('drop-box').classList.remove('drag-over'));
    $('drop-box').addEventListener('drop', e => {
      e.preventDefault();
      $('drop-box').classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    // ─── INDEXED DB RECENT FILES ───
    const DB_NAME = 'ExamArchiveDB';
    const STORE_NAME = 'recentArchives';

    function openArchiveDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME, { keyPath: 'name' });
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function saveArchiveToDB(name, buffer) {
      try {
        const db = await openArchiveDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          name: name,
          buffer: buffer,
          timestamp: Date.now()
        });
      } catch (e) {
        console.warn('Failed to save archive to IndexedDB', e);
      }
    }

    async function loadRecentArchives() {
      try {
        const db = await openArchiveDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).getAll();
          req.onsuccess = () => resolve(req.result.sort((a,b) => b.timestamp - a.timestamp));
          req.onerror = () => resolve([]);
        });
      } catch (e) {
        return [];
      }
    }

    async function loadFromRecent(name) {
      try {
        const db = await openArchiveDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(name);
        req.onsuccess = async () => {
          if (req.result) {
            try {
              await processArchiveBuffer(req.result.buffer, req.result.name);
              saveArchiveToDB(req.result.name, req.result.buffer); // update timestamp
            } catch (err) {
              alert('Could not load recent archive: ' + err.message);
            }
          }
        };
      } catch (e) {
        alert('Could not load from DB: ' + e.message);
      }
    }

    async function initDropZone() {
      const recents = await loadRecentArchives();
      if (recents && recents.length > 0) {
        $('recent-files').style.display = 'flex';
        $('recent-files-list').innerHTML = recents.slice(0, 10).map(r => {
          const date = new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
          return `<div class="btn" style="text-align:left; padding:10px 16px; border-color:var(--border);" onclick="loadFromRecent('${escapeHtmlAttr(r.name)}')">
            <div style="font-weight:600; color:var(--text); margin-bottom:2px">${escapeHtmlAttr(r.name)}</div>
            <div style="font-size:11px; color:var(--text3)">Opened ${date}</div>
          </div>`;
        }).join('');
      }
    }

    const SECRET_PASSPHRASE = 'ArchiveSecretKey2026!#';

    async function decryptAndDecompressArchive(buffer) {
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(SECRET_PASSPHRASE));
      const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['decrypt']);
      const iv = buffer.slice(0, 12);
      const data = buffer.slice(12);
      
      // 1. Decrypt
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data);
      
      // 2. Decompress using built-in browser DecompressionStream (Gzip)
      const ds = new DecompressionStream('gzip');
      const decompressedStream = new Response(decrypted).body.pipeThrough(ds);
      const text = await new Response(decompressedStream).text();
      
      return JSON.parse(text);
    }

    async function processArchiveBuffer(buffer, fileName) {
      let obj;
      try {
        // Try parsing as normal JSON first
        const text = new TextDecoder().decode(buffer);
        obj = JSON.parse(text);
      } catch (err) {
        // If it fails, assume it's encrypted and decrypt/decompress it locally
        try {
          obj = await decryptAndDecompressArchive(buffer);
        } catch (decryptErr) {
           throw new Error('File is neither a valid JSON archive nor could it be decrypted. ' + decryptErr.message);
        }
      }
      
      if (!obj || !Array.isArray(obj.categories)) throw new Error('Invalid archive (missing categories)');
      DATA = obj;
      init();
    }

    function loadFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          await processArchiveBuffer(e.target.result, file.name);
          saveArchiveToDB(file.name, e.target.result);
        } catch (err) {
          alert('Could not load archive: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    async function tryLoadArchiveFromQuery() {
      const params = new URLSearchParams(location.search);
      const path = params.get('archive');
      if (!path) return;
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        const buffer = await res.arrayBuffer();
        
        await processArchiveBuffer(buffer, path.split('/').pop());

        const q = params.get('q');
        if (q != null && String(q).length) {
          requestAnimationFrame(() => openGSearchPrefilled(String(q)));
        }
      } catch (err) {
        console.warn('Archive URL load failed:', path, err);
      }
    }

    function init() {
      $('drop-zone').style.display = 'none';
      $('app').classList.add('visible');
      buildGlobals();
      buildTopbar();
      buildSidebar();
      buildOverview();
      buildGSearchFilters();
      if (window.innerWidth <= 600) {
        $('gsearch-input').placeholder = `Search ${allQuestions.length.toLocaleString()} questions…`;
      } else {
        $('gsearch-input').placeholder = `Search all ${allQuestions.length.toLocaleString()} questions… (⌘K)`;
      }
    }

    function buildGlobals() {
      allQuestions = [];
      DATA.categories.forEach(cat => {
        cat.subtopics.forEach(st => {
          (st.questions || []).forEach(q => {
            q._cat = cat.name;
            q._subtopic = st.name;
            allQuestions.push(q);
          });
        });
      });
    }

    function buildTopbar() {
      $('top-meta').textContent = DATA.parentName + '  ·  scraped ' + new Date(DATA.scrapedAt).toLocaleDateString();
      const validCats = DATA.categories.filter(c => c.subtopics.length > 0);
      $('ts-cats').textContent = validCats.length;
      $('ts-exams').textContent = DATA.categories.reduce((a, c) => a + c.subtopics.length, 0);
      $('ts-qs').textContent = allQuestions.length.toLocaleString();
    }

    function buildSidebar() {
      renderCatList('');
      $('sidebar-search').addEventListener('input', e => renderCatList(e.target.value.toLowerCase()));
    }

    function renderCatList(filter) {
      const list = $('cat-list');
      list.innerHTML = '';
      DATA.categories.forEach((cat, ci) => {
        const matchingSubtopics = cat.subtopics.filter(st =>
          !filter ||
          cat.name.toLowerCase().includes(filter) ||
          st.name.toLowerCase().includes(filter)
        );
        if (!matchingSubtopics.length) return;

        const hdr = document.createElement('div');
        hdr.className = 'cat-header';
        hdr.innerHTML = `<span class="cat-toggle" id="ct-${ci}">▶</span>
      <span class="cat-name">${cat.name}</span>
      <span class="cat-badge">${matchingSubtopics.length}</span>`;
        list.appendChild(hdr);

        const subList = document.createElement('div');
        subList.className = 'subtopic-list';
        subList.id = `sl-${ci}`;

        matchingSubtopics.forEach(st => {
          const item = document.createElement('div');
          item.className = 'subtopic-item';
          item.dataset.stId = st.id;
          const p = localProgress.exams[st.id] || { visited: false, seenQs: [], answeredQs: {} };
          if (p.visited) item.classList.add('visited');
          const totalQs = (st.questions || []).length;
          const seen = p.seenQs ? p.seenQs.length : 0;
          const correct = p.answeredQs ? Object.values(p.answeredQs).filter(a => a.correct).length : 0;

          item.innerHTML = `<span class="st-name">${st.name}</span>
        <div class="st-progress" id="st-prog-${st.id}" data-total="${totalQs}">
          <span>Seen: ${seen}/${totalQs}</span>
          <span class="st-prog-correct">Correct: ${correct}</span>
        </div>`;
          item.addEventListener('click', () => {
            openSubtopic(cat, st, item);
            if (window.innerWidth <= 900) {
              $('sidebar').classList.remove('open');
              $('sidebar-overlay').classList.remove('open');
            }
          });
          subList.appendChild(item);
        });
        list.appendChild(subList);

        hdr.addEventListener('click', () => {
          const tog = $(`ct-${ci}`);
          const sl = $(`sl-${ci}`);
          const isOpen = sl.classList.contains('open');
          sl.classList.toggle('open', !isOpen);
          tog.classList.toggle('open', !isOpen);
        });

        // Auto-open if filter matches
        if (filter) {
          subList.classList.add('open');
          $(`ct-${ci}`) && ($(`ct-${ci}`).classList.add('open'));
        }
      });
    }

    function openSubtopic(cat, st, itemEl) {
      document.querySelectorAll('.subtopic-item').forEach(el => el.classList.remove('active'));
      itemEl.classList.add('active');
      currentSubtopic = st;
      filteredQs = (st.questions || []).slice();
      currentQIdx = 0;
      resetAllMaps();

      if (!localProgress.exams[st.id]) localProgress.exams[st.id] = { visited: true, seenQs: [], answeredQs: {} };
      else localProgress.exams[st.id].visited = true;
      saveProgress();
      itemEl.classList.add('visited');

      $('overview').style.display = 'none';
      $('anki-view').style.display = 'none';
      $('exam-view').classList.add('visible');

      $('ev-title').textContent = st.name;
      const scrapedLabel = DATA.scrapedAt
        ? new Date(DATA.scrapedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
        : '—';
      $('ev-meta').innerHTML = `
    <span class="exam-tag">Category: <span>${cat.name}</span></span>
    <span class="exam-tag">Questions: <span>${filteredQs.length}</span></span>
    <span class="exam-tag">Expected: <span>${st.questionsCount ?? '—'}</span></span>
    <span class="exam-tag">Archive scraped: <span>${scrapedLabel}</span></span>
  `;

      $('q-search').value = '';
      setupStudyMode();
      setupQuizSetup();
      switchTab('study');
    }

    function resetAllMaps() {
      revealedMap = {}; chosenMap = {}; multiSelectMap = {}; multiGradedMap = {};
      orderMap = {}; matchMap = {}; dropMap = {}; bowtieMap = {};
      dynMap = {}; matrixMap = {}; fitbMap = {};
    }

    function setupStudyMode() {
      renderQuestion();
    }

    // ─── EXHIBIT TAB HELPER ───
    function renderExhibitTabs(tabs, elId) {
      if (!tabs) return '';
      const parsed = (typeof tabs === 'string') ? safeParseJSON(tabs) : tabs;
      if (!parsed || typeof parsed !== 'object') return '';
      const keys = Object.keys(parsed);
      if (!keys.length) return '';
      const uid = elId || ('ex' + Math.random().toString(36).slice(2, 7));
      const tabBtns = keys.map((k, i) =>
        `<button class="exhibit-tab-btn${i === 0 ? ' active' : ''}" onclick="switchExhibit('${uid}','${escapeHtmlAttr(k)}')">${k}</button>`
      ).join('');
      const panels = keys.map((k, i) =>
        `<div class="exhibit-panel${i === 0 ? ' active' : ''}" id="${uid}-${escapeHtmlAttr(k)}">${parsed[k] || ''}</div>`
      ).join('');
      return `<div class="exhibit-wrap">
    <div class="exhibit-label">Exhibit</div>
    <div class="exhibit-tabs">${tabBtns}</div>
    ${panels}
  </div>`;
    }

    window.switchExhibit = function (uid, key) {
      document.querySelectorAll(`[id^="${uid}-"]`).forEach(el => {
        el.classList.toggle('active', el.id === `${uid}-${key}`);
      });
      // update tab buttons — find parent
      const panel = document.getElementById(`${uid}-${key}`);
      if (!panel) return;
      const wrap = panel.closest('.exhibit-wrap');
      if (!wrap) return;
      wrap.querySelectorAll('.exhibit-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === key);
      });
    };

    // ─── VIEW LIST (all types) ───
    function renderViewList() {
      const el = $('view-list');
      if (!el) return;
      const list = filteredQs;
      if (!list.length) {
        el.innerHTML = '<div class="no-qs">No questions match this filter.</div>';
        return;
      }
      el.innerHTML = list.map((q, i) => {
        const tid = q.question_type_id;
        const sol = (q.solution || '').trim();
        const tabs = parseTabs(q);
        const exhibitHtml = tabs ? renderExhibitTabs(tabs, 'vw' + q.id) : '';
        const typeName = TYPE_LABELS[tid] || `Type ${tid}`;
        let answerBlock = buildViewAnswerBlock(q);
        return `<article class="view-list-item" id="view-q-${q.id}">
      <div class="view-list-head">Q${i + 1} of ${list.length} · ID ${q.id} · <span style="color:var(--purple)">${typeName}</span></div>
      ${exhibitHtml}
      <div class="q-text view-list-q">${q.question || ''}</div>
      ${answerBlock}
      ${sol ? `<div class="view-explain-block"><div class="view-block-label explain">Explanation</div><div class="q-solution-text">${sol}</div></div>` : ''}
    </article>`;
      }).join('');
    }

    function buildViewAnswerBlock(q) {
      const tid = q.question_type_id;
      const raw = q.correctAnswer ?? q.correct_answer;

      // Type 7: fill-in-blank
      if (tid === 7) {
        const answers = safeParseJSON(raw) || [];
        const unit = q.units || '';
        return `<div class="view-ans-block"><div class="view-block-label">Correct answer</div>
      <div class="view-ans-line"><strong>${Array.isArray(answers) ? answers.join(', ') : answers}</strong> ${unit}</div></div>`;
      }
      // Type 6: ordering
      if (tid === 6) {
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const order = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
        const steps = order.map((k, i) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="width:20px;font-size:11px;color:var(--text3);font-family:var(--mono)">${i + 1}</span>
      <span style="font-size:12px;color:var(--text3);font-family:var(--mono);width:16px">${k}</span>
      <span style="font-size:13px;color:var(--text)">${opts[k]?.choice || k}</span></div>`).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct order</div>${steps}</div>`;
      }
      // Type 5: drag-to-match (ordering with labels)
      if (tid === 5) {
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        const order = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
        const steps = order.map((k, i) => {
          const label = matchOpt ? (matchOpt[String.fromCharCode(65 + i)]?.exp || '') : '';
          return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--amber);min-width:80px">${label}</span>
        <span style="font-size:13px;color:var(--text)">${opts[k]?.choice || k}</span></div>`;
        }).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct matches</div>${steps}</div>`;
      }
      // Type 10: matching
      if (tid === 10) {
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        let ca = {}; try { ca = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { }
        const rows = Object.entries(matchOpt || {}).map(([mk, mv]) => {
          const correctOptKey = ca[mk]?.answers;
          const correctChoice = opts[correctOptKey]?.choice || correctOptKey || '—';
          return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;color:var(--text);flex:1">${mv.option || mk}</span>
        <span style="font-size:12px;color:var(--green);flex:1">→ ${correctChoice}</span></div>`;
        }).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct matches</div>${rows}</div>`;
      }
      // Type 13: inline dropdown
      if (tid === 13) {
        let ca = {}; try { ca = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { }
        let opts = {}; try { opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        const rows = Object.entries(ca || {}).map(([grp, val]) => {
          const groupOpts = opts[grp] || {};
          const label = groupOpts[val] || val;
          return `<div style="padding:4px 0;font-size:13px"><span style="color:var(--text3)">${grp}:</span> <strong style="color:var(--green)">${label}</strong></div>`;
        }).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct selections</div>${rows}</div>`;
      }
      // Type 12: bow-tie (subquestions — no answers in data, show structure)
      if (tid === 12) {
        const subs = q.subquestions || [];
        const subHtml = subs.map(sub => {
          let choices = {}; try { choices = typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices; } catch (e) { }
          const choiceList = Object.entries(choices || {}).filter(([, v]) => v?.choice).map(([k, v]) => `<div style="font-size:12px;padding:2px 0"><span style="color:var(--text3);font-family:var(--mono);margin-right:6px">${k}</span>${v.choice}</div>`).join('');
          return `<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:4px">${sub.question}</div>${choiceList}</div>`;
        }).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Bow-tie columns</div>${subHtml}<div style="font-size:11px;color:var(--text3);margin-top:6px">Correct answers not available in archive for this type.</div></div>`;
      }
      // Type 14: matrix
      if (tid === 14) {
        let ca = {}; try { ca = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { }
        let opts = {}; try { opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        const cols = Object.keys(matchOpt || {});
        const rows = Object.entries(opts || {}).filter(([, v]) => v?.choice).map(([k, v]) => {
          const correctCols = String((ca[k]?.answers) || '').split(',').map(s => s.trim()).filter(Boolean);
          const colLabels = correctCols.map(c => (matchOpt && matchOpt[c]) ? matchOpt[c].option : c).join(', ');
          return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="flex:1;color:var(--text)">${v.choice}</span>
        <span style="color:var(--green)">${colLabels || '—'}</span></div>`;
        }).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct answers</div>${rows}</div>`;
      }
      // Type 16: dynamic table
      if (tid === 16) {
        const dtCA = parseDynTableCA(q);
        const dtOpts = parseDynTable(q);
        if (dtCA && dtOpts) {
          const rows = dtCA.map(({ id, markKeys }) => {
            const rowDef = dtOpts.rows.find(r => r.id === id);
            const rowLabel = rowDef?.text || id;
            const selected = (Array.isArray(markKeys) ? markKeys : [markKeys]).map(mk => {
              const optDef = rowDef?.options?.find(o => o.markKey === mk);
              return optDef?.text || mk;
            }).join(', ');
            return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="flex:1;color:var(--text)">${rowLabel}</span>
          <span style="color:var(--green)">${selected}</span></div>`;
          }).join('');
          return `<div class="view-ans-block"><div class="view-block-label">Correct answers</div>${rows}</div>`;
        }
        return `<div class="view-ans-block"><div class="view-block-label">Answer</div><div class="view-ans-line">${String(raw || '').slice(0, 200)}</div></div>`;
      }
      // Type 15: drag-and-drop text (fill-in-the-blank)
      if (tid === 15) {
        let caArr = []; try { caArr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { }
        let optsArr = []; try { optsArr = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        if (!Array.isArray(optsArr)) optsArr = [];
        const caMap = {};
        (caArr || []).forEach(ca => {
          const opt = optsArr.find(o => o.markKey === ca.answer);
          caMap[ca.id] = opt ? opt.text : ca.answer;
        });
        const rows = Object.entries(caMap).map(([id, val]) =>
          `<div style="padding:4px 0;font-size:13px"><span style="color:var(--text3)">${id}:</span> <strong style="color:var(--green)">${val}</strong></div>`
        ).join('');
        return `<div class="view-ans-block"><div class="view-block-label">Correct selections</div>${rows}</div>`;
      }
      // Type 9: hotspot
      if (tid === 9) {
        return `<div class="view-ans-block"><div class="view-block-label">Correct area</div>
      <div class="view-ans-line" style="font-size:12px;color:var(--text2)">Hotspot answer (see image). Correct region stored as x/y percentage ranges.</div></div>`;
      }
      // Type 0: MCQ without explicit correctAnswer but solution is provided
      if (tid === 0) {
        return `<div class="view-ans-block"><div class="view-block-label">Answer</div><div class="view-ans-line"><em>See explanation for correct answer.</em></div></div>`;
      }
      // Type 1/2/11: standard MCQ / SATA
      let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
      const correctKeys = parseCorrectKeys(q);
      const correctList = [...correctKeys];
      if (!correctList.length) {
        return `<div class="view-ans-block"><div class="view-block-label">Answer</div><div class="view-ans-line">${String(raw || '').slice(0, 200)}</div></div>`;
      }
      const ansTitle = correctList.length > 1 ? 'Correct answers' : 'Correct answer';
      const correctBlock = correctList.map(k => {
        const v = opts[k] || {};
        const r = (v.reason || '').trim();
        return `<div class="view-ans-line" style="margin-top:8px"><strong>${k}</strong> — ${v.choice || '—'}${r ? `<div class="view-dr">${r}</div>` : ''}`;
      }).join('');
      return `<div class="view-ans-block"><div class="view-block-label">${ansTitle}</div>${correctBlock}</div>`;
    }

    // ─── RENDER QUESTION (dispatcher) ───
    function renderQuestion() {
      const total = filteredQs.length;
      if (!total) {
        $('q-area').innerHTML = '<div class="no-qs">No questions found.</div>';
        $('q-counter').textContent = '0 / 0';
        $('q-prog').style.width = '0%';
        return;
      }
      if (currentQIdx >= total) currentQIdx = total - 1;
      if (currentQIdx < 0) currentQIdx = 0;

      $('q-counter').textContent = `${currentQIdx + 1} / ${total}`;
      $('q-prog').style.width = `${((currentQIdx + 1) / total * 100).toFixed(1)}%`;

      const q = filteredQs[currentQIdx];
      recordSeen(q);

      const stId = currentSubtopic ? currentSubtopic.id : null;
      const prevAttempt = stId && localProgress.exams[stId] && localProgress.exams[stId].answeredQs[q.id];
      let prevBadge = '';
      if (prevAttempt) {
        prevBadge = `<div class="q-prev-attempt ${prevAttempt.correct ? 'correct' : 'wrong'}">Previously answered: ${prevAttempt.correct ? 'Correct' : 'Incorrect'}</div>`;
      }

      const tid = q.question_type_id;
      const sk = storeQid(q.id);
      const revealed = !!revealedMap[sk];
      const typeBadge = TYPE_LABELS[tid] ? `<span class="q-type-badge">${TYPE_LABELS[tid]}</span>` : '';
      const tabs = parseTabs(q);
      const exhibitHtml = tabs ? renderExhibitTabs(tabs, 'st' + sk) : '';
      const sol = q.solution || '';
      const qidAttr = escapeHtmlAttr(sk);

      let bodyHtml = '';
      let badge = '';
      let actionsHtml = '';
      let solutionShow = revealed ? 'show' : '';

      if (tid === 7) {
        // ── Fill-in-the-blank ──
        const answers = safeParseJSON(q.correctAnswer ?? q.correct_answer) || [];
        const unit = q.units || '';
        const userVal = fitbMap[sk] || '';
        const isGraded = revealed || !!fitbMap[sk + '_graded'];
        const correctVal = Array.isArray(answers) ? answers[0] : String(answers);
        let inputCls = '';
        if (isGraded) {
          const correct = Math.abs(parseFloat(userVal) - parseFloat(correctVal)) < 0.01;
          inputCls = correct ? 'correct' : 'wrong';
          badge = correct ? '<span class="q-answered-badge correct">✓ Correct</span>' : '<span class="q-answered-badge wrong">✗ Incorrect</span>';
          solutionShow = 'show';
        }
        bodyHtml = `
      <div class="q-text">${q.question || ''}</div>
      <div class="fitb-wrap">
        <input type="number" class="fitb-input ${inputCls}" id="fitb-${sk}" value="${escapeHtmlAttr(userVal)}"
          placeholder="?" ${isGraded ? 'readonly' : ''} step="any">
        ${unit ? `<span class="fitb-unit">${unit}</span>` : ''}
        ${isGraded ? `<span class="fitb-answer show">Answer: <strong>${correctVal}</strong> ${unit}</span>` : ''}
      </div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check-fitb" data-qid="${qidAttr}">Check answer</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }

      } else if (tid === 6) {
        // ── Ordering / Sequence ──
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const correctOrder = String((q.correctAnswer ?? q.correct_answer) || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!orderMap[sk]) orderMap[sk] = [...correctOrder].sort(() => Math.random() - 0.5);
        const userOrder = orderMap[sk];
        const isGraded = !!multiGradedMap[sk];
        if (isGraded) solutionShow = 'show';
        const items = userOrder.map((k, i) => {
          let cls = '';
          if (isGraded) cls = (correctOrder[i] === k) ? 'correct-pos' : 'wrong-pos';
          return `<div class="order-item ${cls}" draggable="${!isGraded}" data-sk="${escapeHtmlAttr(sk)}" data-key="${escapeHtmlAttr(k)}"
        ondragstart="orderDragStart(event,'${escapeHtmlAttr(sk)}','${escapeHtmlAttr(k)}')"
        ondragover="orderDragOver(event)" ondrop="orderDrop(event,'${escapeHtmlAttr(sk)}','${escapeHtmlAttr(k)}')"
        ondragleave="orderDragLeave(event)">
        <span class="order-pos">${i + 1}</span>
        <span class="order-key">${k}</span>
        <span class="order-text">${opts[k]?.choice || k}</span>
        ${isGraded && correctOrder[i] !== k ? `<span style="font-size:11px;color:var(--amber);margin-left:auto">→ should be ${correctOrder[i]}</span>` : ''}
      </div>`;
        }).join('');
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <p class="sata-hint">${isGraded ? '' : 'Drag steps into the correct order, then check.'}</p>
      <div class="order-list">${items}</div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check order</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        const correct = isGraded && userOrder.every((k, i) => correctOrder[i] === k);
        if (isGraded) badge = correct ? '<span class="q-answered-badge correct">✓ Correct order</span>' : '<span class="q-answered-badge wrong">✗ Wrong order</span>';

      } else if (tid === 5) {
        // ── Drag-to-match (ordering with category labels) ──
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        const correctOrder = String((q.correctAnswer ?? q.correct_answer) || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!orderMap[sk]) orderMap[sk] = [...correctOrder].sort(() => Math.random() - 0.5);
        const userOrder = orderMap[sk];
        const isGraded = !!multiGradedMap[sk];
        if (isGraded) solutionShow = 'show';
        const labels = Object.values(matchOpt || {}).map(v => v.exp || '');
        const items = userOrder.map((k, i) => {
          const label = labels[i] || '';
          let cls = '';
          if (isGraded) cls = (correctOrder[i] === k) ? 'correct-pos' : 'wrong-pos';
          return `<div class="order-item ${cls}" draggable="${!isGraded}" data-sk="${escapeHtmlAttr(sk)}" data-key="${escapeHtmlAttr(k)}"
        ondragstart="orderDragStart(event,'${escapeHtmlAttr(sk)}','${escapeHtmlAttr(k)}')"
        ondragover="orderDragOver(event)" ondrop="orderDrop(event,'${escapeHtmlAttr(sk)}','${escapeHtmlAttr(k)}')"
        ondragleave="orderDragLeave(event)">
        <span class="order-pos" style="background:var(--bg4);color:var(--amber);min-width:80px;font-size:11px;width:auto;padding:0 8px">${label}</span>
        <span class="order-text">${opts[k]?.choice || k}</span>
      </div>`;
        }).join('');
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <p class="sata-hint">${isGraded ? '' : 'Drag items to match each category, then check.'}</p>
      <div class="order-list">${items}</div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check matches</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        const correct = isGraded && userOrder.every((k, i) => correctOrder[i] === k);
        if (isGraded) badge = correct ? '<span class="q-answered-badge correct">✓ Correct</span>' : '<span class="q-answered-badge wrong">✗ Incorrect</span>';

      } else if (tid === 10) {
        // ── Matching ──
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        let ca = {}; try { ca = typeof (q.correctAnswer ?? q.correct_answer) === 'string' ? JSON.parse(q.correctAnswer ?? q.correct_answer) : (q.correctAnswer ?? q.correct_answer); } catch (e) { }
        const isGraded = !!multiGradedMap[sk];
        if (!matchMap[sk]) matchMap[sk] = {};
        if (isGraded) solutionShow = 'show';
        const optKeys = Object.keys(opts).filter(k => opts[k]?.choice);
        const rows = Object.entries(matchOpt || {}).map(([mk, mv]) => {
          const correctOptKey = ca[mk]?.answers;
          const userPick = matchMap[sk][mk] || '';
          let selCls = '';
          if (isGraded) selCls = userPick === correctOptKey ? 'correct' : 'wrong';
          const optionItems = optKeys.map(ok =>
            `<option value="${escapeHtmlAttr(ok)}" ${userPick === ok ? 'selected' : ''}>${ok} — ${opts[ok].choice}</option>`
          ).join('');
          return `<tr class="${isGraded ? (userPick === correctOptKey ? 'correct-row' : 'wrong-row') : ''}">
        <td>${mv.option || mk}</td>
        <td><select class="match-select ${selCls}" ${isGraded ? 'disabled' : ''} onchange="matchPick('${escapeHtmlAttr(sk)}','${escapeHtmlAttr(mk)}',this.value)">
          <option value="">— select —</option>${optionItems}</select>
          ${isGraded && userPick !== correctOptKey ? `<div class="match-correct-val show">✓ ${correctOptKey} — ${opts[correctOptKey]?.choice || ''}</div>` : ''}
        </td>
      </tr>`;
        }).join('');
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <table class="match-table"><thead><tr><th>Item</th><th>Match</th></tr></thead><tbody>${rows}</tbody></table>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check matches</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        if (isGraded) {
          const allCorrect = Object.entries(matchOpt || {}).every(([mk]) => matchMap[sk][mk] === ca[mk]?.answers);
          badge = allCorrect ? '<span class="q-answered-badge correct">✓ All correct</span>' : '<span class="q-answered-badge wrong">✗ Some wrong</span>';
        }

      } else if (tid === 13) {
        // ── Inline dropdown ──
        let opts = {}; try { opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        let ca = {}; try { ca = typeof (q.correctAnswer ?? q.correct_answer) === 'string' ? JSON.parse(q.correctAnswer ?? q.correct_answer) : (q.correctAnswer ?? q.correct_answer); } catch (e) { }
        const isGraded = !!multiGradedMap[sk];
        if (!dropMap[sk]) dropMap[sk] = {};
        if (isGraded) solutionShow = 'show';
        // Replace <div id="dropdown-group-N"> placeholders with actual selects
        let qText = q.question || '';
        const groups = Object.keys(opts);
        groups.forEach(grp => {
          const groupOpts = opts[grp] || {};
          const userPick = dropMap[sk][grp] || '';
          const correctVal = ca[grp] || '';
          let selCls = '';
          if (isGraded) selCls = userPick === correctVal ? 'correct' : 'wrong';
          const optItems = Object.entries(groupOpts).filter(([, v]) => v != null).map(([k, v]) =>
            `<option value="${escapeHtmlAttr(k)}" ${userPick === k ? 'selected' : ''}>${k} — ${v}</option>`
          ).join('');
          const selectHtml = `<span class="inline-dropdown"><select class="inline-dropdown-select ${selCls}" ${isGraded ? 'disabled' : ''}
        onchange="dropPick('${escapeHtmlAttr(sk)}','${escapeHtmlAttr(grp)}',this.value)">
        <option value="">select…</option>${optItems}</select></span>`;
          qText = qText.replace(new RegExp(`<div[^>]*id=["']${grp}["'][^>]*>.*?</div>`, 's'), selectHtml);
        });
        bodyHtml = `<div class="q-text">${qText}</div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answers</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        if (isGraded) {
          const allCorrect = groups.every(g => dropMap[sk][g] === ca[g]);
          badge = allCorrect ? '<span class="q-answered-badge correct">✓ Correct</span>' : '<span class="q-answered-badge wrong">✗ Incorrect</span>';
        }

      } else if (tid === 12) {
        // ── Bow-tie (subquestions) ──
        const subs = q.subquestions || [];
        if (!bowtieMap[sk]) bowtieMap[sk] = {};
        const isGraded = !!multiGradedMap[sk];
        if (isGraded) solutionShow = 'show';
        const cols = subs.map(sub => {
          let choices = {}; try { choices = typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices; } catch (e) { }
          const picked = bowtieMap[sk][sub.id] || new Set();
          const items = Object.entries(choices || {}).filter(([, v]) => v?.choice).map(([k, v]) => {
            let cls = picked.has(k) ? 'picked' : '';
            return `<div class="bowtie-option ${cls}" data-sk="${escapeHtmlAttr(sk)}" data-sub-id="${sub.id}" data-choice-key="${escapeHtmlAttr(k)}">
          <span class="bowtie-key">${k}</span>
          <span class="bowtie-text">${v.choice}</span>
        </div>`;
          }).join('');
          return `<div class="bowtie-col"><div class="bowtie-col-title">${sub.question}</div>${items}</div>`;
        }).join('');
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <p class="sata-hint">Select answers in each column, then check.</p>
      <div class="bowtie-grid">${cols}</div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answers</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
          badge = '<span class="q-answered-badge correct" style="background:rgba(155,124,240,.15);color:var(--purple)">Submitted</span>';
        }

      } else if (tid === 14) {
        // ── Matrix (checkboxes per row) ──
        let opts = {}; try { opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        let matchOpt = q.match_option; if (typeof matchOpt === 'string') matchOpt = safeParseJSON(matchOpt);
        let ca = {}; try { ca = typeof (q.correctAnswer ?? q.correct_answer) === 'string' ? JSON.parse(q.correctAnswer ?? q.correct_answer) : (q.correctAnswer ?? q.correct_answer); } catch (e) { }
        const isGraded = !!multiGradedMap[sk];
        if (!matrixMap[sk]) matrixMap[sk] = {};
        if (isGraded) solutionShow = 'show';
        const cols = Object.entries(matchOpt || {});
        const thead = `<tr><th>Finding</th>${cols.map(([k, v]) => `<th>${v?.option || k}</th>`).join('')}</tr>`;
        const optRows = Object.entries(opts || {}).filter(([, v]) => v?.choice).map(([optK, optV]) => {
          const correctCols = String((ca[optK]?.answers) || '').split(',').map(s => s.trim()).filter(Boolean);
          const rowSel = matrixMap[sk][optK] || new Set();
          const tds = cols.map(([colK]) => {
            const checked = rowSel.has(colK);
            const isCorrectCol = correctCols.includes(colK);
            let style = '';
            if (isGraded && checked && isCorrectCol) style = 'color:var(--green)';
            if (isGraded && checked && !isCorrectCol) style = 'color:var(--red)';
            if (isGraded && !checked && isCorrectCol) style = 'color:var(--amber)';
            return `<td><input type="checkbox" class="matrix-cb" ${checked ? 'checked' : ''} ${isGraded ? 'disabled' : ''}
          onchange="matrixToggle('${escapeHtmlAttr(sk)}','${escapeHtmlAttr(optK)}','${escapeHtmlAttr(colK)}',this.checked)"
          style="${style}"></td>`;
          }).join('');
          const rowCorrect = isGraded && correctCols.every(c => rowSel.has(c)) && [...rowSel].every(c => correctCols.includes(c));
          return `<tr class="${isGraded ? (rowCorrect ? 'row-correct' : 'row-wrong') : ''}"><td>${optV.choice}</td>${tds}</tr>`;
        }).join('');
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <p class="sata-hint">${isGraded ? '' : 'Check all columns that apply for each finding.'}</p>
      <table class="matrix-table"><thead>${thead}</thead><tbody>${optRows}</tbody></table>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answers</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        if (isGraded) badge = '<span class="q-answered-badge correct" style="background:rgba(155,124,240,.15);color:var(--purple)">Submitted</span>';

      } else if (tid === 16) {
        // ── Dynamic table ──
        const dtOpts = parseDynTable(q);
        const dtCA = parseDynTableCA(q);
        if (!dynMap[sk]) dynMap[sk] = {};
        const isGraded = !!multiGradedMap[sk];
        if (isGraded) solutionShow = 'show';
        if (dtOpts) {
          const rowsHtml = dtOpts.rows.map(row => {
            const rowSel = dynMap[sk][row.id] || null;
            const caRow = dtCA ? dtCA.find(c => c.id === row.id) : null;
            const correctKeys = caRow ? (Array.isArray(caRow.markKeys) ? caRow.markKeys : [caRow.markKeys]) : [];
            const chips = row.options.map(opt => {
              const picked = rowSel === opt.markKey;
              const isCorrect = correctKeys.includes(opt.markKey);
              let cls = picked ? 'picked' : '';
              if (isGraded && picked && isCorrect) cls = 'correct';
              else if (isGraded && picked && !isCorrect) cls = 'wrong';
              else if (isGraded && !picked && isCorrect) cls = 'correct';
              return `<span class="dynrow-chip ${cls}" data-sk="${escapeHtmlAttr(sk)}" data-row-id="${escapeHtmlAttr(row.id)}" data-mk="${escapeHtmlAttr(opt.markKey)}">${opt.text}</span>`;
            }).join('');
            return `<div class="dynrow-item"><div class="dynrow-label">${row.text}</div><div class="dynrow-opts">${chips}</div></div>`;
          }).join('');
          bodyHtml = `<div class="q-text">${q.question || ''}</div>
        <p class="sata-hint">${isGraded ? '' : 'Select one finding per row.'}</p>
        <div class="dynrow-wrap">${rowsHtml}</div>`;
        } else {
          bodyHtml = `<div class="q-text">${q.question || ''}</div><p class="sata-hint" style="color:var(--red)">Could not parse dynamic table options.</p>`;
        }
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answers</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        if (isGraded) badge = '<span class="q-answered-badge correct" style="background:rgba(155,124,240,.15);color:var(--purple)">Submitted</span>';

      } else if (tid === 15) {
        // ── Drag words (treated as inline selects) ──
        let optsArr = []; try { optsArr = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch (e) { }
        let caArr = []; try { const rawCA = q.correctAnswer ?? q.correct_answer; caArr = typeof rawCA === 'string' ? JSON.parse(rawCA) : rawCA; } catch (e) { }
        const isGraded = !!multiGradedMap[sk];
        if (!dropMap[sk]) dropMap[sk] = {}; // Reusing dropMap for inline selections
        if (isGraded) solutionShow = 'show';

        let qText = q.question || '';
        const caMap = {};
        (caArr || []).forEach(ca => caMap[ca.id] = ca.answer);

        const inputRegex = /<input[^>]*id=["']([^"']+)["'][^>]*>/g;
        let match;
        const foundIds = [];
        while ((match = inputRegex.exec(qText)) !== null) {
          foundIds.push(match[1]);
        }

        foundIds.forEach(id => {
          const userPick = dropMap[sk][id] || '';
          const correctVal = caMap[id] || '';
          let selCls = '';
          if (isGraded) selCls = userPick === correctVal ? 'correct' : 'wrong';

          const optItems = (optsArr || []).map(opt =>
            `<option value="${escapeHtmlAttr(opt.markKey)}" ${userPick === opt.markKey ? 'selected' : ''}>${opt.text}</option>`
          ).join('');

          const selectHtml = `<span class="inline-dropdown"><select class="inline-dropdown-select ${selCls}" ${isGraded ? 'disabled' : ''}
          onchange="dropPick('${escapeHtmlAttr(sk)}','${escapeHtmlAttr(id)}',this.value)">
          <option value="">select…</option>${optItems}</select></span>`;

          qText = qText.replace(new RegExp(`<input[^>]*id=["']${id}["'][^>]*>`, 's'), selectHtml);
        });

        bodyHtml = `<div class="q-text">${qText}</div>`;
        if (!isGraded) {
          actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answers</button>
        <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }
        if (isGraded) {
          const allCorrect = foundIds.every(id => dropMap[sk][id] === caMap[id]);
          badge = allCorrect ? '<span class="q-answered-badge correct">✓ All correct</span>' : '<span class="q-answered-badge wrong">✗ Some wrong</span>';
        }

      } else if (tid === 9) {
        // ── Hotspot ──
        const imgPath = q.image_path;
        let caData = null;
        try { const raw2 = q.correctAnswer ?? q.correct_answer; caData = JSON.parse(typeof raw2 === 'string' ? JSON.parse(raw2) : raw2); } catch (e) { }
        const showTarget = revealed && caData;
        const xMid = caData ? ((caData.xRanges[0] + caData.xRanges[1]) / 2).toFixed(2) : 0;
        const yMid = caData ? ((caData.yRanges[0] + caData.yRanges[1]) / 2).toFixed(2) : 0;
        const xW = caData ? (caData.xRanges[1] - caData.xRanges[0]).toFixed(2) : 4;
        const yH = caData ? (caData.yRanges[1] - caData.yRanges[0]).toFixed(2) : 4;
        bodyHtml = `<div class="q-text">${q.question || ''}</div>
      <p class="hotspot-note">This is a hotspot question. ${revealed ? 'The correct region is highlighted below.' : 'Reveal the answer to see the target region.'}</p>
      <div class="hotspot-wrap">
        ${imgPath ? `<img src="${escapeHtmlAttr(imgPath)}" alt="Hotspot image" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <div style="display:none;padding:20px;color:var(--text3);font-size:13px">Image not available (${escapeHtmlAttr(imgPath)})</div>` : '<div style="padding:20px;color:var(--text3);font-size:13px">No image provided.</div>'}
        ${showTarget ? `<div class="hotspot-target show" style="left:${xMid}%;top:${yMid}%;width:${xW}%;height:${yH}%;transform:translate(-50%,-50%)"></div>` : ''}
      </div>`;
        solutionShow = revealed ? 'show' : '';
        if (!revealed) {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal answer</button>`;
        } else {
          actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Reset</button>`;
        }

      } else {
        // ── Type 0, 1, 2, 11: MCQ / SATA (with optional exhibits) ──
        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const chosen = chosenMap[sk];
        const correctKeys = parseCorrectKeys(q);
        const isSata = isSelectAllThatApply(q);
        const correctSingle = getSingleCorrectKey(q);
        const selectedSet = multiSelectMap[sk] || new Set();
        const sataGraded = !!multiGradedMap[sk];
        const isAnswered = isSata ? sataGraded : !!chosen;
        solutionShow = (isAnswered || revealed) ? 'show' : '';

        let optionsHtml = '';
        Object.entries(opts).forEach(([key, val]) => {
          if (!val || (!val.choice && val.choice !== 0)) return;
          let cls = '';
          let reasonDisplay = false;
          if (isSata) {
            if (sataGraded) {
              const ok = correctKeys.has(key);
              const picked = selectedSet.has(key);
              if (ok && picked) cls = 'revealed-correct';
              else if (ok && !picked) cls = 'sata-missed';
              else if (!ok && picked) cls = 'wrong';
            } else if (revealed) {
              if (correctKeys.has(key)) cls = 'revealed-correct';
            } else if (selectedSet.has(key)) cls = 'sata-picked';
            reasonDisplay = sataGraded || revealed;
          } else {
            if (chosen) {
              if (correctSingle != null && key === correctSingle) cls = 'revealed-correct';
              if (key === chosen && (correctSingle == null || chosen !== correctSingle)) {
                cls = tid === 0 ? 'sata-picked' : 'wrong';
              }
            } else if (revealed) {
              if (correctSingle != null && key === correctSingle) cls = 'revealed-correct';
            }
            reasonDisplay = !!(chosen || revealed);
          }
          const keyEnc = encodeURIComponent(key);
          optionsHtml += `
        <div class="q-option ${cls}" role="button" tabindex="0" data-qid="${qidAttr}" data-opt-key="${keyEnc}">
          <div class="q-opt-key">${key}</div>
          <div style="flex:1;">
            <div class="q-opt-text">${val.choice || ''}</div>
            <div class="q-opt-reason ${reasonDisplay ? 'show' : ''}">${val.reason || ''}</div>
          </div>
        </div>`;
        });

        if (isSata) {
          if (sataGraded) {
            badge = setsEqual(selectedSet, correctKeys)
              ? '<span class="q-answered-badge correct">✓ All correct</span>'
              : '<span class="q-answered-badge wrong">✗ Not all correct</span>';
          }
        } else if (chosen) {
          if (tid === 0) {
            badge = '<span class="q-answered-badge correct" style="background:rgba(155,124,240,.15);color:var(--purple)">Submitted</span>';
          } else {
            badge = (correctSingle != null && chosen === correctSingle)
              ? '<span class="q-answered-badge correct">✓ Correct</span>'
              : '<span class="q-answered-badge wrong">✗ Incorrect</span>';
          }
        }

        const sataHint = isSata && !sataGraded && !revealed
          ? '<p class="sata-hint">Select <strong>all</strong> correct choices, then <strong>Check answer</strong>.</p>' : '';

        if (isSata) {
          if (!sataGraded && !revealed) {
            actionsHtml = `<button type="button" class="btn primary" data-study-btn="check" data-qid="${qidAttr}">Check answer</button>
          <button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal answer</button>`;
          } else {
            actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
          }
        } else {
          if (!chosen && !revealed) actionsHtml = `<button type="button" class="btn" data-study-btn="reveal" data-qid="${qidAttr}">Reveal answer</button>`;
          else actionsHtml = `<button type="button" class="btn" data-study-btn="reset" data-qid="${qidAttr}">Try again</button>`;
        }

        bodyHtml = `<div class="q-text">${q.question || ''}</div>${sataHint}<div class="q-options">${optionsHtml}</div>`;
      }

      if (badge && !revealed) {
        const isCorrect = badge.includes('✓') || badge.includes('Submitted');
        recordGrade(q, isCorrect);
      }

      const isBookmarked = localProgress.bookmarks && localProgress.bookmarks[q.id];
      const starChar = isBookmarked ? '★' : '☆';
      const starColor = isBookmarked ? 'color:var(--amber);' : 'color:var(--text3);';

      $('q-area').innerHTML = `
    <div class="q-card">
      <div class="q-card-head">
        <span class="q-num">Q${currentQIdx + 1}</span>
        <button class="bookmark-btn" onclick="toggleBookmark('${q.id}')" style="background:none;border:none;cursor:pointer;font-size:18px;line-height:1;${starColor}" title="Toggle Bookmark">${starChar}</button>
        ${typeBadge}
        ${badge}
        <span class="q-id">ID: ${q.id}</span>
      </div>
      ${prevBadge ? `<div style="padding:16px 20px 0 20px; border-bottom:1px solid var(--border)">${prevBadge}</div>` : ''}
      <div class="q-body">
        ${exhibitHtml}
        ${bodyHtml}
        <div class="q-actions">${actionsHtml}</div>
        <div class="q-solution ${solutionShow}">
          <div class="q-solution-title">Explanation</div>
          <div class="q-solution-text">${sol || 'No explanation provided.'}</div>
        </div>
      </div>
    </div>`;

      // Ordering drag is handled natively via global window events
    }

    // ─── INTERACTION HANDLERS ───

    window.handleOptionClick = function (qid, key) {
      const q = filteredQs.find(x => String(x.id) === String(qid));
      if (!q) return;
      const sk = storeQid(q.id);
      if (revealedMap[sk] || multiGradedMap[sk]) return;
      if (isSelectAllThatApply(q)) {
        if (!multiSelectMap[sk]) multiSelectMap[sk] = new Set();
        const s = multiSelectMap[sk];
        if (s.has(key)) s.delete(key); else s.add(key);
        renderQuestion(); return;
      }
      if (chosenMap[sk]) return;
      chosenMap[sk] = key;
      renderQuestion();
    };

    window.handleBowtieClick = function (sk, subId, choiceKey) {
      if (revealedMap[sk] || multiGradedMap[sk]) return;
      if (!bowtieMap[sk]) bowtieMap[sk] = {};
      if (!bowtieMap[sk][subId]) bowtieMap[sk][subId] = new Set();
      const s = bowtieMap[sk][subId];
      if (s.has(choiceKey)) s.delete(choiceKey); else s.add(choiceKey);
      renderQuestion();
    };

    window.handleDynChip = function (sk, rowId, mk) {
      if (revealedMap[sk] || multiGradedMap[sk]) return;
      if (!dynMap[sk]) dynMap[sk] = {};
      dynMap[sk][rowId] = (dynMap[sk][rowId] === mk) ? null : mk;
      renderQuestion();
    };

    window.matchPick = function (sk, mk, val) {
      if (!matchMap[sk]) matchMap[sk] = {};
      matchMap[sk][mk] = val;
    };

    window.dropPick = function (sk, grp, val) {
      if (!dropMap[sk]) dropMap[sk] = {};
      dropMap[sk][grp] = val;
    };

    window.matrixToggle = function (sk, optK, colK, checked) {
      if (!matrixMap[sk]) matrixMap[sk] = {};
      if (!matrixMap[sk][optK]) matrixMap[sk][optK] = new Set();
      const s = matrixMap[sk][optK];
      if (checked) s.add(colK); else s.delete(colK);
    };

    // Drag-to-order
    let _dragKey = null;
    window.orderDragStart = function (e, sk, key) {
      _dragKey = key;
      e.dataTransfer.effectAllowed = 'move';
    };
    window.orderDragOver = function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const item = e.target.closest('.order-item');
      if (item) item.classList.add('drag-over-top');
    };
    window.orderDragLeave = function (e) {
      const item = e.target.closest('.order-item');
      if (item) { item.classList.remove('drag-over-top'); item.classList.remove('drag-over-bot'); }
    };
    window.orderDrop = function (e, sk, targetKey) {
      e.preventDefault();
      const item = e.target.closest('.order-item');
      if (item) { item.classList.remove('drag-over-top'); item.classList.remove('drag-over-bot'); }
      if (!_dragKey || _dragKey === targetKey) return;
      const arr = orderMap[sk];
      if (!arr) return;
      const fromIdx = arr.indexOf(_dragKey);
      const toIdx = arr.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, _dragKey);
      _dragKey = null;
      renderQuestion();
    };

    window.checkSataAnswer = function (qid) {
      const q = filteredQs.find(x => String(x.id) === String(qid));
      if (!q) return;
      const sk = storeQid(q.id);
      if (revealedMap[sk]) return;
      multiGradedMap[sk] = true;
      renderQuestion();
    };

    window.revealAnswer = function (qid) {
      const q = filteredQs.find(x => String(x.id) === String(qid));
      if (!q) return;
      const sk = storeQid(q.id);
      revealedMap[sk] = true;
      // For ordering: set correct order on reveal
      const tid = q.question_type_id;
      if (tid === 6 || tid === 5) {
        const correctOrder = String((q.correctAnswer ?? q.correct_answer) || '').split(',').map(s => s.trim()).filter(Boolean);
        orderMap[sk] = [...correctOrder];
      }
      renderQuestion();
    };

    window.resetQ = function (qid) {
      const q = filteredQs.find(x => String(x.id) === String(qid));
      if (!q) return;
      const sk = storeQid(q.id);
      delete chosenMap[sk]; delete revealedMap[sk]; delete multiSelectMap[sk]; delete multiGradedMap[sk];
      delete orderMap[sk]; delete matchMap[sk]; delete dropMap[sk]; delete bowtieMap[sk];
      delete dynMap[sk]; delete matrixMap[sk]; delete fitbMap[sk]; delete fitbMap[sk + '_graded'];
      renderQuestion();
    };

    window.toggleBookmark = function(qid) {
      if (!localProgress.bookmarks) localProgress.bookmarks = {};
      if (localProgress.bookmarks[qid]) {
        delete localProgress.bookmarks[qid];
      } else {
        localProgress.bookmarks[qid] = true;
      }
      saveProgress();
      renderQuestion();
    };

    // check-fitb action
    $('q-area').addEventListener('click', e => {
      const btn = e.target.closest('button[data-study-btn="check-fitb"]');
      if (!btn) return;
      const sk = btn.getAttribute('data-qid');
      const input = document.getElementById('fitb-' + sk);
      if (!input) return;
      fitbMap[sk] = input.value;
      fitbMap[sk + '_graded'] = true;
      renderQuestion();
    });

    function applyQuestionFilters() {
      const term = ($('q-search').value || '').toLowerCase();
      filteredQs = (currentSubtopic.questions || []).filter(q => {
        if (filterBookmarks && (!localProgress.bookmarks || !localProgress.bookmarks[q.id])) return false;
        if (!term) return true;
        const stripped = (q.question || '').replace(/<[^>]+>/g, '').toLowerCase();
        return stripped.includes(term);
      });
      currentQIdx = 0;
      resetAllMaps();
      renderQuestion();
      if (document.querySelector('.tab-btn.active')?.dataset.tab === 'view') renderViewList();
    }

    $('btn-prev').addEventListener('click', () => { currentQIdx--; renderQuestion(); });
    $('btn-next').addEventListener('click', () => { currentQIdx++; renderQuestion(); });

    $('q-search').addEventListener('input', () => applyQuestionFilters());

    $('btn-filter-bookmarks').addEventListener('click', (e) => {
      filterBookmarks = !filterBookmarks;
      e.target.innerHTML = filterBookmarks ? '★' : '☆';
      e.target.style.color = filterBookmarks ? 'var(--amber)' : 'var(--text)';
      applyQuestionFilters();
    });

    // ─── KEYBOARD NAVIGATION ───
    document.addEventListener('keydown', e => {
      // Ignore shortcuts if typing in an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      if ($('gsearch-overlay').classList.contains('open')) return;
      
      const isQuizMode = $('quiz-area').style.display === 'flex';
      
      if (e.key === 'ArrowLeft') {
        if (!isQuizMode && currentQIdx > 0) { currentQIdx--; renderQuestion(); }
      } else if (e.key === 'ArrowRight') {
        if (!isQuizMode && currentQIdx < filteredQs.length - 1) { currentQIdx++; renderQuestion(); }
      } else if (e.key === ' ') {
        e.preventDefault();
        // Find Check or Reveal button and click it
        const checkBtn = document.querySelector('button[data-study-btn="check"]');
        const revealBtn = document.querySelector('button[data-study-btn="reveal"]');
        const resetBtn = document.querySelector('button[data-study-btn="reset"]');
        if (checkBtn) checkBtn.click();
        else if (revealBtn) revealBtn.click();
        else if (resetBtn) resetBtn.click();
      } else if (/^[1-9]$/.test(e.key)) {
        // Select option 1-9
        const idx = parseInt(e.key) - 1;
        const options = document.querySelectorAll('.q-option');
        if (options && options[idx]) {
          // Trigger click
          options[idx].click();
        }
      }
    });

    // ─── TABS ───
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    function switchTab(tab) {
      document.body.classList.toggle('quiz-mode-active', tab === 'quiz');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      if (tab === 'view') renderViewList();
    }

    // ─── QUIZ MODE ───
    function setupQuizSetup() {
      $('quiz-area').style.display = 'none';
      $('quiz-results').style.display = 'none';
      $('quiz-setup').style.display = 'block';
      const maxQ = (currentSubtopic.questions || []).length;
      $('quiz-count').max = maxQ;
      $('quiz-count').value = Math.min(10, maxQ);
    }

    $('btn-start-quiz').addEventListener('click', () => {
      const n = Math.min(parseInt($('quiz-count').value) || 10, (currentSubtopic.questions || []).length);
      const pool = shuffle((currentSubtopic.questions || []).slice()).slice(0, n);
      quizQs = pool;
      quizAnswers = {};
      quizSataSelections = {};
      $('quiz-setup').style.display = 'none';
      $('quiz-results').style.display = 'none';
      renderQuizArea();
    });

    $('btn-start-smart-quiz').addEventListener('click', () => {
      if (!currentSubtopic) return;
      const stId = currentSubtopic.id;
      const prog = localProgress.exams[stId] || { seenQs: [], answeredQs: {} };
      
      const smartPool = (currentSubtopic.questions || []).filter(q => {
        const unseen = !prog.seenQs.includes(q.id);
        const incorrect = prog.answeredQs[q.id] && prog.answeredQs[q.id].correct === false;
        return unseen || incorrect;
      });
      
      if (smartPool.length === 0) {
        alert("You've correctly answered all questions in this exam! Starting a random review quiz instead.");
        $('btn-start-quiz').click();
        return;
      }
      
      const n = Math.min(parseInt($('quiz-count').value) || 10, smartPool.length);
      quizQs = shuffle(smartPool).slice(0, n);
      quizAnswers = {};
      quizSataSelections = {};
      $('quiz-setup').style.display = 'none';
      $('quiz-results').style.display = 'none';
      renderQuizArea();
    });

    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function renderQuizArea() {
      const area = $('quiz-area');
      area.style.display = 'flex';
      area.innerHTML = '';

      quizQs.forEach((q, idx) => {
        let opts = {};
        try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const correctKeys = parseCorrectKeys(q);
        const isSata = correctKeys.size > 1;
        const qsk = storeQid(q.id);
        const chosen = quizAnswers[qsk];
        const sataSel = quizSataSelections[qsk] || new Set();

        let optHtml = '';
        Object.entries(opts).forEach(([key, val]) => {
          let cls = '';
          if (isSata) {
            if (sataSel.has(key)) cls = 'sata-picked';
          } else if (chosen) {
            const c1 = getSingleCorrectKey(q);
            if (c1 != null && key === c1) cls = 'revealed-correct';
            if (key === chosen && (c1 == null || chosen !== c1)) cls = 'wrong';
          }
          const keyEnc = encodeURIComponent(key);
          optHtml += `<div class="q-option ${cls}" role="button" tabindex="0" data-opt-key="${keyEnc}">
        <div class="q-opt-key">${key}</div>
        <div class="q-opt-text">${val.choice || ''}</div>
      </div>`;
        });

        const sataNote = isSata ? '<p class="sata-hint" style="margin:0 0 12px;">Select all that apply, then submit the whole quiz.</p>' : '';

        const card = document.createElement('div');
        card.className = 'q-card';
        card.id = `qz-${q.id}`;
        card.innerHTML = `
      <div class="q-card-head"><span class="q-num">Q${idx + 1}</span></div>
      <div class="q-body">
        <div class="q-text">${q.question || ''}</div>
        ${sataNote}
        <div class="q-options">${optHtml}</div>
      </div>`;
        area.appendChild(card);
      });

      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn primary';
      submitBtn.style.alignSelf = 'flex-start';
      submitBtn.textContent = 'Submit quiz';
      submitBtn.addEventListener('click', submitQuiz);
      area.appendChild(submitBtn);
    }

    window.quizPick = function (qid, key) {
      const sk = storeQid(qid);
      if (quizAnswers[sk]) return;
      quizAnswers[sk] = key;
      const q = quizQs.find(x => String(x.id) === String(qid));
      const card = q ? $(`qz-${q.id}`) : null;
      if (!card) return;
      const c1 = q ? getSingleCorrectKey(q) : null;
      card.querySelectorAll('.q-option').forEach(opt => {
        const k = decodeURIComponent(opt.getAttribute('data-opt-key') || '');
        if (c1 != null && k === c1) opt.classList.add('revealed-correct');
        if (k === key && (c1 == null || key !== c1)) opt.classList.add('wrong');
        opt.style.pointerEvents = 'none';
      });
    };

    window.quizSataToggle = function (qid, key) {
      const sk = storeQid(qid);
      if (!quizSataSelections[sk]) quizSataSelections[sk] = new Set();
      const s = quizSataSelections[sk];
      if (s.has(key)) s.delete(key);
      else s.add(key);
      renderQuizArea();
    };

    function submitQuiz() {
      let correct = 0;
      quizQs.forEach(q => {
        const ck = parseCorrectKeys(q);
        if (ck.size > 1) {
          const sel = quizSataSelections[storeQid(q.id)] || new Set();
          if (setsEqual(sel, ck)) correct++;
        } else {
          const ans = quizAnswers[storeQid(q.id)];
          const c1 = getSingleCorrectKey(q);
          if (c1 != null && ans === c1) correct++;
        }
      });
      const total = quizQs.length;
      const pct = Math.round(correct / total * 100);

      $('quiz-area').style.display = 'none';
      const res = $('quiz-results');
      res.style.display = 'block';
      res.innerHTML = `
    <div class="score-strip">
      <div>
        <div class="sc-lbl">Score</div>
        <div class="sc-val" style="color:${pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)'}">${pct}%</div>
      </div>
      <div style="color:var(--text2);font-size:13px;">${correct} of ${total} correct</div>
      <button class="btn" style="margin-left:auto;" onclick="setupQuizSetup()">Try again</button>
    </div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:12px;">
      ${quizQs.map((q, i) => {
        let opts = {};
        try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const ck = parseCorrectKeys(q);
        const isSata = ck.size > 1;
        const qsk = storeQid(q.id);
        const chosen = quizAnswers[qsk];
        const sataSel = quizSataSelections[qsk] || new Set();
        const isCorrect = isSata ? setsEqual(sataSel, ck) : (getSingleCorrectKey(q) != null && chosen === getSingleCorrectKey(q));
        return `<div class="q-card">
          <div class="q-card-head">
            <span class="q-num">Q${i + 1}</span>
            ${isCorrect ? '<span class="q-answered-badge correct">✓ Correct</span>' : '<span class="q-answered-badge wrong">✗ Incorrect</span>'}
          </div>
          <div class="q-body">
            <div class="q-text">${q.question || ''}</div>
            <div class="q-options">
              ${Object.entries(opts).map(([k, v]) => {
          let cls = '';
          if (isSata) {
            const ok = ck.has(k);
            const picked = sataSel.has(k);
            if (ok && picked) cls = 'revealed-correct';
            else if (ok && !picked) cls = 'sata-missed';
            else if (!ok && picked) cls = 'wrong';
          } else {
            const c1 = getSingleCorrectKey(q);
            cls = (c1 != null && k === c1) ? 'revealed-correct' : (k === chosen && chosen !== c1 ? 'wrong' : '');
          }
          return `<div class="q-option ${cls}">
                  <div class="q-opt-key">${k}</div>
                  <div style="flex:1;">
                    <div class="q-opt-text">${v.choice || ''}</div>
                    <div class="q-opt-reason show">${v.reason || ''}</div>
                  </div>
                </div>`;
        }).join('')}
            </div>
            <div class="q-solution show">
              <div class="q-solution-title">Explanation</div>
              <div class="q-solution-text">${q.solution || 'No explanation provided.'}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
    }

    // ─── OVERVIEW ───
    function buildOverview() {
      const catData = DATA.categories.map(cat => ({
        name: cat.name,
        exams: cat.subtopics.length,
        questions: cat.subtopics.reduce((a, s) => a + (s.questions || []).length, 0)
      })).filter(c => c.questions > 0).sort((a, b) => b.questions - a.questions);

      const totalCats = catData.length;
      const totalExams = DATA.categories.reduce((a, c) => a + c.subtopics.length, 0);
      const totalQs = allQuestions.length;
      const avgPerExam = totalExams > 0 ? Math.round(totalQs / totalExams) : 0;

      let totalSeen = 0;
      let totalCorrect = 0;
      let totalAnswered = 0;
      Object.values(localProgress.exams || {}).forEach(p => {
        totalSeen += (p.seenQs ? p.seenQs.length : 0);
        if (p.answeredQs) {
          Object.values(p.answeredQs).forEach(a => {
            totalAnswered++;
            if (a.correct) totalCorrect++;
          });
        }
      });
      const globalAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
      const seenPct = totalQs > 0 ? Math.round((totalSeen / totalQs) * 100) : 0;
      const bookmarksCount = Object.keys(localProgress.bookmarks || {}).length;

      $('stat-grid').innerHTML = `
    <div class="stat-card" style="border-color:var(--amber);"><div class="s-label" style="color:var(--amber);">Global Accuracy</div><div class="s-val">${globalAccuracy}%</div><div class="s-sub">${totalCorrect} of ${totalAnswered} correct</div></div>
    <div class="stat-card" style="border-color:var(--accent);"><div class="s-label" style="color:var(--accent);">Study Progress</div><div class="s-val">${seenPct}%</div><div class="s-sub">${totalSeen.toLocaleString()} qs seen</div></div>
    <div class="stat-card" style="border-color:var(--purple);"><div class="s-label" style="color:var(--purple);">Bookmarks</div><div class="s-val">${bookmarksCount}</div><div class="s-sub">flagged questions</div></div>
    <div class="stat-card"><div class="s-label">Exams</div><div class="s-val">${totalExams}</div><div class="s-sub">practice sets</div></div>
    <div class="stat-card"><div class="s-label">Questions</div><div class="s-val">${totalQs.toLocaleString()}</div><div class="s-sub">total questions</div></div>
  `;

      const maxQ = catData[0]?.questions || 1;
      const colors = ['#5b8dee', '#3ecf8e', '#9b7cf0', '#f5a623', '#e879a0', '#1ec8a8', '#f05252', '#60a5fa', '#fb923c', '#a3e635'];

      $('bar-chart').innerHTML = catData.map((cat, i) => {
        const pct = (cat.questions / maxQ * 100).toFixed(1);
        const color = colors[i % colors.length];
        return `<div class="bar-row">
      <div class="bar-label" title="${cat.name}">${cat.name}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color};">
          <span style="color:#fff;">${cat.questions.toLocaleString()}</span>
        </div>
      </div>
    </div>`;
      }).join('');
    }

    // ─── GLOBAL LIVE SEARCH ───
    const GSEARCH_PAGE_SIZE = 80;
    let gsearchActive = -1;
    let gsearchMatches = [];
    let gsearchPage = 0;
    /** @type {Set<string>|null} null = all categories */
    let gsearchCats = null;
    let gsearchDebounce = null;

    function openGSearch() {
      $('gsearch-overlay').classList.add('open');
      $('gsearch-panel-input').focus();
      $('gsearch-panel-input').value = '';
      gsearchCats = null;
      syncGSearchChipStyles();
      renderGSearchResults('', 0);
    }

    function openGSearchPrefilled(term) {
      $('gsearch-overlay').classList.add('open');
      $('gsearch-panel-input').value = term;
      $('gsearch-panel-input').focus();
      renderGSearchResults(term, 0);
    }

    function closeGSearch() {
      $('gsearch-overlay').classList.remove('open');
      gsearchActive = -1;
    }

    $('gsearch-input').addEventListener('click', openGSearch);
    $('gsearch-input').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openGSearch(); });
    $('gsearch-kbd').addEventListener('click', openGSearch);
    $('gsearch-overlay').addEventListener('mousedown', e => { if (e.target === $('gsearch-overlay')) closeGSearch(); });

    $('gsearch-panel-input').addEventListener('input', e => {
      clearTimeout(gsearchDebounce);
      gsearchDebounce = setTimeout(() => renderGSearchResults(e.target.value, 0), 120);
    });

    $('gsearch-panel-input').addEventListener('keydown', e => {
      const items = $('gsearch-results').querySelectorAll('.gs-result');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!items.length) return;
        gsearchActive = Math.min(gsearchActive + 1, items.length - 1);
        highlightGResult(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        gsearchActive = Math.max(gsearchActive - 1, 0);
        highlightGResult(items);
      } else if (e.key === 'Enter') { e.preventDefault(); if (gsearchActive >= 0 && items[gsearchActive]) items[gsearchActive].click(); }
      else if (e.key === 'Escape') closeGSearch();
    });

    $('gsearch-prev-page').addEventListener('click', () => {
      if (gsearchPage > 0) renderGSearchResults($('gsearch-panel-input').value, gsearchPage - 1);
    });
    $('gsearch-next-page').addEventListener('click', () => {
      renderGSearchResults($('gsearch-panel-input').value, gsearchPage + 1);
    });

    function highlightGResult(items) {
      items.forEach((el, i) => el.classList.toggle('gs-result-focused', i === gsearchActive));
      if (items[gsearchActive]) items[gsearchActive].scrollIntoView({ block: 'nearest' });
    }

    function syncGSearchChipStyles() {
      document.querySelectorAll('#gsearch-filters .gs-chip').forEach(btn => {
        const c = btn.dataset.cat;
        if (c === '') btn.classList.toggle('active', gsearchCats === null);
        else btn.classList.toggle('active', gsearchCats !== null && gsearchCats.has(c));
      });
    }

    function buildGSearchFilters() {
      const filters = $('gsearch-filters');
      const cats = [...new Set(allQuestions.map(q => q._cat))].sort();
      filters.innerHTML = '<span class="gs-filter-label">Categories:</span>';
      gsearchCats = null;

      const allBtn = document.createElement('button');
      allBtn.className = 'gs-chip active';
      allBtn.dataset.cat = '';
      allBtn.type = 'button';
      allBtn.textContent = 'All';
      allBtn.addEventListener('click', () => {
        gsearchCats = null;
        syncGSearchChipStyles();
        renderGSearchResults($('gsearch-panel-input').value, 0);
      });
      filters.appendChild(allBtn);

      cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'gs-chip';
        btn.dataset.cat = cat;
        btn.type = 'button';
        btn.textContent = cat;
        btn.addEventListener('click', () => {
          if (gsearchCats === null) gsearchCats = new Set();
          if (gsearchCats.has(cat)) {
            gsearchCats.delete(cat);
            if (gsearchCats.size === 0) gsearchCats = null;
          } else {
            gsearchCats.add(cat);
          }
          syncGSearchChipStyles();
          renderGSearchResults($('gsearch-panel-input').value, 0);
        });
        filters.appendChild(btn);
      });
    }

    function stripHtml(html) {
      return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function highlight(text, term) {
      if (!term) return text;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
    }

    function getGSearchPool() {
      if (gsearchCats === null || gsearchCats.size === 0) return allQuestions;
      return allQuestions.filter(x => gsearchCats.has(x._cat));
    }

    function renderGSearchResults(term, page = 0) {
      const q = term.trim().toLowerCase();
      const resultsEl = $('gsearch-results');
      const pagerEl = $('gsearch-pager');
      gsearchActive = -1;

      if (!q) {
        resultsEl.innerHTML = '<div class="gs-empty"><strong>Start typing</strong>Search across all questions, answer choices, and explanations.</div>';
        $('gsearch-count').textContent = '';
        pagerEl.classList.remove('visible');
        gsearchMatches = [];
        return;
      }

      const pool = getGSearchPool();
      gsearchMatches = [];
      for (let i = 0; i < pool.length; i++) {
        const aq = pool[i];
        const qText = stripHtml(aq.question);
        const solText = stripHtml(aq.solution);
        let optText = '';
        try { const o = JSON.parse(aq.options || '{}'); optText = Object.values(o).map(v => stripHtml(v.choice)).join(' '); } catch (e) { }
        const combined = (qText + ' ' + optText + ' ' + solText).toLowerCase();
        if (combined.includes(q)) {
          gsearchMatches.push({ q: aq, qText, solText, optText });
        }
      }

      const total = gsearchMatches.length;
      let totalPages = Math.ceil(total / GSEARCH_PAGE_SIZE) || 1;
      let p = page;
      if (p < 0) p = 0;
      if (p >= totalPages) p = totalPages - 1;
      gsearchPage = p;

      const start = p * GSEARCH_PAGE_SIZE;
      const results = gsearchMatches.slice(start, start + GSEARCH_PAGE_SIZE);

      if (totalPages > 1) {
        $('gsearch-count').textContent = `${start + 1}–${start + results.length} of ${total.toLocaleString()}`;
      } else {
        $('gsearch-count').textContent = `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`;
      }

      if (!results.length) {
        resultsEl.innerHTML = `<div class="gs-empty"><strong>No results</strong>Nothing matched "${term}". Try different keywords or categories.</div>`;
        pagerEl.classList.remove('visible');
        return;
      }

      if (totalPages > 1) {
        pagerEl.classList.add('visible');
        $('gsearch-prev-page').disabled = p <= 0;
        $('gsearch-next-page').disabled = p >= totalPages - 1;
        $('gsearch-page-label').textContent = `Page ${p + 1} / ${totalPages}`;
      } else {
        pagerEl.classList.remove('visible');
      }

      resultsEl.innerHTML = '';
      results.forEach(({ q: aq, qText, solText }) => {
        const el = document.createElement('div');
        el.className = 'gs-result';

        const snippet = qText.length > 160 ? qText.slice(0, 160) + '…' : qText;
        let opts = {};
        try { opts = JSON.parse(aq.options || '{}'); } catch (e) { }
        const ckeys = parseCorrectKeys(aq);
        let correctPreview = '';
        if (ckeys.size > 1) {
          correctPreview = [...ckeys].map(k => stripHtml((opts[k] && opts[k].choice) || k)).join(' · ');
        } else if (ckeys.size === 1) {
          const only = [...ckeys][0];
          correctPreview = stripHtml((opts[only] && opts[only].choice) || only);
        }

        el.innerHTML = `
      <div class="gs-result-breadcrumb">
        <span class="gs-cat-tag">${aq._cat}</span>
        <span class="gs-sep">›</span>
        <span class="gs-sub-tag">${aq._subtopic}</span>
      </div>
      <div class="gs-result-text">${highlight(snippet, term.trim())}</div>
      <div class="gs-result-meta">
        ${correctPreview ? `<span class="gs-correct-tag">✓ ${correctPreview.slice(0, 80)}${correctPreview.length > 80 ? '…' : ''}</span>` : ''}
        <span class="gs-opt-preview">ID: ${aq.id}</span>
      </div>`;

        el.addEventListener('click', () => {
          closeGSearch();
          jumpToQuestion(aq);
        });
        resultsEl.appendChild(el);
      });
    }

    function jumpToQuestion(targetQ) {
      // Find its category and subtopic
      let foundCat = null, foundSt = null;
      for (const cat of DATA.categories) {
        for (const st of cat.subtopics) {
          if ((st.questions || []).some(q => q.id === targetQ.id)) {
            foundCat = cat; foundSt = st; break;
          }
        }
        if (foundSt) break;
      }
      if (!foundSt) return;

      // Open subtopic in sidebar (find the item)
      $('sidebar-search').value = '';
      renderCatList('');

      // Small delay for DOM to render
      setTimeout(() => {
        const allItems = document.querySelectorAll('.subtopic-item');
        let targetItem = null;
        allItems.forEach(item => {
          if (String(item.dataset.stId) === String(foundSt.id)) targetItem = item;
        });
        if (targetItem) {
          // Expand category
          targetItem.closest('.subtopic-list')?.classList.add('open');
          const toggle = targetItem.closest('.subtopic-list')?.previousElementSibling?.querySelector('.cat-toggle');
          if (toggle) toggle.classList.add('open');
          openSubtopic(foundCat, foundSt, targetItem);
          // Jump to specific question
          const idx = foundSt.questions.findIndex(q => q.id === targetQ.id);
          if (idx >= 0) { currentQIdx = idx; renderQuestion(); }
          targetItem.scrollIntoView({ block: 'nearest' });
        }
      }, 50);
    }

    // ─── keyboard nav
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openGSearch(); return; }
      if (e.key === 'Escape' && $('gsearch-overlay').classList.contains('open')) { closeGSearch(); return; }
      if (!currentSubtopic) return;
      const active = document.querySelector('.tab-btn.active');
      if (active && active.dataset.tab !== 'study') return;
      if (e.key === 'ArrowRight') { currentQIdx++; renderQuestion(); return; }
      if (e.key === 'ArrowLeft') { currentQIdx--; renderQuestion(); return; }
      const q = filteredQs[currentQIdx];
      if (!q) return;
      const opts = parseOptionKeys(q);
      const optKey = matchOptionKeyFromKeystroke(e, opts);
      if (!optKey) return;
      const sk = storeQid(q.id);
      if (isSelectAllThatApply(q)) {
        if (revealedMap[sk] || multiGradedMap[sk]) return;
      } else {
        if (chosenMap[sk] || revealedMap[sk]) return;
      }
      e.preventDefault();
      handleOptionClick(q.id, optKey);
    });

    $('q-area').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const opt = e.target.closest('.q-option');
      if (!opt || !$('q-area').contains(opt)) return;
      e.preventDefault();
      opt.click();
    });

    // ─── ANKI VIEW LOGIC ───
    let ankiTreeBuilt = false;

    $('btn-sidebar-anki').addEventListener('click', () => {
      if (window.innerWidth <= 900) {
        $('sidebar').classList.remove('open');
        $('sidebar-overlay').classList.remove('open');
      }
      $('overview').style.display = 'none';
      $('exam-view').classList.remove('visible');
      $('anki-view').style.display = 'flex';

      document.querySelectorAll('.subtopic-item').forEach(el => el.classList.remove('active'));

      if (!ankiTreeBuilt) {
        buildAnkiTree();
        ankiTreeBuilt = true;
      }
      updateAnkiCount();
    });

    function buildAnkiTree() {
      const container = $('anki-tree-container');
      let html = '';

      DATA.categories.forEach((cat, ci) => {
        if (!cat.subtopics || !cat.subtopics.length) return;

        let catHtml = `<details class="anki-details"><summary class="anki-summary"><input type="checkbox" class="anki-cb anki-cb-cat" data-cat-idx="${ci}"> <strong>${escapeHtmlAttr(cat.name)}</strong></summary>`;

        cat.subtopics.forEach((st, si) => {
          if (!st.questions || !st.questions.length) return;

          let stHtml = `<details class="anki-details"><summary class="anki-summary"><input type="checkbox" class="anki-cb anki-cb-st" data-cat-idx="${ci}" data-st-idx="${si}"> <strong>${escapeHtmlAttr(st.name)}</strong> (${st.questions.length} qs)</summary>`;

          st.questions.forEach((q) => {
            const tid = q.question_type_id;
            const typeName = TYPE_LABELS[tid] || `Type ${tid}`;
            const qtext = escapeHtmlAttr((q.question || '').slice(0, 100)) + ((q.question || '').length > 100 ? '...' : '');

            stHtml += `<div class="anki-q-item">
              <input type="checkbox" class="anki-cb anki-cb-q" data-qid="${q.id}">
              <div>
                <div style="font-size:11px;color:var(--purple);margin-bottom:2px;">ID ${q.id} · ${typeName}</div>
                <div>${qtext}</div>
              </div>
            </div>`;
          });

          stHtml += `</details>`;
          catHtml += stHtml;
        });

        catHtml += `</details>`;
        html += catHtml;
      });

      container.innerHTML = html;

      container.addEventListener('change', (e) => {
        if (!e.target.classList.contains('anki-cb')) return;

        const isChecked = e.target.checked;

        if (e.target.classList.contains('anki-cb-cat')) {
          const details = e.target.closest('details');
          details.querySelectorAll('.anki-cb').forEach(cb => cb.checked = isChecked);
        } else if (e.target.classList.contains('anki-cb-st')) {
          const details = e.target.closest('details');
          details.querySelectorAll('.anki-cb').forEach(cb => cb.checked = isChecked);
        }
        syncAnkiTreeState();
        updateAnkiCount();
      });
    }

    function syncAnkiTreeState() {
      document.querySelectorAll('.anki-cb-cat').forEach(catCb => {
        const catDet = catCb.closest('details');

        const stCbs = Array.from(catDet.querySelectorAll('.anki-cb-st'));
        stCbs.forEach(stCb => {
          const stDet = stCb.closest('details');
          const qCbs = Array.from(stDet.querySelectorAll('.anki-cb-q'));
          if (qCbs.length) {
            stCb.checked = qCbs.every(cb => cb.checked);
            stCb.indeterminate = !stCb.checked && qCbs.some(cb => cb.checked);
          }
        });

        if (stCbs.length) {
          catCb.checked = stCbs.every(cb => cb.checked);
          catCb.indeterminate = !catCb.checked && stCbs.some(cb => cb.checked || cb.indeterminate);
        }
      });
    }

    function updateAnkiCount() {
      const count = document.querySelectorAll('.anki-cb-q:checked').length;
      $('anki-sel-count').textContent = `${count} question${count === 1 ? '' : 's'} selected`;
    }

    $('btn-anki-sel-all').addEventListener('click', () => {
      document.querySelectorAll('.anki-cb').forEach(cb => { cb.checked = true; cb.indeterminate = false; });
      updateAnkiCount();
    });

    $('btn-anki-desel-all').addEventListener('click', () => {
      document.querySelectorAll('.anki-cb').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
      updateAnkiCount();
    });

    $('btn-anki-export').addEventListener('click', () => {
      const selectedCb = document.querySelectorAll('.anki-cb-q:checked');
      if (!selectedCb.length) return alert('No questions selected for export.');

      const selectedIds = Array.from(selectedCb).map(cb => cb.dataset.qid);
      const qsToExport = allQuestions.filter(q => selectedIds.includes(String(q.id)));

      const tsvContent = generateAnkiTSV(qsToExport);

      const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `anki_export_${Date.now()}.tsv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    function cleanHTMLForAnki(htmlStr) {
      if (!htmlStr) return '';
      return htmlStr.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '').trim();
    }

    function generateAnkiTSV(qs) {
      let rows = [];
      qs.forEach(q => {
        const tid = q.question_type_id;
        const typeName = TYPE_LABELS[tid] || `Type ${tid}`;

        let frontHtml = `<div style="font-size:12px; color:#888; margin-bottom:10px;">ID ${q.id} | ${typeName}</div>`;
        frontHtml += `<div>${q.question || ''}</div>`;

        const tabs = parseTabs(q);
        if (tabs) {
          let parsedTabs = typeof tabs === 'string' ? safeParseJSON(tabs) : tabs;
          if (parsedTabs && typeof parsedTabs === 'object') {
            Object.keys(parsedTabs).forEach(k => {
              frontHtml += `<div style="margin-top:10px; padding:10px; background:#f0f0f0; color:#000;"><strong>${k}</strong><br>${parsedTabs[k]}</div>`;
            });
          }
        }

        let opts = {}; try { opts = JSON.parse(q.options || '{}'); } catch (e) { }
        const optKeys = Object.keys(opts);
        if (optKeys.length > 0 && typeof opts[optKeys[0]] === 'object' && opts[optKeys[0]] !== null && 'choice' in opts[optKeys[0]]) {
          frontHtml += `<div style="margin-top:12px;">`;
          optKeys.forEach(k => {
            const choiceText = opts[k].choice;
            if (choiceText) {
              frontHtml += `<div style="margin-bottom:6px;"><strong>${k})</strong> ${choiceText}</div>`;
            }
          });
          frontHtml += `</div>`;
        }

        let backHtml = buildViewAnswerBlock(q);
        if (q.solution) {
          backHtml += `<div style="margin-top:16px;"><strong>Explanation:</strong><br>${q.solution}</div>`;
        }

        const front = cleanHTMLForAnki(frontHtml);
        const back = cleanHTMLForAnki(backHtml);

        rows.push(`${front}\t${back}`);
      });
      return rows.join('\n');
    }

    tryLoadArchiveFromQuery().then(() => {
      if ($('drop-zone').style.display !== 'none') {
        initDropZone();
      }
    });

    // Mobile Sidebar Toggle
    const btnSidebarToggle = $('btn-sidebar-toggle');
    const sidebarOverlay = $('sidebar-overlay');
    if (btnSidebarToggle && sidebarOverlay) {
      btnSidebarToggle.addEventListener('click', () => {
        $('sidebar').classList.add('open');
        sidebarOverlay.classList.add('open');
      });
      sidebarOverlay.addEventListener('click', () => {
        $('sidebar').classList.remove('open');
        sidebarOverlay.classList.remove('open');
      });
      
      if ($('btn-sidebar-close')) {
        $('btn-sidebar-close').addEventListener('click', () => {
          $('sidebar').classList.remove('open');
          sidebarOverlay.classList.remove('open');
        });
      }
    }
