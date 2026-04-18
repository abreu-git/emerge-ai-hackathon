// Echo — side panel logic
// Receives captured prompts from the content script, orchestrates the backend
// call, and renders results.

(function () {
  const API_BASE = self.ECHO_API_BASE || "http://localhost:3939";

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

  function renderResponses(original, variants) {
    respList.innerHTML = "";
    const addCard = (label, promptText, responseText, errorText) => {
      const card = document.createElement("div");
      card.className = "echo-resp-card";
      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.textContent = label;
      card.appendChild(lab);
      if (promptText) {
        const pr = document.createElement("div");
        pr.className = "echo-resp-prompt";
        pr.textContent = promptText;
        card.appendChild(pr);
      }
      const rt = document.createElement("div");
      rt.className = "echo-resp-text";
      if (errorText) {
        rt.textContent = `⚠ ${errorText}`;
        rt.style.color = "rgba(239, 68, 68, 0.9)";
      } else {
        rt.textContent = responseText || "(empty)";
      }
      card.appendChild(rt);
      respList.appendChild(card);
    };
    addCard("ORIGINAL", original.prompt, original.response, original.error);
    for (const v of variants) {
      addCard(v.type, v.prompt, v.response, v.error);
    }
  }

  function clearContradictions(message) {
    contrList.innerHTML = "";
    const p = document.createElement("div");
    p.className = "echo-resp-text";
    p.style.opacity = "0.6";
    p.textContent =
      message || "Consistency analyzer not wired yet (block 4).";
    contrList.appendChild(p);
  }

  // ---------- backend call ----------
  async function orchestrate(prompt) {
    const started = Date.now();
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
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text.slice(0, 300)}`);
      }
      const data = await response.json();

      renderResponses(data.original, data.variants);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      setScore(null, `Ran 4 in parallel in ${elapsed}s. Analyzer pending.`);
      setStatus("ready");
    } catch (err) {
      console.error("[Echo] orchestrate failed:", err);
      setStatus("error", "is-error");
      setScore(null, "Backend unreachable.");
      respList.innerHTML = "";
      const card = document.createElement("div");
      card.className = "echo-resp-card";
      card.innerHTML = `
        <div class="echo-resp-label" style="color: rgba(239,68,68,0.9)">Backend error</div>
        <div class="echo-resp-text">${String(err.message ?? err)}</div>
        <div class="echo-resp-prompt" style="margin-top:10px; font-style:normal">
          Is the dev server running?<br>
          <code>cd backend && node dev-server.mjs</code>
        </div>
      `;
      respList.appendChild(card);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_PROMPT_FOR_PANEL" && typeof msg.prompt === "string") {
      orchestrate(msg.prompt);
    }
  });

  console.log("[Echo] side panel ready, API:", API_BASE);
})();
