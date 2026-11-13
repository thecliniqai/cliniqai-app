/* Today prototype (DX-02). Synthetic data, frozen clock 10:42 am, Fri 13 Nov 2026. No network, no storage. */
(function () {
  "use strict";
  const P = window.Proto;
  const icon = P.icon;
  const esc = P.esc;

  const DOCTORS = { rao: "Dr A Rao", iyer: "Dr M Iyer" };
  const DOC_SHORT = { rao: "Dr\u00a0Rao", iyer: "Dr\u00a0Iyer" };
  const LANES = [
    { id: "booked", label: "Booked", short: "Booked", icon: "booked", note: "not arrived" },
    { id: "waiting", label: "Waiting", short: "Waiting", icon: "waiting" },
    { id: "with-doctor", label: "With doctor", short: "Doctor", icon: "doctor" },
    { id: "to-bill", label: "To bill", short: "Bill", icon: "rupee" },
    { id: "done", label: "Done", short: "Done", icon: "done" },
  ];
  const STATUS_CHIP = {
    booked: ["chip-booked", "booked", "Booked"],
    waiting: ["chip-waiting", "waiting", "Waiting"],
    "with-doctor": ["chip-with-doctor", "doctor", "With doctor"],
    "to-bill": ["chip-to-bill", "rupee", "To bill"],
    done: ["chip-done", "done", "Done"],
    "no-show": ["chip-no-show", "noshow", "No-show"],
    cancelled: ["chip-cancelled", "cancelled", "Cancelled"],
  };
  const NOW = 10 * 60 + 42;

  let seq = 0;
  function v(o) {
    seq += 1;
    return Object.assign({ id: "v" + seq, token: null, vitals: null, allergy: null, wait: 0, due: 0 }, o);
  }
  /* Synthetic patients. Phone numbers are in the +91 90000 0xxxx test range. */
  const visits = [
    v({ status: "booked", name: "Meena Pawar", age: "38 y", sex: "F", phone: "9000000101", doctor: "rao", appt: "10:30", allergy: "none" }),
    v({ status: "booked", name: "Aditya Rane", age: "22 y", sex: "M", phone: "9000000102", doctor: "iyer", appt: "10:45", allergy: "none" }),
    v({ status: "booked", name: "Shalini Bhosale", age: "55 y", sex: "F", phone: "9000000103", doctor: "rao", appt: "11:00", allergy: "Sulfa" }),
    v({ status: "booked", name: "Imran Sayyed", age: "44 y", sex: "M", phone: "9000000104", doctor: "iyer", appt: "11:00", allergy: "none" }),
    v({ status: "booked", name: "Geeta Chavan", age: "67 y", sex: "F", phone: "9000000105", doctor: "rao", appt: "11:15", allergy: "unknown" }),
    v({ status: "booked", name: "Rahul Jadhav", age: "31 y", sex: "M", phone: "9000000106", doctor: "rao", appt: "11:30", allergy: "none" }),
    v({ status: "booked", name: "Neha Shinde", age: "26 y", sex: "F", phone: "9000000107", doctor: "iyer", appt: "11:45", allergy: "none" }),
    v({ status: "booked", name: "Omkar Salunkhe", age: "19 y", sex: "M", phone: "9000000108", doctor: "rao", appt: "12:00", allergy: "none" }),
    v({ status: "booked", name: "Fatima Ansari", age: "33 y", sex: "F", phone: "9000000109", doctor: "iyer", appt: "12:30", allergy: "none" }),
    v({ status: "waiting", token: 14, name: "Suresh Patil", age: "54 y", sex: "M", phone: "9000000114", doctor: "rao", origin: "Walk-in", wait: 38, vitals: "BP 150/95 · P 88", allergy: "Penicillin" }),
    v({ status: "waiting", token: 15, name: "Farah Shaikh", age: "29 y", sex: "F", phone: "9000000115", doctor: "iyer", origin: "Appt 10:15", wait: 27, allergy: "none" }),
    v({ status: "waiting", token: 16, name: "Vikram Joshi", age: "61 y", sex: "M", phone: "9000000116", doctor: "rao", origin: "Walk-in", wait: 21, vitals: "BP 138/88 · P 82", allergy: "none" }),
    v({ status: "waiting", token: 17, name: "Baby of Kavita More", age: "8 m", sex: "F", phone: "9000000117", doctor: "iyer", origin: "Appt 10:30", wait: 15, allergy: "unknown" }),
    v({ status: "waiting", token: 18, name: "Anand Kulkarni", age: "47 y", sex: "M", phone: "9000000118", doctor: "rao", origin: "Walk-in", wait: 9, vitals: "BP 124/80 · 98.4°F", allergy: "none" }),
    v({ status: "waiting", token: 19, name: "Lakshmi Venkataraman Narayanan", age: "72 y", sex: "F", phone: "9000000119", doctor: "rao", origin: "Appt 10:40", wait: 4, allergy: "Aspirin" }),
    v({ status: "with-doctor", token: 12, name: "Rohit Deshmukh", age: "35 y", sex: "M", phone: "9000000112", doctor: "rao", origin: "Walk-in", wait: 7, vitals: "BP 128/84", allergy: "none" }),
    v({ status: "with-doctor", token: 13, name: "Sana Qureshi", age: "6 y", sex: "F", phone: "9000000113", doctor: "iyer", origin: "Appt 10:00", wait: 2, vitals: "18.5 kg · 99.1°F", allergy: "none" }),
    v({ status: "to-bill", token: 9, name: "Arjun Mehta", age: "35 y", sex: "M", phone: "9000000121", doctor: "rao", origin: "Walk-in", due: 70000, allergy: "none", lines: [["Consultation fee", 50000], ["ECG", 20000]] }),
    v({ status: "to-bill", token: 10, name: "Priya Kale", age: "41 y", sex: "F", phone: "9000000110", doctor: "iyer", origin: "Appt 9:45", due: 50000, allergy: "none", lines: [["Consultation fee", 50000]] }),
    v({ status: "to-bill", token: 11, name: "Nikhil Gaikwad", age: "28 y", sex: "M", phone: "9000000111", doctor: "rao", origin: "Walk-in", due: 125000, allergy: "none", lines: [["Consultation fee", 50000], ["Dressing", 15000], ["Injection", 10000], ["Nebulisation", 50000]] }),
  ];
  const doneNames = [
    ["Sunil Kamble", "rao"], ["Pallavi Dixit", "iyer"], ["Harish Nair", "rao"], ["Asha Gokhale", "rao"],
    ["Yusuf Khan", "iyer"], ["Ritu Sharma", "rao"], ["Manoj Pillai", "rao"], ["Kiran Thakur", "iyer"],
  ];
  doneNames.forEach(function (d, i) {
    visits.push(v({ status: "done", token: i + 1, name: d[0], age: 30 + i * 3 + " y", sex: i % 2 ? "F" : "M", phone: "90000002" + String(i).padStart(2, "0"), doctor: d[1], origin: i % 3 ? "Walk-in" : "Appt", paid: [50000, 70000, 50000, 30000][i % 4] }));
  });
  visits.push(v({ status: "no-show", name: "Deepa Kadam", age: "36 y", sex: "F", phone: "9000000210", doctor: "rao", appt: "9:30" }));

  /* Patients on file but not in today's list (walk-in / booking search). */
  const directory = [
    { name: "Deepak Wagh", age: "52 y", sex: "M", phone: "9000000031", last: "Last visit 2 Oct · Dr A Rao", doctor: "rao" },
    { name: "Sunita Lokhande", age: "45 y", sex: "F", phone: "9000000032", last: "Last visit 18 Sep · Dr M Iyer", doctor: "iyer" },
    { name: "Ganesh Lokhande", age: "49 y", sex: "M", phone: "9000000032", last: "Same mobile · last visit 3 Aug", doctor: "rao" },
    { name: "Sachin Wagh", age: "27 y", sex: "M", phone: "9000000033", last: "Last visit 11 Jun · Dr A Rao", doctor: "rao" },
  ];

  const state = {
    q: "",
    doctor: "all",
    lane: P.param("lane") || "waiting",
    listLane: "all",
    third: "with-doctor",
    selected: null,
    doneOpen: false,
    mode: P.param("mode") === "doctor" ? "doctor" : "desk",
    nextToken: 20,
    receiptNo: 123,
  };
  const layout = P.param("layout") === "lanes" ? "lanes" : "twopane";

  function fmtTime(hhmm) {
    const parts = hhmm.split(":").map(Number);
    const h = parts[0];
    const m = parts[1];
    const ap = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + ap;
  }
  function minutes(hhmm) {
    const p = hhmm.split(":").map(Number);
    return p[0] * 60 + p[1];
  }
  function phoneDisplay(d) {
    return "+91 " + d.slice(0, 5) + " " + d.slice(5);
  }
  function laneOf(vis) {
    if (vis.status === "no-show" || vis.status === "cancelled") return "done";
    return vis.status;
  }
  function byDoctor(vis) {
    return state.doctor === "all" || vis.doctor === state.doctor;
  }
  function matches(vis, q) {
    if (!q) return true;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const digits = t.replace(/\D/g, "");
    if (/^\d{1,3}$/.test(t)) return vis.token === Number(t);
    if (digits.length >= 4 && digits.length === t.replace(/\s/g, "").length) return vis.phone.indexOf(digits) !== -1;
    const name = vis.name.toLowerCase();
    return t.split(/\s+/).every(function (part) {
      return name.indexOf(part) !== -1;
    });
  }
  function visible(laneId) {
    return visits.filter(function (x) {
      return laneOf(x) === laneId && byDoctor(x) && matches(x, state.q);
    });
  }
  function counts() {
    const c = {};
    LANES.forEach(function (l) {
      c[l.id] = visits.filter(function (x) {
        return laneOf(x) === l.id && byDoctor(x);
      }).length;
    });
    return c;
  }

  /* ------------------------------------------------------------ rendering */
  function tokenHtml(x, size) {
    if (x.status === "booked" || x.status === "no-show") {
      const t = fmtTime(x.appt).split(" ");
      return '<span class="token s-booked ' + (size || "") + '"><span class="sr-only">Appointment </span><b>' + t[0] + "</b><small>" + t[1] + "</small></span>";
    }
    return '<span class="token s-' + x.status + " " + (size || "") + '"><span class="sr-only">Token </span>' + x.token + "</span>";
  }
  function waitHtml(x) {
    if (x.status === "waiting") {
      const cls = x.wait > 60 ? "critical" : x.wait >= 30 ? "long" : "";
      return '<span class="wait ' + cls + '" title="Waiting">' + (cls ? "" : "") + P.formatWait(x.wait) + "</span>";
    }
    if (x.status === "with-doctor") return '<span class="wait" title="In consultation">' + P.formatWait(x.wait) + "</span>";
    if (x.status === "booked" && minutes(x.appt) < NOW) {
      return '<span class="wait long">Late ' + (NOW - minutes(x.appt)) + " min</span>";
    }
    return "";
  }
  function allergyHtml(x, solid) {
    if (!x.allergy || x.allergy === "none") return "";
    if (x.allergy === "unknown")
      return '<span class="chip chip-outline-warning">' + icon("warn") + "Allergies not recorded</span>";
    if (solid) return '<div class="allergy d-allergy">' + icon("allergy") + "Allergies: " + esc(x.allergy) + "</div>";
    return '<span class="chip chip-allergy">' + icon("allergy") + esc(x.allergy) + "</span>";
  }
  function vitalsHtml(x) {
    if (x.status !== "waiting" && x.status !== "with-doctor") return "";
    if (!x.vitals) return '<span class="chip chip-outline-warning">' + icon("vitals") + "Vitals pending</span>";
    return '<span class="vit">' + icon("vitals") + esc(x.vitals) + "</span>";
  }
  function metaHtml(x) {
    const parts = [x.age.replace(" ", "\u00a0") + "\u00a0·\u00a0" + x.sex, DOC_SHORT[x.doctor]];
    if (x.status !== "booked" && x.origin) parts.push(x.origin.replace(" ", "\u00a0"));
    return parts.map(esc).join(' <span class="sep" aria-hidden="true">·</span> ');
  }
  function primaryAction(x) {
    if (state.mode === "doctor") {
      if (x.status === "waiting") return { label: "Call in", act: "call", cls: "btn-primary" };
      if (x.status === "with-doctor") return { label: "Open consult", act: "consult", cls: "btn-primary" };
      return null;
    }
    switch (x.status) {
      case "booked":
        return { label: "Check in", act: "checkin", cls: "btn-primary" };
      case "waiting":
        return { label: "Vitals", act: "vitals", cls: "btn-secondary" };
      case "to-bill":
        return { label: "Collect " + P.formatINR(x.due), act: "collect", cls: "btn-primary" };
      case "done":
        return x.paid ? { label: "Receipt", act: "receipt", cls: "btn-ghost" } : null;
      default:
        return null;
    }
  }
  function rowHtml(x, opts) {
    const o = opts || {};
    const pa = primaryAction(x);
    const compact = laneOf(x) === "done" && !o.full;
    const chip = x.status === "no-show" ? '<span class="chip chip-no-show">' + icon("noshow") + "No-show</span>" : "";
    const showChip = o.showStatus ? statusChip(x) : "";
    return (
      '<li class="row' +
      (compact ? " compact" : "") +
      (o.next ? " next" : "") +
      '" data-id="' +
      x.id +
      '"' +
      (state.selected === x.id && layout === "twopane" ? ' aria-current="true"' : "") +
      '><div class="tcol">' +
      tokenHtml(x) +
      waitHtml(x) +
      '</div><div class="who"><h3 style="margin:0;font:inherit"><button type="button" class="name" data-open="' +
      x.id +
      '">' +
      esc(x.name) +
      '</button></h3><div class="meta">' +
      metaHtml(x) +
      (x.status === "to-bill" ? '<span class="sep" aria-hidden="true">·</span><span class="due">' + P.formatINR(x.due) + " due</span>" : "") +
      "</div>" +
      (compact ? (chip ? '<div class="flags">' + chip + "</div>" : "") : '<div class="flags">' + showChip + vitalsHtml(x) + allergyHtml(x) + chip + "</div>") +
      "</div>" +
      (!compact && (pa || state.mode === "desk")
        ? '<div class="ract">' +
          (pa ? '<button type="button" class="btn ' + pa.cls + '" data-act="' + pa.act + '" data-id="' + x.id + '">' + esc(pa.label) + "</button>" : "") +
          (state.mode === "desk"
            ? '<button type="button" class="icon-btn" data-more="' + x.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ' + esc(x.name) + '">' + icon("more") + "</button>"
            : "") +
          "</div>"
        : "") +
      "</li>"
    );
  }
  function statusChip(x) {
    const s = STATUS_CHIP[x.status];
    return '<span class="chip ' + s[0] + '">' + icon(s[1]) + s[2] + "</span>";
  }

  function laneSwitch(c, current, withAll) {
    const items = (withAll ? [{ id: "all", short: "All", label: "All" }] : []).concat(LANES);
    return (
      '<div class="seg lane-switch" role="radiogroup" aria-label="Show lane">' +
      items
        .map(function (l) {
          const n = l.id === "all" ? c.booked + c.waiting + c["with-doctor"] + c["to-bill"] : c[l.id];
          return (
            '<button type="button" role="radio" aria-checked="' +
            (current === l.id) +
            '" data-lane-pick="' +
            l.id +
            '" aria-label="' +
            l.label +
            ", " +
            n +
            '">' +
            l.short +
            ' <span class="n" aria-hidden="true">' +
            n +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function render() {
    if (state.mode === "doctor") return renderDoctor();
    const c = counts();
    const isPhone = window.matchMedia("(max-width: 767px)").matches;
    const isMid = window.matchMedia("(min-width: 768px) and (max-width: 1279px)").matches;
    const filtering = state.q.trim().length > 0;
    const shownLane = state.lane;
    let lanesHtml = "";
    LANES.forEach(function (l) {
      const list = visible(l.id);
      let shown = isPhone ? l.id === shownLane : true;
      if (layout === "lanes" && isMid) shown = true;
      if (filtering && !list.length) shown = false;
      const third = layout === "lanes" && isMid && ["with-doctor", "to-bill", "done"].indexOf(l.id) !== -1;
      lanesHtml +=
        '<section class="lane' +
        (shown || filtering ? " is-shown" : "") +
        (filtering && !list.length ? " filtered-empty" : "") +
        (third && l.id !== state.third ? " third-hidden" : "") +
        '" data-lane="' +
        l.id +
        '" aria-labelledby="lane-' +
        l.id +
        '"' +
        (filtering && !list.length ? " hidden" : "") +
        ">" +
        (third ? '<div class="third-switch">' + thirdSwitch(c) + "</div>" : "") +
        '<div class="lane-head"><h2 id="lane-' +
        l.id +
        '">' +
        icon(l.icon) +
        l.label +
        ' <span class="lc">' +
        c[l.id] +
        "</span></h2>" +
        (l.note ? '<span class="lane-note">' + l.note + "</span>" : "") +
        (l.id === "done"
          ? '<button type="button" class="icon-btn done-toggle" data-done-toggle aria-expanded="' +
            state.doneOpen +
            '" aria-label="' +
            (state.doneOpen ? "Collapse" : "Expand") +
            ' Done lane">' +
            icon(state.doneOpen ? "right" : "left") +
            "</button>"
          : "") +
        "</div>" +
        (list.length
          ? '<ul class="rows">' +
            list
              .map(function (x) {
                return rowHtml(x, { showStatus: filtering });
              })
              .join("") +
            "</ul>"
          : '<p class="empty-lane">' + emptyCopy(l.id) + "</p>") +
        "</section>";
    });
    const activeMatches = filtering
      ? visits.filter(function (x) {
          return byDoctor(x) && matches(x, state.q) && ["booked", "waiting", "with-doctor", "to-bill"].indexOf(x.status) !== -1;
        })
      : [];
    const noMatch = filtering && !activeMatches.length
      ? '<div class="no-match" role="status"><span>No one in today\'s list matches “' +
        esc(state.q) +
        '”.</span><button type="button" class="btn btn-secondary" data-act="walkin-from-q">' +
        icon("search") +
        "Search all patients</button></div>"
      : filtering
        ? '<p class="body-sm muted" role="status">' +
          activeMatches.length +
          (activeMatches.length === 1 ? " match · press Enter to " + enterVerb(activeMatches[0]) : " matches") +
          "</p>"
        : "";

    const board = document.getElementById("board");
    board.className = "board" + (filtering ? " filtering" : "");
    board.innerHTML =
      '<div class="list-pane' +
      (state.doneOpen ? " done-open" : "") +
      '">' +
      "" +
      lanesHtml +
      "</div>" +
      '<aside class="detail-pane" aria-label="Selected patient">' +
      (isMid && layout === "twopane" ? detailHtml(selectedVisit()) : "") +
      "</aside>";
    document.getElementById("phone-switch").innerHTML = isPhone && !filtering ? laneSwitch(c, state.lane, false) : "";
    document.getElementById("match-line").innerHTML = noMatch;
    document.querySelectorAll("[data-doc-count]").forEach(function (b) {
      const d = b.getAttribute("data-doc-count");
      const n = visits.filter(function (x) {
        return (d === "all" || x.doctor === d) && x.status !== "no-show";
      }).length;
      b.querySelector(".n").textContent = n;
    });
  }
  function thirdSwitch(c) {
    return (
      '<div class="seg" role="radiogroup" aria-label="Third lane">' +
      ["with-doctor", "to-bill", "done"]
        .map(function (id) {
          const l = LANES.find(function (x) {
            return x.id === id;
          });
          return (
            '<button type="button" role="radio" aria-checked="' +
            (state.third === id) +
            '" data-third="' +
            id +
            '">' +
            l.short +
            ' <span class="n">' +
            c[id] +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function emptyCopy(id) {
    return {
      booked: "No more appointments today",
      waiting: "Nobody waiting",
      "with-doctor": "No one with a doctor",
      "to-bill": "Nothing to collect",
      done: "No finished visits yet",
    }[id];
  }
  function enterVerb(x) {
    return { booked: "check in", waiting: "record vitals", "with-doctor": "open", "to-bill": "collect" }[x.status] || "open";
  }
  function selectedVisit() {
    let s = visits.find(function (x) {
      return x.id === state.selected;
    });
    if (!s) {
      s = visits.find(function (x) {
        return x.status === "waiting";
      });
      state.selected = s && s.id;
    }
    return s;
  }
  function detailHtml(x) {
    if (!x) return "";
    const pa = primaryAction(x);
    const timeline = [];
    if (x.appt) timeline.push(["Booked", "by phone · " + fmtTime(x.appt) + " slot"]);
    if (x.status !== "booked") timeline.push([x.origin === "Walk-in" ? "Walk-in" : "Arrived", "token " + (x.token || "—") + " issued"]);
    if (x.vitals) timeline.push(["Vitals", x.vitals]);
    if (x.status === "with-doctor" || x.status === "to-bill" || x.status === "done") timeline.push(["Consult", DOCTORS[x.doctor]]);
    const times = ["9:58 am", "10:21 am", "10:30 am", "10:35 am"];
    return (
      '<article class="detail"><div class="d-head">' +
      tokenHtml(x, "token-lg") +
      '<div><h2 class="title-2">' +
      esc(x.name) +
      '</h2><p class="body-sm muted tnum">' +
      esc(x.age + " · " + x.sex) +
      ' · ID CQ-' +
      String(40 + Number(x.id.slice(1))).padStart(4, "0") +
      " · " +
      phoneDisplay(x.phone) +
      '</p><div class="d-status">' +
      statusChip(x) +
      waitHtml(x).replace('class="wait', 'class="wait body-sm') +
      '<span class="body-sm muted">' +
      esc(DOCTORS[x.doctor]) +
      "</span></div></div></div>" +
      allergyHtml(x, true) +
      '<div class="d-actions">' +
      (pa ? '<button type="button" class="btn btn-lg ' + pa.cls + '" data-act="' + pa.act + '" data-id="' + x.id + '">' + esc(pa.label) + "</button>" : "") +
      (x.status === "booked" ? '<button type="button" class="btn btn-lg btn-secondary" data-act="reschedule" data-id="' + x.id + '">Reschedule</button>' : "") +
      (x.status === "waiting" ? '<button type="button" class="btn btn-lg btn-secondary" data-act="move" data-id="' + x.id + '">Move doctor</button>' : "") +
      '<button type="button" class="icon-btn bordered" data-more="' +
      x.id +
      '" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ' +
      esc(x.name) +
      '">' +
      icon("more") +
      "</button></div>" +
      (x.status === "to-bill"
        ? '<section><h3>Bill</h3><div class="bill-lines">' +
          x.lines
            .map(function (l) {
              return "<div><span>" + esc(l[0]) + "</span><span>" + P.formatINR(l[1]) + "</span></div>";
            })
            .join("") +
          '<div class="total"><span>Total</span><span>' +
          P.formatINR(x.due) +
          "</span></div></div></section>"
        : "") +
      (x.status === "waiting" || x.status === "with-doctor"
        ? '<section><h3>Vitals</h3><p class="body-sm">' + (x.vitals ? esc(x.vitals) : '<span class="chip chip-outline-warning">' + icon("vitals") + "Vitals pending</span>") + "</p></section>"
        : "") +
      '<section><h3>Today</h3><ol class="timeline">' +
      timeline
        .map(function (t, i) {
          return "<li><time>" + times[i] + "</time><span>" + esc(t[0]) + " · " + esc(t[1]) + "</span></li>";
        })
        .join("") +
      "</ol></section>" +
      '<section><h3>Last visit</h3><p class="body-sm muted">2 Oct · ' +
      esc(DOCTORS[x.doctor]) +
      " · paid " +
      P.formatINR(50000) +
      "</p></section></article>"
    );
  }

  /* ------------------------------------------------------------ doctor mode */
  function renderDoctor() {
    const mine = visits.filter(function (x) {
      return x.doctor === "rao";
    });
    const waiting = mine.filter(function (x) {
      return x.status === "waiting";
    });
    const withMe = mine.filter(function (x) {
      return x.status === "with-doctor";
    });
    const done = mine.filter(function (x) {
      return x.status === "done" || x.status === "to-bill";
    });
    const next = waiting[0];
    const board = document.getElementById("board");
    board.className = "board doctor";
    document.getElementById("phone-switch").innerHTML = "";
    document.getElementById("match-line").innerHTML = "";
    board.innerHTML =
      '<div class="doc-grid"><div>' +
      '<section class="lane is-shown" aria-labelledby="lane-me"><div class="lane-head"><h2 id="lane-me">' +
      icon("doctor") +
      'With me <span class="lc">' +
      withMe.length +
      '</span></h2></div><ul class="rows">' +
      withMe.map(function (x) { return rowHtml(x); }).join("") +
      '</ul></section><section class="lane is-shown" aria-labelledby="lane-mw"><div class="lane-head"><h2 id="lane-mw">' +
      icon("waiting") +
      'Waiting for me <span class="lc">' +
      waiting.length +
      '</span></h2><span class="lane-note">Next is pinned</span></div><ul class="rows">' +
      waiting
        .map(function (x, i) {
          return rowHtml(x, { next: i === 0 });
        })
        .join("") +
      '</ul></section><section class="lane is-shown" aria-labelledby="lane-md"><div class="lane-head"><h2 id="lane-md">' +
      icon("done") +
      'Seen today <span class="lc">' +
      done.length +
      "</span></h2></div></section></div>" +
      (next
        ? '<article class="detail snapshot snapshot-panel"><div class="d-head">' +
          tokenHtml(next, "token-lg") +
          '<div><p class="label" style="color:var(--color-accent-fg)">Next patient</p><h2 class="title-2">' +
          esc(next.name) +
          '</h2><p class="body-sm muted">' +
          esc(next.age + " · " + next.sex + " · " + next.origin) +
          " · waiting " +
          P.formatWait(next.wait) +
          "</p></div></div>" +
          allergyHtml(next, true) +
          '<div class="d-actions"><button type="button" class="btn btn-lg btn-primary" data-act="call" data-id="' +
          next.id +
          '">Call in token ' +
          next.token +
          '</button><a class="btn btn-lg btn-secondary" href="../004-consult/index.html">Start consult</a></div>' +
          '<section><h3><span class="smart">' +
          icon("zap") +
          'Smart Assist</span> · Patient snapshot</h3><ul><li>Last seen 2 Oct (Dr A Rao): Essential hypertension</li><li>Chronic: Type 2 diabetes, hypertension</li><li>Last Rx: Telmisartan 40 mg 1-0-0 · Metformin 500 mg 1-0-1</li><li>Follow-up due today (set 2 Oct)</li></ul></section>' +
          '<section><h3>Vitals today</h3><p class="body-sm tnum">' +
          esc(next.vitals || "Pending") +
          "</p></section></article>"
        : "") +
      "</div>";
  }

  /* ------------------------------------------------------------ actions */
  function find(id) {
    return visits.find(function (x) {
      return x.id === id;
    });
  }
  function flashRow(id) {
    window.requestAnimationFrame(function () {
      document.querySelectorAll('.row[data-id="' + id + '"]').forEach(function (r) {
        r.classList.add("flash");
      });
    });
  }
  function checkIn(x) {
    const prev = { status: x.status, token: x.token };
    x.status = "waiting";
    x.token = state.nextToken++;
    x.wait = 0;
    x.origin = "Appt " + fmtTime(x.appt);
    state.selected = x.id;
    clearFilter();
    render();
    flashRow(x.id);
    P.announce("Token " + x.token + ", " + x.name + ", checked in");
    P.toast("Token " + x.token + " · " + x.name + " checked in", {
      undo: function () {
        x.status = prev.status;
        x.token = prev.token;
        state.nextToken--;
        render();
      },
    });
  }
  function clearFilter() {
    state.q = "";
    const f = document.getElementById("filter");
    if (f) f.value = "";
  }
  function doAction(act, x) {
    switch (act) {
      case "checkin":
        return checkIn(x);
      case "collect":
        return openCollect(x);
      case "vitals":
        return openVitals(x);
      case "reschedule":
        return openSlots(x, "reschedule");
      case "call":
        x.status = "with-doctor";
        x.wait = 0;
        render();
        P.announce("Token " + x.token + " called in");
        return P.toast("Token " + x.token + " called · " + x.name);
      case "receipt":
        return P.toast("Receipt CQ/26-27/00" + (100 + x.token) + " · Print or WhatsApp");
      case "move":
        x.doctor = x.doctor === "rao" ? "iyer" : "rao";
        render();
        return P.toast(x.name + " moved to " + DOCTORS[x.doctor]);
      case "consult":
        {
          const a = document.createElement("a");
          a.href = "../004-consult/index.html";
          a.click();
        }
        return undefined;
      default:
        return undefined;
    }
  }
  function moreMenu(btn, x) {
    const items = [];
    if (x.status === "booked") {
      items.push({ label: "Reschedule", icon: "calendar", run: function () { openSlots(x, "reschedule"); } });
      items.push({ label: "Mark no-show", icon: "noshow", run: function () { x.status = "no-show"; render(); P.toast(x.name + " marked no-show", { undo: function () { x.status = "booked"; render(); } }); } });
    }
    if (x.status === "waiting") {
      items.push({ label: "Record vitals", icon: "vitals", run: function () { openVitals(x); } });
      items.push({ label: "Move to " + (x.doctor === "rao" ? DOCTORS.iyer : DOCTORS.rao), icon: "users", run: function () { doAction("move", x); } });
    }
    items.push({ label: "Open patient", icon: "user", run: function () { openDetail(x); } });
    if (x.status === "booked" || x.status === "waiting") {
      items.push("-");
      items.push({ label: "Cancel visit", icon: "cancelled", danger: true, run: function () { const s = x.status; x.status = "cancelled"; render(); P.toast("Visit cancelled · " + x.name, { undo: function () { x.status = s; render(); } }); } });
    }
    P.menu(btn, items);
  }
  function openDetail(x) {
    state.selected = x.id;
    const isMid = window.matchMedia("(min-width: 768px) and (max-width: 1279px)").matches;
    if (isMid && layout === "twopane") {
      render();
      return;
    }
    P.openSheet({
      title: x.name,
      context: (x.token ? "Token " + x.token + " · " : "") + esc(DOCTORS[x.doctor]),
      body: detailHtml(x).replace('<article class="detail">', '<article class="detail" style="border:0">'),
    });
  }

  /* Patient picker used by Walk-in and Book. Enter selects the highlighted (first) match. */
  function pickerBody(prefix) {
    return (
      '<div class="field"><label for="' +
      prefix +
      '-q">Patient: mobile number or name</label><div class="input-wrap">' +
      icon("search") +
      '<input class="input" id="' +
      prefix +
      '-q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="' +
      prefix +
      '-list" aria-autocomplete="list" placeholder="e.g. 98765 43210 or Wagh"></div><p class="hint">↑ ↓ to move · Enter selects</p></div><ul class="picker-results" id="' +
      prefix +
      '-list" role="listbox" aria-label="Matching patients" hidden></ul><div id="' +
      prefix +
      '-step2"></div>'
    );
  }
  function wirePicker(sheet, prefix, onPick) {
    const input = sheet.querySelector("#" + prefix + "-q");
    const list = sheet.querySelector("#" + prefix + "-list");
    let results = [];
    let active = 0;
    function draw() {
      const q = input.value.trim().toLowerCase();
      const digits = q.replace(/\D/g, "");
      results = q
        ? directory.filter(function (p) {
            return (digits.length >= 4 && p.phone.indexOf(digits) !== -1) || (!digits && p.name.toLowerCase().indexOf(q) !== -1);
          })
        : [];
      active = 0;
      list.hidden = !q;
      input.setAttribute("aria-expanded", String(!!q));
      list.innerHTML =
        results
          .map(function (p, i) {
            return (
              '<li role="option" id="' +
              prefix +
              "-o" +
              i +
              '" aria-selected="' +
              (i === active) +
              '" data-i="' +
              i +
              '"><span class="pr-name">' +
              esc(p.name) +
              ' <span class="muted body-sm">' +
              esc(p.age + " · " + p.sex) +
              '</span></span><span class="pr-hint">' +
              (i === active ? "Enter" : "") +
              '</span><span class="pr-meta">' +
              phoneDisplay(p.phone) +
              " · " +
              esc(p.last) +
              "</span></li>"
            );
          })
          .join("") +
        (q
          ? '<li role="option" id="' +
            prefix +
            '-new" aria-selected="' +
            (results.length === 0) +
            '" data-i="new"><span class="pr-name">' +
            icon("plus", "icon-16") +
            " Register “" +
            esc(input.value.trim()) +
            '” as a new patient</span><span class="pr-meta">Name, mobile, age, sex · duplicates are checked</span></li>'
          : "");
      input.setAttribute("aria-activedescendant", results.length ? prefix + "-o" + active : prefix + "-new");
    }
    function highlight() {
      list.querySelectorAll('[role="option"]').forEach(function (li, i) {
        li.setAttribute("aria-selected", String(i === active));
        const h = li.querySelector(".pr-hint");
        if (h) h.textContent = i === active ? "Enter" : "";
      });
      const ids = Array.from(list.querySelectorAll('[role="option"]')).map(function (li) {
        return li.id;
      });
      input.setAttribute("aria-activedescendant", ids[active] || "");
    }
    input.addEventListener("input", draw);
    input.addEventListener("keydown", function (e) {
      const n = list.querySelectorAll('[role="option"]').length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(n - 1, active + 1);
        highlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        highlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!input.value.trim()) return;
        if (active < results.length) onPick(results[active]);
        else onPick(null, input.value.trim());
      }
    });
    list.addEventListener("click", function (e) {
      const li = e.target.closest("li");
      if (!li) return;
      if (li.dataset.i === "new") onPick(null, input.value.trim());
      else onPick(results[Number(li.dataset.i)]);
    });
    return input;
  }
  function whoCard(p) {
    return (
      '<div class="who-card"><span class="avatar">' +
      p.name
        .split(" ")
        .map(function (w) {
          return w[0];
        })
        .slice(0, 2)
        .join("") +
      '</span><div class="grow"><b>' +
      esc(p.name) +
      '</b><span class="body-sm muted tnum">' +
      esc(p.age + " · " + p.sex) +
      " · " +
      phoneDisplay(p.phone) +
      '</span></div><button type="button" class="btn btn-ghost" data-change>Change</button></div>'
    );
  }

  function openWalkIn(prefill) {
    const sheet = P.openSheet({
      title: "Add walk-in",
      context: "Issues the next token for today",
      body: pickerBody("wi"),
      focus: "#wi-q",
    });
    const input = wirePicker(sheet, "wi", function (p, typed) {
      if (!p) return quickRegister(sheet, typed);
      const waitingBy = { rao: 0, iyer: 0 };
      visits.forEach(function (x) {
        if (x.status === "waiting") waitingBy[x.doctor] += 1;
      });
      const doc = waitingBy.iyer < waitingBy.rao ? "iyer" : "rao";
      sheet.querySelector(".field").hidden = true;
      sheet.querySelector("#wi-list").hidden = true;
      sheet.querySelector("#wi-step2").innerHTML =
        '<div style="display:grid;gap:16px">' +
        whoCard(p) +
        '<div class="field"><span class="field-label" id="wi-doc-l">Doctor</span><div class="seg" role="radiogroup" aria-labelledby="wi-doc-l">' +
        ["rao", "iyer"]
          .map(function (d) {
            return '<button type="button" role="radio" aria-checked="' + (d === doc) + '" data-doc="' + d + '">' + DOCTORS[d] + ' <span class="n">' + waitingBy[d] + " waiting</span></button>";
          })
          .join("") +
        '</div><p class="hint">Defaults to the doctor with the shortest queue</p></div>' +
        '<div class="field"><label for="wi-reason">Reason <span class="subtle">(optional)</span></label><input class="input" id="wi-reason" autocomplete="off" placeholder="e.g. fever, follow-up"></div>' +
        '<button type="button" class="btn btn-lg btn-primary btn-block" id="wi-add">Add to queue · token ' +
        state.nextToken +
        "</button></div>";
      let chosen = doc;
      sheet.querySelectorAll("[data-doc]").forEach(function (b) {
        b.addEventListener("click", function () {
          chosen = b.dataset.doc;
          sheet.querySelectorAll("[data-doc]").forEach(function (o) {
            o.setAttribute("aria-checked", String(o === b));
          });
        });
      });
      sheet.querySelector("[data-change]").addEventListener("click", function () {
        P.closeSheet();
        openWalkIn();
      });
      const add = sheet.querySelector("#wi-add");
      add.addEventListener("click", function () {
        const nv = v({ status: "waiting", token: state.nextToken++, name: p.name, age: p.age, sex: p.sex, phone: p.phone, doctor: chosen, origin: "Walk-in", wait: 0, allergy: "unknown" });
        visits.push(nv);
        state.selected = nv.id;
        P.closeSheet();
        render();
        flashRow(nv.id);
        P.announce("Token " + nv.token + ", " + nv.name + ", added to " + DOCTORS[chosen] + "'s queue");
        P.toast("Token " + nv.token + " · " + nv.name + " · " + DOCTORS[chosen], {
          undo: function () {
            visits.splice(visits.indexOf(nv), 1);
            state.nextToken--;
            render();
          },
        });
      });
      add.focus();
    });
    if (prefill) {
      input.value = prefill;
      input.dispatchEvent(new Event("input"));
    }
  }
  function quickRegister(sheet, typed) {
    const digits = typed.replace(/\D/g, "");
    sheet.querySelector(".field").hidden = true;
    sheet.querySelector('[role="listbox"]').hidden = true;
    const host = sheet.querySelector('[id$="-step2"]');
    host.innerHTML =
      '<div style="display:grid;gap:16px"><p class="body-sm muted">New patient. Four fields; everything else can wait.</p>' +
      '<div class="field"><label for="qr-name">Full name</label><input class="input" id="qr-name" autocapitalize="words" autocomplete="off" value="' +
      (digits ? "" : esc(typed)) +
      '"></div><div class="field"><label for="qr-phone">Mobile number</label><div class="adorn"><span>+91</span><input class="input" style="text-align:left" id="qr-phone" type="tel" inputmode="numeric" autocomplete="off" value="' +
      esc(digits) +
      '"></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label for="qr-age">Age (years)</label><input class="input" id="qr-age" inputmode="numeric" autocomplete="off"></div><div class="field"><label for="qr-sex">Sex</label><select class="input" id="qr-sex"><option>Female</option><option>Male</option><option>Other</option></select></div></div>' +
      '<button type="button" class="btn btn-lg btn-primary btn-block" id="qr-save">Register and add to queue</button></div>';
    host.querySelector("#qr-save").addEventListener("click", function () {
      P.closeSheet();
      P.toast("Prototype: registration is not saved");
    });
    host.querySelector(digits ? "#qr-name" : "#qr-phone").focus();
  }

  const SLOT_SETS = {
    Morning: ["10:45", "11:30", "11:45"],
    Afternoon: ["12:15", "12:45", "14:00", "14:30", "15:15"],
    Evening: ["16:30", "17:00", "17:45", "18:15"],
  };
  function slotPicker(prefix, preselect) {
    const days = ["Today", "Tomorrow", "Mon 16", "Tue 17", "Wed 18"];
    return (
      '<div class="field"><span class="field-label" id="' +
      prefix +
      '-day-l">Date</span><div class="seg" role="radiogroup" aria-labelledby="' +
      prefix +
      '-day-l">' +
      days
        .map(function (d, i) {
          return '<button type="button" role="radio" aria-checked="' + (i === 0) + '" data-day="' + d + '">' + d + "</button>";
        })
        .join("") +
      '</div></div><div class="slots" role="radiogroup" aria-label="Available slots">' +
      Object.keys(SLOT_SETS)
        .map(function (k) {
          return (
            "<div><h4>" +
            k +
            '</h4><div class="slot-row">' +
            SLOT_SETS[k]
              .map(function (s) {
                return '<button type="button" class="toggle-chip" role="radio" aria-checked="' + (s === preselect) + '" data-slot="' + s + '">' + fmtTime(s) + "</button>";
              })
              .join("") +
            "</div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function wireSlots(sheet, onChange) {
    sheet.querySelectorAll("[data-slot]").forEach(function (b) {
      b.addEventListener("click", function () {
        sheet.querySelectorAll("[data-slot]").forEach(function (o) {
          o.setAttribute("aria-checked", String(o === b));
        });
        onChange(b.dataset.slot);
      });
    });
    sheet.querySelectorAll("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () {
        sheet.querySelectorAll("[data-day]").forEach(function (o) {
          o.setAttribute("aria-checked", String(o === b));
        });
      });
    });
  }

  function openBook() {
    const sheet = P.openSheet({ title: "Book appointment", context: "Fri, 13 Nov · clinic time (IST)", body: pickerBody("bk"), focus: "#bk-q" });
    wirePicker(sheet, "bk", function (p, typed) {
      if (!p) return quickRegister(sheet, typed);
      let slot = "11:30";
      sheet.querySelector(".field").hidden = true;
      sheet.querySelector("#bk-list").hidden = true;
      sheet.querySelector("#bk-step2").innerHTML =
        '<div style="display:grid;gap:16px">' +
        whoCard(p) +
        '<div class="field"><label for="bk-doc">Doctor</label><select class="input" id="bk-doc"><option value="rao"' +
        (p.doctor === "rao" ? " selected" : "") +
        ">Dr A Rao (General physician)</option><option value=\"iyer\"" +
        (p.doctor === "iyer" ? " selected" : "") +
        '>Dr M Iyer (Paediatrics)</option></select><p class="hint">Their usual doctor</p></div>' +
        '<div class="suggest"><span class="smart">' +
        icon("zap") +
        'Smart Assist</span><span>Next free slot: <b class="tnum">11:30 am today</b> · usually comes in the morning</span></div>' +
        slotPicker("bk", slot) +
        '<button type="button" class="btn btn-lg btn-primary btn-block" id="bk-go">Book ' +
        fmtTime(slot) +
        " today</button></div>";
      const go = sheet.querySelector("#bk-go");
      wireSlots(sheet, function (s) {
        slot = s;
        go.textContent = "Book " + fmtTime(s) + " today";
      });
      sheet.querySelector("[data-change]").addEventListener("click", function () {
        P.closeSheet();
        openBook();
      });
      go.addEventListener("click", function () {
        const nv = v({ status: "booked", name: p.name, age: p.age, sex: p.sex, phone: p.phone, doctor: sheet.querySelector("#bk-doc").value, appt: slot, allergy: "none" });
        visits.splice(visits.filter(function (x) { return x.status === "booked"; }).length, 0, nv);
        visits.sort(function (a, b) {
          if (a.status === "booked" && b.status === "booked") return minutes(a.appt) - minutes(b.appt);
          return 0;
        });
        P.closeSheet();
        render();
        flashRow(nv.id);
        P.announce(p.name + " booked at " + fmtTime(slot));
        P.toast("Booked · " + p.name + " · " + fmtTime(slot) + " today · WhatsApp confirmation queued");
      });
      go.focus();
    });
  }
  function openSlots(x) {
    let slot = null;
    const sheet = P.openSheet({
      title: "Reschedule",
      context: esc(x.name) + " · now " + fmtTime(x.appt) + " today with " + DOCTORS[x.doctor],
      body: slotPicker("rs", null) + '<p class="hint">The patient gets a WhatsApp message with the new time.</p>',
      foot: '<button type="button" class="btn btn-lg btn-primary" id="rs-go" aria-disabled="true">Pick a new slot</button>',
      focus: "[data-slot]",
    });
    const go = sheet.querySelector("#rs-go");
    wireSlots(sheet, function (s) {
      slot = s;
      go.removeAttribute("aria-disabled");
      go.textContent = "Confirm " + fmtTime(s);
    });
    go.addEventListener("click", function () {
      if (!slot) return;
      const old = x.appt;
      x.appt = slot;
      visits.sort(function (a, b) {
        if (a.status === "booked" && b.status === "booked") return minutes(a.appt) - minutes(b.appt);
        return 0;
      });
      P.closeSheet();
      render();
      flashRow(x.id);
      P.toast("Rescheduled · " + x.name + " · " + fmtTime(slot), {
        undo: function () {
          x.appt = old;
          render();
        },
      });
    });
  }
  function openVitals(x) {
    const sheet = P.openSheet({
      title: "Vitals",
      context: "Token " + x.token + " · " + esc(x.name),
      body:
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="field"><label for="vt-sys">BP systolic</label><div class="adorn"><input class="input" id="vt-sys" inputmode="numeric" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">mmHg</span></div></div>' +
        '<div class="field"><label for="vt-dia">BP diastolic</label><div class="adorn"><input class="input" id="vt-dia" inputmode="numeric" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">mmHg</span></div></div>' +
        '<div class="field"><label for="vt-p">Pulse</label><div class="adorn"><input class="input" id="vt-p" inputmode="numeric" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">bpm</span></div></div>' +
        '<div class="field"><label for="vt-t">Temperature</label><div class="adorn"><input class="input" id="vt-t" inputmode="decimal" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">°F</span></div></div>' +
        '<div class="field"><label for="vt-s">SpO₂</label><div class="adorn"><input class="input" id="vt-s" inputmode="numeric" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">%</span></div></div>' +
        '<div class="field"><label for="vt-w">Weight</label><div class="adorn"><input class="input" id="vt-w" inputmode="decimal" autocomplete="off" style="text-align:left"><span style="border-right:0;border-left:1px solid var(--color-border)">kg</span></div></div></div>' +
        '<p class="hint">Enter moves to the next field. Last recorded 2 Oct: BP 142/90 · 79 kg</p>',
      foot: '<button type="button" class="btn btn-lg btn-primary" id="vt-save">Save vitals</button>',
      focus: "#vt-sys",
    });
    const fields = Array.from(sheet.querySelectorAll("input"));
    fields.forEach(function (f, i) {
      f.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (fields[i + 1]) fields[i + 1].focus();
          else sheet.querySelector("#vt-save").click();
        }
      });
    });
    sheet.querySelector("#vt-save").addEventListener("click", function () {
      const s = fields[0].value || "120";
      const d = fields[1].value || "80";
      x.vitals = "BP " + s + "/" + d + (fields[2].value ? " · P " + fields[2].value : "");
      P.closeSheet();
      render();
      flashRow(x.id);
      P.toast("Vitals saved · token " + x.token);
    });
  }
  function openCollect(x) {
    let method = "cash";
    const sheet = P.openSheet({
      title: "Collect payment",
      context: "Token " + x.token + " · " + esc(x.name) + " · " + DOCTORS[x.doctor],
      body:
        '<div class="bill-lines">' +
        x.lines
          .map(function (l) {
            return "<div><span>" + esc(l[0]) + "</span><span>" + P.formatINR(l[1]) + "</span></div>";
          })
          .join("") +
        '</div><div class="slot-row"><button type="button" class="toggle-chip" aria-pressed="false">' +
        icon("plus", "icon-16") +
        "Dressing " +
        P.formatINR(15000) +
        '</button><button type="button" class="toggle-chip" aria-pressed="false">' +
        icon("plus", "icon-16") +
        "Injection " +
        P.formatINR(10000) +
        '</button><button type="button" class="toggle-chip" aria-pressed="false">' +
        icon("plus", "icon-16") +
        'Custom</button></div><div class="pay-total"><span>Total</span><span>' +
        P.formatINR(x.due) +
        '</span></div><div class="field"><span class="field-label" id="pm-l">Paid by</span><div class="seg" role="radiogroup" aria-labelledby="pm-l">' +
        ["Cash", "UPI", "Card", "Split"]
          .map(function (m, i) {
            return '<button type="button" role="radio" aria-checked="' + (i === 0) + '" data-pm="' + m.toLowerCase() + '">' + m + "</button>";
          })
          .join("") +
        '</div></div><div class="field"><label for="pay-amt">Amount received</label><div class="adorn"><span>₹</span><input class="input tnum" id="pay-amt" inputmode="decimal" autocomplete="off" value="' +
        (x.due / 100).toLocaleString("en-IN") +
        '"></div><p class="hint">Change to return: ₹0</p></div>',
      foot:
        '<button type="button" class="btn btn-lg btn-secondary" id="pay-due">Save as due</button><button type="button" class="btn btn-lg btn-primary" id="pay-go">Collect ' +
        P.formatINR(x.due) +
        "</button>",
      focus: "#pay-go",
    });
    sheet.querySelectorAll("[data-pm]").forEach(function (b) {
      b.addEventListener("click", function () {
        method = b.dataset.pm;
        sheet.querySelectorAll("[data-pm]").forEach(function (o) {
          o.setAttribute("aria-checked", String(o === b));
        });
      });
    });
    sheet.querySelectorAll(".slot-row .toggle-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      });
    });
    sheet.querySelector("#pay-due").addEventListener("click", function () {
      P.closeSheet();
      P.toast("Saved as due · " + P.formatINR(x.due));
    });
    sheet.querySelector("#pay-go").addEventListener("click", function () {
      const receipt = "CQ/26-27/00" + state.receiptNo++;
      const amount = x.due;
      x.status = "done";
      x.paid = amount;
      render();
      sheet.querySelector(".sheet-body").innerHTML =
        '<div class="success" role="status"><p class="ok">' +
        icon("done") +
        P.formatINR(amount) +
        " received (" +
        method.charAt(0).toUpperCase() +
        method.slice(1) +
        ')</p><p class="body-sm muted">Receipt <span class="tnum">' +
        receipt +
        '</span> · token ' +
        x.token +
        " · " +
        esc(x.name) +
        "</p></div>";
      sheet.querySelector(".sheet-foot").innerHTML =
        '<button type="button" class="btn btn-lg btn-secondary">' +
        icon("printer") +
        'Print</button><button type="button" class="btn btn-lg btn-secondary">' +
        icon("message") +
        'Send on WhatsApp</button><button type="button" class="btn btn-lg btn-primary" id="pay-done">Done</button>';
      const done = sheet.querySelector("#pay-done");
      done.addEventListener("click", P.closeSheet);
      done.focus();
      P.announce(P.formatINR(amount) + " received, receipt " + receipt);
    });
  }
  function openNew() {
    const sheet = P.openSheet({
      title: "New",
      body:
        '<div style="display:grid;gap:8px">' +
        [
          ["walkin", "Add walk-in", "W", "users"],
          ["book", "Book appointment", "B", "calendar"],
          ["register", "Register new patient", "N", "addsquare"],
          ["collect", "Collect payment", "C", "rupee"],
        ]
          .map(function (a) {
            return '<button type="button" class="btn btn-lg btn-secondary" style="justify-content:flex-start" data-new="' + a[0] + '">' + icon(a[3]) + a[1] + '<kbd class="kbd-lg" style="margin-left:auto">' + a[2] + "</kbd></button>";
          })
          .join("") +
        "</div>",
    });
    sheet.querySelectorAll("[data-new]").forEach(function (b) {
      b.addEventListener("click", function () {
        const k = b.dataset.new;
        P.closeSheet();
        if (k === "walkin") openWalkIn();
        else if (k === "book") openBook();
        else if (k === "collect") collectFirst();
        else P.toast("Register opens the same quick form as walk-in");
      });
    });
  }
  function collectFirst() {
    const x = visits.find(function (y) {
      return y.status === "to-bill";
    });
    if (x) openCollect(x);
    else P.toast("Nothing to collect");
  }

  /* ------------------------------------------------------------ boot */
  const desk = state.mode === "desk";
  const user = desk ? { initials: "PN", name: "Pooja N", role: "Front desk" } : { initials: "AR", name: "Dr A Rao", role: "Doctor" };
  P.shell({
    active: "today",
    user: user,
    topbar:
      '<div class="tb-phone only-phone">' +
      P.mark(28) +
      '<span class="clinic">Asha Clinic</span></div>' +
      '<div class="tb-title from-md"><h1>' +
      (desk ? "Today" : "My queue") +
      '</h1><span class="body-sm muted">Fri, 13 Nov</span><span class="dot-live">Live</span></div>' +
      '<span class="grow"></span>' +
      (desk
        ? '<div class="from-md" style="gap:8px"><button type="button" class="btn btn-secondary" data-action="walkin">' +
          icon("plus") +
          'Walk-in <kbd class="kbd-lg">W</kbd></button><button type="button" class="btn btn-secondary" data-action="book">' +
          icon("calendar") +
          'Book <kbd class="kbd-lg">B</kbd></button></div>'
        : "") +
      '<button type="button" class="icon-btn" aria-label="Search all patients (Ctrl K)">' +
      icon("search") +
      "</button>" +
      P.topbarIcons(user),
    main:
      '<div class="today' +
      (layout === "lanes" ? " layout-lanes" : "") +
      '"><div class="today-head"><div class="phone-title only-phone"><h1>' +
      (desk ? "Today" : "My queue") +
      '</h1><span class="body-sm muted">Fri, 13 Nov</span><span class="dot-live">Live</span>' +
      "</div>" +
      (desk
        ? '<div class="tools"><div class="field filter" style="gap:4px"><label class="sr-only" for="filter">Filter today: token, name or mobile number</label><div class="input-wrap">' +
          icon("search") +
          '<input class="input" id="filter" type="search" enterkeyhint="go" autocomplete="off" placeholder="Token, name or mobile" aria-describedby="filter-hint"><kbd class="kbd-lg" aria-hidden="true">/</kbd></div><span id="filter-hint" class="sr-only">Enter on a single match does its next step: check in, vitals or collect.</span></div>' +
          '<div class="doctors" role="radiogroup" aria-label="Doctor">' +
          [
            ["all", "All"],
            ["rao", "Dr A Rao"],
            ["iyer", "Dr M Iyer"],
          ]
            .map(function (d) {
              return '<button type="button" class="toggle-chip" role="radio" aria-checked="' + (d[0] === "all") + '" data-doc-filter="' + d[0] + '" data-doc-count="' + d[0] + '">' + d[1] + ' <span class="n"></span></button>';
            })
            .join("") +
          '</div><label class="sr-only" for="doc-sel">Doctor</label><select class="input doc-select only-phone" id="doc-sel"><option value="all">All doctors</option><option value="rao">Dr A Rao</option><option value="iyer">Dr M Iyer</option></select></div>'
        : "") +
      '<div id="match-line"></div><div id="phone-switch"></div></div><div id="board" class="board"></div></div>',
  });

  render();

  const app = document.getElementById("app");
  app.addEventListener("click", function (e) {
    const t = e.target;
    const actBtn = t.closest("[data-act]");
    if (actBtn) {
      if (actBtn.dataset.act === "walkin-from-q") return openWalkIn(state.q);
      const x = find(actBtn.dataset.id);
      if (x) doAction(actBtn.dataset.act, x);
      return undefined;
    }
    const more = t.closest("[data-more]");
    if (more) return moreMenu(more, find(more.dataset.more));
    const open = t.closest("[data-open]");
    if (open) return openDetail(find(open.dataset.open));
    const lp = t.closest("[data-lane-pick]");
    if (lp) {
      if (window.matchMedia("(max-width: 767px)").matches) state.lane = lp.dataset.lanePick;
      else state.listLane = lp.dataset.lanePick;
      render();
      const again = document.querySelector('[data-lane-pick="' + lp.dataset.lanePick + '"]');
      if (again) again.focus();
      return undefined;
    }
    const th = t.closest("[data-third]");
    if (th) {
      state.third = th.dataset.third;
      render();
      return undefined;
    }
    const df = t.closest("[data-doc-filter]");
    if (df) {
      state.doctor = df.dataset.docFilter;
      document.querySelectorAll("[data-doc-filter]").forEach(function (b) {
        b.setAttribute("aria-checked", String(b === df));
      });
      render();
      return undefined;
    }
    if (t.closest("[data-done-toggle]")) {
      state.doneOpen = !state.doneOpen;
      render();
      const dt = document.querySelector("[data-done-toggle]");
      if (dt) dt.focus();
      return undefined;
    }
    const a = t.closest("[data-action]");
    if (a) {
      const k = a.dataset.action;
      if (k === "walkin") openWalkIn();
      else if (k === "book") openBook();
      else if (k === "new") openNew();
      else if (k === "more") P.toast("More: Records, Reports, Settings, Install app");
    }
    return undefined;
  });
  const docSel = document.getElementById("doc-sel");
  if (docSel)
    docSel.addEventListener("change", function () {
      state.doctor = docSel.value;
      render();
    });
  const filter = document.getElementById("filter");
  if (filter) {
    filter.addEventListener("input", function () {
      state.q = filter.value;
      render();
    });
    filter.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        clearFilter();
        render();
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const m = visits.filter(function (x) {
        return byDoctor(x) && matches(x, state.q) && ["booked", "waiting", "with-doctor", "to-bill"].indexOf(x.status) !== -1;
      });
      if (m.length === 1) {
        const pa = primaryAction(m[0]);
        if (pa) doAction(pa.act, m[0]);
        else openDetail(m[0]);
      } else if (!m.length && state.q.trim()) {
        openWalkIn(state.q);
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    if (P.sheetOpen() || P.inField() || e.ctrlKey || e.metaKey || e.altKey || !desk) return;
    const k = e.key.toLowerCase();
    if (k === "w") {
      e.preventDefault();
      openWalkIn();
    } else if (k === "b") {
      e.preventDefault();
      openBook();
    } else if (k === "c") {
      e.preventDefault();
      collectFirst();
    } else if (k === "/") {
      e.preventDefault();
      if (filter) filter.focus();
    }
  });
  let lastWidthClass = "";
  window.addEventListener("resize", function () {
    const w = window.innerWidth < 768 ? "p" : window.innerWidth < 1280 ? "m" : "d";
    if (w !== lastWidthClass) {
      lastWidthClass = w;
      render();
    }
  });
})();
