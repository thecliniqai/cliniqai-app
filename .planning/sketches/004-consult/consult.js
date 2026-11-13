/* Consult prototype (DX-03). Synthetic patient, no network, nothing stored. */
(function () {
  "use strict";
  const P = window.Proto;
  const icon = P.icon;
  const esc = P.esc;

  const DRUGS = [
    { name: "Telmisartan 40 mg", form: "Tablet", generic: "Telmisartan" },
    { name: "Amlodipine 5 mg", form: "Tablet", generic: "Amlodipine" },
    { name: "Metformin 500 mg", form: "Tablet", generic: "Metformin" },
    { name: "Paracetamol 650 mg", form: "Tablet", generic: "Paracetamol" },
    { name: "Pantoprazole 40 mg", form: "Tablet", generic: "Pantoprazole" },
    { name: "Cetirizine 10 mg", form: "Tablet", generic: "Cetirizine" },
    { name: "Amoxicillin 500 mg", form: "Capsule", generic: "Amoxicillin", salt: "penicillin" },
    { name: "Azithromycin 500 mg", form: "Tablet", generic: "Azithromycin" },
  ];
  const FREQ = { 1: "1-0-1", 2: "1-0-0", 3: "0-0-1", 4: "1-1-1", 5: "0-1-0", 6: "SOS" };
  const FREQ_WORDS = { "1-0-1": "morning 1, afternoon 0, night 1", "1-0-0": "morning 1, afternoon 0, night 0", "0-0-1": "morning 0, afternoon 0, night 1", "1-1-1": "morning 1, afternoon 1, night 1", "0-1-0": "morning 0, afternoon 1, night 0", SOS: "when needed" };
  const DX = [
    ["Essential hypertension", "BA00"],
    ["Type 2 diabetes mellitus", "5A11"],
    ["Tension-type headache", "8A81"],
    ["Acute upper respiratory infection", "CA07"],
    ["Gastritis", "DA42"],
  ];
  const state = { rx: [], dx: [], pending: null, tab: "notes", assist: P.param("assist") !== "0", saved: "10:42 am" };

  function durText(t) {
    const m = /^(\d+)\s*([dwm])$/i.exec(t.trim());
    if (!m) return t.trim() || "5 days";
    const n = Number(m[1]);
    const u = { d: n === 1 ? "day" : "days", w: n === 1 ? "week" : "weeks", m: n === 1 ? "month" : "months" }[m[2].toLowerCase()];
    return n + " " + u;
  }

  function block(id, n, title, body, tab, extra) {
    return (
      '<section class="blk' +
      (tab === "notes" ? " tab-on" : "") +
      '" data-tab="' +
      tab +
      '" id="' +
      id +
      '" aria-labelledby="' +
      id +
      '-h" tabindex="-1"><div class="blk-head"><h2 id="' +
      id +
      '-h">' +
      title +
      "</h2>" +
      (extra || "") +
      '<kbd aria-label="Alt ' +
      n +
      '">Alt ' +
      n +
      '</kbd></div><div class="blk-body">' +
      body +
      "</div></section>"
    );
  }
  function chipSet(items, pressed) {
    return (
      '<div class="chips">' +
      items
        .map(function (c) {
          return '<button type="button" class="toggle-chip" aria-pressed="' + (pressed.indexOf(c) !== -1) + '">' + esc(c) + "</button>";
        })
        .join("") +
      '<button type="button" class="toggle-chip" aria-pressed="false">' +
      icon("plus", "icon-16") +
      "Add</button></div>"
    );
  }
  function ctxHtml() {
    return (
      '<section><h2>' +
      icon("vitals", "icon-16") +
      'Vitals today <button type="button" class="btn btn-ghost">Edit</button></h2><div class="vgrid">' +
      '<div class="flag"><span>BP</span><b>150/95</b></div><div><span>Pulse</span><b>88</b></div><div><span>Temp</span><b>98.4°F</b></div>' +
      "<div><span>SpO₂</span><b>98%</b></div><div><span>Weight</span><b>78 kg</b></div><div><span>BMI</span><b>27.0</b></div></div>" +
      '<p class="caption subtle" style="margin-top:8px">BP flagged high (text and colour). Recorded 10:21 am by the front desk.</p></section>' +
      '<section><h2>' +
      icon("history", "icon-16") +
      'Last visit · 2 Oct · Dr A Rao</h2><p class="body-sm">Essential hypertension (BA00)</p><ul class="rx-old" style="margin-top:8px"><li><span>Telmisartan 40 mg</span><span class="f">1-0-0 · 30 days</span></li><li><span>Metformin 500 mg</span><span class="f">1-0-1 · 30 days</span></li></ul>' +
      '<button type="button" class="btn btn-secondary btn-block" style="margin-top:10px" data-repeat>' +
      icon("refresh") +
      "Repeat last Rx</button></section>" +
      "<section><h2>" +
      icon("file", "icon-16") +
      'Problems</h2><ul><li>Type 2 diabetes · since 2019</li><li>Hypertension · since 2021</li></ul></section><section><h2>' +
      icon("history", "icon-16") +
      'History</h2><ul><li class="tnum">2 Oct · Dr A Rao · ' +
      P.formatINR(50000) +
      '</li><li class="tnum">14 Aug · Dr A Rao · ' +
      P.formatINR(50000) +
      '</li><li class="tnum">3 Jun · Dr M Iyer · ' +
      P.formatINR(30000) +
      "</li></ul></section>"
    );
  }

  function render() {
    const rxBody =
      '<ol class="rx-lines" id="rx-lines" aria-label="Prescription lines"></ol>' +
      '<div class="smart-row"><span class="smart">' +
      icon("zap") +
      'Smart Assist</span><button type="button" class="toggle-chip" data-repeat>' +
      icon("refresh", "icon-16") +
      'Repeat last Rx (2)</button><button type="button" class="toggle-chip" data-fav="3">Paracetamol 650 mg · SOS</button><button type="button" class="toggle-chip" data-fav="4">Pantoprazole 40 mg · 1-0-0</button></div>' +
      '<div class="rx-entry"><div class="grid"><div class="field combo"><label for="rx-q">Medicine</label><input class="input" id="rx-q" role="combobox" aria-expanded="false" aria-controls="rx-list" aria-autocomplete="list" autocomplete="off" placeholder="Type a medicine or salt"><ul class="listbox" id="rx-list" role="listbox" aria-label="Medicines" hidden></ul></div>' +
      '<div class="field"><label for="rx-f">Frequency</label><input class="input tnum" id="rx-f" inputmode="numeric" autocomplete="off" placeholder="1-0-1" aria-describedby="rx-f-h"></div>' +
      '<div class="field"><label for="rx-d">Duration</label><input class="input" id="rx-d" autocomplete="off" enterkeyhint="done" placeholder="5d, 2w, 1m"></div></div>' +
      '<p class="presets" id="rx-f-h">Keys: 1 = 1-0-1 · 2 = 1-0-0 · 3 = 0-0-1 · 4 = 1-1-1 · 5 = 0-1-0 · 6 = SOS · Enter adds the line</p>' +
      '<div class="field"><span class="field-label" id="rx-t-l">Timing</span><div class="seg" role="radiogroup" aria-labelledby="rx-t-l"><button type="button" role="radio" aria-checked="true">After food</button><button type="button" role="radio" aria-checked="false">Before food</button><button type="button" role="radio" aria-checked="false">Empty stomach</button></div></div></div>';

    const doc =
      '<div class="seg mobile-tabs" role="tablist" aria-label="Consult sections"><button type="button" role="tab" aria-selected="true" data-tabpick="notes">Notes</button><button type="button" role="tab" aria-selected="false" data-tabpick="rx">Rx <span class="n" id="rx-n">0</span></button><button type="button" role="tab" aria-selected="false" data-tabpick="ctx">Patient</button></div>' +
      '<div class="ctx-mobile" data-tab="ctx">' +
      ctxHtml() +
      "</div>" +
      block(
        "b-complaints",
        1,
        "Complaints",
        chipSet(["Headache", "Giddiness", "Fever", "Cough", "Body ache"], ["Headache"]) +
          '<div class="field"><label for="notes">Notes</label><textarea class="input" id="notes" rows="3" placeholder="History of present illness"></textarea></div>',
        "notes"
      ) +
      block("b-exam", 2, "Examination", '<div class="field"><label for="exam">General physician template</label><textarea class="input" id="exam" rows="2">CVS S1 S2 heard. RS clear. Abdomen soft.</textarea></div>', "notes", '<span class="count">GP</span>') +
      block(
        "b-dx",
        3,
        "Diagnosis",
        '<div class="chips" id="dx-chips"></div><div class="field combo"><label for="dx-q">Search diagnosis</label><input class="input" id="dx-q" role="combobox" aria-expanded="false" aria-controls="dx-list" aria-autocomplete="list" autocomplete="off" placeholder="Name, abbreviation (HTN, URTI) or ICD-11 code"><ul class="listbox" id="dx-list" role="listbox" aria-label="Diagnoses" hidden></ul></div>',
        "notes"
      ) +
      block("b-rx", 4, "Prescription", rxBody, "rx", '<span class="count" id="rx-count">No medicines yet</span>') +
      block("b-inv", 5, "Investigations", chipSet(["CBC", "HbA1c", "Lipid profile", "Serum creatinine", "ECG"], ["HbA1c"]), "notes") +
      block("b-adv", 6, "Advice", chipSet(["Low salt diet", "Walk 30 min daily", "Check BP at home", "Avoid fried food"], ["Low salt diet"]), "notes") +
      block(
        "b-fu",
        7,
        "Follow-up",
        '<div class="seg" role="radiogroup" aria-label="Follow-up in"><button type="button" role="radio" aria-checked="false">3 days</button><button type="button" role="radio" aria-checked="false">1 week</button><button type="button" role="radio" aria-checked="true">2 weeks</button><button type="button" role="radio" aria-checked="false">1 month</button></div><p class="body-sm muted">Fri, 27 Nov · the front desk books it on Finish</p>',
        "notes"
      );

    const assist =
      '<div class="assist-head"><span class="chip chip-ai">' +
      icon("sparkles") +
      'AI Assist</span><span class="chip chip-preview">Preview</span><button type="button" class="icon-btn" style="margin-left:auto" data-assist-close aria-label="Close AI Assist panel">' +
      icon("x") +
      '</button></div><div class="assist-body"><p class="body-sm muted">AI features are in preview and not yet offered as a paid product.</p>' +
      '<button type="button" class="btn btn-secondary btn-block">' +
      icon("note") +
      'Draft note from conversation</button><div class="ai-draft"><div style="display:flex;align-items:center;gap:6px"><span class="chip chip-ai">' +
      icon("sparkles") +
      'AI draft</span><span class="caption subtle">Needs your review</span></div><p><b>Complaints:</b> headache for 3 days, worse in the morning; occasional giddiness.</p><div style="display:flex;gap:8px"><button type="button" class="btn btn-secondary">Accept</button><button type="button" class="btn btn-ghost">Discard</button></div></div>' +
      '<p class="caption subtle">The draft never saves itself. Only accepted sections enter the note, marked as reviewed by you.</p></div>';

    P.shell({
      active: "today",
      focusMode: true,
      hideBottom: true,
      user: { initials: "AR", name: "Dr A Rao", role: "Doctor" },
      topbar:
        '<a class="icon-btn" href="../003-today/index.html?mode=doctor" aria-label="Back to My queue">' +
        icon("back") +
        '</a><div class="cx-id"><span class="token s-with-doctor"><span class="sr-only">Token </span>14</span><div class="who"><h1>Suresh Patil</h1><p class="tnum">54 y · M · CQ-0050 · +91 90000 00114</p></div></div>' +
        '<span class="save" id="save" role="status">' +
        icon("check") +
        '<span>Saved · 10:42 am</span></span><div class="cx-actions"><button type="button" class="btn btn-secondary ctx-btn" data-ctx>' +
        icon("panel") +
        'Patient</button><button type="button" class="btn btn-secondary" data-assist aria-pressed="' +
        state.assist +
        '">' +
        icon("sparkles") +
        'AI Assist <span class="chip chip-preview">Preview</span></button><button type="button" class="btn btn-primary" data-finish>Finish visit</button></div>',
      main:
        '<div class="cx-alert" role="note"><b>' +
        icon("allergy") +
        'Allergies: Penicillin</b><span class="chronic">Chronic: Type 2 diabetes, hypertension</span></div><div class="cx-body' +
        (state.assist ? " assist-open" : "") +
        '" id="cx-body"><aside class="ctx" aria-label="Patient context">' +
        ctxHtml() +
        '</aside><div class="doc" id="doc">' +
        doc +
        '</div><aside class="assist" aria-label="AI Assist">' +
        assist +
        '</aside></div><div class="finish-bar"><button type="button" class="btn btn-lg btn-secondary" data-assist-m>' +
        icon("sparkles") +
        'AI Assist</button><button type="button" class="btn btn-lg btn-primary" data-finish>Finish visit</button></div>',
    });
  }

  function markSaving() {
    const s = document.getElementById("save");
    s.classList.add("saving");
    s.querySelector("span").textContent = "Saving…";
    window.clearTimeout(markSaving.t);
    markSaving.t = window.setTimeout(function () {
      s.classList.remove("saving");
      s.querySelector("span").textContent = "Saved · 10:43 am";
    }, 700);
  }

  function drawRx() {
    const ol = document.getElementById("rx-lines");
    ol.innerHTML = state.rx
      .map(function (r, i) {
        return (
          '<li class="rx-line' +
          (r.repeat ? " repeat" : "") +
          '"><span class="ix">' +
          (i + 1) +
          '</span><div><div class="drug">' +
          esc(r.drug.name) +
          " <small>" +
          esc(r.drug.form) +
          '</small></div><div class="how"><span class="freq" aria-label="' +
          FREQ_WORDS[r.freq] +
          '">' +
          r.freq +
          "</span><span>" +
          esc(r.timing) +
          "</span><span>" +
          esc(r.dur) +
          "</span>" +
          (r.repeat ? '<span class="chip chip-neutral">Repeated · review</span>' : "") +
          (r.drug.salt === "penicillin" ? '<span class="chip chip-match">' + icon("allergy") + "Matches allergy: Penicillin</span>" : "") +
          "</div>" +
          (r.drug.salt === "penicillin"
            ? '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px"><span class="body-sm" style="color:var(--color-danger-fg)">Penicillin allergy on record. Not added to the signed Rx until you confirm.</span><button type="button" class="btn btn-secondary">Prescribe anyway…</button></div>'
            : "") +
          '</div><button type="button" class="icon-btn" aria-label="Remove ' +
          esc(r.drug.name) +
          '" data-rm="' +
          i +
          '">' +
          icon("x") +
          "</button></li>"
        );
      })
      .join("");
    const n = state.rx.length;
    document.getElementById("rx-count").textContent = n ? n + (n === 1 ? " medicine" : " medicines") : "No medicines yet";
    document.getElementById("rx-n").textContent = n;
  }
  function addRx(drug, freq, dur, repeat) {
    state.rx.push({ drug: drug, freq: freq, dur: dur, timing: "After food", repeat: !!repeat });
    drawRx();
    markSaving();
    P.announce(drug.name + " " + freq + " " + dur + " added");
  }

  function wireCombo(inputId, listId, source, label, onPick) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    let res = [];
    let active = 0;
    function draw() {
      const q = input.value.trim().toLowerCase();
      res = q
        ? source.filter(function (x) {
            return label(x).toLowerCase().indexOf(q) !== -1 || (x.alias && x.alias.indexOf(q) !== -1);
          })
        : [];
      active = 0;
      list.hidden = !res.length;
      input.setAttribute("aria-expanded", String(!!res.length));
      list.innerHTML = res
        .map(function (x, i) {
          return '<li role="option" id="' + listId + "-" + i + '" aria-selected="' + (i === active) + '" data-i="' + i + '">' + label(x, true) + "</li>";
        })
        .join("");
      input.setAttribute("aria-activedescendant", res.length ? listId + "-0" : "");
    }
    function hl() {
      list.querySelectorAll("li").forEach(function (li, i) {
        li.setAttribute("aria-selected", String(i === active));
      });
      input.setAttribute("aria-activedescendant", listId + "-" + active);
    }
    function pick(i) {
      const x = res[i];
      if (!x) return;
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      onPick(x);
    }
    input.addEventListener("input", draw);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && res.length) {
        e.preventDefault();
        active = (active + 1) % res.length;
        hl();
      } else if (e.key === "ArrowUp" && res.length) {
        e.preventDefault();
        active = (active - 1 + res.length) % res.length;
        hl();
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(active);
      } else if (e.key === "Escape") {
        list.hidden = true;
      }
    });
    list.addEventListener("mousedown", function (e) {
      const li = e.target.closest("li");
      if (li) {
        e.preventDefault();
        pick(Number(li.dataset.i));
      }
    });
    return input;
  }

  function finish() {
    const sheet = P.openSheet({
      title: "Finish visit",
      context: "Token 14 · Suresh Patil",
      body:
        '<div class="review sum"><p><b>Diagnosis:</b> ' +
        (state.dx.map(esc).join(", ") || '<span class="muted">none recorded</span>') +
        "</p><p><b>Prescription:</b> " +
        (state.rx.length
          ? state.rx
              .map(function (r) {
                return esc(r.drug.name) + " " + r.freq + " · " + esc(r.dur);
              })
              .join("; ")
          : '<span class="muted">none</span>') +
        "</p><p><b>Follow-up:</b> 2 weeks · Fri, 27 Nov</p></div>" +
        '<div class="field"><span class="field-label">Send prescription</span><div class="chips"><button type="button" class="toggle-chip" aria-pressed="true">' +
        icon("message", "icon-16") +
        'WhatsApp</button><button type="button" class="toggle-chip" aria-pressed="false">' +
        icon("printer", "icon-16") +
        'Print</button></div></div><div class="field"><span class="field-label" id="ho-l">Billing</span><div class="seg" role="radiogroup" aria-labelledby="ho-l"><button type="button" role="radio" aria-checked="true">Front desk collects ' +
        P.formatINR(50000) +
        '</button><button type="button" role="radio" aria-checked="false">Collect here</button></div></div><p class="caption subtle">Signing locks this prescription. Changes after signing are amendments with a reason.</p>',
      foot: '<button type="button" class="btn btn-lg btn-secondary" data-close-review>Back to note</button><button type="button" class="btn btn-lg btn-primary" id="sign">Sign and finish</button>',
      focus: "#sign",
    });
    sheet.querySelector("[data-close-review]").addEventListener("click", P.closeSheet);
    sheet.querySelector("#sign").addEventListener("click", function () {
      sheet.querySelector(".sheet-body").innerHTML =
        '<div class="success" role="status"><p class="title-3" style="display:flex;gap:8px;align-items:center;color:var(--color-success-fg)">' +
        icon("done") +
        'Visit finished · Rx v1 signed</p><p class="body-sm muted">Token 14 moved to To bill. WhatsApp prescription queued.</p></div>';
      sheet.querySelector(".sheet-foot").innerHTML =
        '<a class="btn btn-lg btn-primary" id="next" href="../003-today/index.html?mode=doctor">Call next · token 16</a>';
      sheet.querySelector("#next").focus();
      P.announce("Visit finished and signed");
    });
  }

  render();
  const repeatLast = function () {
    addRx(DRUGS[0], "1-0-0", "30 days", true);
    addRx(DRUGS[2], "1-0-1", "30 days", true);
  };
  const rxQ = wireCombo(
    "rx-q",
    "rx-list",
    DRUGS,
    function (d, html) {
      return html ? "<span>" + esc(d.name) + " <small>" + d.form + "</small></span>" + (d.salt === "penicillin" ? '<span class="chip chip-match">' + icon("allergy") + "Allergy</span>" : "<small>" + d.generic + "</small>") : d.name;
    },
    function (d) {
      state.pending = d;
      rxQ.value = d.name;
      document.getElementById("rx-f").focus();
    }
  );
  const rxF = document.getElementById("rx-f");
  const rxD = document.getElementById("rx-d");
  rxF.addEventListener("keydown", function (e) {
    if (FREQ[e.key] && rxF.value === "") {
      e.preventDefault();
      rxF.value = FREQ[e.key];
      rxD.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      rxD.focus();
    }
  });
  rxD.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!state.pending) return;
    addRx(state.pending, rxF.value || "1-0-1", durText(rxD.value));
    state.pending = null;
    rxQ.value = "";
    rxF.value = "";
    rxD.value = "";
    rxQ.focus();
  });
  const dxQ = wireCombo(
    "dx-q",
    "dx-list",
    DX.map(function (d) {
      return { name: d[0], code: d[1], alias: d[0] === "Essential hypertension" ? "htn" : d[0].indexOf("respiratory") !== -1 ? "urti" : "" };
    }),
    function (d, html) {
      return html ? "<span>" + esc(d.name) + "</span><small>ICD-11 " + d.code + "</small>" : d.name + " " + d.code;
    },
    function (d) {
      state.dx.push(d.name + " (" + d.code + ")");
      document.getElementById("dx-chips").innerHTML = state.dx
        .map(function (t) {
          return '<span class="chip chip-neutral" style="height:32px;padding:0 12px;font-size:var(--text-body-sm)">' + esc(t) + "</span>";
        })
        .join("");
      dxQ.value = "";
      markSaving();
    }
  );

  document.getElementById("notes").addEventListener("input", markSaving);
  const app = document.getElementById("app");
  app.addEventListener("click", function (e) {
    const t = e.target;
    if (t.closest("[data-repeat]")) return repeatLast();
    const fav = t.closest("[data-fav]");
    if (fav) return addRx(DRUGS[Number(fav.dataset.fav)], fav.dataset.fav === "3" ? "SOS" : "1-0-0", "5 days");
    const rm = t.closest("[data-rm]");
    if (rm) {
      state.rx.splice(Number(rm.dataset.rm), 1);
      drawRx();
      return undefined;
    }
    if (t.closest("[data-finish]")) return finish();
    if (t.closest("[data-assist]")) {
      state.assist = !state.assist;
      document.getElementById("cx-body").classList.toggle("assist-open", state.assist);
      t.closest("[data-assist]").setAttribute("aria-pressed", String(state.assist));
      return undefined;
    }
    if (t.closest("[data-assist-close]")) {
      state.assist = false;
      document.getElementById("cx-body").classList.remove("assist-open");
      return undefined;
    }
    if (t.closest("[data-assist-m]")) {
      return P.openSheet({ title: "AI Assist", body: document.querySelector(".assist .assist-body").outerHTML });
    }
    if (t.closest("[data-ctx]")) {
      return P.openSheet({ title: "Patient context", context: "Suresh Patil · token 14", body: '<div class="ctx" style="display:block;border:0;margin:-16px -20px">' + ctxHtml() + "</div>" });
    }
    const tp = t.closest("[data-tabpick]");
    if (tp) {
      state.tab = tp.dataset.tabpick;
      document.querySelectorAll("[data-tabpick]").forEach(function (b) {
        b.setAttribute("aria-selected", String(b === tp));
      });
      document.querySelectorAll("#doc [data-tab]").forEach(function (b) {
        b.classList.toggle("tab-on", b.dataset.tab === state.tab);
      });
      return undefined;
    }
    const chip = t.closest(".toggle-chip[aria-pressed]");
    if (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
      markSaving();
    }
    const radio = t.closest('[role="radio"]');
    if (radio) {
      radio.parentElement.querySelectorAll('[role="radio"]').forEach(function (r) {
        r.setAttribute("aria-checked", String(r === radio));
      });
    }
    return undefined;
  });
  document.addEventListener("keydown", function (e) {
    if (e.altKey && /^Digit[1-7]$/.test(e.code)) {
      e.preventDefault();
      const ids = ["b-complaints", "b-exam", "b-dx", "b-rx", "b-inv", "b-adv", "b-fu"];
      const sec = document.getElementById(ids[Number(e.code.slice(5)) - 1]);
      sec.scrollIntoView({ block: "start" });
      const f = sec.querySelector("input, textarea, button.toggle-chip");
      (f || sec).focus();
    }
  });
  if (P.param("demo") === "rx") {
    repeatLast();
    addRx(DRUGS[6], "1-0-1", "5 days");
    state.dx.push("Essential hypertension (BA00)");
    document.getElementById("dx-chips").innerHTML = '<span class="chip chip-neutral" style="height:32px;padding:0 12px;font-size:var(--text-body-sm)">Essential hypertension (BA00)</span>';
  }
  if (P.param("tab")) {
    const b = document.querySelector('[data-tabpick="' + P.param("tab") + '"]');
    if (b) b.click();
  }
})();
