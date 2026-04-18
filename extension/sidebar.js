// Echo — side panel logic
// Receives captured prompts from the content script (via runtime messages),
// orchestrates the backend call, and renders results.

(function () {
  const empty = document.getElementById("echo-empty");
  const body = document.getElementById("echo-body");
  const promptBox = document.getElementById("echo-prompt-box");
  const respList = document.getElementById("echo-resp-list");
  const contrList = document.getElementById("echo-contr-list");
  const scoreNum = document.getElementById("echo-score-num");
  const scoreArc = document.getElementById("echo-score-arc");
  const scoreVerdict = document.getElementById("echo-score-verdict");
  const status = document.getElementById("echo-status");

  // Tabs
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

  function setScore(value) {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    scoreNum.textContent = String(v);
    const circumference = 326;
    scoreArc.style.strokeDashoffset = String(
      circumference - (circumference * v) / 100
    );
  }

  function setPrompt(text) {
    promptBox.textContent = text;
  }

  function renderResponses(original, variants) {
    respList.innerHTML = "";
    const addCard = (label, promptText, responseText) => {
      const card = document.createElement("div");
      card.className = "echo-resp-card";
      const lab = document.createElement("div");
      lab.className = "echo-resp-label";
      lab.textContent = label;
      const pr = document.createElement("div");
      pr.className = "echo-resp-prompt";
      pr.textContent = promptText;
      const rt = document.createElement("div");
      rt.className = "echo-resp-text";
      rt.textContent = responseText;
      card.appendChild(lab);
      card.appendChild(pr);
      card.appendChild(rt);
      respList.appendChild(card);
    };
    addCard("ORIGINAL", original.prompt, original.response);
    for (const v of variants) {
      addCard(v.type, v.prompt, v.response);
    }
  }

  function renderContradictions(contradictions) {
    contrList.innerHTML = "";
    if (!contradictions || contradictions.length === 0) {
      const p = document.createElement("div");
      p.className = "echo-resp-text";
      p.style.opacity = "0.6";
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
      const a = document.createElement("div");
      a.className = "echo-resp-text";
      a.textContent = `A: ${c.response_a || ""}`;
      const b = document.createElement("div");
      b.className = "echo-resp-text";
      b.style.marginTop = "6px";
      b.textContent = `B: ${c.response_b || ""}`;
      const expl = document.createElement("div");
      expl.className = "echo-resp-prompt";
      expl.style.marginTop = "8px";
      expl.style.fontStyle = "normal";
      expl.textContent = c.explanation || "";
      card.appendChild(lab);
      card.appendChild(a);
      card.appendChild(b);
      card.appendChild(expl);
      contrList.appendChild(card);
    }
  }

  async function runEcho(prompt) {
    showBody();
    setPrompt(prompt);
    setStatus("capturing…", "is-working");

    // TODO(block-5): wire to backend /api/orchestrate
    // For now, just confirm capture visually.
    scoreVerdict.textContent = `Captured: "${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}"`;
    setStatus("ready");
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_PROMPT_FOR_PANEL" && typeof msg.prompt === "string") {
      runEcho(msg.prompt);
    }
  });

  console.log("[Echo] side panel ready");
})();
