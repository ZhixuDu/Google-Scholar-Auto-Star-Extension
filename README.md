# Scholar Auto-Star (v1.1)

A Chrome extension that automates clicking the ⭐ "Save" button on Google
Scholar search results and optionally applies a label to each saved paper.
Designed for compiling publication lists (e.g., for grant reports) where you
need to bulk-save hundreds of Scholar hits and then export them as BibTeX.

---

## Installation

1. Download and unzip the folder somewhere on your computer.
2. Open Chrome → `chrome://extensions`.
3. Toggle **Developer mode** ON (top-right).
4. Click **Load unpacked** and select the `scholar-auto-star` folder.
5. The extension is now active on `scholar.google.com`.

If you already installed v1.0, go to `chrome://extensions`, find "Scholar
Auto-Star", and click the refresh/reload icon — or remove and re-add the folder.

---

## Quick start (with label)

1. **Create your label first.** Go to
   [My Library](https://scholar.google.com/scholar?scilib=1) → "Manage labels"
   in the left sidebar → create a label like `NSF Award 2112562`.
   **The extension can only apply labels that already exist.**
2. Sign in to Google and run your Scholar search.
3. The **⭐ Scholar Auto-Star** panel appears in the top-right of the page.
4. Type the exact label name into the "Apply label" field.
5. Set the delay (2500 ms is a good default) and jitter (1500 ms).
6. Optionally tick **Auto-advance to next page** if you want it to crawl all
   pages unattended.
7. Click **Start on this page**.

Progress shows both saves and label applications. When done, open My Library,
filter by your label in the left sidebar, select all, and **Export → BibTeX**.

---

## What's new in v1.1

- **Label field.** Applies a pre-existing label to every paper as it's saved.
- Leave the label field blank to just star without labeling (v1.0 behavior).
- Status line now shows both save count and label count, with separate failure
  reporting if labels fail to apply.
- Label preference persists across auto-advance page navigations.

---

## Is there an easier way to apply labels?

Yes — if you want the **same** label on every starred paper, you can just:

1. Use this extension with the label field **blank** to star everything.
2. Go to My Library.
3. Tick the "select all" checkbox at the top.
4. Click the label icon in the top toolbar and apply your label to all items at
   once.

That's actually simpler than per-paper labeling and doesn't depend on Scholar's
dropdown DOM staying stable. Use per-paper labeling (this extension's feature)
only if you want to apply **different** labels to different papers in the same
session, or if you want fully automated end-to-end labeling.

---

## Caveats

- **The label must already exist** in your Scholar library. The extension
  searches the Label dropdown for an exact (case-insensitive) text match and
  clicks it. It does not create new labels.
- **Label selectors are best-guess.** Google Scholar changes its HTML markup
  occasionally. If labels stop applying, look at the `applyLabel()` function in
  `content.js` — the `candidateSelectors` array lists the selectors tried. You
  may need to add one matching Scholar's current markup.
- **CAPTCHA risk remains.** Adding label application means slightly more
  clicking per paper, which can slightly increase CAPTCHA probability. If you
  see frequent CAPTCHAs, raise the delay or use the bulk-label-from-My-Library
  approach above.
- **Timing.** With labeling enabled, each paper takes roughly 4–6 seconds
  (vs. 2–4 seconds without labeling). 368 papers ≈ 25–35 minutes.

---

## Troubleshooting

**"Label X not found in dropdown"** — The label doesn't exist. Create it in My
Library first, making sure the name matches exactly (case doesn't matter, but
spaces and punctuation do).

**Saves work, labels don't** — Scholar may have changed label dropdown markup.
Open DevTools (F12) → Console on a Scholar results page, click Save on one
result manually, then click the "Label" link to open the dropdown, then inspect
the dropdown items. Update `candidateSelectors` in `content.js` accordingly.

**Progress says labeled N but I don't see them in My Library** — Check that
you're looking at the right label in the sidebar. Refresh My Library.

---

## Files

- `manifest.json` — extension manifest (Manifest V3)
- `content.js` — main logic: panel injection, star clicks, label application
- `content.css` — styling for the floating panel
- `README.md` — this file
