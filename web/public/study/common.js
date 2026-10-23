// Shared data loading, formatting, tooltip and ARP profile for the study pages.
window.S = (function () {
  const STYLE_ORDER = ["uniform", "mixed", "varied"];
  const COLOR = { uniform: "var(--uniform)", mixed: "var(--mixed)", varied: "var(--varied)", few: "var(--few)" };
  const HEX = { uniform: "#E8553F", mixed: "#8C8798", varied: "#2E6FD8", few: "#CFCAD6" };
  // Chart colours other than the three styles (see docs/DESIGN.md).
  const lerp = (a, b) => d3.interpolateRgb(a, b);
  const PAL = {
    seq: d3.scaleSequential(d3.interpolateRgbBasis(["#F6EFE6", "#F7B9A6", "#E8553F", "#8F2414"])).domain([0.3, 1]).clamp(true),
    div: (v) => { const t = Math.max(-1, Math.min(1, v / 0.4)); return t < 0 ? lerp("#EEE9E1", "#2E6FD8")(-t) : lerp("#EEE9E1", "#E8553F")(t); },
    nullCell: "#F3EEE6",
    cmp: ["#7B3FE4", "#0F8B8D", "#B5651D", "#C2185B"],
    district: ["#7B3FE4", "#0F8B8D", "#B5651D", "#C2185B", "#2E6FD8", "#E8553F", "#5C8A00", "#8C8798", "#C79A00", "#1E1B2E"],
    grade: { 1: "#CFCAD6", 2: "#8C8798", 3: "#1E1B2E" },
    subject: { FH: "#C2185B", FM: "#0F8B8D" },
    opt: { top: "#1E1B2E", mid: "#8C8798", low: "#E4DDD1" },
  };
  const fmtInt = d3.format(",");
  const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  const pts = (x) => (x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Math.round(x * 100)) + " pts");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Every per-ARP measure the pages can sort, plot or compare.
  const METRICS = [
    { id: "variety", label: "Answer variety", short: "Variety", fmt: (x) => (x == null ? "–" : x.toFixed(2)), domain: [0, 1],
      desc: "How often the ARP's answer to each Grade 1–3 FLN question changes between classrooms. 0 = the same answer every time." },
    { id: "flnLean", label: "Positivity vs grade average", short: "Positivity", fmt: pts, domain: [-0.55, 0.2],
      desc: "Points above or below the average answer on the same form, grade and month, across all raters." },
    { id: "flnAllYes", label: "FLN forms with every top answer", short: "All-top FLN", fmt: pct, domain: [0, 1],
      desc: "Share of Grade 1–3 FLN forms where every question got the best answer." },
    { id: "partial", label: "In-between answers used", short: "In-between", fmt: pct, domain: [0, 1],
      desc: "On questions with more than two answers (some, partial…), how often the ARP picks a middle option." },
    { id: "contradictions", label: "Contradictory answers", short: "Contradictions", fmt: pct, domain: [0, 1],
      desc: "When an earlier answer rules a later one out (no tracker → NIPUN Talika updated), how often the ARP gives it anyway." },
    { id: "noPlan", label: "Gr 4–8 forms ended at “no lesson plan”", short: "No plan", fmt: pct, domain: [0, 1],
      desc: "Answering “no lesson plan” skips the rest of the Grade 4–8 form." },
    { id: "gAllYes", label: "Gr 4–8 forms all “yes” (with a plan)", short: "All-yes Gr 4–8", fmt: pct, domain: [0, 1],
      desc: "Of Grade 4–8 forms that go past the lesson-plan question, the share marked “yes” throughout." },
    { id: "allPresent", label: "Every teacher marked present", short: "All teachers present", fmt: pct, domain: [0, 1],
      desc: "Visits where teachers present equals teachers in position. Partly reflects the schools, not only the ARP." },
    { id: "classFull", label: "Every enrolled child present", short: "Full class", fmt: pct, domain: [0, 0.6],
      desc: "Visits where children present in the observed class equals children enrolled." },
    { id: "factFlip", label: "School facts changed on revisit", short: "Fact changes", fmt: pct, domain: [0, 0.4],
      desc: "Returning to a school 2 weeks to 6 months later: how often library, sports, eco club or timetable answers changed." },
    { id: "enrSame", label: "Enrolment unchanged on revisit", short: "Same enrolment", fmt: pct, domain: [0, 1],
      desc: "Returning to a school: how often the total enrolment written down is exactly the same." },
    { id: "teacherRepeat", label: "Visits to a teacher seen before", short: "Repeat teachers", fmt: pct, domain: [0, 0.8],
      desc: "Share of observations of a teacher this ARP had already observed." },
    { id: "hindiShare", label: "FLN observations in Hindi", short: "Hindi share", fmt: pct, domain: [0, 1],
      desc: "Of Grade 1–3 FLN observations, the share in Hindi rather than Maths." },
    { id: "grade1Share", label: "FLN observations in Grade 1", short: "Grade 1 share", fmt: pct, domain: [0, 1] , desc: "Of Grade 1–3 FLN observations, the share in Grade 1." },
    { id: "minutes", label: "Median visit length", short: "Minutes", fmt: (x) => (x == null ? "–" : Math.round(x) + " min"), domain: [100, 160], desc: "Time the app recorded per observation." },
    { id: "visitsPerMonth", label: "Visits per active month", short: "Visits/month", fmt: (x) => (x == null ? "–" : x.toFixed(1)), domain: [0, 35], desc: "Average observations in months with at least one." },
    { id: "targetShare", label: "Months at the 30-visit target", short: "At target", fmt: pct, domain: [0, 1], desc: "" },
    { id: "schools", label: "Schools visited", short: "Schools", fmt: (x) => (x == null ? "–" : fmtInt(x)), domain: [0, 250], desc: "" },
    { id: "visits", label: "Observations", short: "Visits", fmt: (x) => fmtInt(x), domain: [0, 550], desc: "" },
  ];
  const M = Object.fromEntries(METRICS.map((m) => [m.id, m]));

  let DATA;
  async function load() {
    if (DATA) return DATA;
    const data = await fetch("data.json").then((r) => r.json());
    data.TYPES = Object.fromEntries(data.meta.types.map((t) => [t.id, t]));
    data.byId = new Map(data.arps.map((d) => [d.id, d]));
    data.typed = data.arps.filter((d) => d.type !== "few");
    data.arps.forEach((d) => (d.badges = data.meta.badges.filter((b) => d[b.metric] != null && (b.op === ">=" ? d[b.metric] >= b.value : d[b.metric] < b.value))));
    data.itemMedian = data.meta.items.map((_, i) => d3.median(data.typed, (d) => d.items[i]));
    const d0 = d3.timeParse("%Y-%m-%d");
    data.range = `${d3.timeFormat("%B %Y")(d0(data.meta.dateFrom))} to ${d3.timeFormat("%B %Y")(d0(data.meta.dateTo))}`;
    DATA = data;
    reveal();
    document.querySelectorAll("[data-bind=generated]").forEach((el) => (el.textContent = d3.timeFormat("%d %b %Y")(new Date(data.meta.generatedAt))));
    return data;
  }

  // Highlighter marks sweep in and .rise elements lift in as they reach the screen.
  function reveal() {
    // Reveal on entry, and also anything a jump scrolled past.
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting || e.boundingClientRect.top < 0) { e.target.classList.add(e.target.matches("mark,.mark") ? "on" : "in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -12% 0px" });
    document.querySelectorAll("mark, .mark, .rise").forEach((el) => io.observe(el));
  }

  // ---- tooltip ----
  let tip;
  function showTip(ev, html) {
    tip = tip || document.getElementById("tip");
    tip.innerHTML = html;
    const w = tip.offsetWidth || 260, h = tip.offsetHeight || 100;
    tip.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - w - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(ev.clientY + 14, innerHeight - h - 8)) + "px";
    tip.style.opacity = 1;
  }
  function hideTip() { if (tip) tip.style.opacity = 0; }
  const chip = (t) => `<span class="chip" style="--c:${COLOR[t]}">${DATA.TYPES[t].label}</span>`;
  const arpTip = (d, extra = "") => `<b>${d.name}</b><span class="m">${d.block}, ${d.district}</span><br>${chip(d.type)}<br>` +
    `Variety ${M.variety.fmt(d.variety)} · in-between ${pct(d.partial)}${extra}<br><span class="m">click for the profile</span>`;

  // ---- compare list (kept in the URL hash on the explore page, and in this browser) ----
  const CK = "arpstudy-compare";
  function getCompare() { try { return JSON.parse(localStorage.getItem(CK) || "[]"); } catch (e) { return []; } }
  function setCompare(list) { try { localStorage.setItem(CK, JSON.stringify(list.slice(0, 4))); } catch (e) { /* storage blocked */ } document.dispatchEvent(new CustomEvent("comparechange")); }

  // ---- profile ----
  const rank = (k, v) => { if (v == null) return null; const vals = DATA.typed.map((d) => d[k]).filter((x) => x != null); return Math.round(100 * d3.mean(vals, (x) => (x <= v ? 1 : 0))); };
  function openProfile(d) {
    if (!d) return;
    hideTip();
    const dlg = document.getElementById("pf");
    const first = d.name.split(" ")[0];
    const st = (k) => { const m = M[k], p = rank(k, d[k]); return `<div class="stat"><b class="num">${m.fmt(d[k])}</b><span>${m.label}</span>${p == null ? "" : `<em>higher than ${p}% of ARPs</em>`}</div>`; };
    const inCmp = getCompare().includes(d.id);
    dlg.innerHTML = `<div class="pf">
      <header><div><h3 id="pfname">${d.name}</h3><div class="where">${d.block} block, ${d.district} · ${d.months} months · ${fmtInt(d.visits)} observations (${fmtInt(d.flnForms || 0)} Grade 1–3 FLN)</div></div>
      <button class="close" aria-label="Close">×</button></header>
      <p class="verdict">${chip(d.type)} &nbsp;${DATA.TYPES[d.type].rule}.</p>
      ${d.type === "few" ? `<p class="note">With this little data, treat the numbers as unreliable.</p>` : ""}
      <div>${d.badges.map((b) => `<span class="badge">${b.label}</span>`).join("")}</div>
      <h4>How ${first} fills in the form</h4>
      <div class="stats">${["variety", "flnLean", "flnAllYes", "partial", "contradictions", "noPlan", "gAllYes", "allPresent", "factFlip", "enrSame"].map(st).join("")}</div>
      <h4>Item by item: share marked as seen (dot) against the median ARP (line)</h4>
      <svg class="chart" id="pfitems"></svg>
      <h4>What and how much ${first} observes</h4>
      <div class="stats">${["visitsPerMonth", "targetShare", "schools", "teacherRepeat", "hindiShare", "grade1Share", "minutes"].map(st).join("")}</div>
      <h4>Observations per month</h4><svg class="chart" id="spv" height="120"></svg>
      <h4>Share of FLN forms with every top answer, by month</h4><svg class="chart" id="spa" height="120"></svg>
      <div class="actions">
        <button class="btn" id="pfcmp">${inCmp ? "Remove from comparison" : "Add to comparison"}</button>
        <a href="explore.html#compare">Open the comparison</a>
        <span class="note">Link to this profile: <a href="#arp=${d.id}">#arp=${d.id}</a></span>
      </div>
      <p class="note">This describes how the forms were filled in. It doesn't measure coaching quality or student learning.</p>
    </div>`;
    dlg.querySelector(".close").onclick = () => dlg.close();
    dlg.querySelector("#pfcmp").onclick = () => {
      const list = getCompare(), i = list.indexOf(d.id);
      if (i >= 0) list.splice(i, 1); else list.unshift(d.id);
      setCompare(list); openProfile(d);
    };
    if (!dlg.open) dlg.showModal();
    history.replaceState(null, "", location.pathname + location.search + "#arp=" + d.id);
    itemDots(d3.select("#pfitems"), [d]);
    spark(d);
  }

  // Item dot plot: one row per item, a dot per ARP, a tick for the median ARP.
  function itemDots(svg, arps, opts = {}) {
    svg.selectAll("*").remove();
    const items = DATA.meta.items, groups = { fln: "Grade 1–3 FLN", g: "Grade 4–8", school: "School" };
    const w = svg.node().getBoundingClientRect().width || 600, rowH = 19, gapH = 26;
    const labW = Math.min(w * 0.48, 290), m = { l: labW, r: 14 };
    const x = d3.scaleLinear().domain([0, 1]).range([m.l, w - m.r]);
    let y = 22; const pos = [];
    let lastG = null;
    items.forEach((it, i) => { if (it.group !== lastG) { y += lastG ? gapH : 0; pos.push({ head: groups[it.group], y }); y += 18; lastG = it.group; } pos.push({ i, y }); y += rowH; });
    svg.attr("height", y + 26);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y + 4})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")).tickSizeOuter(0));
    x.ticks(5).forEach((t) => svg.append("line").attr("class", "gridline").attr("x1", x(t)).attr("x2", x(t)).attr("y1", 14).attr("y2", y));
    pos.forEach((p) => {
      if (p.head) { svg.append("text").attr("class", "lbl-strong").attr("x", 0).attr("y", p.y + 4).text(p.head); return; }
      const it = items[p.i];
      const lab = svg.append("text").attr("class", "lbl").attr("x", 0).attr("y", p.y + 4).text(it.label);
      fitText(lab, labW - 8);
      const med = DATA.itemMedian[p.i];
      if (med != null) svg.append("line").attr("x1", x(med)).attr("x2", x(med)).attr("y1", p.y - 6).attr("y2", p.y + 6).attr("stroke", "var(--text)").attr("stroke-width", 2).attr("opacity", 0.55);
      arps.forEach((d, k) => {
        const v = d.items[p.i]; if (v == null) return;
        svg.append("circle").attr("cx", x(v)).attr("cy", p.y + (arps.length > 1 ? (k - (arps.length - 1) / 2) * 3 : 0)).attr("r", 5.5)
          .attr("fill", opts.colors ? opts.colors[k] : COLOR[d.type]).attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
          .on("pointermove", (ev) => showTip(ev, `<b>${d.name}</b>${it.label}: ${pct(v)}<br><span class="m">median ARP ${pct(med)}</span>`)).on("pointerleave", hideTip);
      });
    });
  }
  function fitText(sel, max) {
    const node = sel.node(), full = node.textContent; let t = full;
    while (node.getComputedTextLength() > max && t.length > 4) { t = t.slice(0, -2); node.textContent = t + "…"; }
    if (node.textContent !== full) sel.append("title").text(full);
  }

  function spark(d) {
    const months = d.monthly.map((m) => m[0]);
    const mn = (m) => d3.timeFormat("%b %y")(d3.timeParse("%Y-%m")(m));
    const draw = (id, key, max, fmt, target) => {
      const s = d3.select("#" + id), w = s.node().getBoundingClientRect().width, h = 120, m = { t: 10, r: 8, b: 22, l: 42 };
      const x = d3.scaleBand().domain(months).range([m.l, w - m.r]).padding(0.25), y = d3.scaleLinear().domain([0, max]).range([h - m.b, m.t]);
      s.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickFormat(fmt).tickSizeOuter(0));
      const every = Math.ceil(months.length / (w < 500 ? 4 : 8));
      s.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).tickValues(months.filter((_, i) => i % every === 0)).tickFormat(mn).tickSizeOuter(0));
      const vals = d.monthly.filter((r) => r[key] != null);
      s.selectAll("rect.b").data(vals).join("rect").attr("class", "b").attr("x", (r) => x(r[0])).attr("width", x.bandwidth()).attr("rx", 2)
        .attr("y", h - m.b).attr("height", 0).attr("fill", key === 1 ? "var(--text-2)" : COLOR[d.type])
        .on("pointermove", (ev, r) => showTip(ev, `${mn(r[0])}: ${key === 1 ? r[1] + " observations" : pct(r[2])}`)).on("pointerleave", hideTip)
        .transition().duration(reduce ? 0 : 600).delay((_, i) => i * 20).attr("y", (r) => y(r[key])).attr("height", (r) => y(0) - y(r[key]));
      if (target) {
        s.append("line").attr("class", "ref").attr("x1", m.l).attr("x2", w - m.r).attr("y1", y(target)).attr("y2", y(target));
        s.append("text").attr("class", "lbl").attr("x", w - m.r).attr("y", y(target) - 4).attr("text-anchor", "end").text("target 30");
      }
    };
    draw("spv", 1, Math.max(32, d3.max(d.monthly, (r) => r[1]) || 0), d3.format("d"), 30);
    draw("spa", 2, 1, d3.format(".0%"));
  }

  function wireProfile() {
    const dlg = document.getElementById("pf");
    dlg.addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search + (location.hash.startsWith("#arp=") ? "" : location.hash)));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    const fromHash = () => { const m = location.hash.match(/^#arp=(.+)$/); if (m) openProfile(DATA.byId.get(decodeURIComponent(m[1]))); };
    addEventListener("hashchange", fromHash); fromHash();
  }

  // Legend of styles, as HTML.
  const legend = () => STYLE_ORDER.map((t) => chip(t)).join(" &nbsp; ");
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

  return { STYLE_ORDER, COLOR, HEX, PAL, reveal, METRICS, M, fmtInt, pct, pts, reduce, load, showTip, hideTip, chip, arpTip, openProfile, wireProfile, itemDots, fitText, getCompare, setCompare, legend, debounce };
})();
