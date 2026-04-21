// Scholar Auto-Star — content script
// Injects a control panel on Google Scholar pages that auto-clicks the ⭐ "Save"
// button on each result, with configurable delays, and optionally applies a
// pre-existing label from your Scholar library to each saved paper.

(function () {
  'use strict';

  let stopRequested = false;
  let running = false;

  // ---------- Helpers ----------

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findSaveButtons() {
    // Scholar's "Save" (star) button — try multiple selectors for robustness.
    const selectors = [
      'a.gs_or_sav',
      'a.gs_or_btn.gs_or_sav',
      'a[aria-label="Save"]',
      'a.gs_or_btn[href*="save"]',
    ];
    const set = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => set.add(el));
    }
    return Array.from(set);
  }

  function isStarred(btn) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').toLowerCase();
    if (btn.classList.contains('gs_or_sav_c')) return true;
    if (label.includes('saved') || text.includes('saved')) return true;
    return false;
  }

  function captchaPresent() {
    return !!document.querySelector(
      'form#gs_captcha_f, #gs_captcha_ccl, #recaptcha, iframe[src*="recaptcha"]'
    );
  }

  function setStatus(msg) {
    const el = document.getElementById('sas-status');
    if (el) el.textContent = msg;
  }

  function setProgress(done, total) {
    const bar = document.getElementById('sas-bar');
    if (bar && total > 0) {
      bar.style.width = Math.round((done / total) * 100) + '%';
    }
  }

  function getResultBlock(btn) {
    // Each Scholar result is wrapped in a container; find its top-level element.
    return (
      btn.closest('[data-cid]') ||
      btn.closest('.gs_r.gs_or.gs_scl') ||
      btn.closest('.gs_r') ||
      btn.closest('.gs_ri') ||
      btn.parentElement
    );
  }

  // ---------- Save dialog + label handling ----------
  //
  // After clicking Save, Scholar opens a modal dialog titled "Saved to My library"
  // containing label checkboxes and Done/Remove buttons. We need to: wait for the
  // dialog, check the desired label's checkbox, then click Done to close it.

  function findVisibleDialog() {
    // Scholar uses various class names for its modal dialogs; look broadly.
    const candidates = document.querySelectorAll(
      '.gs_md_dgn, .gs_md_dw, .gs_md_dgb, [role="dialog"], .gs_md_wnw'
    );
    for (const c of candidates) {
      if (c.offsetParent === null) continue; // not visible
      const text = (c.textContent || '').toLowerCase();
      if (
        text.includes('saved to my library') ||
        text.includes('label as') ||
        (c.querySelector('input[type="checkbox"]') &&
          /done|remove article/i.test(text))
      ) {
        return c;
      }
    }
    // Fallback: any visible container with checkboxes + a "Done" button
    const all = document.querySelectorAll('div');
    for (const d of all) {
      if (d.offsetParent === null) continue;
      if (d.children.length === 0) continue;
      const txt = (d.textContent || '').toLowerCase();
      if (
        txt.includes('label as') &&
        d.querySelector('input[type="checkbox"]')
      ) {
        return d;
      }
    }
    return null;
  }

  async function waitForSaveDialog(maxWaitMs = 3000) {
    const step = 150;
    const iters = Math.ceil(maxWaitMs / step);
    for (let i = 0; i < iters; i++) {
      const d = findVisibleDialog();
      if (d) return d;
      await sleep(step);
    }
    return null;
  }

  function getCheckboxLabelText(cb, container) {
    // Try multiple strategies, from most reliable to fuzziest, to find the
    // text associated with a checkbox. Covers standard <label for="">,
    // parent <label>, aria-label, aria-labelledby, and Material-style
    // sibling/ancestor layouts where the text lives in an adjacent span.

    // 1. aria-label attribute
    const aria = cb.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    // 2. aria-labelledby reference
    const labelledBy = cb.getAttribute('aria-labelledby');
    if (labelledBy) {
      try {
        const el = container.querySelector(`#${CSS.escape(labelledBy)}`);
        if (el) {
          const t = el.textContent.trim();
          if (t) return t;
        }
      } catch (e) {
        /* ignore invalid ID */
      }
    }

    // 3. Enclosing <label> element
    const parentLabel = cb.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, button, svg').forEach((i) => i.remove());
      const t = clone.textContent.trim();
      if (t) return t;
    }

    // 4. <label for="cbId">
    if (cb.id) {
      try {
        const forLabel = container.querySelector(
          `label[for="${CSS.escape(cb.id)}"]`
        );
        if (forLabel) {
          const t = forLabel.textContent.trim();
          if (t) return t;
        }
      } catch (e) {
        /* ignore */
      }
    }

    // 5. Walk up ancestors: the nearest container whose (non-input) text
    //    is non-empty and reasonably short is almost certainly the row
    //    that holds this checkbox + its label. This handles Material-style
    //    layouts where <input> and its label span are separate children.
    let ancestor = cb.parentElement;
    for (let depth = 0; depth < 6 && ancestor && ancestor !== container; depth++) {
      const clone = ancestor.cloneNode(true);
      // Strip anything that isn't label text
      clone
        .querySelectorAll('input, button, svg')
        .forEach((el) => el.remove());
      // Strip common "Learn more" links that appear next to "Reading list"
      clone.querySelectorAll('a').forEach((a) => {
        if (/^\s*learn more\s*$/i.test(a.textContent || '')) a.remove();
      });
      const text = clone.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length >= 1 && text.length <= 100) {
        return text;
      }
      ancestor = ancestor.parentElement;
    }

    return '';
  }

  function findButtonInDialog(dialog, texts) {
    const clickables = dialog.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"]'
    );
    const wanted = texts.map((t) => t.toLowerCase());
    for (const b of clickables) {
      const t = (b.textContent || b.value || '').trim().toLowerCase();
      if (wanted.includes(t)) return b;
    }
    return null;
  }

  async function closeDialog(dialog) {
    if (!dialog || dialog.offsetParent === null) return;
    const doneBtn = findButtonInDialog(dialog, ['done', 'ok', 'close']);
    if (doneBtn) {
      doneBtn.click();
    } else {
      // Fallback: Escape key
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    }
    await sleep(350);
  }

  async function handleSaveDialog(labelName) {
    // Wait for the modal that appears after clicking Save.
    const dialog = await waitForSaveDialog(3500);
    if (!dialog) {
      // Dialog never appeared — nothing to do (and nothing to close).
      return { dialogFound: false, labeled: false };
    }

    let labeled = false;
    if (labelName) {
      const target = labelName.trim().toLowerCase();
      const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const txt = getCheckboxLabelText(cb, dialog).toLowerCase();
        if (!txt) continue;
        if (txt === target) {
          if (!cb.checked) {
            // Clicking the wrapping <label> is more reliable than cb.click()
            // because Scholar may have handlers attached to the label element.
            const parentLabel = cb.closest('label');
            const forLabel = cb.id
              ? dialog.querySelector(`label[for="${cb.id}"]`)
              : null;
            const clickTarget = parentLabel || forLabel || cb;
            clickTarget.click();
          }
          labeled = true;
          break;
        }
      }

      if (!labeled) {
        console.warn(
          `[Scholar Auto-Star] Label "${labelName}" not found in save dialog. ` +
            `Available:`,
          Array.from(checkboxes)
            .map((cb) => getCheckboxLabelText(cb, dialog))
            .filter(Boolean)
        );
      }
      // Give Scholar a moment to register the checkbox change.
      await sleep(300);
    }

    await closeDialog(dialog);
    return { dialogFound: true, labeled };
  }

  // ---------- Label discovery (dropdown + detection) ----------

  const discoveredLabels = new Set();

  function readLabelsFromDialog(dialog) {
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    const names = [];
    for (const cb of checkboxes) {
      const txt = getCheckboxLabelText(cb, dialog).trim();
      // Trim any trailing "Learn more" text (shown next to Reading list)
      const cleaned = txt.replace(/\s+learn more\s*$/i, '').trim();
      if (cleaned && cleaned.length < 120) names.push(cleaned);
    }
    console.log(
      `[Scholar Auto-Star] readLabelsFromDialog: ${checkboxes.length} checkbox(es), extracted:`,
      names
    );
    return names;
  }

  function refreshLabelDropdown() {
    const select = document.getElementById('sas-label-select');
    if (!select) return;

    const previous = select.value;
    // Reset
    select.innerHTML = '';
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = '— No label —';
    select.appendChild(optNone);

    const sorted = Array.from(discoveredLabels).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const name of sorted) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    }

    const optCustom = document.createElement('option');
    optCustom.value = '__custom__';
    optCustom.textContent = 'Custom (type below)…';
    select.appendChild(optCustom);

    // Restore previous selection if still valid
    if (previous && Array.from(select.options).some((o) => o.value === previous)) {
      select.value = previous;
    }
    updateCustomInputVisibility();
  }

  function updateCustomInputVisibility() {
    const select = document.getElementById('sas-label-select');
    const input = document.getElementById('sas-label-input');
    if (!select || !input) return;
    input.style.display = select.value === '__custom__' ? 'block' : 'none';
  }

  function getSelectedLabel() {
    const select = document.getElementById('sas-label-select');
    const input = document.getElementById('sas-label-input');
    if (!select) return '';
    if (select.value === '__custom__') return (input.value || '').trim();
    return select.value || '';
  }

  // ---------- Label detection strategies ----------

  function readLabelsFromCurrentPage() {
    // Strategy for Manage Labels / My Library pages: the labels are already
    // visible as links on the page itself — no save dialog needed.
    const labels = new Set();

    // Strategy A: Manage Labels page has a table; each row's first-column link
    // is the label name.
    const tableRows = document.querySelectorAll('tr');
    for (const row of tableRows) {
      const cells = row.querySelectorAll('td');
      if (!cells.length) continue;
      const link = cells[0].querySelector('a');
      if (!link) continue;
      const text = (link.textContent || '').trim();
      if (
        text &&
        text.length > 0 &&
        text.length < 120 &&
        !/^(label name|actions|manage|edit|delete|create|remove)$/i.test(text)
      ) {
        labels.add(text);
      }
    }

    // Strategy B: links anywhere on the page whose href looks like a label
    // filter (Scholar uses params like lbl_id= or label=).
    const allLinks = document.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      if (!/[?&](lbl_id|label)=/.test(href)) continue;
      const text = (link.textContent || '').trim();
      if (
        text &&
        text.length > 0 &&
        text.length < 120 &&
        !/^(manage|edit|delete|create|remove|all)$/i.test(text)
      ) {
        labels.add(text);
      }
    }

    return Array.from(labels);
  }

  async function fetchLabelsFromMyLibrary() {
    // Fetch Scholar's label-listing pages in the background and parse out
    // the label names. Try the Manage Labels page first (clean table) and
    // then fall back to the My Library sidebar.
    const urls = [
      '/citations?view_op=list_article_labels&hl=en',
      '/scholar?scilib=1',
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) continue;
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const labels = new Set();

        // Strategy A: table rows (Manage Labels page)
        doc.querySelectorAll('tr').forEach((row) => {
          const firstCell = row.querySelector('td');
          if (!firstCell) return;
          const link = firstCell.querySelector('a');
          if (!link) return;
          const text = (link.textContent || '').trim();
          if (
            text &&
            text.length > 0 &&
            text.length < 120 &&
            !/^(label name|actions|manage|edit|delete|create|remove)$/i.test(text)
          ) {
            labels.add(text);
          }
        });

        // Strategy B: href-based filter (My Library sidebar)
        doc.querySelectorAll('a[href]').forEach((link) => {
          const href = link.getAttribute('href') || '';
          if (!/[?&](lbl_id|label)=/.test(href)) return;
          const text = (link.textContent || '').trim();
          if (
            text &&
            text.length > 0 &&
            text.length < 120 &&
            !/^(manage|edit|delete|create|remove|all)$/i.test(text)
          ) {
            labels.add(text);
          }
        });

        if (labels.size > 0) {
          console.log(
            `[Scholar Auto-Star] Found ${labels.size} label(s) via ${url}:`,
            Array.from(labels)
          );
          return Array.from(labels);
        }
      } catch (e) {
        console.warn('[Scholar Auto-Star] Fetch error for', url, ':', e);
      }
    }
    return [];
  }

  async function detectLabelsFromSaveDialog() {
    // Last resort: open a save dialog, read labels, then undo the save.
    const saveBtns = findSaveButtons();
    const unsaved = saveBtns.filter((b) => !isStarred(b));
    if (unsaved.length === 0) return [];

    const btn = unsaved[0];
    btn.click();

    const dialog = await waitForSaveDialog(4000);
    if (!dialog) return [];

    const names = readLabelsFromDialog(dialog);

    // Undo the save — click "Remove article" so we leave no trace.
    const removeBtn = findButtonInDialog(dialog, ['remove article', 'remove']);
    if (removeBtn) {
      removeBtn.click();
      await sleep(500);
    } else {
      await closeDialog(dialog);
    }
    return names;
  }

  async function detectLabels() {
    setStatus('Detecting labels…');

    // 1) Try reading from the current page (works on Manage Labels, My Library).
    let names = readLabelsFromCurrentPage();
    let source = 'this page';

    // 2) Fetch My Library page and parse its sidebar.
    if (names.length === 0) {
      setStatus('Fetching labels from My Library…');
      names = await fetchLabelsFromMyLibrary();
      source = 'My Library';
    }

    // 3) Fall back to the save-dialog trick (only works on search results).
    if (names.length === 0) {
      setStatus('Trying the save dialog…');
      names = await detectLabelsFromSaveDialog();
      source = 'save dialog';
    }

    if (names.length === 0) {
      setStatus(
        '⚠️ Could not find any labels. Create one at My Library → Manage labels, ' +
          'then click Detect again. Or use "Custom" to type the label manually.'
      );
      return;
    }

    names.forEach((n) => discoveredLabels.add(n));
    refreshLabelDropdown();
    setStatus(
      `✅ Detected ${names.length} label(s) from ${source}: ${names.join(', ')}`
    );
  }

  function startLabelObserver() {
    // Passively watch the page for save dialogs. Whenever one appears,
    // harvest the labels shown inside it to keep the dropdown up to date.
    let lastSeenAt = 0;
    const observer = new MutationObserver(() => {
      const now = Date.now();
      if (now - lastSeenAt < 250) return; // throttle
      lastSeenAt = now;
      const dialog = findVisibleDialog();
      if (!dialog) return;
      const names = readLabelsFromDialog(dialog);
      if (!names.length) return;
      let changed = false;
      for (const n of names) {
        if (!discoveredLabels.has(n)) {
          discoveredLabels.add(n);
          changed = true;
        }
      }
      if (changed) refreshLabelDropdown();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- Main action ----------

  async function starAllOnPage({ delayMs, jitterMs, autoNext, labelName }) {
    if (running) return;
    running = true;
    stopRequested = false;

    try {
      const all = findSaveButtons();
      const todo = all.filter((b) => !isStarred(b));

      if (all.length === 0) {
        setStatus('⚠️ No Save buttons found. Are you on a Scholar results page?');
        return;
      }
      if (todo.length === 0) {
        setStatus('✅ All results on this page are already saved.');
        if (autoNext) await goToNextPage(labelName);
        return;
      }

      setStatus(`Starring ${todo.length} item(s)…`);
      setProgress(0, todo.length);

      let count = 0;
      let labelOk = 0;
      let labelFail = 0;

      for (const btn of todo) {
        if (stopRequested) {
          setStatus(`⏸ Stopped. Saved ${count} of ${todo.length}.`);
          return;
        }
        if (captchaPresent()) {
          setStatus(
            `🛑 CAPTCHA detected after ${count} saves. Solve it, then click Start again.`
          );
          return;
        }

        try {
          btn.click();
          count++;
        } catch (e) {
          console.warn('[Scholar Auto-Star] click failed:', e);
          continue;
        }

        // After clicking Save, Scholar opens a modal dialog. Handle it:
        // apply the label if requested, and always close it before the next save.
        const { dialogFound, labeled } = await handleSaveDialog(labelName);

        if (labelName) {
          if (labeled) labelOk++;
          else labelFail++;
          setStatus(
            `Saved ${count}/${todo.length} • labeled ${labelOk}` +
              (labelFail ? ` (${labelFail} failed)` : '') +
              (!dialogFound ? ' [no dialog!]' : '')
          );
        } else {
          setStatus(`Saved ${count} / ${todo.length} on this page…`);
        }
        setProgress(count, todo.length);

        const wait = delayMs + Math.random() * jitterMs;
        await sleep(wait);
      }

      let summary = `✅ Finished page: saved ${count}`;
      if (labelName) summary += `, labeled ${labelOk}`;
      if (labelFail) summary += ` (${labelFail} label failures — check label name)`;
      summary += '.';
      setStatus(summary);

      if (autoNext && !stopRequested) {
        await sleep(1500 + Math.random() * 1500);
        await goToNextPage(labelName);
      }
    } finally {
      running = false;
    }
  }

  async function goToNextPage(labelName) {
    const nextLink =
      document.querySelector('#gs_n td[align="left"] + td a') ||
      document.querySelector('a[aria-label="Next"]') ||
      Array.from(document.querySelectorAll('#gs_n a')).find((a) =>
        /next/i.test(a.textContent || '')
      );

    if (nextLink && nextLink.href) {
      setStatus('➡️ Going to next page…');
      sessionStorage.setItem('sas_autostart', '1');
      sessionStorage.setItem('sas_delay', document.getElementById('sas-delay').value);
      sessionStorage.setItem('sas_jitter', document.getElementById('sas-jitter').value);
      sessionStorage.setItem(
        'sas_autonext',
        document.getElementById('sas-autonext').checked ? '1' : '0'
      );
      sessionStorage.setItem('sas_label', labelName || '');
      window.location.href = nextLink.href;
    } else {
      setStatus('🏁 No next page found — you appear to be on the last page.');
    }
  }

  // ---------- UI ----------

  function injectUI() {
    if (document.getElementById('sas-controls')) return;

    const panel = document.createElement('div');
    panel.id = 'sas-controls';
    panel.innerHTML = `
      <div class="sas-header">
        <span class="sas-title">⭐ Scholar Auto-Star</span>
        <button id="sas-collapse" title="Collapse">–</button>
      </div>
      <div class="sas-body">
        <div class="sas-row">
          <button id="sas-start" class="sas-primary">Start on this page</button>
          <button id="sas-stop" class="sas-danger">Stop</button>
        </div>
        <div class="sas-label-group">
          <div class="sas-label-header">
            <span>Apply label (optional)</span>
            <button id="sas-detect" class="sas-small" title="Open a save dialog, read labels, cancel it">
              🔄 Detect
            </button>
          </div>
          <select id="sas-label-select">
            <option value="">— No label —</option>
            <option value="__custom__">Custom (type below)…</option>
          </select>
          <input id="sas-label-input" type="text" placeholder="Type exact label text…" style="display:none;margin-top:4px;" />
        </div>
        <label class="sas-label">
          Delay between clicks (ms)
          <input id="sas-delay" type="number" value="2500" min="500" step="500" />
        </label>
        <label class="sas-label">
          Random jitter (ms)
          <input id="sas-jitter" type="number" value="1500" min="0" step="250" />
        </label>
        <label class="sas-label sas-check">
          <input id="sas-autonext" type="checkbox" />
          Auto-advance to next page
        </label>
        <div id="sas-status">Ready.</div>
        <div class="sas-progress"><div id="sas-bar"></div></div>
        <div class="sas-hint">
          Click <strong>🔄 Detect</strong> to load your existing labels, or create new ones
          at <a href="https://scholar.google.com/scholar?scilib=1" target="_blank">My Library</a>
          → Manage labels. Export saved items to BibTeX from My Library when done.
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const body = panel.querySelector('.sas-body');
    document.getElementById('sas-collapse').addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? '' : 'none';
    });

    document.getElementById('sas-start').addEventListener('click', () => {
      const delayMs = parseInt(document.getElementById('sas-delay').value, 10) || 2500;
      const jitterMs = parseInt(document.getElementById('sas-jitter').value, 10) || 0;
      const autoNext = document.getElementById('sas-autonext').checked;
      const labelName = getSelectedLabel();
      starAllOnPage({ delayMs, jitterMs, autoNext, labelName });
    });

    document.getElementById('sas-stop').addEventListener('click', () => {
      stopRequested = true;
      sessionStorage.removeItem('sas_autostart');
      setStatus('Stop requested…');
    });

    document.getElementById('sas-detect').addEventListener('click', () => {
      detectLabels();
    });

    document.getElementById('sas-label-select').addEventListener('change', () => {
      updateCustomInputVisibility();
    });

    // Passive watcher: capture labels whenever any save dialog appears.
    startLabelObserver();

    // Kick off an initial detection in the background so the dropdown is
    // pre-populated when the user opens it. Uses only non-intrusive strategies
    // (current-page DOM + fetch My Library); does NOT touch search results.
    (async () => {
      let names = readLabelsFromCurrentPage();
      if (names.length === 0) names = await fetchLabelsFromMyLibrary();
      if (names.length > 0) {
        names.forEach((n) => discoveredLabels.add(n));
        refreshLabelDropdown();
      }
    })();

    // Auto-resume after page navigation.
    if (sessionStorage.getItem('sas_autostart') === '1') {
      const delayMs = parseInt(sessionStorage.getItem('sas_delay'), 10) || 2500;
      const jitterMs = parseInt(sessionStorage.getItem('sas_jitter'), 10) || 1500;
      const autoNext = sessionStorage.getItem('sas_autonext') === '1';
      const labelName = sessionStorage.getItem('sas_label') || '';
      document.getElementById('sas-delay').value = delayMs;
      document.getElementById('sas-jitter').value = jitterMs;
      document.getElementById('sas-autonext').checked = autoNext;
      if (labelName) {
        // Pre-populate the custom input so the label persists across pages
        // even if Detect hasn't run yet on this page.
        discoveredLabels.add(labelName);
        refreshLabelDropdown();
        document.getElementById('sas-label-select').value = labelName;
        updateCustomInputVisibility();
      }
      sessionStorage.removeItem('sas_autostart');
      setTimeout(
        () => starAllOnPage({ delayMs, jitterMs, autoNext, labelName }),
        1500
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
