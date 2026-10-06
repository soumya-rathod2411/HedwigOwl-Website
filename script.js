/* ============================================================
   Hedwig Owl — script.js

   This file is split into three parts:
   1. MOCK DATA + DATA ACCESS  -- everything that talks to "the backend".
      Right now that's a fake in-memory array, but every place that
      touches it goes through getFiles(), so swapping this for a real
      API later only means rewriting that one function.
   2. RENDERING  -- turns file objects into DOM cards.
   3. STATE + EVENTS -- sorting, date search, and progressive scroll
      loading, all working together on top of parts 1 and 2.
   ============================================================ */

(function () {
  "use strict";

  /* ==========================================================
     1. REAL DATA ACCESS -- fetches Hedwig's actual report manifest
     ========================================================== */

  // Your repo's public raw-file base URL. If the repo or branch name
  // ever changes, this is the one line to update.
  const REPO_BASE_URL = "https://raw.githubusercontent.com/soumya-rathod2411/hedwigOwl/main/";
  const MANIFEST_URL = REPO_BASE_URL + "reports/index.json";

  // The manifest is fetched once and cached here. archiveFetchPromise
  // makes sure that even if getFiles() is called multiple times before
  // the first fetch finishes (e.g. the initial load firing right as
  // the scroll observer also fires), only one network request ever
  // goes out -- everyone just waits on the same promise.
  let archiveFetchPromise = null;

  function fetchArchive() {
    if (archiveFetchPromise) return archiveFetchPromise;

    archiveFetchPromise = fetch(MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((manifest) => {
        if (!Array.isArray(manifest)) {
          throw new Error("Manifest was not a list as expected");
        }

        // Security: only trust entries that actually look like a real
        // Hedwig report. This isn't about distrusting your own pipeline
        // -- it's a cheap, defense-in-depth check so that if this JSON
        // file is ever malformed, corrupted, or (once the repo is
        // public) someone with write access ever pushes something
        // unexpected, the site can't be made to build a link to an
        // arbitrary filename/path instead of a real report.
        const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
        const PDF_PATTERN = /^hedwig_report_\d{4}-\d{2}-\d{2}\.pdf$/;

        return manifest
          .filter((entry) =>
            entry &&
            typeof entry.date === "string" && DATE_PATTERN.test(entry.date) &&
            typeof entry.pdf === "string" && PDF_PATTERN.test(entry.pdf)
          )
          .map((entry) => ({
            id: entry.pdf,
            name: entry.pdf,
            type: "pdf",
            date: entry.date,
            url: REPO_BASE_URL + "reports/pdf/" + entry.pdf
          }));
      });

    return archiveFetchPromise;
  }

  // The single function every part of the UI calls to get files.
  // options:
  //   sort:   "newest" | "oldest"
  //   date:   "YYYY-MM-DD" or null  -- if set, only that date is returned
  //   offset: number of files to skip (for pagination)
  //   limit:  max number of files to return
  function getFiles(options) {
    const { sort, date, offset, limit } = options;

    return fetchArchive()
      .then((archive) => {
        let results = archive.slice();

        if (date) {
          results = results.filter((f) => f.date === date);
        }

        results.sort((a, b) => {
          if (sort === "oldest") return a.date.localeCompare(b.date);
          return b.date.localeCompare(a.date); // "newest" default
        });

        const page = results.slice(offset, offset + limit);

        return {
          files: page,
          total: results.length,
          hasMore: offset + limit < results.length
        };
      })
      .catch((err) => {
        console.error("Hedwig archive fetch failed:", err);
        // A failed fetch and a genuinely empty archive need to look
        // different to the person using the site -- this flag lets
        // the rendering code tell them apart.
        return { files: [], total: 0, hasMore: false, error: true };
      });
  }

  /* ==========================================================
     2. RENDERING
     ========================================================== */

  // One small inline SVG per file type: an envelope with a wax-seal
  // emblem, in the same antique gold/charcoal line-art style as the
  // header logo. The seal holds a plain letter monogram per file type
  // (an original mark, not any trademarked crest) so cards stay easy
  // to tell apart at a glance.
  const FILE_ICONS = {
    pdf: fileIconSVG("P"),
    docx: fileIconSVG("D"),
    xlsx: fileIconSVG("X"),
    png: fileIconSVG("I")
  };

  function fileIconSVG(monogram) {
    return `
      <svg class="file-icon" viewBox="0 0 36 32" aria-hidden="true">
        <!-- envelope body -->
        <rect x="2" y="6" width="32" height="23" rx="1.5"
              fill="#F3ECD9" stroke="#C9A227" stroke-width="1.2" />
        <!-- envelope flap -->
        <path d="M2 7l16 12L34 7" fill="none" stroke="#C9A227" stroke-width="1.2"
              stroke-linejoin="round" />
        <!-- wax seal -->
        <circle cx="18" cy="19" r="6.4" fill="#8B2E22" stroke="#6E2419" stroke-width="0.6" />
        <circle cx="18" cy="19" r="4.6" fill="none" stroke="#C9A227" stroke-width="0.5" opacity="0.6" />
        <text x="18" y="21.5" text-anchor="middle" font-family="Cormorant Garamond, serif"
              font-weight="600" font-size="7" fill="#EFE4C8">${monogram}</text>
      </svg>
    `;
  }

  function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function createFileCard(file) {
    const card = document.createElement("a");
    card.className = "file-card";
    card.href = file.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    // Icon markup is always one of our own fixed SVG strings (never
    // built from file data), so it's safe as innerHTML.
    const iconWrap = document.createElement("span");
    iconWrap.innerHTML = FILE_ICONS[file.type] || FILE_ICONS.pdf;
    card.appendChild(iconWrap.firstElementChild);

    // file.name and the formatted date DO come from data (the fetched
    // manifest) -- textContent is used instead of innerHTML for these
    // specifically so that even if that data ever contained HTML/script
    // content, it would just display as plain text, never execute.
    const info = document.createElement("div");
    info.className = "file-info";

    const nameEl = document.createElement("p");
    nameEl.className = "file-name";
    nameEl.textContent = file.name;

    const dateEl = document.createElement("p");
    dateEl.className = "file-date";
    dateEl.textContent = formatDisplayDate(file.date);

    info.appendChild(nameEl);
    info.appendChild(dateEl);
    card.appendChild(info);

    const chevronWrap = document.createElement("span");
    chevronWrap.innerHTML = `
      <svg class="file-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
    card.appendChild(chevronWrap.firstElementChild);

    return card;
  }

  /* ==========================================================
     3. STATE + EVENTS
     ========================================================== */

  const grid = document.getElementById("file-grid");
  const endMessage = document.getElementById("end-message");
  const emptyMessage = document.getElementById("empty-message");
  const errorMessage = document.getElementById("error-message");
  const viewMoreBtn = document.getElementById("view-more-btn");
  const dateInput = document.getElementById("date-search-input");
  const sortButtons = document.querySelectorAll(".sort-btn");

  const BATCH_SIZE = 9;

  const state = {
    sort: "newest",
    date: null,
    offset: 0,
    hasMore: true,
    isLoading: false
  };

  // Wipes the grid and any end-of-list / empty messaging, ready for a
  // fresh set of results after a sort or date-filter change.
  function resetView() {
    grid.innerHTML = "";
    state.offset = 0;
    state.hasMore = true;
    endMessage.hidden = true;
    emptyMessage.hidden = true;
    errorMessage.hidden = true;
    viewMoreBtn.hidden = true;
  }

  // limit=BATCH_SIZE for the initial page load (just the first 9);
  // limit=Infinity for the "View more" button, which loads every
  // remaining file in one go rather than another batch of 9. Array.slice
  // (used inside getFiles) handles an Infinity end bound fine -- it just
  // clamps to however many results actually exist.
  function loadFiles(limit) {
    if (state.isLoading || !state.hasMore) return;

    state.isLoading = true;
    viewMoreBtn.hidden = true;

    getFiles({
      sort: state.sort,
      date: state.date,
      offset: state.offset,
      limit: limit
    }).then((result) => {
      state.isLoading = false;

      if (result.error) {
        errorMessage.hidden = false;
        state.hasMore = false;
        return;
      }

      result.files.forEach((file) => {
        grid.appendChild(createFileCard(file));
      });

      state.offset += result.files.length;
      state.hasMore = result.hasMore;

      if (state.offset === 0 && result.total === 0) {
        emptyMessage.hidden = false;
      } else if (state.hasMore) {
        viewMoreBtn.hidden = false;
      } else {
        endMessage.hidden = false;
      }
    });
  }

  // ---- Sort buttons ----
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const newSort = btn.getAttribute("data-sort");
      if (newSort === state.sort) return;

      sortButtons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      state.sort = newSort;
      resetView();
      loadFiles(BATCH_SIZE);
    });
  });

  // ---- Date search ----
  dateInput.addEventListener("change", () => {
    state.date = dateInput.value || null;
    resetView();
    loadFiles(BATCH_SIZE);
  });

  // ---- View more button ----
  viewMoreBtn.addEventListener("click", () => {
    loadFiles(Infinity);
  });

  // ---- Initial load ----
  loadFiles(BATCH_SIZE);
})();
