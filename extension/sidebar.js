// Echo — side panel logic
// Receives captured prompts from the content script, orchestrates the backend
// call, and renders results.

(function () {
  const API_BASE = self.ECHO_API_BASE || "http://localhost:3939";
  const LOG = (...args) => console.log("[Echo/panel]", ...args);
  LOG("loading, API_BASE =", API_BASE);

  const input = document.getElementById("echo-input");
  const submit = document.getElementById("echo-submit");
  const empty = document.getElementById("echo-empty");
  const body = document.getElementById("echo-body");
  const promptBox = document.getElementById("echo-prompt-box");
  const respList = document.getElementById("echo-resp-list");
  const contrList = document.getElementById("echo-contr-list");
  const scoreNum = document.getElementById("echo-score-num");
  const scoreArc = document.getElementById("echo-score-arc");
  const scoreVerdict = document.getElementById("echo-score-verdict");
  const status = document.getElementById("echo-status");

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

  function showBody() {
    empty.hidden = true;
    body.hidden = false;
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.remove("is-working", "is-error");
    if (kind) status.classList.add(kind);
  }

  function setScore(value, verdictText) {
    if (value == null || Number.isNaN(value)) {
      scoreNum.textContent = "—";
      scoreArc.style.strokeDashoffset = "326";
    } else {
      const v = Math.max(0, Math.min(100, Math.round(value)));
      scoreNum.textContent = String(v);
      const circumference = 326;
      scoreArc.style.strokeDashoffset = String(
        circumference - (circumference * v) / 100
      );
    }
    if (verdictText != null) scoreVerdict.textContent = verdictText;
  }

  function setPrompt(text) {
    promptBox.textContent = text;
  }

  const STANCE_COLORS = {
    pro: "#10B981",
    contra: "#EF4444",
    neutral: "#94A3B8",
    refuses: "#F59E0B",
  };

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

      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.textContent = labels[i];
      header.appendChild(lab);

      if (stanceByResponse && stanceByResponse[i]) {
        const stance = stanceByResponse[i];
        const chip = document.createElement("span");
        chip.textContent = stance;
        chip.style.fontSize = "10px";
        chip.style.fontWeight = "600";
        chip.style.padding = "2px 8px";
        chip.style.borderRadius = "999px";
        chip.style.background = (STANCE_COLORS[stance] || "#64748B") + "33";
        chip.style.color = STANCE_COLORS[stance] || "#94A3B8";
        chip.style.textTransform = "uppercase";
        chip.style.letterSpacing = "0.08em";
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
        rt.style.color = "rgba(239, 68, 68, 0.9)";
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
      p.style.opacity = "0.7";
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

  function clearContradictions(message) {
    contrList.innerHTML = "";
    const p = document.createElement("div");
    p.className = "echo-resp-text";
    p.style.opacity = "0.6";
    p.textContent = message || "Analyzing…";
    contrList.appendChild(p);
  }

  // ---------- backend call ----------
  let lastHandledPromptKey = null;

  async function orchestrate(prompt, capturedAt) {
    const key = `${capturedAt || Date.now()}::${prompt}`;
    if (key === lastHandledPromptKey) {
      LOG("skipping duplicate prompt");
      return;
    }
    lastHandledPromptKey = key;

    const started = Date.now();
    LOG("orchestrate start:", prompt.slice(0, 80));
    showBody();
    setPrompt(prompt);
    setScore(null, "Running…");
    setStatus("generating variants…", "is-working");
    clearContradictions();
    respList.innerHTML = "";

    try {
      const response = await fetch(`${API_BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      LOG("orchestrate HTTP", response.status);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text.slice(0, 300)}`);
      }
      const data = await response.json();
      LOG("orchestrate data:", data);

      const stances = data.analysis?.stance_by_response || null;
      renderResponses(data.original, data.variants, stances);

      if (data.analysis) {
        setScore(
          data.analysis.consistency_score,
          data.analysis.verdict || "analyzed"
        );
        renderContradictions(data.analysis.contradictions);
      } else {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        setScore(null, `Ran 4 in parallel in ${elapsed}s. Analyzer skipped.`);
        renderContradictions([]);
      }
      setStatus("ready");
    } catch (err) {
      console.error("[Echo/panel] orchestrate failed:", err);
      setStatus("error", "is-error");
      setScore(null, "Backend unreachable.");
      respList.innerHTML = "";
      const card = document.createElement("div");
      card.className = "echo-resp-card";
      card.innerHTML = `
        <div class="echo-resp-label" style="color: rgba(239,68,68,0.9)">Backend error</div>
        <div class="echo-resp-text"></div>
        <div class="echo-resp-prompt" style="margin-top:10px; font-style:normal">
          Is the dev server running?<br>
          <code>cd backend && node dev-server.mjs</code>
        </div>
      `;
      card.querySelector(".echo-resp-text").textContent = String(err.message ?? err);
      respList.appendChild(card);
    }
  }

  // Composer — primary input path.
  function submitFromInput() {
    const prompt = input.value.trim();
    if (!prompt) return;
    submit.disabled = true;
    orchestrate(prompt).finally(() => {
      submit.disabled = false;
    });
  }
  submit.addEventListener("click", submitFromInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitFromInput();
    }
  });

  // Listen for prompts broadcast from the background (secondary path: user
  // typed directly in chatgpt.com). Mirror into the composer so the user sees
  // what's being analyzed.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_PROMPT_FOR_PANEL" && typeof msg.prompt === "string") {
      LOG("received prompt from bg:", msg.prompt.slice(0, 80));
      input.value = msg.prompt;
      orchestrate(msg.prompt, msg.capturedAt);
    }
  });

  // On load, check if a prompt was captured before the panel was open.
  chrome.runtime.sendMessage({ type: "ECHO_GET_LAST_PROMPT" }, (pending) => {
    const err = chrome.runtime.lastError;
    if (err) {
      LOG("could not fetch pending prompt:", err.message);
      return;
    }
    if (pending && pending.prompt) {
      const age = Date.now() - (pending.capturedAt || 0);
      LOG(`found pending prompt (${age}ms old)`);
      // Only auto-run if very recent (under 30s); older ones are stale.
      if (age < 30000) {
        orchestrate(pending.prompt, pending.capturedAt);
      } else {
        LOG("pending prompt is stale, ignoring");
      }
    } else {
      LOG("no pending prompt on init");
    }
  });

  LOG("side panel ready");
})();
