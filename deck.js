/**
 * Deck runtime, same idea as p4k-deck's <deck-stage>:
 * a fixed 1920×1080 canvas scaled to the viewport, slides kept in the DOM,
 * and the slide number written to the URL hash (#1, #2, …).
 *
 * Navigation: arrows, Space, PgUp/PgDn, Home/End, digit jump, R, F, N, ?,
 * click on the side edges, buttons, and horizontal swipe.
 * Elements with [data-frag="N"] stay hidden until the next "forward"
 * action reveals the next group — a lecture build, before the slide changes.
 */
(() => {
  const W = 1920;
  const H = 1080;
  const stage = document.querySelector("deck-stage");
  if (!stage) return;

  const slides = [...stage.children].filter((el) => el.tagName === "SECTION");
  const bar = document.getElementById("bar");
  const countEl = document.getElementById("count");
  const partEl = document.getElementById("part");
  const fragEl = document.getElementById("frag");
  const live = document.getElementById("live");
  const help = document.getElementById("help");
  const notesPanel = document.getElementById("notes-panel");
  const hud = document.getElementById("hud");

  const PARTS = {
    start: "Старт",
    anatomy: "Анатомия",
    hr: "Кадры",
    docs: "Документы",
    money: "Финансы",
    craft: "Свой скилл",
    end: "Итог",
  };

  let index = -1;
  let started = false;
  let typeToken = 0;
  let digits = "";
  let digitTimer = 0;
  let notesOn = false;
  let swallowClick = false;
  let pointer = null;

  const coarse = () => window.matchMedia("(pointer: coarse)").matches;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobileQuery = window.matchMedia("(max-width: 900px)");

  function fragMax(slide) {
    let max = 0;
    slide.querySelectorAll("[data-frag]").forEach((el) => {
      max = Math.max(max, parseInt(el.dataset.frag, 10) || 0);
    });
    return max;
  }

  function shownOf(slide) {
    return parseInt(slide.dataset.shown || "0", 10) || 0;
  }

  function applyFrags(slide) {
    const shown = shownOf(slide);
    slide.querySelectorAll("[data-frag]").forEach((el) => {
      const n = parseInt(el.dataset.frag, 10) || 0;
      const on = n <= shown;
      const was = el.classList.contains("on");
      el.classList.toggle("on", on);
      el.setAttribute("aria-hidden", on ? "false" : "true");
      if (on && !was) typeWithin(el);
    });
  }

  function clearTimers(root) {
    root.querySelectorAll(".typer").forEach((el) => {
      if (el._timer) clearTimeout(el._timer);
      el._timer = 0;
    });
  }

  function fullText(el) {
    if (!el.dataset.full) el.dataset.full = (el.textContent || "").replace(/\s+/g, " ").trim();
    return el.dataset.full;
  }

  function typeEl(el) {
    const full = fullText(el);
    if (el._timer) clearTimeout(el._timer);
    const token = typeToken;
    if (reduced()) {
      el.textContent = full;
      el.classList.remove("typing");
      return;
    }
    const delay = (parseFloat(el.dataset.delay || "0") || 0) * 1000;
    el.textContent = "";
    el.classList.add("typing");
    const tick = (i) => {
      if (token !== typeToken) return;
      if (!stage.querySelector("section[data-deck-active]")?.contains(el)) return;
      const ch = full[i];
      const step = ch === " " ? 1 : 2;
      i = Math.min(full.length, i + step);
      el.textContent = full.slice(0, i);
      if (i < full.length) el._timer = setTimeout(() => tick(i), 16);
      else el.classList.remove("typing");
    };
    el._timer = setTimeout(() => tick(0), delay);
  }

  function typeWithin(root) {
    root.querySelectorAll(".typer").forEach((el) => {
      const frag = el.closest("[data-frag]");
      if (frag && !frag.classList.contains("on")) return;
      typeEl(el);
    });
  }

  function fit() {
    const mobile = mobileQuery.matches;
    document.documentElement.classList.toggle("is-mobile", mobile);
    if (mobile) {
      stage.style.width = "100%";
      stage.style.height = "auto";
      stage.style.transform = "none";
      stage.style.left = "auto";
      stage.style.top = "auto";
      stage.style.position = "relative";
      stage.style.overflow = "visible";
      return;
    }
    stage.style.overflow = "";
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.position = "absolute";
    stage.style.width = W + "px";
    stage.style.height = H + "px";
    stage.style.left = "50%";
    stage.style.top = "50%";
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function parseHash() {
    const m = (location.hash || "").match(/^#(\d+)$/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (!n || n < 1) return 0;
    return Math.min(slides.length - 1, n - 1);
  }

  function updateHud(slide) {
    const n = index + 1;
    const part = PARTS[slide.dataset.part] || "";
    countEl.textContent = n + " / " + slides.length;
    partEl.textContent = part;
    const max = fragMax(slide);
    const shown = shownOf(slide);
    const pending = shown < max;
    stage.toggleAttribute("data-pending", pending);
    fragEl.textContent = max ? (pending ? "шаг " + shown + "/" + max : "шаг " + max + "/" + max) : "";
    if (bar) bar.style.width = (n / slides.length) * 100 + "%";
    const label = slide.dataset.label || part || "Слайд";
    document.title = n + " · " + label + " — Скиллы для ИИ-агентов";
    if (live) live.textContent = "Слайд " + n + " из " + slides.length + ". " + label;
    document.querySelectorAll(".part-pip").forEach((pip) => {
      const order = ["start", "anatomy", "hr", "docs", "money", "craft", "end"];
      const cur = order.indexOf(slide.dataset.part);
      const mine = order.indexOf(pip.dataset.part);
      pip.classList.toggle("on", mine === cur);
      pip.classList.toggle("done", mine > -1 && mine < cur);
    });
    if (notesOn) renderNotes();
  }

  function renderNotes() {
    const slide = slides[index];
    const note = slide.querySelector(".notes");
    const text = note ? note.textContent.trim() : "";
    notesPanel.hidden = false;
    notesPanel.innerHTML = "<b>Заметки · " + (index + 1) + "</b><p>" +
      (text ? escapeHtml(text) : "На этом слайде заметок нет.") + "</p>";
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function go(next, dir, opts = {}) {
    if (!slides.length) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    if (clamped === index && !opts.force) {
      flash();
      return;
    }
    const prev = index >= 0 ? slides[index] : null;
    if (prev) {
      prev.removeAttribute("data-deck-active");
      prev.classList.remove("leave");
      prev.dataset.leave = dir < 0 ? "back" : "fwd";
      prev.classList.add("leave");
      const leaving = prev;
      setTimeout(() => leaving.classList.remove("leave"), 520);
      clearTimers(prev);
    }
    const jumped = opts.init || Math.abs(clamped - index) > 1;
    index = clamped;
    const slide = slides[index];
    typeToken++;
    if (jumped || dir < 0) slide.dataset.shown = String(fragMax(slide));
    else slide.dataset.shown = "0";
    applyFrags(slide);
    stage.dataset.dir = dir < 0 ? "back" : "fwd";
    slides.forEach((s, i) => {
      if (i === index) {
        s.setAttribute("data-deck-active", "");
        s.classList.remove("leave");
      } else s.removeAttribute("data-deck-active");
      s.setAttribute("aria-hidden", i === index ? "false" : "true");
    });
    try { history.replaceState(null, "", "#" + (index + 1)); } catch (e) {}
    updateHud(slide);
    typeWithin(slide);
    flash();
    resetMobileScroll();
  }

  function resetMobileScroll() {
    if (!mobileQuery.matches) return;
    const slide = slides[index];
    if (slide) slide.scrollTop = 0;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }

  function next() {
    if (!started || index < 0) return;
    const slide = slides[index];
    if (!slide) return;
    const max = fragMax(slide);
    const shown = shownOf(slide);
    if (shown < max) {
      slide.dataset.shown = String(shown + 1);
      applyFrags(slide);
      updateHud(slide);
      flash();
      return;
    }
    if (index >= slides.length - 1) { flash(); return; }
    go(index + 1, 1);
  }

  function prev() {
    if (!started || index < 0) return;
    const slide = slides[index];
    if (slide && shownOf(slide) > 0 && fragMax(slide) > 0) {
      slide.dataset.shown = String(shownOf(slide) - 1);
      applyFrags(slide);
      updateHud(slide);
      flash();
      return;
    }
    if (index <= 0) { flash(); return; }
    go(index - 1, -1);
  }

  function flash() {
    if (!hud) return;
    hud.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      if (!mobileQuery.matches) hud.classList.remove("show");
    }, 1800);
  }

  function toggleHelp(force) {
    const open = typeof force === "boolean" ? force : help.hidden;
    help.hidden = !open;
  }

  function toggleNotes() {
    notesOn = !notesOn;
    document.body.classList.toggle("show-notes", notesOn);
    if (notesOn) renderNotes();
    else notesPanel.hidden = true;
  }

  function onKey(e) {
    if (!started) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const key = e.key;
    if (key === "Escape") {
      if (!help.hidden) { help.hidden = true; e.preventDefault(); }
      return;
    }
    if (key === "?" || (key === "/" && e.shiftKey)) {
      toggleHelp();
      e.preventDefault();
      return;
    }
    if (key === "n" || key === "N" || key === "т" || key === "Т") {
      toggleNotes();
      e.preventDefault();
      return;
    }
    if (key === "f" || key === "F" || key === "а" || key === "А") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
      e.preventDefault();
      return;
    }
    let handled = true;
    if (key === "ArrowRight" || key === "PageDown" || key === " " || key === "Spacebar") next();
    else if (key === "ArrowLeft" || key === "PageUp" || key === "Backspace") prev();
    else if (key === "Home" || key === "r" || key === "R" || key === "к" || key === "К") go(0, -1);
    else if (key === "End") go(slides.length - 1, 1);
    else if (/^[0-9]$/.test(key)) {
      digits += key;
      clearTimeout(digitTimer);
      fragEl.textContent = "к слайду " + digits;
      digitTimer = setTimeout(() => {
        const n = parseInt(digits, 10);
        digits = "";
        if (n >= 1 && n <= slides.length) go(n - 1, n - 1 >= index ? 1 : -1);
        else updateHud(slides[index]);
      }, 650);
    } else handled = false;
    if (handled) e.preventDefault();
  }

  function interactive(target) {
    return target.closest("a, button, input, textarea, label, .hud, .help, .notes-panel");
  }

  document.addEventListener("keydown", onKey);

  function beginGesture(x, y, target) {
    if (interactive(target)) { pointer = null; return; }
    pointer = { x: x, y: y, used: false };
  }
  /* passive: these listeners must not be able to cancel a scroll. */
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    beginGesture(e.clientX, e.clientY, e.target);
  }, { passive: true });
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { pointer = null; return; }
    const t = e.touches[0];
    beginGesture(t.clientX, t.clientY, e.target);
  }, { passive: true });

  function endGesture(x, y) {
    if (!pointer || pointer.used) return;
    pointer.used = true;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    const moved = Math.abs(dx) > 12 || Math.abs(dy) > 12;
    /* A drag is not a click. Vertical movement is the browser's scroll. */
    if (moved) swallowClick = true;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
    if (dx < 0) next();
    else prev();
  }
  document.addEventListener("pointerup", (e) => endGesture(e.clientX, e.clientY), { passive: true });
  document.addEventListener("touchend", (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    endGesture(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; return; }
    if (e.button !== 0 || interactive(e.target)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim().length) return;
    const x = e.clientX / window.innerWidth;
    const left = coarse() ? 0.3 : 0.08;
    const right = coarse() ? 0.7 : 0.92;
    if (x <= left) prev();
    else if (x >= right) next();
  });

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dir = btn.dataset.go;
      if (dir === "next") next();
      else if (dir === "prev") prev();
      else if (dir === "help") toggleHelp();
    });
  });

  window.addEventListener("hashchange", () => {
    const n = parseHash();
    if (n !== index) go(n, n >= index ? 1 : -1, { init: true });
  });

  window.addEventListener("resize", fit);
  mobileQuery.addEventListener?.("change", fit);

  window.addEventListener("beforeprint", () => {
    slides.forEach((slide) => {
      slide.querySelectorAll(".typer").forEach((el) => { el.textContent = fullText(el); el.classList.remove("typing"); });
      slide.querySelectorAll("[data-frag]").forEach((el) => el.classList.add("on"));
    });
  });

  slides.forEach((slide, i) => {
    slide.setAttribute("data-deck-slide", String(i));
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "слайд");
    slide.setAttribute("aria-label", (i + 1) + ". " + (slide.dataset.label || ""));
  });

  fit();
  const start = () => {
    if (start.done) return;
    start.done = true;
    started = true;
    document.body.classList.add("ready");
    go(parseHash(), 1, { init: true, force: true });
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  setTimeout(start, 1400);

  document.addEventListener("mousemove", () => flash());
})();
