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
  const drawerContrCount = document.getElementById("echo-drawer-contr-count");

  // ---------- state ----------
  // entries: [{ label, prompt, response, error, stance, status, expected_inconsistency }]
  // label = "CHATGPT" (for index 0, the live response) | "PARAPHRASE" | "ROLE_SHIFT" | "SPECIFICITY_SHIFT"
  // status = "pending" | "loading" | "done" | "error"
  const state = {
    currentPrompt: "",
    entries: [],
    expandedIndex: -1,
    analysis: null,
  };

  // Resolver for the ORIGINAL card — resolves when the content script
  // relays ChatGPT's stabilized response (ECHO_ASSISTANT_FOR_PANEL).
  let pendingAssistant = null;
  function waitForAssistant() {
    return new Promise((resolve) => {
      pendingAssistant = resolve;
    });
  }

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
    // Fill uses transform: scaleX() now (smoother than width animation).
    footerFill.style.transform = "scaleX(0)";
    footerFill.classList.remove("is-high", "is-mid", "is-low");
    drawer.classList.remove("is-open");
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
  }

  // Animate an integer from 0 to `to` over `duration` ms, writing to el.textContent.
  // Uses requestAnimationFrame + the ease-out portion of the curve.
  function animateCount(el, to, duration = 600) {
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      // ease-out quint — matches --ease feel
      const eased = 1 - Math.pow(1 - t, 5);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
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
      const isStreaming = entry.status === "loading" && entry.response;

      const card = document.createElement("div");
      const classes = ["echo-card"];
      classes.push(isExpanded ? "is-expanded" : "is-collapsed");
      if (entry.status === "loading" && !entry.response) classes.push("is-loading");
      if (isStreaming) classes.push("is-streaming");
      card.className = classes.join(" ");
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

      // Body bubble (review text)
      const bodyDiv = document.createElement("div");
      bodyDiv.className = "echo-card-body";
      const review = document.createElement("div");
      review.className = "echo-card-review";
      // Loading state: no text, just 3 bouncing dots
      if (entry.status === "loading" && !entry.response) {
        const dots = document.createElement("div");
        dots.className = "echo-streaming-dots";
        dots.innerHTML = "<span></span><span></span><span></span>";
        bodyDiv.appendChild(dots);
      } else {
        review.textContent = reviewText(entry);
        bodyDiv.appendChild(review);
      }
      card.appendChild(bodyDiv);

      // Toggle — only show if we have real content
      if (entry.status === "done" && entry.response) {
        const toggle = document.createElement("button");
        toggle.className = "echo-card-toggle";
        toggle.type = "button";
        toggle.textContent = isExpanded ? "Show less" : "Read more";
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
    const score = Math.max(0, Math.min(100, analysis.consistency_score));
    const cls = scoreClass(score);

    // Color ramps immediately; number counts up for the reveal moment.
    footerScore.classList.remove("is-high", "is-mid", "is-low");
    if (cls) footerScore.classList.add(cls);
    animateCount(footerScore, score, 700);

    // Smooth scale transform (set in clearAll to 0) — animates via CSS.
    // Using a 2-frame delay so the browser picks up the transition.
    footerFill.classList.remove("is-high", "is-mid", "is-low");
    if (cls) footerFill.classList.add(cls);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        footerFill.style.transform = `scaleX(${score / 100})`;
      });
    });
  }

  // ---------- report drawer ----------
  function openDrawer() {
    if (!state.analysis) return;
    const a = state.analysis;
    const cls = scoreClass(a.consistency_score);

    // Score — big mono display, colored by range.
    drawerScore.classList.remove("is-high", "is-mid", "is-low");
    if (cls) drawerScore.classList.add(cls);
    drawerScore.textContent = String(a.consistency_score);

    // Recommendation pill — inline with score (trust / verify / do_not_trust).
    drawerRec.classList.remove("rec-trust", "rec-verify", "rec-do_not_trust");
    if (a.recommendation) {
      drawerRec.hidden = false;
      drawerRec.textContent = (a.recommendation || "").replace(/_/g, " ");
      drawerRec.classList.add(`rec-${a.recommendation}`);
    } else {
      drawerRec.hidden = true;
    }

    drawerVerdict.textContent = a.verdict || "";

    // Stance rows — entry name + dot + stance chip.
    const stanceColor = {
      pro: "var(--color-success)",
      contra: "var(--color-danger)",
      neutral: "var(--color-text-faint)",
      refuses: "var(--color-warning)",
    };
    drawerStances.innerHTML = "";
    const stances = a.stance_by_response || [];
    state.entries.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "echo-drawer-stance-row";

      const name = document.createElement("span");
      name.className = "echo-drawer-stance-name";
      const dot = document.createElement("span");
      dot.className = "echo-drawer-stance-dot";
      const stance = stances[i] || entry.stance || "neutral";
      dot.style.background = stanceColor[stance] || stanceColor.neutral;
      name.appendChild(dot);
      name.appendChild(document.createTextNode(entry.label));
      row.appendChild(name);

      const chip = document.createElement("span");
      chip.className = `echo-stance stance-${stance}`;
      chip.textContent = stance;
      row.appendChild(chip);

      drawerStances.appendChild(row);
    });

    // Contradictions — clash layout "A ↔ B" + explanation below.
    drawerContradictions.innerHTML = "";
    const contrs = a.contradictions || [];
    drawerContrCount.textContent = contrs.length ? `· ${contrs.length}` : "";

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

        const clash = document.createElement("div");
        clash.className = "echo-drawer-contr-clash";
        const sideA = document.createElement("div");
        sideA.className = "echo-drawer-contr-side";
        sideA.textContent = c.response_a || "";
        const vs = document.createElement("div");
        vs.className = "echo-drawer-contr-vs";
        vs.textContent = "↔";
        const sideB = document.createElement("div");
        sideB.className = "echo-drawer-contr-side";
        sideB.textContent = c.response_b || "";
        clash.appendChild(sideA);
        clash.appendChild(vs);
        clash.appendChild(sideB);
        card.appendChild(clash);

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

  function updateCardReviewInPlace(i) {
    const card = cardsEl.querySelector(`[data-index="${i}"]`);
    if (!card) return;
    const body = card.querySelector(".echo-card-body");
    if (!body) return;
    const entry = state.entries[i];

    // First delta arriving on a loading card: swap bouncing dots for review
    // text element, then begin streaming updates into it.
    let review = body.querySelector(".echo-card-review");
    if (!review) {
      body.innerHTML = "";
      review = document.createElement("div");
      review.className = "echo-card-review";
      body.appendChild(review);
    }
    review.textContent = entry.response || "…";

    // Flip state classes so streaming cursor is shown via CSS.
    if (entry.status === "loading" && entry.response) {
      card.classList.add("is-streaming");
      card.classList.remove("is-loading");
    }
  }

  async function runStreamed(entry, index) {
    try {
      const r = await fetch(`${API_BASE}/api/stream-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: entry.prompt }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${r.status} ${text.slice(0, 200)}`);
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch (e) {
            LOG("bad NDJSON line:", line);
            continue;
          }
          if (msg.type === "delta") {
            entry.response += msg.text;
            updateCardReviewInPlace(index);
          } else if (msg.type === "done") {
            entry.status = "done";
            entry.response = msg.text || entry.response;
            renderCards(); // full re-render so "See more" toggle shows
          } else if (msg.type === "error") {
            throw new Error(msg.error || "stream error");
          }
        }
      }
      // If the server closed the stream without a "done" frame (edge case),
      // still mark the entry done if we have content.
      if (entry.status !== "done") {
        entry.status = entry.response ? "done" : "error";
        if (!entry.response) entry.error = "empty stream";
        renderCards();
      }
    } catch (err) {
      entry.status = "error";
      entry.error = String(err.message ?? err);
      LOG(`${entry.label} stream failed:`, entry.error);
      renderCards();
    }
  }

  async function orchestrate(prompt) {
    LOG("orchestrate:", prompt.slice(0, 80));
    state.currentPrompt = prompt;
    clearAll();

    // Show captured prompt immediately.
    empty.hidden = true;
    promptCard.hidden = false;
    cardsEl.hidden = false;
    promptBox.textContent = prompt;

    // Seed the ORIGINAL card. This one waits for the LIVE response from
    // ChatGPT itself — captured from the DOM by the content script — rather
    // than calling /api/stream-one. Status stays "loading" until the
    // content script relays the stabilized assistant text.
    state.entries.push({
      label: "CHATGPT",
      prompt,
      response: "",
      error: "",
      stance: null,
      status: "loading",
      isLive: true, // marker — do not call stream-one
    });
    state.expandedIndex = 0;
    renderCards();

    // Prepare the promise that /api/analyze will await.
    const assistantPromise = waitForAssistant();

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

    setStatus("streaming variants + waiting for ChatGPT…", "is-working");

    // Step 2: stream the 3 adversarial variants (entries 1,2,3) against
    // gpt-4o via /api/stream-one. Entry 0 (CHATGPT / isLive) is NOT streamed
    // here — it gets filled by the content script's assistant observer.
    const runPromises = state.entries.map((entry, i) => {
      if (entry.isLive) {
        // Wait for the content script to capture ChatGPT's actual response.
        return assistantPromise.then((responseText) => {
          entry.response = responseText;
          entry.status = "done";
          LOG(`CHATGPT live response arrived (${responseText.length} chars)`);
          renderCards();
        });
      }
      return runStreamed(entry, i);
    });
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
    if (msg.type === "ECHO_ASSISTANT_FOR_PANEL" && typeof msg.response === "string") {
      LOG("received assistant response from bg:", msg.response.slice(0, 80));
      // Fill the CHATGPT (isLive) entry if we have one waiting.
      const entry = state.entries.find((e) => e.isLive);
      if (entry) {
        entry.response = msg.response;
        // If we already resolved the promise earlier, keep the text anyway.
        if (pendingAssistant) {
          pendingAssistant(msg.response);
          pendingAssistant = null;
        }
      } else {
        LOG("no isLive entry to fill (no active prompt) — ignoring");
      }
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

  // Tell the background when the side panel is being closed (by the user
  // clicking X, or by Chrome tearing down the panel). Lets background keep
  // its panelOpenState in sync so the next click reopens correctly.
  window.addEventListener("pagehide", () => {
    try {
      chrome.runtime.sendMessage({ type: "ECHO_PANEL_CLOSING" });
    } catch (_e) {}
  });

  LOG("side panel ready");
})();
