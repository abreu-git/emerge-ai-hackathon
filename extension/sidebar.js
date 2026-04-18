// Echo — side panel logic
// Multi-step orchestration with progressive reveal:
//   1. /api/variants       → 3 variant questions
//   2. /api/run-one (x4)   → fire 4 parallel calls, render each as it resolves
//   3. /api/analyze        → consistency score + contradictions + verdict
// Accordion cards (one expanded at a time). Footer bar opens report drawer.

(function () {
  const API_BASE = self.ECHO_API_BASE || "http://localhost:3939";
  const LOG = (...args) => console.log("[Echo/panel]", ...args);
  LOG("loading, API_BASE =", API_BASE);

  // ---------- DOM refs ----------
  const empty = document.getElementById("echo-empty");
  const promptCard = document.getElementById("echo-prompt-card");
  const promptBox = document.getElementById("echo-prompt-box");
  const cardsEl = document.getElementById("echo-cards");
  const footerBar = document.getElementById("echo-footer-bar");
  const footerScore = document.getElementById("echo-footer-score");
  const footerFill = document.getElementById("echo-footer-bar-fill");
  const status = document.getElementById("echo-status");
  const drawer = document.getElementById("echo-drawer");
  const drawerClose = document.getElementById("echo-drawer-close");
  const drawerScore = document.getElementById("echo-drawer-score");
  const drawerVerdict = document.getElementById("echo-drawer-verdict");
  const drawerRec = document.getElementById("echo-drawer-recommendation");
  const drawerStances = document.getElementById("echo-drawer-stances");
  const drawerContradictions = document.getElementById("echo-drawer-contradictions");

  // ---------- state ----------
  // entries: [{ label, prompt, response, error, stance, status, expected_inconsistency }]
  // label = "ORIGINAL" | "PARAPHRASE" | "ROLE_SHIFT" | "SPECIFICITY_SHIFT"
  // status = "pending" | "loading" | "done" | "error"
  const state = {
    currentPrompt: "",
    entries: [],
    expandedIndex: -1,
    analysis: null,
  };

  // ---------- helpers ----------
  function scoreClass(s) {
    if (s == null) return "";
    if (s >= 80) return "is-high";
    if (s >= 50) return "is-mid";
    return "is-low";
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.remove("is-working", "is-error");
    if (kind) status.classList.add(kind);
  }

  function clearAll() {
    state.entries = [];
    state.expandedIndex = -1;
    state.analysis = null;
    cardsEl.innerHTML = "";
    footerBar.hidden = true;
    footerScore.textContent = "—";
    footerScore.classList.remove("is-high", "is-mid", "is-low");
    footerFill.style.width = "0%";
    footerFill.classList.remove("is-high", "is-mid", "is-low");
    drawer.classList.remove("is-open");
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
  }

  // ---------- accordion rendering ----------
  function reviewText(entry) {
    if (entry.status === "pending") return "Waiting…";
    if (entry.status === "loading") return "Running against GPT-4o…";
    if (entry.status === "error") return `⚠ ${entry.error || "error"}`;
    return entry.response || "(empty)";
  }

  function renderCards() {
    cardsEl.innerHTML = "";
    state.entries.forEach((entry, i) => {
      const isExpanded = state.expandedIndex === i;

      const card = document.createElement("div");
      card.className = `echo-card ${isExpanded ? "is-expanded" : "is-collapsed"} ${
        entry.status === "loading" ? "is-loading" : ""
      }`;
      card.dataset.index = String(i);

      // Header: type + stance chip
      const header = document.createElement("div");
      header.className = "echo-card-header";

      const typeEl = document.createElement("div");
      typeEl.className = "echo-card-type";
      typeEl.textContent = entry.label;
      header.appendChild(typeEl);

      if (entry.stance) {
        const chip = document.createElement("span");
        chip.className = `echo-stance stance-${entry.stance}`;
        chip.textContent = entry.stance;
        header.appendChild(chip);
      }
      card.appendChild(header);

      // Question (the variant prompt)
      if (entry.prompt) {
        const q = document.createElement("div");
        q.className = "echo-card-question";
        q.textContent = entry.prompt;
        card.appendChild(q);
      }

      // Body (review text)
      const bodyDiv = document.createElement("div");
      bodyDiv.className = "echo-card-body";
      const review = document.createElement("div");
      review.className = "echo-card-review";
      review.textContent = reviewText(entry);
      bodyDiv.appendChild(review);
      card.appendChild(bodyDiv);

      // Toggle — only show if we have real content
      if (entry.status === "done" && entry.response) {
        const toggle = document.createElement("button");
        toggle.className = "echo-card-toggle";
        toggle.type = "button";
        toggle.textContent = isExpanded ? "Show less ▲" : "See more ▼";
        toggle.addEventListener("click", () => {
          state.expandedIndex = isExpanded ? -1 : i;
          renderCards();
        });
        card.appendChild(toggle);
      }

      cardsEl.appendChild(card);
    });
  }

  // ---------- footer bar ----------
  function renderFooter(analysis) {
    if (!analysis) {
      footerBar.hidden = true;
      return;
    }
    footerBar.hidden = false;
    const score = analysis.consistency_score;
    const cls = scoreClass(score);

    footerScore.textContent = String(score);
    footerScore.classList.remove("is-high", "is-mid", "is-low");
    if (cls) footerScore.classList.add(cls);

    footerFill.style.width = `${Math.max(0, Math.min(100, score))}%`;
    footerFill.classList.remove("is-high", "is-mid", "is-low");
    if (cls) footerFill.classList.add(cls);
  }

  // ---------- report drawer ----------
  function openDrawer() {
    if (!state.analysis) return;
    const a = state.analysis;
    const cls = scoreClass(a.consistency_score);

    drawerScore.textContent = String(a.consistency_score);
    drawerScore.classList.remove("is-high", "is-mid", "is-low");
    if (cls) drawerScore.classList.add(cls);

    drawerVerdict.textContent = a.verdict || "";

    drawerRec.textContent = (a.recommendation || "").replace(/_/g, " ");
    drawerRec.classList.remove("rec-trust", "rec-verify", "rec-do_not_trust");
    if (a.recommendation) drawerRec.classList.add(`rec-${a.recommendation}`);

    // Stances (same order as entries)
    drawerStances.innerHTML = "";
    const stances = a.stance_by_response || [];
    state.entries.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "echo-drawer-stance-row";
      const lab = document.createElement("span");
      lab.className = "echo-drawer-stance-label";
      lab.textContent = entry.label;
      const chip = document.createElement("span");
      const stance = stances[i] || entry.stance || "—";
      chip.className = `echo-stance stance-${stance}`;
      chip.textContent = stance;
      row.appendChild(lab);
      row.appendChild(chip);
      drawerStances.appendChild(row);
    });

    // Contradictions
    drawerContradictions.innerHTML = "";
    const contrs = a.contradictions || [];
    if (contrs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "echo-drawer-empty";
      empty.textContent = "No contradictions detected.";
      drawerContradictions.appendChild(empty);
    } else {
      for (const c of contrs) {
        const card = document.createElement("div");
        card.className = "echo-drawer-contr-card";

        const dim = document.createElement("div");
        dim.className = "echo-drawer-contr-dim";
        dim.textContent = c.dimension || "contradiction";
        card.appendChild(dim);

        const a1 = document.createElement("div");
        a1.className = "echo-drawer-contr-sample";
        a1.textContent = `A: ${c.response_a || ""}`;
        card.appendChild(a1);

        const b1 = document.createElement("div");
        b1.className = "echo-drawer-contr-sample";
        b1.textContent = `B: ${c.response_b || ""}`;
        card.appendChild(b1);

        if (c.explanation) {
          const expl = document.createElement("div");
          expl.className = "echo-drawer-contr-expl";
          expl.textContent = c.explanation;
          card.appendChild(expl);
        }
        drawerContradictions.appendChild(card);
      }
    }

    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      drawer.hidden = true;
    }, 300);
  }

  footerBar.addEventListener("click", openDrawer);
  drawerClose.addEventListener("click", closeDrawer);

  // ---------- orchestration ----------
  async function postJSON(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`${path}: ${r.status} ${text.slice(0, 200)}`);
    }
    return r.json();
  }

  async function orchestrate(prompt) {
    LOG("orchestrate:", prompt.slice(0, 80));
    state.currentPrompt = prompt;
    clearAll();

    // Show captured prompt immediately.
    empty.hidden = true;
    promptCard.hidden = false;
    promptBox.textContent = prompt;

    // Seed the ORIGINAL card now (status: loading).
    state.entries.push({
      label: "ORIGINAL",
      prompt,
      response: "",
      error: "",
      stance: null,
      status: "loading",
    });
    state.expandedIndex = 0;
    renderCards();

    setStatus("generating variants…", "is-working");

    // Step 1: generate variants.
    let variantsData;
    try {
      variantsData = await postJSON("/api/variants", { prompt });
    } catch (err) {
      LOG("variants failed:", err.message);
      setStatus("error", "is-error");
      state.entries[0].status = "error";
      state.entries[0].error = err.message;
      renderCards();
      return;
    }
    const variants = variantsData.variants || [];
    LOG(`got ${variants.length} variants`);

    // Seed variant cards (loading) so they animate in.
    for (const v of variants) {
      state.entries.push({
        label: v.type,
        prompt: v.prompt,
        response: "",
        error: "",
        stance: null,
        status: "loading",
        expected_inconsistency: v.expected_inconsistency,
      });
    }
    renderCards();

    setStatus("running 4 in parallel…", "is-working");

    // Step 2: fire all 4 /api/run-one calls in parallel. Each resolves
    // independently and updates its card.
    const runPromises = state.entries.map((entry, i) =>
      postJSON("/api/run-one", { prompt: entry.prompt })
        .then((r) => {
          entry.response = r.response || "";
          entry.status = "done";
          LOG(`${entry.label} done (${entry.response.length} chars)`);
          renderCards();
        })
        .catch((err) => {
          entry.status = "error";
          entry.error = String(err.message ?? err);
          LOG(`${entry.label} failed:`, entry.error);
          renderCards();
        })
    );
    await Promise.all(runPromises);

    // Step 3: analyze (only if all 4 produced something).
    const allOk = state.entries.every((e) => e.status === "done" && e.response);
    if (!allOk) {
      setStatus("partial failure", "is-error");
      return;
    }

    setStatus("analyzing consistency…", "is-working");
    try {
      const original = state.entries[0];
      const variantsForAnalyze = state.entries.slice(1).map((e) => ({
        type: e.label,
        prompt: e.prompt,
        response: e.response,
        expected_inconsistency: e.expected_inconsistency,
      }));
      const analysis = await postJSON("/api/analyze", {
        original: { prompt: original.prompt, response: original.response },
        variants: variantsForAnalyze,
      });
      state.analysis = analysis;
      // Attach stances to entries
      const stances = analysis.stance_by_response || [];
      state.entries.forEach((e, i) => {
        e.stance = stances[i] || null;
      });
      renderCards();
      renderFooter(analysis);
      setStatus("ready");
      LOG("analysis done, score:", analysis.consistency_score);
    } catch (err) {
      LOG("analyze failed:", err.message);
      setStatus("analyzer error", "is-error");
    }
  }

  // ---------- inbound prompts ----------
  let lastHandled = "";
  function handleCaptured(prompt) {
    if (!prompt) return;
    if (prompt === lastHandled) {
      LOG("duplicate prompt, ignoring");
      return;
    }
    lastHandled = prompt;
    orchestrate(prompt);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ECHO_PROMPT_FOR_PANEL" && typeof msg.prompt === "string") {
      LOG("received prompt from bg:", msg.prompt.slice(0, 80));
      handleCaptured(msg.prompt);
    }
  });

  // Pick up any pending prompt captured before the panel opened.
  chrome.runtime.sendMessage({ type: "ECHO_GET_LAST_PROMPT" }, (pending) => {
    const err = chrome.runtime.lastError;
    if (err) {
      LOG("could not fetch pending prompt:", err.message);
      return;
    }
    if (pending && pending.prompt) {
      const age = Date.now() - (pending.capturedAt || 0);
      LOG(`pending prompt age: ${age}ms`);
      if (age < 30000) handleCaptured(pending.prompt);
      else LOG("pending prompt stale, ignoring");
    } else {
      LOG("no pending prompt");
    }
  });

  LOG("side panel ready");
})();
