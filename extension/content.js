// Echo — content script
// Injects the Echo sidebar into ChatGPT and hooks the prompt submit.

(function () {
  if (window.__ECHO_INJECTED__) return;
  window.__ECHO_INJECTED__ = true;

  const SIDEBAR_ID = "echo-sidebar-root";
  const TOGGLE_ID = "echo-toggle-btn";

  // ---------- sidebar DOM ----------
  function buildSidebar() {
    const root = document.createElement("div");
    root.id = SIDEBAR_ID;
    root.className = "echo-hidden";
    root.innerHTML = `
      <div class="echo-header">
        <div class="echo-brand">
          <div class="echo-logo-dot"></div>
          <div>
            <div class="echo-title">Echo</div>
            <div class="echo-subtitle">See the same AI, from every angle.</div>
          </div>
        </div>
        <div class="echo-header-actions">
          <button class="echo-min" aria-label="Minimize" title="Minimize">–</button>
          <button class="echo-close" aria-label="Close" title="Close">×</button>
        </div>
      </div>
      <div class="echo-resize-handle" aria-label="Resize"></div>

      <div class="echo-empty">
        <div class="echo-empty-ring">
          <div class="echo-empty-inner">—</div>
        </div>
        <div class="echo-empty-title">Ask ChatGPT anything</div>
        <div class="echo-empty-text">Echo will silently generate 3 adversarial variants and score consistency.</div>
      </div>

      <div class="echo-body" hidden>
        <div class="echo-score-card">
          <div class="echo-score-ring">
            <svg viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="52" stroke="#1a1333" stroke-width="10" fill="none"/>
              <circle class="echo-score-arc" cx="60" cy="60" r="52" stroke="url(#echo-grad)" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="326" stroke-dashoffset="326" transform="rotate(-90 60 60)"/>
              <defs>
                <linearGradient id="echo-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#D946EF"/>
                  <stop offset="100%" stop-color="#7C3AED"/>
                </linearGradient>
              </defs>
            </svg>
            <div class="echo-score-num">—</div>
          </div>
          <div class="echo-score-meta">
            <div class="echo-score-label">Consistency</div>
            <div class="echo-score-verdict">Waiting for your first prompt…</div>
          </div>
        </div>

        <div class="echo-tabs">
          <button class="echo-tab is-active" data-tab="responses">Responses</button>
          <button class="echo-tab" data-tab="contradictions">Contradictions</button>
        </div>

        <div class="echo-panel" data-panel="responses">
          <div class="echo-resp-list"></div>
        </div>
        <div class="echo-panel" data-panel="contradictions" hidden>
          <div class="echo-contr-list"></div>
        </div>
      </div>

      <div class="echo-footer">
        <span class="echo-status">ready</span>
        <span class="echo-powered">powered by Claude + GPT-4o</span>
      </div>
    `;
    return root;
  }

  function buildToggle() {
    const btn = document.createElement("button");
    btn.id = TOGGLE_ID;
    btn.setAttribute("aria-label", "Open Echo");
    btn.innerHTML = `<span class="echo-toggle-dot"></span><span>Echo</span>`;
    return btn;
  }

  const sidebar = buildSidebar();
  const toggle = buildToggle();
  document.documentElement.appendChild(sidebar);
  document.documentElement.appendChild(toggle);

  // ---------- toggle behavior ----------
  function openSidebar() {
    sidebar.classList.remove("echo-hidden");
    toggle.classList.add("echo-hidden");
  }
  function closeSidebar() {
    sidebar.classList.add("echo-hidden");
    toggle.classList.remove("echo-hidden");
  }
  toggle.addEventListener("click", openSidebar);
  sidebar.querySelector(".echo-close").addEventListener("click", closeSidebar);
  sidebar.querySelector(".echo-min").addEventListener("click", closeSidebar);

  // ---------- drag + resize + persistence ----------
  const STORAGE_KEY = "echo.layout";
  const DEFAULT_LAYOUT = { left: null, top: 16, width: 420, height: null }; // null = let CSS decide

  function applyLayout(layout) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(layout.width ?? 420, vw - 24);
    const h = layout.height ? Math.min(layout.height, vh - 24) : vh - 32;
    sidebar.style.width = w + "px";
    sidebar.style.height = h + "px";
    if (layout.left == null) {
      sidebar.style.left = "";
      sidebar.style.right = "16px";
    } else {
      const left = Math.max(8, Math.min(layout.left, vw - w - 8));
      sidebar.style.left = left + "px";
      sidebar.style.right = "auto";
    }
    const top = Math.max(8, Math.min(layout.top ?? 16, vh - 80));
    sidebar.style.top = top + "px";
  }

  function saveLayout() {
    const rect = sidebar.getBoundingClientRect();
    const data = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    try { chrome.storage?.local?.set({ [STORAGE_KEY]: data }); } catch (_e) {}
  }

  let currentLayout = { ...DEFAULT_LAYOUT };
  try {
    chrome.storage?.local?.get([STORAGE_KEY], (res) => {
      if (res && res[STORAGE_KEY]) {
        currentLayout = { ...DEFAULT_LAYOUT, ...res[STORAGE_KEY] };
      }
      applyLayout(currentLayout);
    });
  } catch (_e) {
    applyLayout(currentLayout);
  }

  // Drag by header
  const header = sidebar.querySelector(".echo-header");
  let drag = null;
  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return; // don't drag from min/close
    const rect = sidebar.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    sidebar.classList.add("echo-dragging");
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = sidebar.offsetWidth, h = sidebar.offsetHeight;
    const left = Math.max(8, Math.min(e.clientX - drag.dx, vw - w - 8));
    const top = Math.max(8, Math.min(e.clientY - drag.dy, vh - 40));
    sidebar.style.left = left + "px";
    sidebar.style.right = "auto";
    sidebar.style.top = top + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!drag) return;
    drag = null;
    sidebar.classList.remove("echo-dragging");
    saveLayout();
  });

  // Resize by bottom-left corner handle (so the handle is away from ChatGPT's composer)
  const resizeHandle = sidebar.querySelector(".echo-resize-handle");
  let resize = null;
  resizeHandle.addEventListener("mousedown", (e) => {
    const rect = sidebar.getBoundingClientRect();
    resize = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      startLeft: rect.left,
    };
    sidebar.classList.add("echo-resizing");
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resize) return;
    const dx = e.clientX - resize.startX;
    const dy = e.clientY - resize.startY;
    const newW = Math.max(300, Math.min(resize.startW - dx, window.innerWidth - 16));
    const newH = Math.max(320, Math.min(resize.startH + dy, window.innerHeight - 16));
    const newLeft = Math.max(8, resize.startLeft + dx);
    sidebar.style.width = newW + "px";
    sidebar.style.height = newH + "px";
    sidebar.style.left = newLeft + "px";
    sidebar.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (!resize) return;
    resize = null;
    sidebar.classList.remove("echo-resizing");
    saveLayout();
  });

  window.addEventListener("resize", () => {
    // Re-clamp into viewport when window changes
    const rect = sidebar.getBoundingClientRect();
    applyLayout({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "ECHO_TOGGLE_SIDEBAR") {
      if (sidebar.classList.contains("echo-hidden")) openSidebar();
      else closeSidebar();
    }
  });

  // ---------- tabs ----------
  sidebar.querySelectorAll(".echo-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      sidebar.querySelectorAll(".echo-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const name = tab.dataset.tab;
      sidebar.querySelectorAll(".echo-panel").forEach((p) => {
        p.hidden = p.dataset.panel !== name;
      });
    });
  });

  // ---------- ChatGPT prompt hook (scaffold only, wiring next) ----------
  // We watch the composer for submit. ChatGPT uses a contenteditable inside
  // a form. We'll capture text via the Enter key for now; real capture lives
  // in a follow-up block once the backend is up.
  function findComposer() {
    return document.querySelector('form textarea, form [contenteditable="true"]');
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const el = findComposer();
      if (!el || !el.contains(e.target)) return;
      const prompt = (el.innerText || el.value || "").trim();
      if (!prompt) return;
      console.log("[Echo] captured prompt:", prompt);
      // TODO(block-2+): POST to backend /api/orchestrate
    },
    true
  );

  console.log("[Echo] content script ready");
})();
