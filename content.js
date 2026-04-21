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
    // Try several strategies to find the label text associated with a checkbox.
    const parentLabel = cb.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input').forEach((i) => i.remove());
      return clone.textContent.trim();
    }
    if (cb.id) {
      const forLabel = container.querySelector(`label[for="${cb.id}"]`);
      if (forLabel) return forLabel.textContent.trim();
    }
    // Next non-empty sibling
    let sib = cb.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.TEXT_NODE && sib.textContent.trim()) {
        return sib.textContent.trim();
      }
      if (sib.nodeType === Node.ELEMENT_NODE) {
        const t = sib.textContent.trim();
        if (t) return t;
      }
      sib = sib.nextSibling;
    }
    // Parent element's text minus the checkbox
    if (cb.parentElement) {
      const clone = cb.parentElement.cloneNode(true);
      clone.querySelectorAll('input').forEach((i) => i.remove());
      return clone.textContent.trim();
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
        <label class="sas-label">
          Apply label (optional — must exist in My Library)
          <input id="sas-label-input" type="text" placeholder="e.g. NSF Award 2112562" />
        </label>
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
          Create labels first at
          <a href="https://scholar.google.com/scholar?scilib=1" target="_blank">My Library</a>
          → Manage labels. Then export saved items to BibTeX from there.
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
      const labelName = document.getElementById('sas-label-input').value.trim();
      starAllOnPage({ delayMs, jitterMs, autoNext, labelName });
    });

    document.getElementById('sas-stop').addEventListener('click', () => {
      stopRequested = true;
      sessionStorage.removeItem('sas_autostart');
      setStatus('Stop requested…');
    });

    // Auto-resume after page navigation.
    if (sessionStorage.getItem('sas_autostart') === '1') {
      const delayMs = parseInt(sessionStorage.getItem('sas_delay'), 10) || 2500;
      const jitterMs = parseInt(sessionStorage.getItem('sas_jitter'), 10) || 1500;
      const autoNext = sessionStorage.getItem('sas_autonext') === '1';
      const labelName = sessionStorage.getItem('sas_label') || '';
      document.getElementById('sas-delay').value = delayMs;
      document.getElementById('sas-jitter').value = jitterMs;
      document.getElementById('sas-autonext').checked = autoNext;
      document.getElementById('sas-label-input').value = labelName;
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
