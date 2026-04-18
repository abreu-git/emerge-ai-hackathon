// Echo — side panel logic
// Captures prompts from the ChatGPT content script (via background),
// orchestrates the backend call, keeps an in-memory session history, and
// renders the current entry. No composer here — entry point is ChatGPT.

(function () {
  const API_BASE = self.ECHO_API_BASE || "http://localhost:3939";
  const LOG = (...args) => console.log("[Echo/panel]", ...args);
  LOG("loading, API_BASE =", API_BASE);

  // ---------- DOM refs ----------
  const empty = document.getElementById("echo-empty");
  const body = document.getElementById("echo-body");
  const promptCard = document.getElementById("echo-prompt-card");
  const promptBox = document.getElementById("echo-prompt-box");
  const nav = document.getElementById("echo-nav");
  const prevBtn = document.getElementById("echo-prev");
  const nextBtn = document.getElementById("echo-next");
  const navCount = document.getElementById("echo-nav-count");
  const respList = document.getElementById("echo-resp-list");
  const contrList = document.getElementById("echo-contr-list");
  const scoreRing = document.querySelector(".echo-score-ring");
  const scoreNum = document.getElementById("echo-score-num");
  const scoreArc = document.getElementById("echo-score-arc");
  const scoreVerdict = document.getElementById("echo-score-verdict");
  const status = document.getElementById("echo-status");

  // ---------- state ----------
  // history: [{ prompt, capturedAt, data: null|object, status: 'loading'|'done'|'error', error?: string }]
  const state = {
    history: [],
    currentIndex: -1,
  };

  // ---------- tabs ----------
  document.querySelectorAll(".echo-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".echo-tab")
        .forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const name = tab.dataset.tab;
      document.querySelectorAll(".echo-panel").forEach((p) => {
        p.hidden = p.dataset.panel !== name;
      });
    });
  });

  // ---------- nav buttons ----------
  prevBtn.addEventListener("click", () => {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      render();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (state.currentIndex < state.history.length - 1) {
      state.currentIndex++;
      render();
    }
  });

  // ---------- helpers ----------
  function scoreClass(score) {
    if (score == null) return "";
    if (score >= 80) return "is-high";
    if (score >= 50) return "is-mid";
    return "is-low";
  }

  function setScore(value) {
    scoreRing.classList.remove("is-high", "is-mid", "is-low");
    scoreNum.classList.remove("is-high", "is-mid", "is-low");
    if (value == null || Number.isNaN(value)) {
      scoreNum.textContent = "—";
      scoreArc.style.strokeDashoffset = "326";
      return;
    }
    const v = Math.max(0, Math.min(100, Math.round(value)));
    scoreNum.textContent = String(v);
    const circumference = 326;
    scoreArc.style.strokeDashoffset = String(
      circumference - (circumference * v) / 100
    );
    const cls = scoreClass(v);
    if (cls) {
      scoreRing.classList.add(cls);
      scoreNum.classList.add(cls);
    }
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.remove("is-working", "is-error");
    if (kind) status.classList.add(kind);
  }

  function renderResponses(original, variants, stanceByResponse) {
    respList.innerHTML = "";
    const labels = ["ORIGINAL", ...variants.map((v) => v.type)];
    const all = [original, ...variants];

    all.forEach((r, i) => {
      const card = document.createElement("div");
      card.className = "echo-resp-card";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.marginBottom = "4px";
      header.style.gap = "8px";

      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.textContent = labels[i];
      header.appendChild(lab);

      if (stanceByResponse && stanceByResponse[i]) {
        const stance = stanceByResponse[i];
        const chip = document.createElement("span");
        chip.className = `echo-stance stance-${stance}`;
        chip.textContent = stance;
        header.appendChild(chip);
      }
      card.appendChild(header);

      if (r.prompt) {
        const pr = document.createElement("div");
        pr.className = "echo-resp-prompt";
        pr.textContent = r.prompt;
        card.appendChild(pr);
      }
      const rt = document.createElement("div");
      rt.className = "echo-resp-text";
      if (r.error) {
        rt.textContent = `⚠ ${r.error}`;
        rt.style.color = "var(--echo-red)";
      } else {
        rt.textContent = r.response || "(empty)";
      }
      card.appendChild(rt);
      respList.appendChild(card);
    });
  }

  function renderContradictions(contradictions) {
    contrList.innerHTML = "";
    if (!contradictions || contradictions.length === 0) {
      const p = document.createElement("div");
      p.className = "echo-resp-text";
      p.style.color = "var(--echo-text-faint)";
      p.textContent = "No contradictions detected.";
      contrList.appendChild(p);
      return;
    }
    for (const c of contradictions) {
      const card = document.createElement("div");
      card.className = "echo-resp-card";

      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.textContent = c.dimension || "contradiction";
      card.appendChild(lab);

      const a = document.createElement("div");
      a.className = "echo-resp-text";
      a.style.marginTop = "6px";
      a.textContent = `A: ${c.response_a || ""}`;
      card.appendChild(a);

      const b = document.createElement("div");
      b.className = "echo-resp-text";
      b.style.marginTop = "6px";
      b.textContent = `B: ${c.response_b || ""}`;
      card.appendChild(b);

      if (c.explanation) {
        const expl = document.createElement("div");
        expl.className = "echo-resp-prompt";
        expl.style.marginTop = "8px";
        expl.style.fontStyle = "normal";
        expl.textContent = c.explanation;
        card.appendChild(expl);
      }
      contrList.appendChild(card);
    }
  }

  function renderNav() {
    const n = state.history.length;
    if (n === 0) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    navCount.textContent = `${state.currentIndex + 1} / ${n}`;
    prevBtn.disabled = state.currentIndex <= 0;
    nextBtn.disabled = state.currentIndex >= n - 1;
  }

  function render() {
    renderNav();

    if (state.history.length === 0) {
      empty.hidden = false;
      body.hidden = true;
      promptCard.hidden = true;
      return;
    }

    empty.hidden = true;
    body.hidden = false;
    promptCard.hidden = false;

    const entry = state.history[state.currentIndex];
    promptBox.textContent = entry.prompt;

    if (entry.status === "loading") {
      setScore(null);
      scoreVerdict.textContent = "Running 4 prompts in parallel against GPT-4o…";
      setStatus("analyzing…", "is-working");
      respList.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "echo-resp-text";
      loading.style.color = "var(--echo-text-dim)";
      loading.textContent = "Generating 3 adversarial variants…";
      respList.appendChild(loading);
      renderContradictions([]);
      return;
    }

    if (entry.status === "error") {
      setScore(null);
      scoreVerdict.textContent = "Backend error.";
      setStatus("error", "is-error");
      respList.innerHTML = "";
      const card = document.createElement("div");
      card.className = "echo-resp-card";
      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.style.color = "var(--echo-red)";
      lab.textContent = "Backend error";
      card.appendChild(lab);
      const txt = document.createElement("div");
      txt.className = "echo-resp-text";
      txt.textContent = entry.error || "unknown error";
      card.appendChild(txt);
      const hint = document.createElement("div");
      hint.className = "echo-resp-prompt";
      hint.style.marginTop = "10px";
      hint.style.fontStyle = "normal";
      hint.textContent = "Is the dev server running? cd backend && node dev-server.mjs";
      card.appendChild(hint);
      respList.appendChild(card);
      renderContradictions([]);
      return;
    }

    // status === "done"
    const data = entry.data;
    const stances = data.analysis?.stance_by_response || null;
    renderResponses(data.original, data.variants, stances);

    if (data.analysis) {
      setScore(data.analysis.consistency_score);
      scoreVerdict.textContent = data.analysis.verdict || "analyzed";
      renderContradictions(data.analysis.contradictions);
    } else {
      setScore(null);
      scoreVerdict.textContent = "Analyzer skipped (partial failure).";
      renderContradictions([]);
    }
    setStatus("ready");
  }

  // ---------- backend call ----------
  async function runOrchestrate(entry) {
    try {
      LOG("fetching /api/orchestrate for:", entry.prompt.slice(0, 80));
      const response = await fetch(`${API_BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: entry.prompt }),
      });
      LOG("HTTP", response.status);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text.slice(0, 300)}`);
      }
      const data = await response.json();
      entry.data = data;
      entry.status = "done";
      LOG("orchestrate done, score:", data.analysis?.consistency_score);
    } catch (err) {
      entry.status = "error";
      entry.error = String(err.message ?? err);
      console.error("[Echo/panel] orchestrate failed:", err);
    }
    // Re-render only if this entry is still the one being viewed.
    if (state.history[state.currentIndex] === entry) {
      render();
    }
  }

  function handleCapturedPrompt(prompt, capturedAt) {
    const last = state.history[state.history.length - 1];
    if (last && last.prompt === prompt) {
      LOG("duplicate prompt, ignoring");
      return;
    }
    const entry = {
      prompt,
      capturedAt: capturedAt || Date.now(),
      data: null,
      status: "loading",
    };
    state.history.push(entry);
    state.currentIndex = state.history.length - 1;
    LOG(`added entry ${state.currentIndex + 1}/${state.history.length}`);
    render();
    runOrchestrate(entry);
  }

  // ---------- incoming messages ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_PROMPT_FOR_PANEL" && typeof msg.prompt === "string") {
      LOG("received prompt from bg:", msg.prompt.slice(0, 80));
      handleCapturedPrompt(msg.prompt, msg.capturedAt);
    }
  });

  // On panel open, pick up any prompt captured before the panel existed.
  chrome.runtime.sendMessage({ type: "ECHO_GET_LAST_PROMPT" }, (pending) => {
    const err = chrome.runtime.lastError;
    if (err) {
      LOG("could not fetch pending prompt:", err.message);
      return;
    }
    if (pending && pending.prompt) {
      const age = Date.now() - (pending.capturedAt || 0);
      LOG(`found pending prompt (${age}ms old)`);
      if (age < 30000) {
        handleCapturedPrompt(pending.prompt, pending.capturedAt);
      } else {
        LOG("pending prompt is stale, ignoring");
      }
    } else {
      LOG("no pending prompt on init");
    }
  });

  // Initial paint (empty state).
  render();
  LOG("side panel ready");
})();
