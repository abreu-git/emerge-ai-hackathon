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
        <button class="echo-close" aria-label="Close">×</button>
      </div>

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
