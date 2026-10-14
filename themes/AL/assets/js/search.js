/* Anti-Federalist Library: full-text search (loaded on the search page only) */
(function () {
  "use strict";

  var form = document.getElementById("page-search-form");
  var input = document.getElementById("page-search-box");
  var resultsList = document.getElementById("results");
  var status = document.getElementById("search-status");
  var script = document.getElementById("search-script");

  if (!form || !input || !resultsList || !status || !script) {
    return;
  }

  var INDEX_URL = script.dataset.index;
  var CONTEXT = 80;          /* characters of context on each side of a match */
  var MAX_SNIPPETS = 3;      /* snippets shown per result */
  var MAX_COUNT = 500;       /* stop counting matches per term after this */

  /* Common words ignored when a query also contains more specific words. */
  var STOP_WORDS = [
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
    "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "with"
  ];

  var store = null;
  var pendingQuery = null;

  /* ---------- Utilities ---------- */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(text) {
    status.textContent = text;
  }

  /* Split a query into terms. Quoted text is kept as one phrase.
     Returns { terms, phrase } where phrase is the unquoted multi-word
     query used for ranking and snippet selection. */
  function parseQuery(query) {
    var phrases = [];
    var words = [];
    var phraseRe = /"([^"]+)"/g;
    var match;
    while ((match = phraseRe.exec(query)) !== null) {
      var quoted = match[1].trim().toLowerCase().replace(/\s+/g, " ");
      if (quoted) phrases.push(quoted);
    }
    query
      .replace(phraseRe, " ")
      .replace(/"/g, " ")
      .split(/\s+/)
      .forEach(function (word) {
        word = word.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, "");
        if (word) words.push(word);
      });

    var allWords = words.slice();
    var specific = words.filter(function (w) {
      return STOP_WORDS.indexOf(w) === -1;
    });
    if (specific.length || phrases.length) words = specific;

    var terms = phrases.concat(words).filter(function (term, i, arr) {
      return arr.indexOf(term) === i;
    });

    return {
      terms: terms,
      phrase: allWords.length > 1 ? allWords.join(" ") : null
    };
  }

  function isWordChar(ch) {
    return !!ch && /[0-9a-z\u00c0-\u024f]/.test(ch);
  }

  /* Count occurrences of term in text that start at a word boundary, and
     optionally record their positions. */
  function findAll(text, term, positions) {
    var count = 0;
    var from = 0;
    var idx;
    while ((idx = text.indexOf(term, from)) !== -1) {
      from = idx + term.length;
      if (idx > 0 && isWordChar(text.charAt(idx - 1))) continue;
      count++;
      if (positions) positions.push([idx, idx + term.length]);
      if (count >= MAX_COUNT) break;
    }
    return count;
  }

  /* ---------- Search ---------- */
  function search(query) {
    var parsed = parseQuery(query);
    var terms = parsed.terms;
    var fullPhrase = parsed.phrase;
    if (!terms.length) return { terms: terms, phrase: fullPhrase, results: [] };

    var results = [];

    store.forEach(function (doc) {
      var score = 0;
      var total = 0;

      for (var i = 0; i < terms.length; i++) {
        var titleHits = findAll(doc.lt, terms[i]);
        var contentHits = findAll(doc.lc, terms[i]);
        if (titleHits + contentHits === 0) return; /* every term must match */
        score += titleHits * 25 + Math.min(contentHits, 50);
        total += contentHits;
      }

      if (fullPhrase) {
        if (doc.lt.indexOf(fullPhrase) !== -1) score += 50;
        score += Math.min(findAll(doc.lc, fullPhrase), 20) * 5;
      }

      results.push({ doc: doc, score: score, total: total });
    });

    /* Ties keep the site order (by weight), so series stay in sequence. */
    results.sort(function (a, b) {
      return b.score - a.score || a.doc.order - b.doc.order;
    });

    return { terms: terms, phrase: fullPhrase, results: results };
  }

  /* Build up to MAX_SNIPPETS excerpts with matches marked, in original case.
     Excerpts containing the full phrase are preferred. */
  function buildSnippets(doc, terms, fullPhrase) {
    var text = doc.c;
    var positions = [];
    terms.forEach(function (term) {
      findAll(doc.lc, term, positions);
    });
    if (!positions.length) return [];

    /* Anchor points decide where excerpts are taken from. */
    var anchors = [];
    if (fullPhrase) findAll(doc.lc, fullPhrase, anchors);
    if (!anchors.length) anchors = positions.slice();
    anchors.sort(function (a, b) {
      return a[0] - b[0];
    });

    positions.sort(function (a, b) {
      return a[0] - b[0] || b[1] - a[1];
    });

    /* Merge overlapping match ranges. */
    var ranges = [];
    positions.forEach(function (p) {
      var last = ranges[ranges.length - 1];
      if (last && p[0] <= last[1]) {
        last[1] = Math.max(last[1], p[1]);
      } else {
        ranges.push([p[0], p[1]]);
      }
    });

    /* Build context windows around anchors, merging any that overlap. */
    var windows = [];
    anchors.forEach(function (a) {
      var start = Math.max(0, a[0] - CONTEXT);
      var end = Math.min(text.length, a[1] + CONTEXT);
      var last = windows[windows.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
      } else if (windows.length < MAX_SNIPPETS) {
        windows.push({ start: start, end: end });
      }
    });

    /* Attach every match range that falls fully inside each window. */
    windows.forEach(function (w) {
      w.ranges = ranges.filter(function (r) {
        return r[0] >= w.start && r[1] <= w.end;
      });
    });

    return windows.map(function (w) {
      /* Snap to word boundaries so excerpts do not start mid word. */
      var start = w.start;
      var end = w.end;
      if (start > 0) {
        var space = text.indexOf(" ", start);
        if (space !== -1 && space < w.ranges[0][0]) start = space + 1;
      }
      if (end < text.length) {
        var lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > w.ranges[w.ranges.length - 1][1]) end = lastSpace;
      }

      var html = start > 0 ? "\u2026" : "";
      var cursor = start;
      w.ranges.forEach(function (r) {
        html += escapeHtml(text.slice(cursor, r[0]));
        html += "<mark>" + escapeHtml(text.slice(r[0], r[1])) + "</mark>";
        cursor = r[1];
      });
      html += escapeHtml(text.slice(cursor, end));
      if (end < text.length) html += "\u2026";
      return html;
    });
  }

  function render(query) {
    var outcome = search(query);
    var results = outcome.results;
    resultsList.innerHTML = "";

    if (!outcome.terms.length) {
      setStatus("");
      return;
    }

    if (!results.length) {
      setStatus("No results found for \u201c" + query + "\u201d.");
      return;
    }

    setStatus(
      results.length + " result" + (results.length === 1 ? "" : "s") +
      " for \u201c" + query + "\u201d."
    );

    var fragment = document.createDocumentFragment();
    results.forEach(function (result) {
      var doc = result.doc;
      var snippets = buildSnippets(doc, outcome.terms, outcome.phrase);
      var li = document.createElement("li");
      var html = '<a class="result-title" href="' + escapeHtml(doc.u) + '">' + escapeHtml(doc.t) + "</a>";
      if (doc.s) {
        html += '<div class="result-section">' + escapeHtml(doc.s) + "</div>";
      }
      if (snippets.length) {
        html += '<div class="snippet-container">' +
          snippets.map(function (s) {
            return '<p class="search-snippet">' + s + "</p>";
          }).join("") +
          "</div>";
      }
      var countLabel = result.total >= MAX_COUNT ? MAX_COUNT + "+" : String(result.total);
      if (result.total > 0) {
        html += '<small class="match-count">' + countLabel + " match" + (result.total === 1 ? "" : "es") + " in text</small>";
      } else {
        html += '<small class="match-count">Match in title</small>';
      }
      li.innerHTML = html;
      fragment.appendChild(li);
    });
    resultsList.appendChild(fragment);
  }

  function run(query) {
    query = query.trim();
    if (!query) {
      resultsList.innerHTML = "";
      setStatus("");
      return;
    }
    if (!store) {
      pendingQuery = query;
      setStatus("Loading the library index\u2026");
      return;
    }
    render(query);
  }

  /* ---------- Events ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var query = input.value.trim();
    var url = new URL(window.location.href);
    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState({}, "", url);
    run(query);
  });

  /* ---------- Initial load ---------- */
  var initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  input.value = initialQuery;
  if (initialQuery) run(initialQuery);

  fetch(INDEX_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      store = data.map(function (doc, i) {
        doc.order = i;
        doc.c = doc.c || "";
        doc.t = doc.t || "";
        doc.lt = doc.t.toLowerCase();
        doc.lc = doc.c.toLowerCase();
        return doc;
      });
      if (pendingQuery) run(pendingQuery);
    })
    .catch(function () {
      setStatus("Search is unavailable right now. Please try again later.");
    });
})();