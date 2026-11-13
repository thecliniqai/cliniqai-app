/* Consult prototype (DX-03, round 2). Synthetic patient and a synthetic "doctor memory"; no network,
   nothing stored. Tap-first: every common step is a tile; typing is the fallback, never the default. */
(function () {
  "use strict";
  const P = window.Proto;
  const icon = P.icon;
  const esc = P.esc;

  /* ------------------------------------------------------------------ synthetic doctor memory */
  /* Complaints the doctor used most, with what usually accompanies them (ranking only, never auto-added). */
  const COMPLAINTS = [
    { n: "Fever", w: ["Body ache", "Cough", "Cold", "Headache"] },
    { n: "Cough", w: ["Cold", "Fever", "Sore throat", "Breathlessness"] },
    { n: "Cold", w: ["Cough", "Sore throat", "Fever"] },
    { n: "Headache", w: ["Giddiness", "Fever"] },
    { n: "Body ache", w: ["Fever", "Weakness"] },
    { n: "Sore throat", w: ["Cold", "Cough", "Fever"] },
    { n: "Loose stools", w: ["Vomiting", "Abdominal pain", "Fever"] },
    { n: "Vomiting", w: ["Loose stools", "Abdominal pain"] },
    { n: "Acidity", w: ["Abdominal pain"] },
    { n: "Giddiness", w: ["Headache", "Weakness"] },
    { n: "Abdominal pain", w: ["Loose stools", "Vomiting", "Acidity"] },
    { n: "Breathlessness", w: ["Cough"] },
    { n: "Weakness", w: ["Body ache", "Giddiness"] },
    { n: "Skin rash", w: ["Fever"] },
    { n: "Back pain", w: [] },
    { n: "Burning urination", w: ["Fever"] },
  ];
  const DUR = ["1d", "2d", "3d", "5d", "1w", "2w", "1m"];
  const SEV = ["Mild", "Moderate", "Severe"];

  const RS_FIND = ["Crepts", "Wheeze", "Rhonchi", "Reduced air entry", "Bronchial breathing"];
  const SIDE = ["Right", "Left", "Bilateral"];
  const EXAM_TEMPLATES = [
    {
      id: "fever",
      name: "Fever workup",
      for: ["Fever", "Body ache"],
      systems: [
        { k: "gen", n: "General", normal: "Febrile to touch, no toxic look, hydration adequate", find: ["Toxic look", "Dehydrated", "Rash", "Throat congested", "Tonsils enlarged"] },
        { k: "cvs", n: "CVS", normal: "S1 S2 normal, no murmur", find: ["Murmur", "Tachycardia", "Irregular rhythm"] },
        { k: "rs", n: "RS", normal: "Bilateral air entry equal, no added sounds", find: RS_FIND, side: true },
        { k: "pa", n: "Abdomen", normal: "Soft, non-tender, no organomegaly", find: ["Tenderness", "Hepatomegaly", "Splenomegaly", "Guarding"] },
      ],
    },
    {
      id: "gp",
      name: "GP general",
      for: ["Headache", "Giddiness", "Weakness", "Back pain"],
      systems: [
        { k: "cvs", n: "CVS", normal: "S1 S2 normal, no murmur", find: ["Murmur", "Tachycardia", "Irregular rhythm"] },
        { k: "rs", n: "RS", normal: "Bilateral vesicular breath sounds, no added sounds", find: RS_FIND, side: true },
        { k: "pa", n: "Abdomen", normal: "Soft, non-tender, no organomegaly", find: ["Tenderness", "Hepatomegaly", "Splenomegaly", "Guarding"] },
        { k: "cns", n: "CNS", normal: "Conscious, oriented, no focal deficit", find: ["Neck stiffness", "Focal deficit", "Drowsy", "Gait abnormal"] },
      ],
    },
    {
      id: "resp",
      name: "Respiratory",
      for: ["Cough", "Cold", "Sore throat", "Breathlessness"],
      systems: [
        { k: "ent", n: "ENT", normal: "Throat not congested, tonsils normal, no post-nasal drip", find: ["Throat congested", "Tonsils enlarged", "Post-nasal drip", "Ear drum dull"] },
        { k: "rs", n: "RS", normal: "Bilateral air entry equal, no added sounds", find: RS_FIND, side: true },
        { k: "cvs", n: "CVS", normal: "S1 S2 normal, no murmur", find: ["Murmur", "Tachycardia"] },
      ],
    },
    {
      id: "abd",
      name: "Abdomen",
      for: ["Loose stools", "Vomiting", "Abdominal pain", "Acidity"],
      systems: [
        { k: "gen", n: "General", normal: "Hydration adequate, no pallor", find: ["Dehydrated", "Pallor", "Icterus"] },
        { k: "pa", n: "Abdomen", normal: "Soft, non-tender, bowel sounds normal", find: ["Epigastric tenderness", "RIF tenderness", "Guarding", "Distension", "Hepatomegaly"] },
        { k: "cvs", n: "CVS", normal: "S1 S2 normal", find: ["Tachycardia"] },
      ],
    },
    { id: "dental", name: "Dental", for: [], systems: [{ k: "oral", n: "Oral cavity", normal: "No caries, gingiva healthy, no mobility", find: ["Caries", "Gingivitis", "Mobility", "Abscess"] }], odontogram: true },
    { id: "child", name: "Child", for: [], systems: [{ k: "gen", n: "General", normal: "Active, playful, well hydrated", find: ["Lethargic", "Dehydrated", "Rash"] }, { k: "rs", n: "RS", normal: "No distress, air entry equal", find: ["Retractions", "Wheeze", "Crepts"], side: true }], growth: true },
  ];
  const SIGNS = ["Pallor", "Icterus", "Cyanosis", "Clubbing", "Lymph nodes", "Edema"];

  const DRUGS = [
    { name: "Paracetamol 650 mg", form: "Tablet", generic: "Paracetamol", usual: { f: "1-0-1", t: "After food", d: 5 }, fav: true },
    { name: "Cetirizine 10 mg", form: "Tablet", generic: "Cetirizine", usual: { f: "0-0-1", t: "After food", d: 5 }, fav: true },
    { name: "Pantoprazole 40 mg", form: "Tablet", generic: "Pantoprazole", usual: { f: "1-0-0", t: "Before food", d: 5 }, fav: true },
    { name: "Azithromycin 500 mg", form: "Tablet", generic: "Azithromycin", usual: { f: "1-0-0", t: "After food", d: 3 }, fav: true },
    { name: "Telmisartan 40 mg", form: "Tablet", generic: "Telmisartan", usual: { f: "1-0-0", t: "After food", d: 30 } },
    { name: "Amlodipine 5 mg", form: "Tablet", generic: "Amlodipine", usual: { f: "0-0-1", t: "After food", d: 30 } },
    { name: "Metformin 500 mg", form: "Tablet", generic: "Metformin", usual: { f: "1-0-1", t: "After food", d: 30 } },
    { name: "Amoxicillin 500 mg", form: "Capsule", generic: "Amoxicillin", salt: "penicillin", usual: { f: "1-0-1", t: "After food", d: 5 } },
    { name: "Ondansetron 4 mg", form: "Tablet", generic: "Ondansetron", usual: { f: "1-0-1", t: "Before food", d: 3 } },
    { name: "ORS sachet", form: "Sachet", generic: "Oral rehydration salts", usual: { f: "SOS", t: "With water", d: 3 } },
    { name: "Levocetirizine 5 mg", form: "Tablet", generic: "Levocetirizine", usual: { f: "0-0-1", t: "After food", d: 5 } },
    { name: "Salbutamol inhaler", form: "Inhaler", generic: "Salbutamol", usual: { f: "SOS", t: "", d: 30 } },
  ];
  const drug = (n) => DRUGS.find((d) => d.name.indexOf(n) === 0);
  const FREQ = ["1-0-1", "1-0-0", "0-0-1", "1-1-1", "SOS"];
  const FREQ_WORDS = { "1-0-1": "morning and night", "1-0-0": "morning only", "0-0-1": "night only", "1-1-1": "three times a day", SOS: "when needed" };
  const TIMING = ["After food", "Before food", "With food", "Empty stomach"];
  const DUR_RX = [3, 5, 7, 10, 14, 30];

  /* Diagnoses with the doctor's own usual plan (learned from past signed visits). */
  const DX = [
    { n: "Viral fever", icd: "MG26", for: ["Fever", "Body ache", "Headache"], rx: [["Paracetamol", "1-0-1", 5], ["Cetirizine", "0-0-1", 5], ["Pantoprazole", "1-0-0", 5]], inv: ["CBC", "Dengue NS1", "Malaria antigen"], adv: ["Plenty of oral fluids", "Rest 2–3 days", "Tepid sponging if fever > 101°F"], fu: "3d" },
    { n: "Acute URTI", icd: "CA07", for: ["Cough", "Cold", "Sore throat", "Fever"], rx: [["Azithromycin", "1-0-0", 3], ["Paracetamol", "1-0-1", 5], ["Levocetirizine", "0-0-1", 5]], inv: [], adv: ["Warm saline gargles", "Steam inhalation twice daily", "Avoid cold drinks"], fu: "5d" },
    { n: "Acute gastroenteritis", icd: "1A40", for: ["Loose stools", "Vomiting", "Abdominal pain"], rx: [["ORS", "SOS", 3], ["Ondansetron", "1-0-1", 3], ["Pantoprazole", "1-0-0", 5]], inv: ["Stool routine"], adv: ["ORS after every loose stool", "Soft bland diet", "Hand hygiene"], fu: "3d" },
    { n: "Essential hypertension", icd: "BA00", chronic: true, for: ["Headache", "Giddiness"], rx: [["Telmisartan", "1-0-0", 30], ["Amlodipine", "0-0-1", 30]], inv: ["Serum creatinine", "Lipid profile", "ECG"], adv: ["Low salt diet", "Walk 30 min daily", "Check BP at home"], fu: "1m" },
    { n: "Type 2 diabetes mellitus", icd: "5A11", chronic: true, for: ["Weakness"], rx: [["Metformin", "1-0-1", 30]], inv: ["HbA1c", "Fasting blood sugar", "Serum creatinine"], adv: ["Diabetic diet", "Walk 30 min daily"], fu: "1m" },
    { n: "Allergic rhinitis", icd: "CA08.0", for: ["Cold", "Cough"], rx: [["Levocetirizine", "0-0-1", 10]], inv: [], adv: ["Avoid dust exposure"], fu: "2w" },
    { n: "Acute bronchitis", icd: "CA42", for: ["Cough", "Breathlessness", "Fever"], rx: [["Azithromycin", "1-0-0", 5], ["Salbutamol", "SOS", 30]], inv: ["Chest X-ray"], adv: ["Steam inhalation twice daily"], fu: "5d" },
    { n: "Tension-type headache", icd: "8A81", for: ["Headache"], rx: [["Paracetamol", "SOS", 5]], inv: [], adv: ["Regular sleep", "Limit screen time"], fu: "2w" },
    { n: "Urinary tract infection", icd: "GC08", for: ["Burning urination", "Fever"], rx: [], inv: ["Urine routine", "Urine culture"], adv: ["Plenty of oral fluids"], fu: "5d" },
    { n: "Migraine", icd: "8A80", for: ["Headache"], rx: [], inv: [], adv: [], fu: "2w" },
    { n: "Gastritis", icd: "DA42", for: ["Acidity", "Abdominal pain"], rx: [["Pantoprazole", "1-0-0", 14]], inv: [], adv: ["Avoid spicy food", "Small frequent meals"], fu: "2w" },
  ];
  const INV_ALL = ["CBC", "Dengue NS1", "Malaria antigen", "HbA1c", "Fasting blood sugar", "Lipid profile", "Serum creatinine", "Urine routine", "Chest X-ray", "ECG", "LFT", "TSH", "Stool routine", "Urine culture"];
  const ADV_ALL = ["Plenty of oral fluids", "Rest 2–3 days", "Warm saline gargles", "Steam inhalation twice daily", "Low salt diet", "Walk 30 min daily", "Diabetic diet", "Soft bland diet", "Avoid spicy food", "Check BP at home"];
  const FU = [["none", "None"], ["3d", "3 days"], ["5d", "5 days"], ["1w", "1 week"], ["2w", "2 weeks"], ["1m", "1 month"]];
  const FU_DATE = { "3d": "Mon, 16 Nov", "5d": "Wed, 18 Nov", "1w": "Fri, 20 Nov", "2w": "Fri, 27 Nov", "1m": "Sun, 13 Dec" };
  const LAST_VISIT = { date: "2 Oct", dx: "Essential hypertension", rx: [["Telmisartan", "1-0-0", 30], ["Metformin", "1-0-1", 30]] };

  const S = {
    c: [], // complaints {n, dur, sev, note, open}
    exam: null, // {t, sys: {k: {abn, f:[], side, note}}, signs: {}}
    dx: [],
    rx: [], // {d, f, t, dur(days), note, repeat}
    inv: [],
    adv: [],
    fu: null,
    pending: null, // dose builder: {d, f, t, dur, note, editIx}
    sum: window.matchMedia("(min-width: 1440px)").matches,
    cur: "complaints",
  };

  const durWord = (n) => (n === 1 ? "1 day" : n % 30 === 0 ? n / 30 + (n === 30 ? " month" : " months") : n % 7 === 0 && n >= 14 ? n / 7 + " weeks" : n + " days");
  const durLabel = { "1d": "1 day", "2d": "2 days", "3d": "3 days", "5d": "5 days", "1w": "1 week", "2w": "2 weeks", "1m": "1 month" };
  const has = (arr, key, val) => arr.some((x) => x[key] === val);

  /* ------------------------------------------------------------------ ranking (the chain) */
  function rankedComplaints() {
    const added = S.c.map((x) => x.n);
    const score = {};
    COMPLAINTS.forEach((c, i) => (score[c.n] = 100 - i));
    added.forEach((a) => {
      const src = COMPLAINTS.find((c) => c.n === a);
      if (src) src.w.forEach((w, i) => (score[w] = (score[w] || 0) + 1000 - i * 10));
    });
    return COMPLAINTS.filter((c) => added.indexOf(c.n) === -1)
      .sort((a, b) => score[b.n] - score[a.n])
      .slice(0, 10);
  }
  function rankedTemplates() {
    const added = S.c.map((x) => x.n);
    return EXAM_TEMPLATES.map((t) => ({ t, s: t.for.filter((f) => added.indexOf(f) !== -1).length })).sort((a, b) => b.s - a.s);
  }
  function rankedDx() {
    const added = S.c.map((x) => x.n);
    const chosen = S.dx.map((x) => x.n);
    const scored = DX.filter((d) => chosen.indexOf(d.n) === -1).map((d, i) => ({ d, s: d.for.filter((f) => added.indexOf(f) !== -1).length * 10 - i * 0.1 }));
    scored.sort((a, b) => b.s - a.s);
    return { likely: scored.filter((x) => x.s > 0).slice(0, 4).map((x) => x.d), recent: scored.filter((x) => x.s <= 0).slice(0, 5).map((x) => x.d) };
  }
  function primaryDx() {
    return S.dx.length ? DX.find((d) => d.n === S.dx[0].n) : null;
  }

  /* ------------------------------------------------------------------ html helpers */
  function tile(label, attrs, pressed, sub, cls) {
    return '<button type="button" class="tile ' + (cls || "") + '" aria-pressed="' + !!pressed + '" ' + attrs + ">" + esc(label) + (sub ? " <small>" + esc(sub) + "</small>" : "") + "</button>";
  }
  function pills(opts, val, attr, name) {
    return (
      '<span class="pills" role="radiogroup" aria-label="' +
      esc(name) +
      '">' +
      opts.map((o) => '<button type="button" class="pill" role="radio" aria-checked="' + (o[0] === val) + '" ' + attr + '="' + esc(o[0]) + '">' + esc(o[1]) + "</button>").join("") +
      "</span>"
    );
  }
  function sec(id, n, title, body) {
    return '<section class="sec" id="s-' + id + '" data-sec="' + id + '" aria-labelledby="h-' + id + '"><div class="sec-head"><h2 id="h-' + id + '">' + title + '</h2><span class="sum" id="sum-' + id + '"></span><kbd>Alt ' + n + "</kbd></div>" + body + "</section>";
  }

  /* ------------------------------------------------------------------ patient context */
  function ctxHtml() {
    return (
      '<section><h2>Vitals · 10:21 am <button type="button" class="btn btn-ghost" data-vitals>Edit</button></h2><div class="vgrid">' +
      '<div class="flag"><span>BP</span><b>150/95</b></div><div><span>Pulse</span><b>96</b></div><div><span>Temp</span><b>100.8°F</b></div>' +
      "<div><span>SpO₂</span><b>97%</b></div><div><span>Weight</span><b>78 kg</b></div><div><span>BMI</span><b>27.0</b></div></div></section>" +
      '<section><h2>Allergies</h2><p class="body-sm allergy-line">Penicillin</p></section>' +
      '<section><h2>Problems</h2><ul><li>Type 2 diabetes · since 2019</li><li>Hypertension · since 2021</li></ul></section>' +
      "<section><h2>Last visit · " +
      LAST_VISIT.date +
      '</h2><p class="body-sm" style="margin-bottom:8px">' +
      LAST_VISIT.dx +
      ' <span class="subtle">(BA00)</span></p><ul class="rx-old">' +
      LAST_VISIT.rx.map((r) => "<li><span>" + esc(drug(r[0]).name) + '</span><span class="f">' + r[1] + " · " + durWord(r[2]) + "</span></li>").join("") +
      '</ul><button type="button" class="btn btn-secondary btn-block" style="margin-top:12px" data-same-last>' +
      icon("refresh") +
      "Same as last visit</button></section>" +
      '<section><h2>History</h2><ul class="tnum"><li>2 Oct · Dr A Rao · Hypertension</li><li>14 Aug · Dr A Rao · Hypertension review</li><li>3 Jun · Dr M Iyer · Acute URTI</li></ul></section>'
    );
  }

  /* ------------------------------------------------------------------ shell */
  function render() {
    const note =
      '<nav class="strip" aria-label="Sections">' +
      [["complaints", "Complaints"], ["exam", "Examination"], ["dx", "Diagnosis"], ["rx", "Prescription"], ["plan", "Plan"]]
        .map((s) => '<button type="button" data-jump="' + s[0] + '" aria-current="' + (S.cur === s[0]) + '">' + s[1] + '<span class="n" id="n-' + s[0] + '">0</span></button>')
        .join("") +
      "</nav>" +
      sec("complaints", 1, "Complaints", '<div class="group"><div class="eyebrow">Tap to add <span class="smart">· ranked for you</span></div><div class="tiles" id="c-tiles"></div></div><ul class="items" id="c-items" aria-label="Complaints added"></ul><div class="group" id="c-notes"></div>') +
      sec("exam", 2, "Examination", '<div class="group"><div class="vit-strip" id="vit"></div></div><div class="group"><div class="eyebrow">Template <span class="smart">· all findings start normal</span></div><div class="tiles" id="t-tiles"></div></div><div class="group"><div class="exam" id="exam"></div></div><div class="group" id="signs-g"><div class="eyebrow">General signs · tap any that are present</div><div class="signs" id="signs"></div></div>') +
      sec("dx", 3, "Diagnosis", '<div id="dx-sugg"></div><ul class="items" id="dx-items" aria-label="Diagnoses"></ul>') +
      sec("rx", 4, "Prescription", '<div id="rx-sugg"></div><ol class="rx-lines" id="rx-lines" aria-label="Prescription lines"></ol><div class="group rx-entry"><div class="eyebrow">Add a medicine</div><div class="combo"><label class="sr-only" for="rx-q">Medicine</label><div class="input-wrap">' + icon("search") + '<input class="input" id="rx-q" role="combobox" aria-expanded="false" aria-controls="rx-list" aria-autocomplete="list" autocomplete="off" placeholder="Type a medicine or salt · Enter picks the top match"><kbd class="kbd-lg">M</kbd></div><ul class="listbox" id="rx-list" role="listbox" aria-label="Medicines" hidden></ul></div><div class="dose" id="dose" hidden></div></div>') +
      sec("plan", 5, "Plan", '<div class="group"><div class="eyebrow" id="inv-eb">Investigations</div><div class="tiles" id="inv-tiles"></div></div><div class="group"><div class="eyebrow" id="adv-eb">Advice</div><div class="tiles" id="adv-tiles"></div></div><div class="group"><div class="eyebrow" id="fu-eb">Follow-up</div><div class="tiles" id="fu-tiles"></div><p class="hint-line" id="fu-hint"></p></div><div class="group"><div class="tiles"><button type="button" class="tile ghost">' + icon("share") + 'Refer to a specialist</button><button type="button" class="tile ghost">' + icon("file") + "Attach a report</button></div></div>");

    P.shell({
      active: "today",
      focusMode: true,
      hideBottom: true,
      user: { initials: "AR", name: "Dr A Rao", role: "Doctor" },
      topbar:
        '<a class="icon-btn" href="../003-today/index.html?mode=doctor" aria-label="Back to My queue">' +
        icon("back") +
        '</a><div class="cx-id"><span class="token s-with-doctor"><span class="sr-only">Token </span>14</span><div class="who"><h1>Suresh Patil</h1><p class="tnum">54 y · M · CQ-0050 · Walk-in · with you 6 min</p></div></div>' +
        '<span class="save" id="save" role="status">' +
        icon("check") +
        '<span>Saved 10:48 am</span></span><div class="cx-actions"><button type="button" class="btn btn-secondary ctx-btn" data-ctx>Patient</button><button type="button" class="btn btn-secondary sum-btn" data-sum aria-pressed="' +
        S.sum +
        '">Summary</button><button type="button" class="icon-btn bordered" data-assist-m aria-label="AI Assist, preview" title="AI Assist · Preview">' +
        icon("sparkles") +
        '</button><button type="button" class="btn btn-primary" data-finish>Finish visit</button></div>',
      main:
        '<div class="cx-alert" role="note"><b>' +
        icon("allergy") +
        'Allergy: Penicillin</b><span class="chronic">Type 2 diabetes · Hypertension</span></div><div class="cx-body' +
        (S.sum ? " sum-open" : "") +
        '" id="cx-body"><aside class="rail" aria-label="Patient">' +
        ctxHtml() +
        '</aside><div class="note" id="note">' +
        note +
        '</div><aside class="sum-pane" aria-label="Visit summary"><section><h2>Summary · as the patient will see it</h2><div class="sum-doc" id="sum-doc"></div></section></aside></div>' +
        '<div class="finish-bar"><button type="button" class="btn btn-lg btn-secondary" data-ctx>Patient</button><button type="button" class="btn btn-lg btn-primary" data-finish>Finish visit</button></div>',
    });
    drawAll();
  }

  function markSaving() {
    const s = document.getElementById("save");
    if (!s) return;
    s.classList.add("saving");
    s.querySelector("span").textContent = "Saving…";
    window.clearTimeout(markSaving.t);
    markSaving.t = window.setTimeout(function () {
      s.classList.remove("saving");
      s.querySelector("span").textContent = "Saved 10:49 am";
    }, 600);
  }
  function drawAll() {
    drawComplaints();
    drawExam();
    drawDx();
    drawRx();
    drawPlan();
    drawSummary();
  }
  function setCount(id, n, sum) {
    document.getElementById("n-" + id).textContent = n;
    document.getElementById("sum-" + id).textContent = sum || "";
  }

  /* ------------------------------------------------------------------ complaints */
  function drawComplaints() {
    document.getElementById("c-tiles").innerHTML = rankedComplaints().map((c) => tile(c.n, 'data-c="' + esc(c.n) + '"', false)).join("") + '<button type="button" class="tile ghost" data-c-search>' + icon("search") + "Other…</button>";
    document.getElementById("c-items").innerHTML = S.c
      .map(
        (x, i) =>
          '<li class="item"><div class="nm">' +
          esc(x.n) +
          (x.sev ? "<small>" + x.sev + "</small>" : "") +
          (x.note ? "<small>" + esc(x.note) + "</small>" : "") +
          '</div><div class="ctl"><span class="lbl">for</span>' +
          pills(DUR.map((d) => [d, d]), x.dur, 'data-cdur="' + i + '" data-v', "Duration of " + x.n) +
          '<button type="button" class="pill" data-copen="' +
          i +
          '" aria-expanded="' +
          !!x.open +
          '">' +
          (x.open ? "Less" : "Detail") +
          '</button></div><button type="button" class="icon-btn rm" data-crm="' +
          i +
          '" aria-label="Remove ' +
          esc(x.n) +
          '">' +
          icon("x") +
          "</button>" +
          (x.open
            ? '<div class="more"><div class="ctl"><span class="lbl">Severity</span>' +
              pills(SEV.map((s) => [s, s]), x.sev, 'data-csev="' + i + '" data-v', "Severity of " + x.n) +
              '</div><input class="input" placeholder="Note, e.g. worse at night" value="' +
              esc(x.note || "") +
              '" data-cnote="' +
              i +
              '" aria-label="Note on ' +
              esc(x.n) +
              '"></div>'
            : "") +
          "</li>"
      )
      .join("");
    document.getElementById("c-notes").innerHTML = S.c.length
      ? '<button type="button" class="tile ghost" data-hpi>' + icon("note") + "Add history note</button>"
      : "";
    setCount("complaints", S.c.length, S.c.map((x) => x.n + " " + x.dur).join(" · "));
  }
  function addComplaint(n) {
    if (has(S.c, "n", n)) return;
    S.c.push({ n: n, dur: "3d", sev: null, note: "", open: false });
    drawComplaints();
    drawExam();
    drawDx();
    markSaving();
    P.announce(n + " added, 3 days");
  }

  /* ------------------------------------------------------------------ examination */
  function drawExam() {
    document.getElementById("vit").innerHTML =
      '<div class="vits"><span>Vitals · front desk 10:21 am</span><span class="flag"><span>BP</span> <b>150/95</b> <b style="font-weight:500">high</b></span><span><span>Pulse</span> <b>96</b></span><span><span>Temp</span> <b>100.8°F</b></span><span><span>SpO₂</span> <b>97%</b></span><span><span>Wt</span> <b>78 kg</b></span></div><button type="button" class="btn btn-ghost btn-sm" data-vitals>Edit</button>';
    const ranked = rankedTemplates();
    document.getElementById("t-tiles").innerHTML = ranked.map((r, i) => tile(r.t.name, 'data-t="' + r.t.id + '"', S.exam && S.exam.t === r.t.id, i === 0 && r.s > 0 ? "suggested" : "")).join("");
    const ex = document.getElementById("exam");
    if (!S.exam) {
      ex.innerHTML = "";
    } else {
      const t = EXAM_TEMPLATES.find((x) => x.id === S.exam.t);
      ex.innerHTML =
        '<div class="exam-head"><b>' +
        esc(t.name) +
        "</b> · " +
        t.systems.length +
        ' systems, all normal unless marked <button type="button" class="btn btn-ghost btn-sm" data-t-clear>Clear</button></div>' +
        t.systems
          .map((s) => {
            const st = S.exam.sys[s.k] || { abn: false, f: [], side: null, note: "" };
            const found = st.f.length ? st.f.join(", ") + (st.side ? " · " + st.side.toLowerCase() : "") : "";
            return (
              '<div class="sys' +
              (st.abn ? " abn" : "") +
              '"><div><div class="sn">' +
              esc(s.n) +
              '</div><div class="sv">' +
              (st.abn ? esc(found || "Abnormal · choose a finding") + (st.note ? " · " + esc(st.note) : "") : esc(s.normal)) +
              '</div></div><div class="seg" role="radiogroup" aria-label="' +
              esc(s.n) +
              ' finding"><button type="button" role="radio" aria-checked="' +
              !st.abn +
              '" data-sys="' +
              s.k +
              '" data-abn="0">Normal</button><button type="button" role="radio" aria-checked="' +
              !!st.abn +
              '" data-sys="' +
              s.k +
              '" data-abn="1">Abnormal</button></div>' +
              (st.abn
                ? '<div class="findings"><div class="tiles">' +
                  s.find.map((f) => tile(f, 'data-find="' + s.k + '" data-v="' + esc(f) + '"', st.f.indexOf(f) !== -1)).join("") +
                  "</div>" +
                  (s.side ? '<div class="ctl"><span class="lbl">Side</span>' + pills(SIDE.map((x) => [x, x]), st.side, 'data-side="' + s.k + '" data-v', s.n + " side") + "</div>" : "") +
                  '<input class="input" placeholder="Add a note (optional)" value="' +
                  esc(st.note || "") +
                  '" data-sysnote="' +
                  s.k +
                  '" aria-label="' +
                  esc(s.n) +
                  ' note"></div>'
                : "") +
              "</div>"
            );
          })
          .join("");
    }
    const signs = (S.exam && S.exam.signs) || {};
    document.getElementById("signs").innerHTML = SIGNS.map((s) => tile(s, 'data-sign="' + esc(s) + '"', !!signs[s], signs[s] ? "present" : "absent")).join("");
    const abn = S.exam ? Object.keys(S.exam.sys).filter((k) => S.exam.sys[k].abn).length : 0;
    const present = Object.keys(signs).filter((k) => signs[k]).length;
    setCount("exam", S.exam ? 1 : 0, S.exam ? EXAM_TEMPLATES.find((x) => x.id === S.exam.t).name + (abn ? " · " + abn + " abnormal" : " · all normal") + (present ? " · " + present + " sign" + (present > 1 ? "s" : "") : "") : "");
  }

  /* ------------------------------------------------------------------ diagnosis */
  function drawDx() {
    const r = rankedDx();
    document.getElementById("dx-sugg").innerHTML =
      (r.likely.length ? '<div class="group"><div class="eyebrow">Likely from the complaints <span class="smart">' + icon("zap") + "Smart Assist</span></div><div class=\"tiles\">" + r.likely.map((d) => tile(d.n, 'data-dx="' + esc(d.n) + '"', false, d.icd)).join("") + "</div></div>" : "") +
      '<div class="group"><div class="eyebrow">' +
      (r.likely.length ? "Your recent" : "Your recent · tap to add") +
      '</div><div class="tiles">' +
      r.recent.map((d) => tile(d.n, 'data-dx="' + esc(d.n) + '"', false, d.icd)).join("") +
      '<button type="button" class="tile ghost" data-dx-search>' +
      icon("search") +
      "Search ICD-11…</button></div></div>";
    document.getElementById("dx-items").innerHTML = S.dx
      .map(
        (d, i) =>
          '<li class="item"><div class="nm">' +
          esc(d.n) +
          "<small>ICD-11 " +
          d.icd +
          "</small>" +
          (i === 0 ? '<span class="chip chip-outline">Primary</span>' : "") +
          (d.chronic ? '<span class="chip chip-neutral">Chronic</span>' : "") +
          '</div><div class="ctl">' +
          (i > 0 ? '<button type="button" class="pill" data-dxprimary="' + i + '">Make primary</button>' : "") +
          '</div><button type="button" class="icon-btn rm" data-dxrm="' +
          i +
          '" aria-label="Remove ' +
          esc(d.n) +
          '">' +
          icon("x") +
          "</button></li>"
      )
      .join("");
    setCount("dx", S.dx.length, S.dx.map((d) => d.n).join(" · "));
  }
  function addDx(n) {
    const d = DX.find((x) => x.n === n);
    if (!d || has(S.dx, "n", n)) return;
    S.dx.push({ n: d.n, icd: d.icd, chronic: !!d.chronic });
    if (!S.fu && d.fu) S.fu = d.fu;
    drawDx();
    drawRx();
    drawPlan();
    drawSummary();
    markSaving();
    P.announce(d.n + " added");
  }

  /* ------------------------------------------------------------------ prescription */
  function addRx(d, f, t, dur, extra) {
    S.rx.push(Object.assign({ d: d, f: f, t: t, dur: dur, note: "" }, extra || {}));
    drawRx();
    drawSummary();
    markSaving();
    P.announce(d.name + " " + f + " " + durWord(dur) + " added");
  }
  function drawRx() {
    const pd = primaryDx();
    const favs = DRUGS.filter((d) => d.fav && !has(S.rx.map((r) => r.d), "name", d.name));
    const bundle = pd && pd.rx.length ? pd.rx : null;
    const bundleDone = bundle && bundle.every((b) => S.rx.some((r) => r.d === drug(b[0])));
    document.getElementById("rx-sugg").innerHTML =
      '<div class="group"><div class="eyebrow">One tap <span class="smart">' +
      icon("zap") +
      'Smart Assist</span></div><div class="tiles">' +
      (bundle
        ? '<button type="button" class="tile bundle" data-bundle aria-pressed="' + !!bundleDone + '"><b>Your usual for ' + esc(pd.n) + "</b><span>" + bundle.map((b) => drug(b[0]).generic + " " + b[1] + " · " + durWord(b[2])).join(" · ") + "</span></button>"
        : "") +
      '<button type="button" class="tile bundle" data-same-last aria-pressed="false"><b>Same as last visit · ' +
      LAST_VISIT.date +
      "</b><span>" +
      LAST_VISIT.rx.map((b) => drug(b[0]).generic + " " + b[1] + " · " + durWord(b[2])).join(" · ") +
      "</span></button></div></div>" +
      '<div class="group"><div class="eyebrow">Favourites · added with your usual dose</div><div class="tiles">' +
      favs.map((d) => tile(d.name, 'data-fav="' + esc(d.name) + '"', false, d.usual.f + " · " + durWord(d.usual.d))).join("") +
      "</div></div>";
    document.getElementById("rx-lines").innerHTML = S.rx
      .map((r, i) => {
        const match = r.d.salt === "penicillin";
        return (
          '<li class="rx-line' +
          (r.repeat ? " repeat" : "") +
          (match ? " flagged" : "") +
          '"><span class="ix">' +
          (i + 1) +
          '</span><div class="drug">' +
          esc(r.d.name) +
          "<small>" +
          esc(r.d.form) +
          "</small>" +
          (r.note ? "<small>" + esc(r.note) + "</small>" : "") +
          '</div><div class="how"><button type="button" class="pill freq" data-edit="' +
          i +
          '" aria-label="' +
          r.f +
          ", " +
          FREQ_WORDS[r.f] +
          '. Edit dose">' +
          r.f +
          '</button><button type="button" class="pill" data-edit="' +
          i +
          '">' +
          esc(r.t || "—") +
          '</button><button type="button" class="pill" data-edit="' +
          i +
          '">' +
          durWord(r.dur) +
          "</button></div>" +
          (match ? '<div class="warn-row"><span class="chip chip-match">' + icon("allergy") + "Penicillin allergy on record</span><span>Not included in the signed Rx until you confirm.</span><button type=\"button\" class=\"btn btn-sm btn-secondary\">Prescribe anyway…</button></div>" : "") +
          '<button type="button" class="icon-btn rm" data-rxrm="' +
          i +
          '" aria-label="Remove ' +
          esc(r.d.name) +
          '">' +
          icon("x") +
          "</button></li>"
        );
      })
      .join("");
    drawDose();
    setCount("rx", S.rx.length, S.rx.map((r) => r.d.generic + " " + r.f).join(" · "));
  }
  function drawDose() {
    const box = document.getElementById("dose");
    const p = S.pending;
    if (!p) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<div class="dose-head">' +
      esc(p.d.name) +
      "<small>" +
      esc(p.d.form) +
      " · " +
      esc(p.d.generic) +
      '</small><button type="button" class="icon-btn" data-dose-cancel aria-label="Cancel">' +
      icon("x") +
      "</button></div>" +
      '<div class="dose-row"><div class="lbl">Frequency <span>· keys</span>' +
      FREQ.map((f, i) => "<kbd>" + (i + 1) + "</kbd>").join("") +
      '</div><div class="tiles freq-tiles">' +
      FREQ.map((f) => tile(f, 'data-pf="' + f + '"', p.f === f)).join("") +
      '<button type="button" class="tile ghost" data-pf-custom>Other…</button></div></div>' +
      '<div class="dose-row"><div class="lbl">Timing</div><div class="tiles">' +
      TIMING.map((t) => tile(t, 'data-pt="' + esc(t) + '"', p.t === t)).join("") +
      "</div></div>" +
      '<div class="dose-row"><div class="lbl">Duration</div><div class="tiles">' +
      DUR_RX.map((d) => tile(durWord(d), 'data-pd="' + d + '"', p.dur === d)).join("") +
      '<span class="stepper" aria-label="Duration in days"><button type="button" data-pstep="-1" aria-label="One day less">−</button><output id="pdur">' +
      durWord(p.dur) +
      '</output><button type="button" data-pstep="1" aria-label="One day more">+</button></span></div></div>' +
      '<div class="dose-foot"><input class="input grow" id="pnote" placeholder="Instruction (optional), e.g. with warm water" value="' +
      esc(p.note || "") +
      '" aria-label="Instruction"><button type="button" class="btn btn-primary" data-dose-add>' +
      (p.editIx != null ? "Update line" : "Add to prescription") +
      " <kbd>↵</kbd></button></div>";
  }
  function openDose(d, editIx) {
    const line = editIx != null ? S.rx[editIx] : null;
    S.pending = line ? { d: line.d, f: line.f, t: line.t, dur: line.dur, note: line.note, editIx: editIx } : { d: d, f: d.usual.f, t: d.usual.t, dur: d.usual.d, note: "", editIx: null };
    drawDose();
    document.getElementById("dose").scrollIntoView({ block: "nearest" });
  }
  function commitDose() {
    const p = S.pending;
    if (!p) return;
    p.note = (document.getElementById("pnote") || {}).value || "";
    if (p.editIx != null) {
      Object.assign(S.rx[p.editIx], { f: p.f, t: p.t, dur: p.dur, note: p.note });
      S.pending = null;
      drawRx();
      drawSummary();
      markSaving();
    } else {
      S.pending = null;
      addRx(p.d, p.f, p.t, p.dur, { note: p.note });
    }
    const q = document.getElementById("rx-q");
    q.value = "";
    q.focus();
  }

  /* ------------------------------------------------------------------ plan */
  function drawPlan() {
    const pd = primaryDx();
    const sInv = pd ? pd.inv : [];
    const sAdv = pd ? pd.adv : [];
    const invList = sInv.concat(INV_ALL.filter((x) => sInv.indexOf(x) === -1)).slice(0, 10);
    const advList = sAdv.concat(ADV_ALL.filter((x) => sAdv.indexOf(x) === -1)).slice(0, 8);
    document.getElementById("inv-eb").innerHTML = "Investigations" + (sInv.length ? ' <span class="smart">· usual for ' + esc(pd.n) + " first</span>" : "");
    document.getElementById("adv-eb").innerHTML = "Advice" + (sAdv.length ? ' <span class="smart">· usual for ' + esc(pd.n) + " first</span>" : "");
    document.getElementById("inv-tiles").innerHTML = invList.map((x) => tile(x, 'data-inv="' + esc(x) + '"', S.inv.indexOf(x) !== -1)).join("") + '<button type="button" class="tile ghost" data-inv-search>' + icon("search") + "Other…</button>";
    document.getElementById("adv-tiles").innerHTML = advList.map((x) => tile(x, 'data-adv="' + esc(x) + '"', S.adv.indexOf(x) !== -1)).join("") + '<button type="button" class="tile ghost" data-adv-search>' + icon("plus") + "Write advice…</button>";
    document.getElementById("fu-eb").innerHTML = "Follow-up" + (pd && pd.fu ? ' <span class="smart">· your usual for ' + esc(pd.n) + "</span>" : "");
    document.getElementById("fu-tiles").innerHTML = FU.map((f) => tile(f[1], 'data-fu="' + f[0] + '"', S.fu === f[0])).join("") + '<button type="button" class="tile ghost" data-fu-date>Pick a date…</button>';
    document.getElementById("fu-hint").textContent = S.fu && S.fu !== "none" ? FU_DATE[S.fu] + " · the front desk books it when you finish" : S.fu === "none" ? "No follow-up" : "Choose an interval, or it is set when you add a diagnosis";
    const n = S.inv.length + S.adv.length + (S.fu && S.fu !== "none" ? 1 : 0);
    setCount("plan", n, [S.inv.length ? S.inv.length + " tests" : "", S.adv.length ? S.adv.length + " advice" : "", S.fu && S.fu !== "none" ? "review " + FU_DATE[S.fu].split(", ")[1] : ""].filter(Boolean).join(" · "));
    drawSummary();
  }

  /* ------------------------------------------------------------------ summary */
  function summaryHtml() {
    const ex = S.exam ? EXAM_TEMPLATES.find((x) => x.id === S.exam.t) : null;
    const abn = ex ? ex.systems.filter((s) => S.exam.sys[s.k] && S.exam.sys[s.k].abn).map((s) => s.n + ": " + (S.exam.sys[s.k].f.join(", ") || "abnormal") + (S.exam.sys[s.k].side ? " (" + S.exam.sys[s.k].side.toLowerCase() + ")" : "")) : [];
    const present = S.exam ? SIGNS.filter((s) => S.exam.signs[s]) : [];
    const e = (t) => '<span class="empty">' + t + "</span>";
    return (
      "<div><h3>Complaints</h3>" +
      (S.c.length ? S.c.map((c) => esc(c.n) + " · " + durLabel[c.dur] + (c.sev ? ", " + c.sev.toLowerCase() : "")).join("<br>") : e("None yet")) +
      "</div><div><h3>Examination</h3>" +
      (ex ? "BP 150/95 (high), pulse 96, temp 100.8°F, SpO₂ 97%<br>" + esc(ex.name) + ": " + (abn.length ? esc(abn.join("; ")) + "; rest normal" : "all systems normal") + (present.length ? "<br>" + esc(present.join(", ")) + " present" : "") : e("No template applied")) +
      "</div><div><h3>Diagnosis</h3>" +
      (S.dx.length ? S.dx.map((d) => esc(d.n) + ' <span class="f">' + d.icd + "</span>").join("<br>") : e("None yet")) +
      "</div><div><h3>Prescription</h3>" +
      (S.rx.length ? "<ol>" + S.rx.map((r) => esc(r.d.name) + ' <span class="f">' + r.f + " · " + esc(r.t) + " · " + durWord(r.dur) + "</span>").join("</li><li>").replace(/^/, "<li>") + "</li></ol>" : e("No medicines")) +
      "</div><div><h3>Plan</h3>" +
      [S.inv.length ? "Tests: " + esc(S.inv.join(", ")) : "", S.adv.length ? esc(S.adv.join(". ")) : "", S.fu && S.fu !== "none" ? "Review " + FU_DATE[S.fu] : ""].filter(Boolean).join("<br>") +
      (!S.inv.length && !S.adv.length && !S.fu ? e("Nothing yet") : "") +
      "</div>"
    );
  }
  function drawSummary() {
    const el = document.getElementById("sum-doc");
    if (el) el.innerHTML = summaryHtml();
  }

  /* ------------------------------------------------------------------ search / combo */
  function wireCombo(input, list, source, onPick) {
    let res = [];
    let active = 0;
    function draw() {
      const q = input.value.trim().toLowerCase();
      res = q ? source(q) : [];
      active = 0;
      list.hidden = !res.length;
      input.setAttribute("aria-expanded", String(!!res.length));
      list.innerHTML = res.map((x, i) => '<li role="option" id="' + list.id + "-" + i + '" aria-selected="' + (i === active) + '" data-i="' + i + '"' + (x.create ? ' class="create"' : "") + ">" + x.html + "</li>").join("");
      input.setAttribute("aria-activedescendant", res.length ? list.id + "-0" : "");
    }
    function hl() {
      list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      input.setAttribute("aria-activedescendant", list.id + "-" + active);
    }
    function pick(i) {
      const x = res[i];
      if (!x) return;
      res = [];
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
      } else if (e.key === "Enter" && res.length) {
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
    return { draw: draw };
  }
  const byStart = (q, f) => (a, b) => (f(a).toLowerCase().indexOf(q) === 0 ? 0 : 1) - (f(b).toLowerCase().indexOf(q) === 0 ? 0 : 1);
  function drugSearch(q) {
    const r = DRUGS.filter((d) => d.name.toLowerCase().indexOf(q) !== -1 || d.generic.toLowerCase().indexOf(q) !== -1).sort(byStart(q, (d) => d.name)).map((d) => ({
      d: d,
      html: "<span>" + esc(d.name) + " <small>" + d.form + "</small></span>" + (d.salt === "penicillin" ? '<span class="chip chip-match">' + icon("allergy") + "Allergy</span>" : "<small>usual " + d.usual.f + " · " + durWord(d.usual.d) + "</small>"),
    }));
    if (q.length > 2) r.push({ create: true, custom: q, html: "Add “" + esc(q) + "” as a custom medicine" });
    return r;
  }
  /* A small inline search sheet for the "Other…" tiles (complaints, diagnoses, tests, advice). */
  function searchSheet(title, items, onPick, allowCreate) {
    const sheet = P.openSheet({
      title: title,
      body: '<div class="inline-search"><label class="sr-only" for="ss-q">Search</label><input class="input" id="ss-q" role="combobox" aria-expanded="false" aria-controls="ss-list" aria-autocomplete="list" autocomplete="off" placeholder="Type to search"><ul class="listbox" id="ss-list" role="listbox" aria-label="Results" hidden></ul></div>',
      focus: "#ss-q",
    });
    wireCombo(sheet.querySelector("#ss-q"), sheet.querySelector("#ss-list"), function (q) {
      const r = items.filter((x) => x.toLowerCase().indexOf(q) !== -1).map((x) => ({ v: x, html: esc(x) }));
      if (allowCreate && q.length > 1 && !items.some((x) => x.toLowerCase() === q)) r.push({ create: true, v: q, html: "Add “" + esc(q) + "”" });
      return r;
    }, function (x) {
      P.closeSheet();
      onPick(x.v);
    });
  }
  /* Command bar: one box that adds to the right section. */
  function cmdk() {
    const sheet = P.openSheet({ title: "Add anything", body: '<label class="sr-only" for="ck-q">Add anything</label><input class="input" id="ck-q" role="combobox" aria-expanded="false" aria-controls="ck-list" aria-autocomplete="list" autocomplete="off" placeholder="Complaint, diagnosis, medicine, test or advice…"><ul class="listbox" id="ck-list" role="listbox" aria-label="Results"></ul>', focus: "#ck-q" });
    sheet.classList.add("cmdk");
    wireCombo(sheet.querySelector("#ck-q"), sheet.querySelector("#ck-list"), function (q) {
      const out = [];
      COMPLAINTS.filter((c) => c.n.toLowerCase().indexOf(q) !== -1).sort(byStart(q, (c) => c.n)).slice(0, 3).forEach((c) => out.push({ k: "c", v: c.n, html: esc(c.n) + '<span class="kind">Complaint</span>' }));
      DX.filter((d) => d.n.toLowerCase().indexOf(q) !== -1 || d.icd.toLowerCase().indexOf(q) !== -1).slice(0, 3).forEach((d) => out.push({ k: "dx", v: d.n, html: esc(d.n) + " <small>" + d.icd + '</small><span class="kind">Diagnosis</span>' }));
      DRUGS.filter((d) => d.name.toLowerCase().indexOf(q) !== -1 || d.generic.toLowerCase().indexOf(q) !== -1).sort(byStart(q, (d) => d.name)).slice(0, 3).forEach((d) => out.push({ k: "rx", v: d, html: esc(d.name) + " <small>" + d.usual.f + " · " + durWord(d.usual.d) + '</small><span class="kind">Medicine</span>' }));
      INV_ALL.filter((x) => x.toLowerCase().indexOf(q) !== -1).slice(0, 2).forEach((x) => out.push({ k: "inv", v: x, html: esc(x) + '<span class="kind">Test</span>' }));
      ADV_ALL.filter((x) => x.toLowerCase().indexOf(q) !== -1).slice(0, 2).forEach((x) => out.push({ k: "adv", v: x, html: esc(x) + '<span class="kind">Advice</span>' }));
      return out;
    }, function (x) {
      P.closeSheet();
      if (x.k === "c") addComplaint(x.v);
      else if (x.k === "dx") addDx(x.v);
      else if (x.k === "rx") addRx(x.v, x.v.usual.f, x.v.usual.t, x.v.usual.d);
      else if (x.k === "inv") toggle(S.inv, x.v, drawPlan);
      else if (x.k === "adv") toggle(S.adv, x.v, drawPlan);
    });
  }
  function toggle(arr, v, after) {
    const i = arr.indexOf(v);
    if (i === -1) arr.push(v);
    else arr.splice(i, 1);
    after();
    markSaving();
  }

  /* ------------------------------------------------------------------ finish */
  function finish() {
    const sheet = P.openSheet({
      title: "Finish visit",
      context: "Token 14 · Suresh Patil",
      body:
        '<div class="review"><div class="sum-doc">' +
        summaryHtml() +
        "</div>" +
        '<div class="field"><span class="field-label">Send the prescription</span><div class="tiles"><button type="button" class="tile" aria-pressed="true">' +
        icon("message") +
        'WhatsApp</button><button type="button" class="tile" aria-pressed="false">' +
        icon("printer") +
        'Print</button></div></div><div class="field"><span class="field-label" id="ho-l">Fee ₹500</span><div class="tiles" role="radiogroup" aria-labelledby="ho-l"><button type="button" class="tile" role="radio" aria-checked="true">Front desk collects</button><button type="button" class="tile" role="radio" aria-checked="false">Collect here</button></div></div><p class="hint">Signing locks this prescription. Changes after signing are amendments with a reason.</p></div>',
      foot: '<button type="button" class="btn btn-lg btn-secondary" data-close-review>Back to note</button><button type="button" class="btn btn-lg btn-primary" id="sign">Sign and finish</button>',
      focus: "#sign",
    });
    sheet.querySelector("[data-close-review]").addEventListener("click", P.closeSheet);
    sheet.querySelector("#sign").addEventListener("click", function () {
      sheet.querySelector(".sheet-body").innerHTML =
        '<div class="success" role="status"><p class="title-3" style="display:flex;gap:8px;align-items:center;color:var(--color-success-fg)">' +
        icon("done") +
        'Visit finished · Rx v1 signed</p><p class="body-sm muted">Token 14 moved to To bill. WhatsApp prescription queued' +
        (S.fu && S.fu !== "none" ? "; follow-up " + FU_DATE[S.fu] + " sent to the front desk" : "") +
        ".</p></div>";
      sheet.querySelector(".sheet-foot").innerHTML = '<a class="btn btn-lg btn-primary" id="next" href="../003-today/index.html?mode=doctor">Call next · token 16</a>';
      sheet.querySelector("#next").focus();
      P.announce("Visit finished and signed");
    });
  }

  /* ------------------------------------------------------------------ wire */
  render();
  const rxQ = document.getElementById("rx-q");
  wireCombo(rxQ, document.getElementById("rx-list"), drugSearch, function (x) {
    const d = x.create ? { name: x.custom.replace(/\b\w/g, (c) => c.toUpperCase()), form: "Tablet", generic: "Custom", usual: { f: "1-0-1", t: "After food", d: 5 } } : x.d;
    rxQ.value = d.name;
    openDose(d, null);
  });
  rxQ.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.defaultPrevented && S.pending && document.getElementById("rx-list").hidden) {
      e.preventDefault();
      commitDose();
    }
  });

  const app = document.getElementById("app");
  app.addEventListener("click", function (e) {
    const t = e.target;
    const g = (a) => t.closest("[" + a + "]");
    let el;
    if ((el = g("data-c"))) return addComplaint(el.dataset.c);
    if (g("data-c-search")) return searchSheet("Add a complaint", COMPLAINTS.map((c) => c.n), addComplaint, true);
    if ((el = g("data-cdur"))) {
      S.c[el.dataset.cdur].dur = el.dataset.v;
      drawComplaints();
      drawSummary();
      return markSaving();
    }
    if ((el = g("data-csev"))) {
      S.c[el.dataset.csev].sev = el.dataset.v;
      drawComplaints();
      drawSummary();
      return markSaving();
    }
    if ((el = g("data-copen"))) {
      S.c[el.dataset.copen].open = !S.c[el.dataset.copen].open;
      return drawComplaints();
    }
    if ((el = g("data-crm"))) {
      const x = S.c.splice(Number(el.dataset.crm), 1)[0];
      drawComplaints();
      drawExam();
      drawDx();
      drawSummary();
      return P.toast(x.n + " removed", { undo: () => addComplaint(x.n) });
    }
    if (g("data-hpi")) {
      document.getElementById("c-notes").innerHTML = '<div class="field"><label for="hpi">History note</label><textarea class="input" id="hpi" rows="3" placeholder="Onset, progression, what helps"></textarea></div>';
      return document.getElementById("hpi").focus();
    }
    if ((el = g("data-t"))) {
      S.exam = { t: el.dataset.t, sys: {}, signs: (S.exam && S.exam.signs) || {} };
      drawExam();
      drawSummary();
      markSaving();
      return P.announce(EXAM_TEMPLATES.find((x) => x.id === el.dataset.t).name + " applied, all systems normal");
    }
    if (g("data-t-clear")) {
      S.exam = null;
      drawExam();
      return drawSummary();
    }
    if ((el = g("data-sys"))) {
      if (!S.exam.sys[el.dataset.sys]) S.exam.sys[el.dataset.sys] = { abn: false, f: [], side: null, note: "" };
      S.exam.sys[el.dataset.sys].abn = el.dataset.abn === "1";
      drawExam();
      drawSummary();
      markSaving();
      if (el.dataset.abn === "1") {
        const first = document.querySelector('[data-find="' + el.dataset.sys + '"]');
        if (first) first.focus();
      }
      return undefined;
    }
    if ((el = g("data-find"))) {
      const st = S.exam.sys[el.dataset.find];
      const i = st.f.indexOf(el.dataset.v);
      if (i === -1) st.f.push(el.dataset.v);
      else st.f.splice(i, 1);
      drawExam();
      drawSummary();
      return markSaving();
    }
    if ((el = g("data-side"))) {
      S.exam.sys[el.dataset.side].side = el.dataset.v;
      drawExam();
      drawSummary();
      return markSaving();
    }
    if ((el = g("data-sign"))) {
      if (!S.exam) S.exam = { t: null, sys: {}, signs: {} };
      S.exam.signs[el.dataset.sign] = !S.exam.signs[el.dataset.sign];
      if (!S.exam.t) {
        document.getElementById("signs").innerHTML = SIGNS.map((s) => tile(s, 'data-sign="' + esc(s) + '"', !!S.exam.signs[s], S.exam.signs[s] ? "present" : "absent")).join("");
      } else drawExam();
      drawSummary();
      return markSaving();
    }
    if ((el = g("data-dx"))) return addDx(el.dataset.dx);
    if (g("data-dx-search")) return searchSheet("Search diagnosis (ICD-11)", DX.map((d) => d.n + " · " + d.icd), (v) => addDx(v.split(" · ")[0]), false);
    if ((el = g("data-dxrm"))) {
      S.dx.splice(Number(el.dataset.dxrm), 1);
      drawDx();
      drawRx();
      return drawPlan();
    }
    if ((el = g("data-dxprimary"))) {
      const d = S.dx.splice(Number(el.dataset.dxprimary), 1)[0];
      S.dx.unshift(d);
      drawDx();
      drawRx();
      return drawPlan();
    }
    if (g("data-bundle")) {
      const pd = primaryDx();
      pd.rx.forEach((b) => {
        const d = drug(b[0]);
        if (!S.rx.some((r) => r.d === d)) addRx(d, b[1], d.usual.t, b[2]);
      });
      return P.announce(pd.rx.length + " medicines added");
    }
    if (g("data-same-last")) {
      LAST_VISIT.rx.forEach((b) => {
        const d = drug(b[0]);
        if (!S.rx.some((r) => r.d === d)) addRx(d, b[1], d.usual.t, b[2], { repeat: true });
      });
      if (!has(S.dx, "n", LAST_VISIT.dx)) addDx(LAST_VISIT.dx);
      if (P.sheetOpen()) P.closeSheet();
      return document.getElementById("s-rx").scrollIntoView({ block: "start" });
    }
    if ((el = g("data-fav"))) {
      const d = DRUGS.find((x) => x.name === el.dataset.fav);
      return addRx(d, d.usual.f, d.usual.t, d.usual.d);
    }
    if ((el = g("data-edit"))) return openDose(null, Number(el.dataset.edit));
    if ((el = g("data-rxrm"))) {
      const x = S.rx.splice(Number(el.dataset.rxrm), 1)[0];
      drawRx();
      drawSummary();
      return P.toast(x.d.name + " removed", { undo: () => addRx(x.d, x.f, x.t, x.dur, { note: x.note, repeat: x.repeat }) });
    }
    if ((el = g("data-pf"))) {
      S.pending.f = el.dataset.pf;
      return drawDose();
    }
    if (g("data-pf-custom")) {
      const v = window.prompt("Frequency, e.g. 1-0-1-1", S.pending.f);
      if (v) S.pending.f = v.trim();
      return drawDose();
    }
    if ((el = g("data-pt"))) {
      S.pending.t = el.dataset.pt;
      return drawDose();
    }
    if ((el = g("data-pd"))) {
      S.pending.dur = Number(el.dataset.pd);
      return drawDose();
    }
    if ((el = g("data-pstep"))) {
      S.pending.dur = Math.max(1, S.pending.dur + Number(el.dataset.pstep));
      document.getElementById("pdur").textContent = durWord(S.pending.dur);
      document.querySelectorAll("[data-pd]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.pd) === S.pending.dur)));
      return undefined;
    }
    if (g("data-dose-add")) return commitDose();
    if (g("data-dose-cancel")) {
      S.pending = null;
      rxQ.value = "";
      drawDose();
      return rxQ.focus();
    }
    if ((el = g("data-inv"))) return toggle(S.inv, el.dataset.inv, drawPlan);
    if (g("data-inv-search")) return searchSheet("Add a test", INV_ALL, (v) => toggle(S.inv, v, drawPlan), true);
    if ((el = g("data-adv"))) return toggle(S.adv, el.dataset.adv, drawPlan);
    if (g("data-adv-search")) return searchSheet("Add advice", ADV_ALL, (v) => toggle(S.adv, v, drawPlan), true);
    if ((el = g("data-fu"))) {
      S.fu = el.dataset.fu;
      drawPlan();
      return markSaving();
    }
    if (g("data-finish")) return finish();
    if (g("data-vitals")) return P.toast("Vitals editing is not part of this prototype");
    if (g("data-sum")) {
      S.sum = !S.sum;
      document.getElementById("cx-body").classList.toggle("sum-open", S.sum);
      t.closest("[data-sum]").setAttribute("aria-pressed", String(S.sum));
      return drawSummary();
    }
    if (g("data-assist-m")) {
      return P.openSheet({
        title: "AI Assist",
        context: '<span class="chip chip-preview">Preview</span> AI features are in preview and not yet offered as a paid product.',
        body:
          '<div class="assist assist-body"><button type="button" class="btn btn-secondary btn-block">' +
          icon("note") +
          'Draft the history note from the conversation</button><div class="ai-draft"><div style="display:flex;align-items:center;gap:6px"><span class="chip chip-ai">' +
          icon("sparkles") +
          'AI draft</span><span class="caption subtle">Needs your review</span></div><p><b>History:</b> fever for 3 days with body ache; dry cough since yesterday; no breathlessness; taking paracetamol at home.</p><div style="display:flex;gap:8px"><button type="button" class="btn btn-secondary">Accept into note</button><button type="button" class="btn btn-ghost">Discard</button></div></div><p class="caption subtle">The draft never saves itself. Only accepted text enters the note, marked as reviewed by you.</p></div>',
      });
    }
    if (g("data-ctx")) return P.openSheet({ title: "Patient", context: "Suresh Patil · token 14", body: '<div class="ctx-sheet">' + ctxHtml() + "</div>" });
    if ((el = g("data-jump"))) {
      jump(el.dataset.jump);
      return undefined;
    }
    const chip = t.closest(".tile[aria-pressed]:not([data-c]):not([data-dx]):not([data-fav]):not([data-bundle]):not([data-same-last])");
    if (chip && !chip.dataset.t && !chip.dataset.find && !chip.dataset.sign && !chip.dataset.inv && !chip.dataset.adv && !chip.dataset.fu && !chip.dataset.pf && !chip.dataset.pt && !chip.dataset.pd) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
    }
    const radio = t.closest('.tile[role="radio"]');
    if (radio) radio.parentElement.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute("aria-checked", String(r === radio)));
    return undefined;
  });
  app.addEventListener("input", function (e) {
    const t = e.target;
    if (t.dataset.cnote != null) {
      S.c[t.dataset.cnote].note = t.value;
      drawSummary();
    } else if (t.dataset.sysnote != null) {
      S.exam.sys[t.dataset.sysnote].note = t.value;
      drawSummary();
    }
    markSaving();
  });
  app.addEventListener("keydown", function (e) {
    if (e.target.id === "pnote" && e.key === "Enter") {
      e.preventDefault();
      commitDose();
    }
  });
  function jump(id, noFocus) {
    S.cur = id;
    document.querySelectorAll("[data-jump]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.jump === id)));
    const sec = document.getElementById("s-" + id);
    sec.scrollIntoView({ block: "start" });
    if (noFocus) return;
    const f = id === "rx" ? document.getElementById("rx-q") : sec.querySelector(".tile, input");
    if (f) f.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", function (e) {
    if (e.altKey && /^Digit[1-5]$/.test(e.code)) {
      e.preventDefault();
      return jump(["complaints", "exam", "dx", "rx", "plan"][Number(e.code.slice(5)) - 1]);
    }
    if (S.pending && !P.inField() && /^[1-5]$/.test(e.key)) {
      S.pending.f = FREQ[Number(e.key) - 1];
      return drawDose();
    }
    if (S.pending && document.activeElement === rxQ && /^[1-5]$/.test(e.key) && document.getElementById("rx-list").hidden) {
      e.preventDefault();
      S.pending.f = FREQ[Number(e.key) - 1];
      return drawDose();
    }
    if (!P.inField() && !P.sheetOpen()) {
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        return cmdk();
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        jump("rx");
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        finish();
      }
    }
    return undefined;
  });
  /* section strip follows the scroll */
  const io = new IntersectionObserver(
    function (entries) {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          S.cur = en.target.dataset.sec;
          document.querySelectorAll("[data-jump]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.jump === S.cur)));
        }
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  document.querySelectorAll(".sec").forEach((s) => io.observe(s));

  /* demo states for screenshots: ?demo=mid (complaints + exam + dx) · ?demo=rx (full note) */
  const demo = P.param("demo");
  if (demo === "mid" || demo === "rx") {
    ["Fever", "Body ache", "Cough"].forEach(addComplaint);
    S.exam = { t: "fever", sys: { rs: { abn: true, f: ["Crepts"], side: "Right", note: "" } }, signs: {} };
    drawExam();
    addDx("Viral fever");
  }
  if (demo === "rx") {
    primaryDx().rx.forEach((b) => addRx(drug(b[0]), b[1], drug(b[0]).usual.t, b[2]));
    toggle(S.inv, "CBC", drawPlan);
    toggle(S.adv, "Plenty of oral fluids", drawPlan);
    toggle(S.adv, "Rest 2–3 days", drawPlan);
  }
  if (P.param("tab")) document.fonts.ready.then(() => jump(P.param("tab"), true));
})();
