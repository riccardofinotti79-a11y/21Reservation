/*!
 * 21Reservation Widget v1 — https://21reservation.app
 * Usage:
 *   Inline embed:
 *     <div data-21r-widget data-subdomain="demo"></div>
 *     <script src="https://your-host/widget.js" async></script>
 *   Floating button:
 *     <div data-21r-widget data-subdomain="demo" data-mode="button" data-label="Prenota un tavolo"></div>
 *     <script src="https://your-host/widget.js" async></script>
 */
(function () {
  "use strict";
  // Guard against double-load of the script tag on the same page.
  if (window.__R21_WIDGET_LOADED__) return;
  window.__R21_WIDGET_LOADED__ = true;
  var scriptEl = document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();
  var scriptSrc = (scriptEl && scriptEl.src) || "";
  var BASE = scriptSrc.replace(/\/widget\.js.*$/, "");

  var registry = {}; // iframe.name -> element
  var counter = 0;

  function buildSrc(sub, params) {
    var qs = "embed=1";
    if (params && params.origin) qs += "&origin=" + encodeURIComponent(params.origin);
    if (params && params.theme) qs += "&theme=" + encodeURIComponent(params.theme);
    if (params && params.accent) qs += "&accent=" + encodeURIComponent(params.accent);
    return BASE + "/book/" + encodeURIComponent(sub) + "?" + qs;
  }

  function makeIframe(sub, opts) {
    counter += 1;
    var name = "r21f-" + counter;
    var iframe = document.createElement("iframe");
    iframe.name = name;
    iframe.setAttribute("data-21r-iframe", "1");
    iframe.setAttribute("allow", "clipboard-write; payment *");
    iframe.setAttribute("title", "Prenota un tavolo");
    iframe.src = buildSrc(sub, {
      origin: window.location.origin,
      theme: opts && opts.theme,
      accent: opts && opts.accent,
    });
    iframe.style.cssText = [
      "width:100%",
      "border:0",
      "background:transparent",
      "display:block",
      "min-height:" + ((opts && opts.minHeight) || 720) + "px",
      "transition:height .2s ease"
    ].join(";");
    registry[name] = iframe;
    return iframe;
  }

  function readEmbedOpts(el, defaults) {
    var theme = (el.getAttribute("data-theme") || "").toLowerCase();
    var accent = el.getAttribute("data-accent") || el.getAttribute("data-color") || "";
    return {
      theme: theme === "light" ? "light" : (theme === "dark" ? "dark" : ""),
      accent: accent || "",
      minHeight: defaults && defaults.minHeight,
    };
  }

  function mountInline(el) {
    var sub = el.getAttribute("data-subdomain");
    if (!sub) return;
    if (el.__r21mounted) return;
    el.__r21mounted = true;
    var iframe = makeIframe(sub, readEmbedOpts(el, { minHeight: 720 }));
    el.appendChild(iframe);
  }

  function mountButton(el) {
    var sub = el.getAttribute("data-subdomain");
    if (!sub) return;
    if (el.__r21mounted) return;
    el.__r21mounted = true;
    var label = el.getAttribute("data-label") || "Prenota un tavolo";
    var accent = el.getAttribute("data-accent") || el.getAttribute("data-color") || "#D97706";
    var theme = (el.getAttribute("data-theme") || "").toLowerCase();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = label;
    btn.style.cssText = [
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "font-size:14px",
      "font-weight:600",
      "letter-spacing:.02em",
      "padding:12px 22px",
      "background:" + accent,
      "color:#0a0a0a",
      "border:0",
      "border-radius:999px",
      "cursor:pointer",
      "box-shadow:0 8px 24px -8px " + accent + "80",
      "transition:transform .15s ease, box-shadow .2s ease"
    ].join(";");
    btn.onmouseenter = function () { btn.style.transform = "translateY(-1px)"; };
    btn.onmouseleave = function () { btn.style.transform = "translateY(0)"; };
    btn.onclick = function () { openModal(sub); };
    el.appendChild(btn);
  }

  function openModal(sub, opts) {
    var overlay = document.createElement("div");
    overlay.setAttribute("data-21r-overlay", "1");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(0,0,0,.72)",
      "backdrop-filter:blur(6px)",
      "-webkit-backdrop-filter:blur(6px)",
      "z-index:2147483000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:16px",
      "opacity:0",
      "transition:opacity .2s ease"
    ].join(";");
    var shell = document.createElement("div");
    shell.style.cssText = [
      "position:relative",
      "width:100%",
      "max-width:820px",
      "height:90vh",
      "background:#09090b",
      "border-radius:16px",
      "overflow:hidden",
      "box-shadow:0 30px 80px -20px rgba(0,0,0,.6)"
    ].join(";");
    var closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute("aria-label", "Chiudi");
    closeBtn.style.cssText = [
      "position:absolute",
      "top:12px",
      "right:12px",
      "z-index:2",
      "width:36px",
      "height:36px",
      "border-radius:999px",
      "border:0",
      "background:rgba(255,255,255,.1)",
      "color:#fff",
      "font-size:22px",
      "line-height:32px",
      "cursor:pointer"
    ].join(";");
    closeBtn.onclick = function () { closeModal(overlay); };
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) closeModal(overlay);
    });
    var iframe = makeIframe(sub, {
      minHeight: 640,
      theme: opts && opts.theme,
      accent: opts && opts.accent,
    });
    iframe.style.cssText += ";width:100%;height:100%;";
    shell.appendChild(closeBtn);
    shell.appendChild(iframe);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.style.opacity = "1"; });
    document.addEventListener("keydown", escHandler);
    function escHandler(e) {
      if (e.key === "Escape") { closeModal(overlay); document.removeEventListener("keydown", escHandler); }
    }
  }

  function closeModal(overlay) {
    overlay.style.opacity = "0";
    setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    // Include root itself if it matches
    if (root && root.matches && root.matches("[data-21r-widget]")) {
      mountOne(root);
    }
    scope.querySelectorAll("[data-21r-widget]").forEach(mountOne);
  }

  function mountOne(el) {
    if (!el || el.__r21mounted) return;
    var mode = (el.getAttribute("data-mode") || "inline").toLowerCase();
    if (mode === "button") mountButton(el);
    else mountInline(el);
  }

  window.addEventListener("message", function (ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== "21reservation") return;
    if (data.type === "height" && data.name && registry[data.name]) {
      var h = Math.max(320, Math.min(4000, parseInt(data.height, 10) || 0));
      registry[data.name].style.height = h + "px";
      registry[data.name].style.minHeight = h + "px";
    }
    if (data.type === "close") {
      // Close the nearest overlay if we are in a modal
      var iframe = registry[data.name];
      if (iframe) {
        var overlay = iframe.closest("[data-21r-overlay]");
        if (overlay) closeModal(overlay);
      }
    }
  });

  // The iframe cannot know its own frame.name reliably across origins; we
  // ask each iframe to include its window.name in messages by seeding it via
  // src?frame=<name>. Simpler: use `iframe.name` (set above) and the iframe
  // reads `window.name` on load.
  // Kick things off:
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { scan(); });
  } else {
    scan();
  }

  // Observe future DOM insertions so widgets added after load (SPA re-renders,
  // dynamic hosts, page builders) auto-mount without needing R21Widget.rescan().
  function startObserver() {
    if (!("MutationObserver" in window) || !document.body) return;
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n && n.nodeType === 1) scan(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);

  // Also expose a manual API for SPA hosts
  window.R21Widget = { rescan: function () { scan(); }, open: openModal };
})();
