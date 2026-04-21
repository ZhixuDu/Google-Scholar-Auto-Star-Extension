# Scholar Auto-Star

A Chrome extension that automates saving (starring) Google Scholar search
results to your **My Library**, with optional automatic labeling. Built for
researchers who need to compile publication lists for grant reports, systematic
literature reviews, or bibliometric work — where manually clicking the ⭐ on
hundreds of results is a real bottleneck.

Once items are saved and labeled, you can export them from My Library to a
single `.bib` file in one click.

## Features

- One-click bulk-starring of every result on a Google Scholar search page
- Configurable delay + random jitter between clicks to avoid rate limiting
- Optional **auto-advance** through all pages of a multi-page search
- **Smart label detection**: auto-populates a dropdown with your existing
  Scholar labels (read from the Manage Labels page, My Library sidebar, or the
  save dialog as fallback) — no need to type exact label names
- **CAPTCHA detection**: stops automatically if Scholar throws a challenge, so
  you can solve it manually and resume
- **Resume across pages**: settings (delay, label, auto-advance) persist
  through page navigation
- Runs entirely in your browser — no outbound requests, no analytics, no
  account needed

## Installation

### From source (Developer mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** on in the top-right corner.
4. Click **Load unpacked** and select the repository folder.
5. Navigate to `https://scholar.google.com` — a blue control panel labeled
   **⭐ Scholar Auto-Star** should appear in the top-right of the page.

### Chrome Web Store

Not yet published. Contributions toward that welcome.

## Usage

1. Run your Scholar search and make sure you're signed in to Google.
2. In the Scholar Auto-Star panel, pick your label from the dropdown.
   It should already be populated. If not, click **🔄 Detect**. (**Bugs for this version.**)
3. Adjust **Delay** (2500 ms is a sensible default) and **Random jitter**
   (1500 ms). Lower values are faster but more likely to trigger CAPTCHAs.
4. (Optional) Tick **Auto-advance to next page** to crawl the full result set
   unattended.
5. Click **Start on this page** and let it run.

When finished, open
[My Library](https://scholar.google.com/scholar?scilib=1), filter by your
label in the left sidebar, select all, and use the three-dot menu to export
as BibTeX.

## How label detection works

The extension tries three strategies in order:

1. **Current page DOM** — if you're on the Manage Labels or My Library page,
   labels are already visible and get parsed directly.
2. **Background fetch** — requests Scholar's label-listing endpoints
   (`/citations?view_op=list_article_labels` and `/scholar?scilib=1`) and
   parses the response. No navigation away from your current page.
3. **Save dialog** — as a last resort, opens the save dialog on the first
   unstarred result, reads the label checkboxes, and clicks *Remove article*
   to undo the save.

A fourth passive path runs a `MutationObserver` that harvests labels from any
save dialog that appears during normal use, keeping the dropdown up to date.

## Caveats

- **CAPTCHA risk.** Any automation of Google Scholar carries some risk.
  Randomized delays help, and the extension pauses automatically when it
  detects a challenge. If CAPTCHAs are frequent, raise the delay.
- **Scholar can change its HTML.** Class names and dialog structure
  occasionally shift. If label detection or save-dialog handling breaks,
  expect the fix to be a few selectors in `content.js`.
- **Label must exist before use.** The extension selects existing labels from
  the save dialog — it does not create new ones.
- **Chrome-only for now.** Uses Manifest V3. Should port cleanly to Firefox
  with minimal changes (promise-based APIs, but `chrome.*` namespace differs).

## Troubleshooting

- **Dropdown is empty.** Click 🔄 Detect; the status line should report which
  strategy succeeded. If all three fail, check DevTools Console for
  `[Scholar Auto-Star]` messages with diagnostic output.
- **Labels aren't being applied** but saves work. Open DevTools, run a save
  manually while the panel is open, and look for the line
  `[Scholar Auto-Star] readLabelsFromDialog: N checkbox(es), extracted: [...]`.
  If the extracted array is empty, Scholar has changed its dialog markup and
  `getCheckboxLabelText` in `content.js` needs a new strategy.
- **"No Save buttons found."** You're not on a Scholar search-results page.
  Make sure the URL is `scholar.google.com/scholar?q=...`.
- **Saves silently fail** (no dialog appears). You're not signed in to Google
  — sign in and retry.

## File layout

```
scholar-auto-star/
├── manifest.json    # Extension manifest (MV3)
├── content.js       # Main logic: panel injection, click automation, label handling
├── content.css      # Floating control panel styles
├── README.md        # This file
├── LICENSE          # MIT
└── .gitignore
```

## Contributing

Pull requests welcome. Particularly useful contributions:

- Firefox port (replace `chrome.*` where needed, bundle for `about:debugging`)
- Selector updates when Scholar changes its markup
- Localization (currently English-only)
- Chrome Web Store listing

## License

[MIT](LICENSE). Use responsibly — this tool automates what a human can do
manually; it's not a mandate to hammer Scholar with thousands of rapid
requests. Google Scholar's anti-abuse systems exist for good reasons.
