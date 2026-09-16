(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TONES = ["mint", "lilac", "sand"];
  var RAMP = " .:-=+*#%@";

  /* ------------------------------------------------------------ content */

  var FEATURES = [
    ["book-open", "m4b chapters, done properly", "Chapter marks are read straight out of the file (chpl, QuickTime, ID3 CHAP), listed in a dropdown, and can be edited or written back with ffmpeg."],
    ["headphones", "One folder, two ways to import", "Drop a folder of mp3s and choose: one book with many chapters, or one book per file. Amp never copies your audio, it just remembers the path."],
    ["sliders-horizontal", "A real 10-band equalizer", "Biquad filters in the audio graph, with presets, per-book memory, a preamp and a headroom-safe limiter so nothing clips."],
    ["gauge", "Speed, sleep timer, bookmarks", "0.5x to 3.5x, sleep timer by minutes or chapters, stop-after-chapter, and bookmarks with notes that survive restarts."],
    ["palette", "Adaptive colour from the cover", "Amp samples the artwork and tints the window, the player and the widget with it. Custom covers can be picked or searched online."],
    ["keyboard", "Every key is yours", "Around forty actions are rebindable, including skip intervals, chapter jumps, speed nudges and the global tray hotkeys."],
    ["folder-tree", "Folders, playlists, queue", "Organise however you think: nested folders, multiple playlists, a drag-to-reorder queue and a right-click reorder menu in the library."],
    ["square-stack", "Square covers, four layouts", "Grid, list, shelf and mini views. The mini player shrinks the window into a portrait widget that floats above your work."],
    ["search", "Search that finds things", "Full-text search across titles, authors, narrators, series, tags, folders and transcripts, with filters for finished and in-progress books."],
    ["tags", "Metadata editing", "Fix a wrong narrator, add a series index, merge a stray track, split a chapter, or add missing artwork without leaving the app."],
    ["moon", "Light, dark or adaptive", "A single theme token set drives the whole UI. Square corners if you want them; the palette follows the cover if you let it."],
    ["layout-grid", "Small on purpose", "No accounts, no telemetry, no cloud. One JSON library file you can read, diff and back up."]
  ];

  var ACQUISITION = [
    ["file-search", "Search from the app", "Query AudioBookBay, see size, format, bitrate and seeders, then send the magnet to qBittorrent without leaving Amp."],
    ["cloud-download", "Queue and import", "Watch progress per torrent, pause, resume, remove with or without files, and import finished downloads as books."],
    ["mic-vocal", "Optional transcription", "If whisper.cpp or openai-whisper is installed locally, Amp transcribes a book and turns the transcript into a chapter list."],
    ["network", "Remote listening", "Turn on the Tailscale server and stream from your phone, with token auth and HTTP range requests for seeking."],
    ["terminal", "TUI and Python GUI", "tui.py searches and downloads AudioBookBay from the terminal; gui.py is a small Tkinter companion for headless boxes."],
    ["server", "Server mode", "server.py serves the same endpoints as the desktop app, so the network app agrees with the local one."]
  ];

  var PLAYBACK_ROWS = [
    ["Formats", "m4b, m4a, mp3, mp4, flac, ogg, opus, aac — anything Chromium can decode"],
    ["Chapters", "Embedded chapters, filename rules, or manually marked; written back with ffmpeg"],
    ["Transport", "Play, pause, seek, skip, next/previous chapter, next/previous book, speed 0.5–3.5x"],
    ["Equalizer", "Ten bands, presets, preamp, saved per book"],
    ["Output", "Pick any system output device from the player, switch devices mid-chapter"],
    ["Sleep", "Timer in minutes or chapters, plus stop-after-chapter and a slow fade"],
    ["Tray", "Runs in the tray, media keys and a global hotkey bring it back"],
    ["Mini widget", "Portrait widget window, always-on-top optional, resize friendly"],
    ["Remote", "Optional Tailscale server so your phone on the tailnet can stream the library"]
  ];

  var PLAYBACK_CARDS = [
    ["audio-waveform", "Chapters as a dropdown", "Jump straight to chapter 37 without scrubbing for it."],
    ["volume-2", "Volume that remembers", "Per-book volume trims, mute, and a visible output device label."],
    ["monitor", "Mini widget", "One window that shrinks into a portrait player and floats above other apps."],
    ["battery-charging", "Sleep timer", "Fade out over the last thirty seconds so you don't lose your place."],
    ["cast", "Output switching", "setSinkId under the hood, with a fallback message when a device is unavailable."],
    ["mouse-pointer-click", "Right-click reorder", "Context menu reordering in the library, plus folders and playlists."]
  ];

  var PLATFORMS = [
    ["terminal-square", "Windows", "NSIS installer or portable", "Check Repo"],
  ];

  var INSTALL_NOTES = [
    ["shield-check", "Runs offline", "Amp makes no network requests unless you search a torrent index, look up a cover, or enable the remote server."],
    ["package", "Built by CI", "Every push builds the web app and runs the test suite; tagged releases publish installers from GitHub Actions."],
    ["copy", "Bring your library", "Settings and the library live in one JSON file per store, ready to commit, sync or keep in your dotfiles."]
  ];

  /* ------------------------------------------------------------ helpers */

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function iconTag(name) {
    return '<i data-lucide="' + name + '"></i>';
  }

  function renderCardGrid(target, items, toneOffset) {
    var grid = document.getElementById(target);
    if (!grid) return;
    items.forEach(function (item, index) {
      var tone = TONES[(index + (toneOffset || 0)) % TONES.length];
      var card = el("div", "card tone-" + tone);
      card.appendChild(el("div", "card-icon", iconTag(item[0])));
      card.appendChild(el("h3", null, item[1]));
      card.appendChild(el("p", null, item[2]));
      grid.appendChild(card);
    });
  }

  function renderPlaybackTable() {
    var table = document.getElementById("playback-table");
    if (!table) return;
    var thead = el("thead", null, "<tr><th>Area</th><th>What it does</th></tr>");
    var tbody = el("tbody");
    PLAYBACK_ROWS.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", null, row[0]));
      tr.appendChild(el("td", null, row[1]));
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
  }

  function renderInstallGrid() {
    var grid = document.getElementById("install-grid");
    if (!grid) return;

    PLATFORMS.forEach(function (platform, index) {
      var tone = TONES[index % TONES.length];
      var card = el("div", "card tone-" + tone);
      card.appendChild(el("div", "card-icon", iconTag(platform[0])));
      card.appendChild(el("h3", null, platform[1]));
      card.appendChild(el("p", null, platform[2]));
      var button = el("button", "btn btn-ghost copy-btn");
      button.type = "button";
      button.innerHTML = iconTag("copy") + '<span class="copy-label">' + platform[3] + "</span>";
      button.addEventListener("click", function () {
        copyText(platform[3], button);
      });
      card.appendChild(button);
      grid.appendChild(card);
    });

    INSTALL_NOTES.forEach(function (note, index) {
      var tone = TONES[(index + 1) % TONES.length];
      var card = el("div", "card tone-" + tone);
      card.appendChild(el("div", "card-icon", iconTag(note[0])));
      card.appendChild(el("h3", null, note[1]));
      card.appendChild(el("p", null, note[2]));
      grid.appendChild(card);
    });
  }

  function copyText(text, button) {
    var label = button.querySelector(".copy-label");
    var original = label.textContent;
    function done(ok) {
      label.textContent = ok ? "copied" : original;
      window.setTimeout(function () { label.textContent = original; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  /* ---------------------------------------------------------------- nav */

  function initNav() {
    var nav = document.getElementById("nav");
    var toggle = document.getElementById("nav-toggle");
    var links = document.getElementById("nav-links");

    function onScroll() {
      nav.style.borderBottomColor = window.scrollY > 12 ? "var(--line-strong)" : "var(--line)";
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* -------------------------------------------------- hero opening wave */
  /* The hero centerpiece wakes up from silence into a full waveform once,
     then settles into a slow, quiet idle — one deliberate moment rather
     than constant motion. */

  function shade(v) {
    var idx = Math.max(0, Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1))));
    return RAMP[idx];
  }

  function initHeroWave() {
    var pre = document.getElementById("hero-wave");
    if (!pre) return;

    var cols = 64;
    var rows = 9;
    var buildMs = 1000;
    var start = null;

    function renderFrame(amp, phase) {
      var rows2 = [];
      for (var r = 0; r < rows; r++) rows2.push(new Array(cols).fill(" "));
      for (var x = 0; x < cols; x++) {
        var envelope = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.11 + phase * 0.35));
        var v = Math.abs(Math.sin(x * 0.28 + phase)) * envelope * amp;
        var height = Math.round(v * rows);
        for (var y = 0; y < height; y++) {
          rows2[rows - 1 - y][x] = shade(v);
        }
      }
      pre.textContent = rows2.map(function (row) { return row.join(""); }).join("\n");
    }

    if (reduceMotion) {
      renderFrame(0.65, 0.6);
      return;
    }

    function tick(now) {
      if (start === null) start = now;
      var elapsed = now - start;
      var t = Math.min(1, elapsed / buildMs);
      var eased = 1 - Math.pow(1 - t, 3);
      var phase = elapsed / 1000;
      var idleAmp = 0.5 + 0.12 * Math.sin(phase * 0.4);
      var amp = t < 1 ? eased : idleAmp;
      renderFrame(amp, phase * (t < 1 ? 2.2 : 0.6));
      window.requestAnimationFrame(tick);
    }

    window.requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------- wave dividers */
  /* Thin ascii waveform strips used as section separators — a single
     shared brand motif rather than a per-section reveal effect. */

  function initWaveDividers() {
    var nodes = document.querySelectorAll(".wave-divider");
    if (!nodes.length) return;

    var chars = "-_.,:;~=";
    var width = 90;

    function renderStatic(node, phase) {
      var out = "";
      for (var x = 0; x < width; x++) {
        var v = (Math.sin(x * 0.5 + phase) + 1) / 2;
        out += chars[Math.round(v * (chars.length - 1))];
      }
      node.textContent = out;
    }

    if (reduceMotion) {
      nodes.forEach(function (node) {
        renderStatic(node, Number(node.dataset.phase || 0));
      });
      return;
    }

    var t = 0;
    window.setInterval(function () {
      t += 0.12;
      nodes.forEach(function (node) {
        renderStatic(node, t + Number(node.dataset.phase || 0));
      });
    }, 150);
  }

  /* ---------------------------------------------------------------- init */

  document.addEventListener("DOMContentLoaded", function () {
    renderCardGrid("features-grid", FEATURES, 0);
    renderCardGrid("acquisition-grid", ACQUISITION, 1);
    renderCardGrid("playback-cards", PLAYBACK_CARDS, 2);
    renderPlaybackTable();
    renderInstallGrid();

    initNav();
    initHeroWave();
    initWaveDividers();

    if (window.lucide) window.lucide.createIcons();
  });
})();