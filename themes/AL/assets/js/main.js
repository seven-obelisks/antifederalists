/* Anti-Federalist Library: site scripts (loaded at the end of <body>) */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- Storage helpers (storage can be blocked) ---------- */
  function saveTheme(value) {
    try {
      localStorage.setItem("theme", value);
    } catch (e) {}
  }

  /* ---------- Theme toggle ----------
     The initial theme is applied in <head> before first paint. */
  var toggle = document.getElementById("theme-toggle");
  var toggleImg = document.getElementById("theme-toggle-img");
  var toggleLabel = document.getElementById("theme-toggle-label");

  function syncToggle() {
    if (!toggle) return;
    var isDark = root.classList.contains("dark");
    toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    if (toggleImg) {
      toggleImg.src = isDark ? toggle.dataset.light : toggle.dataset.dark;
    }
    if (toggleLabel) {
      toggleLabel.textContent = isDark ? "Switch to light mode" : "Switch to dark mode";
    }
    toggle.title = toggleLabel ? toggleLabel.textContent : "";
  }

  syncToggle();

  if (toggle) {
    toggle.addEventListener("click", function () {
      var isDark = root.classList.toggle("dark");
      saveTheme(isDark ? "dark" : "light");
      syncToggle();
    });
  }

  /* ---------- Library panel ---------- */
  var libraryButton = document.getElementById("library-button");
  var libraryPanel = document.getElementById("library-panel");

  function setPanel(open, returnFocus) {
    if (!libraryButton || !libraryPanel) return;
    libraryPanel.classList.toggle("is-open", open);
    libraryButton.setAttribute("aria-expanded", open ? "true" : "false");
    root.classList.toggle("panel-open", open);
    if (!open && returnFocus) libraryButton.focus();
  }

  if (libraryButton && libraryPanel) {
    libraryButton.addEventListener("click", function () {
      setPanel(libraryButton.getAttribute("aria-expanded") !== "true", false);
    });

    /* Close with Escape. */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && libraryPanel.classList.contains("is-open")) {
        setPanel(false, true);
      }
    });

    /* Close when clicking outside the header. */
    document.addEventListener("click", function (e) {
      if (!libraryPanel.classList.contains("is-open")) return;
      var header = libraryButton.closest(".site-header");
      if (header && !header.contains(e.target)) setPanel(false, false);
    });

    /* Close when focus leaves the header (keyboard users tabbing on). */
    document.addEventListener("focusin", function (e) {
      if (!libraryPanel.classList.contains("is-open")) return;
      var header = libraryButton.closest(".site-header");
      if (header && !header.contains(e.target)) setPanel(false, false);
    });
  }

  /* ---------- Featured paper (home page) ---------- */
  var featured = document.getElementById("featured-paper");
  var featuredData = document.getElementById("featured-paper-data");

  if (featured && featuredData) {
    try {
      var papers = JSON.parse(featuredData.textContent);
      if (papers.length) {
        var pick = papers[Math.floor(Math.random() * papers.length)];
        var link = featured.querySelector("a");
        var summary = featured.querySelector("p");
        if (link) {
          link.href = pick.url;
          link.textContent = pick.title;
        }
        if (summary) {
          summary.textContent = pick.summary;
        }
      }
    } catch (e) {
      /* Keep the build-time selection if the data cannot be read. */
    }
  }
})();