// content/downloader.js — Blackboard+ PDF scanner & download panel
// Supports Classic and Ultra Blackboard Learn via REST API + DOM fallback.

(function () {
  'use strict';

  if (window.__bbplusDownloader) return;
  window.__bbplusDownloader = true;
  if (window !== window.top) return;

  // ── Constants ──────────────────────────────────────────────

  const PANEL_ID = 'bbplus-panel';
  const BTN_ID = 'bbplus-btn';
  const CSS_ID = 'bbplus-css';

  // ── Course detection ───────────────────────────────────────

  function getCourseId() {
    const href = location.href;
    let m;
    // Ultra: /ultra/courses/_123_1/...
    m = href.match(/\/ultra\/courses\/([^/?#]+)/);
    if (m) return m[1];
    // Classic: course_id=_123_1
    m = href.match(/course_id=([^&#]+)/);
    if (m) return m[1];
    // Generic: /courses/_123_1
    m = href.match(/\/courses\/([^/?#]+)/);
    if (m) return m[1];
    return null;
  }

  function getCourseName() {
    const selectors = [
      '[data-testid="course-name"]',
      '#courseMenuPalette_paletteTitleHeading',
      '.course-title',
      '#breadcrumbs li:last-child',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 1) return sanitize(text);
    }
    return sanitize(document.title.split(/[:|—–]/)[0] || 'Course');
  }

  function sanitize(s) {
    return s.replace(/[<>:"/\\|?*]/g, '_').trim().slice(0, 60);
  }

  function escHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── API helpers ────────────────────────────────────────────

  async function apiFetch(url) {
    const full = url.startsWith('http') ? url : location.origin + url;
    const resp = await fetch(full, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function apiFetchAll(url) {
    const results = [];
    let next = url;
    let guard = 0;
    while (next && guard++ < 30) {
      const data = await apiFetch(next);
      const items = data.results || (Array.isArray(data) ? data : []);
      results.push(...items);
      next = data.paging?.nextPage || null;
    }
    return results;
  }

  // ── REST API scanner (primary) ─────────────────────────────

  async function scanAPI(courseId, onProgress) {
    let topLevel;
    try {
      onProgress('Conectando a API...', 0, 1);
      topLevel = await apiFetchAll(
        `/learn/api/public/v1/courses/${courseId}/contents`
      );
    } catch {
      return null; // API unavailable, caller uses DOM fallback
    }

    const files = [];
    await walkItems(courseId, topLevel, '', files, onProgress, 0);
    return dedup(files);
  }

  async function walkItems(courseId, items, parent, files, onProgress, depth) {
    if (depth > 6) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = item.title || 'Sem titulo';
      const section = parent ? `${parent} > ${title}` : title;
      onProgress(section, i + 1, items.length);

      // Attachments
      try {
        const atts = await apiFetchAll(
          `/learn/api/public/v1/courses/${courseId}/contents/${item.id}/attachments`
        );
        for (const att of atts) {
          if (!isPDF(att.fileName, att.mimeType)) continue;
          files.push({
            url: `${location.origin}/learn/api/public/v1/courses/${courseId}/contents/${item.id}/attachments/${att.id}/download`,
            filename: att.fileName || 'arquivo.pdf',
            section,
          });
        }
      } catch { /* no attachments */ }

      // Embedded links in body HTML
      if (item.body) {
        for (const f of extractPDFsFromHTML(item.body)) {
          f.section = section;
          files.push(f);
        }
      }

      // Recurse into folders/modules
      const handler = (item.contentHandler?.id || '').toLowerCase();
      if (handler.includes('folder') || handler.includes('module') || handler.includes('container')) {
        try {
          const children = await apiFetchAll(
            `/learn/api/public/v1/courses/${courseId}/contents/${item.id}/children`
          );
          await walkItems(courseId, children, section, files, onProgress, depth + 1);
        } catch { /* no children */ }
      }
    }
  }

  // ── DOM scanner (fallback) ─────────────────────────────────

  async function scanDOM(courseId, onProgress) {
    const files = [];
    const visited = new Set();

    onProgress('Escaneando pagina...', 0, 1);
    extractPDFsFromDoc(document, files, '');

    const contentLinks = findContentLinks();
    for (let i = 0; i < contentLinks.length; i++) {
      const link = contentLinks[i];
      if (visited.has(link.url)) continue;
      visited.add(link.url);
      onProgress(link.name || `Pagina ${i + 1}`, i + 1, contentLinks.length);

      try {
        const html = await (await fetch(link.url, { credentials: 'include' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        extractPDFsFromDoc(doc, files, link.name);

        // discover nested pages
        doc.querySelectorAll('a[href*="listContent"], a[href*="content_id"]').forEach((a) => {
          try {
            const full = new URL(a.href, location.origin).href;
            if (!visited.has(full)) {
              visited.add(full);
              contentLinks.push({ url: full, name: `${link.name} > ${a.textContent.trim()}` });
            }
          } catch { /* skip */ }
        });
      } catch { /* network error */ }
    }

    return dedup(files);
  }

  function findContentLinks() {
    const links = [];
    const seen = new Set();
    const selectors = [
      '#courseMenuPalette_contents a',
      '.courseMenu a',
      'a[href*="listContent"]',
      'a[href*="listContentEditable"]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((a) => {
        if (a.href && !seen.has(a.href)) {
          seen.add(a.href);
          links.push({ url: a.href, name: a.textContent.trim() });
        }
      });
    }
    return links;
  }

  function extractPDFsFromDoc(doc, out, section) {
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href || a.getAttribute('href') || '';
      if (!href) return;
      try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin) return;
        const isDownload =
          /\/bbcswebdav\//i.test(url.pathname) ||
          /\/xythoswfs\//i.test(url.pathname) ||
          \.pdf$/i.test(url.pathname);
        if (!isDownload) return;
        const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
        if (!filename || !isPDF(filename, '')) return;
        out.push({ url: url.href, filename, section });
      } catch { /* bad URL */ }
    });

    // Classic onclick pattern
    doc.querySelectorAll('a[onclick]').forEach((a) => {
      const m = (a.getAttribute('onclick') || '').match(/['"](\/bbcswebdav\/[^'"]+\.pdf)['"]/i);
      if (m) {
        const filename = decodeURIComponent(m[1].split('/').pop() || '');
        if (filename) {
          out.push({ url: location.origin + m[1], filename, section });
        }
      }
    });
  }

  function extractPDFsFromHTML(html) {
    const out = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      extractPDFsFromDoc(doc, out, '');
    } catch { /* parse error */ }
    return out;
  }

  function isPDF(filename, mime) {
    if (mime && mime.includes('pdf')) return true;
    return \.pdf$/i.test(filename || '');
  }

  function dedup(files) {
    const seen = new Set();
    return files.filter((f) => {
      const key = f.url.replace(/\?.*$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Combined scanner ───────────────────────────────────────

  async function scanCourse(courseId, onProgress) {
    const apiResult = await scanAPI(courseId, onProgress);
    if (apiResult && apiResult.length > 0) return apiResult;
    return scanDOM(courseId, onProgress);
  }

  // ── UI: Panel ──────────────────────────────────────────────

  let allFiles = [];

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bp-header">
        <span class="bp-title">Blackboard+ PDF</span>
        <button class="bp-close" title="Fechar">&times;</button>
      </div>

      <div class="bp-scan" id="bp-scan">
        <p class="bp-scan-msg">Escaneia todos os modulos do curso e lista os PDFs.</p>
        <button class="bp-scan-btn" id="bp-scan-btn">Escanear curso</button>
        <div class="bp-progress" id="bp-scan-progress" hidden>
          <div class="bp-bar"><div class="bp-fill" id="bp-scan-fill"></div></div>
          <span class="bp-ptext" id="bp-scan-text">Iniciando...</span>
        </div>
      </div>

      <div class="bp-toolbar" id="bp-toolbar" hidden>
        <span class="bp-count-label" id="bp-total-label">0 PDFs</span>
        <div class="bp-sel-actions">
          <button class="bp-sel-btn" id="bp-sel-all">Todos</button>
          <button class="bp-sel-btn" id="bp-sel-none">Nenhum</button>
        </div>
      </div>

      <div class="bp-list" id="bp-list" hidden></div>

      <div class="bp-footer" id="bp-footer" hidden>
        <button class="bp-download-btn" id="bp-download" disabled>
          Baixar <span id="bp-dl-count">0</span> PDF(s)
        </button>
        <div class="bp-progress" id="bp-dl-progress" hidden>
          <div class="bp-bar"><div class="bp-fill" id="bp-dl-fill"></div></div>
          <span class="bp-ptext" id="bp-dl-text"></span>
        </div>
      </div>
    `;

    // Close
    panel.querySelector('.bp-close').onclick = () => panel.classList.remove('bp-open');

    // Scan
    panel.querySelector('#bp-scan-btn').onclick = async () => {
      const courseId = getCourseId();
      if (!courseId) return;

      const scanBtn = panel.querySelector('#bp-scan-btn');
      const scanMsg = panel.querySelector('.bp-scan-msg');
      const scanProg = panel.querySelector('#bp-scan-progress');
      const scanFill = panel.querySelector('#bp-scan-fill');
      const scanText = panel.querySelector('#bp-scan-text');

      scanBtn.hidden = true;
      scanMsg.hidden = true;
      scanProg.hidden = false;

      try {
        allFiles = await scanCourse(courseId, (label, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          scanFill.style.width = pct + '%';
          scanText.textContent = label.length > 40 ? label.slice(0, 37) + '...' : label;
        });
      } catch {
        allFiles = [];
      }

      scanProg.hidden = true;

      if (!allFiles.length) {
        scanBtn.hidden = false;
        scanMsg.hidden = false;
        scanMsg.textContent = 'Nenhum PDF encontrado neste curso.';
        scanMsg.classList.add('bp-warn');
        return;
      }

      panel.querySelector('#bp-scan').hidden = true;
      panel.querySelector('#bp-toolbar').hidden = false;
      panel.querySelector('#bp-list').hidden = false;
      panel.querySelector('#bp-footer').hidden = false;
      panel.querySelector('#bp-total-label').textContent = `${allFiles.length} PDF${allFiles.length > 1 ? 's' : ''}`;
      renderFiles();
    };

    // Select all / none
    panel.querySelector('#bp-sel-all').onclick = () => {
      panel.querySelectorAll('.bp-cb').forEach((cb) => { cb.checked = true; });
      syncCount();
    };
    panel.querySelector('#bp-sel-none').onclick = () => {
      panel.querySelectorAll('.bp-cb').forEach((cb) => { cb.checked = false; });
      syncCount();
    };

    // Download
    panel.querySelector('#bp-download').onclick = () => {
      const selected = [];
      panel.querySelectorAll('.bp-cb:checked').forEach((cb) => {
        const idx = +cb.dataset.i;
        if (allFiles[idx]) selected.push(allFiles[idx]);
      });
      if (!selected.length) return;
      startDownload(selected);
    };

    document.body.appendChild(panel);
    return panel;
  }

  function renderFiles() {
    const list = document.getElementById('bp-list');

    if (!allFiles.length) {
      list.innerHTML = '<div class="bp-empty">Nenhum PDF encontrado.</div>';
      document.getElementById('bp-download').disabled = true;
      document.getElementById('bp-dl-count').textContent = '0';
      return;
    }

    // Group by section
    const groups = {};
    allFiles.forEach((f, i) => {
      const sec = f.section || 'Arquivos';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push({ ...f, _i: i });
    });

    let html = '';
    for (const [sec, items] of Object.entries(groups)) {
      html += `<div class="bp-section">${escHTML(sec)}</div>`;
      for (const f of items) {
        html += `
          <label class="bp-row">
            <input type="checkbox" class="bp-cb" data-i="${f._i}" checked />
            <span class="bp-fname" title="${escHTML(f.filename)}">${escHTML(f.filename)}</span>
          </label>`;
      }
    }
    list.innerHTML = html;

    list.querySelectorAll('.bp-cb').forEach((cb) => {
      cb.addEventListener('change', syncCount);
    });
    syncCount();
  }

  function syncCount() {
    const n = document.querySelectorAll(`#${PANEL_ID} .bp-cb:checked`).length;
    document.getElementById('bp-dl-count').textContent = n;
    document.getElementById('bp-download').disabled = n === 0;
  }

  function startDownload(files) {
    const dlBtn = document.getElementById('bp-download');
    const dlProg = document.getElementById('bp-dl-progress');
    const dlFill = document.getElementById('bp-dl-fill');
    const dlText = document.getElementById('bp-dl-text');
    const folder = getCourseName();

    dlBtn.hidden = true;
    dlProg.hidden = false;
    dlFill.style.width = '0%';
    dlText.textContent = `Baixando ${files.length} PDF(s)...`;

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_FILES',
        files: files.map((f) => ({ url: f.url, filename: f.filename })),
        folder,
      },
      (resp) => {
        if (resp && resp.success > 0) {
          dlFill.style.width = '100%';
          dlFill.classList.add('bp-done');
          dlText.textContent = `${resp.success} PDF(s) baixado(s)`;
          if (resp.failed > 0) dlText.textContent += ` — ${resp.failed} falha(s)`;
        } else {
          dlFill.style.width = '100%';
          dlFill.classList.add('bp-error');
          dlText.textContent = 'Erro ao baixar. Verifique se esta logado.';
        }
        setTimeout(() => {
          dlProg.hidden = true;
          dlBtn.hidden = false;
          dlFill.classList.remove('bp-done', 'bp-error');
        }, 4000);
      }
    );
  }

  // ── UI: Trigger button ─────────────────────────────────────

  function createTrigger() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'PDFs';
    btn.title = 'Blackboard+ — Baixar PDFs do curso';
    btn.onclick = () => {
      let panel = document.getElementById(PANEL_ID);
      if (!panel) panel = createPanel();
      panel.classList.toggle('bp-open');
    };
    document.body.appendChild(btn);
  }

  // ── Init & SPA navigation ─────────────────────────────────

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/panel.css');
    document.head.appendChild(link);
  }

  function cleanup() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(BTN_ID)?.remove();
    allFiles = [];
  }

  function init() {
    if (!getCourseId()) return;
    if (document.getElementById(BTN_ID)) return;
    injectCSS();
    createTrigger();
  }

  // Ultra SPA navigation — detect URL changes via multiple methods
  let lastHref = location.href;
  let lastCourseId = getCourseId();

  function onNavigate() {
    const currentHref = location.href;
    const currentCourse = getCourseId();

    if (currentHref === lastHref) return;
    lastHref = currentHref;

    // Course changed (or left/entered a course) — full reset
    if (currentCourse !== lastCourseId) {
      lastCourseId = currentCourse;
      cleanup();
      // Wait for Ultra SPA to render the new page
      setTimeout(init, 600);
      setTimeout(init, 1500); // retry in case first was too early
    }
  }

  // Intercept pushState and replaceState
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      original(...args);
      onNavigate();
    };
  }

  window.addEventListener('popstate', onNavigate);

  // Polling fallback — Ultra sometimes navigates without touching history API
  setInterval(onNavigate, 1000);

  init();
})();
