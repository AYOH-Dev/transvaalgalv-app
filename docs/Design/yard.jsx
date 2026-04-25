// ════════════════════════════════════════════════════════════════════════════
// YARD VIEW — full-screen, glove-friendly receiving flow.
//
// Three sub-screens:
//   1. Loads list      — planned arrivals queued from DocuWare
//   2. Load detail     — header + line list with progress, big "Walk lines" CTA
//   3. Walkthrough     — one line at a time, full-screen, big buttons
//
// Honors the receipting rules from frontend/src/pages/Receipts.tsx:
//   - item_type / process / packaging required to mark received
//   - quantity_discrepancy "short" requires received < expected
//   - quantity_discrepancy "over"  requires received > expected
//   - process options disabled per item_type (galvanised disables galvanising etc.)
// ════════════════════════════════════════════════════════════════════════════

const PROCESS_OPTIONS_YARD = [
  { value: "galvanising",                          label: "Galvanising" },
  { value: "double_dip",                           label: "Double-Dip" },
  { value: "galvanising_paint",                    label: "Galvanising & Paint" },
  { value: "strip_only",                           label: "Strip Only" },
  { value: "strip_regalvanise",                    label: "Strip & Regalvanise" },
  { value: "strip_galvanising_paint",              label: "Strip, Galv & Paint" },
  { value: "shotblast_only",                       label: "Shotblast Only" },
  { value: "shotblast_galvanising",                label: "Shotblast & Galv" },
  { value: "shotblast_strip_regalvanising",        label: "Shotblast, Strip & Regalv" },
  { value: "doesnt_fit_bath",                      label: "Doesn't fit in bath" },
  { value: "outsourcing_required",                 label: "Outsourcing required" },
  { value: "not_suitable",                         label: "Not suitable" },
  { value: "unsafe",                               label: "Unsafe — did not offload" },
];

const DISABLED_PROC = {
  galvanised: ["galvanising", "galvanising_paint", "shotblast_galvanising"],
  blacksteel: ["strip_only", "strip_regalvanise", "strip_galvanising_paint", "shotblast_strip_regalvanising"],
};

// Defect categories — compressed for the yard. Each becomes one swipe step.
const YARD_DEFECTS = [
  { key: "damaged",       label: "Damage",          opts: ["None","Dented","Bent","Crack","Deep scratch","Multiple"] },
  { key: "rust",          label: "Rust",            opts: ["Normal","Porosity","Irreparable"] },
  { key: "paint",         label: "Paint",           opts: ["None","Some","A lot"] },
  { key: "oilGreaseDiesel", label: "Oil / grease / diesel", opts: ["None","Some","A lot"] },
  { key: "weldingFlux",   label: "Welding flux",    opts: ["No","Yes"] },
  { key: "weldingSplatter", label: "Weld / cut splatter", opts: ["No","Yes"] },
  { key: "burr",          label: "Burr",            opts: ["None","Some","A lot"] },
  { key: "sharpEdges",    label: "Sharp edges",     opts: ["No","Yes"] },
  { key: "holesInadequate", label: "Holes inadequate", opts: ["No","Yes"] },
  { key: "threadedArticle", label: "Threaded article", opts: ["No","Yes"] },
];

function defaultsFor() {
  const o = {};
  YARD_DEFECTS.forEach(d => o[d.key] = d.opts[0]);
  return o;
}
function hasAnyYardDefect(d) {
  return YARD_DEFECTS.some(def => (d[def.key] ?? def.opts[0]) !== def.opts[0]);
}

// ════════════════════════════════════════════════════════════════════════════
// ROOT YARD VIEW — orchestrates list / detail / walkthrough
// ════════════════════════════════════════════════════════════════════════════
function YardView({ pods, online, queueCount, onIssueGRN }) {
  const [view, setView] = React.useState("list"); // list | detail | walk
  const [activeId, setActiveId] = React.useState(null);
  // Per-line yard state, keyed by lineId. Lives at root so walkthrough/detail share it.
  const [lineState, setLineState] = React.useState({});

  const active = pods.find(p => p.id === activeId);

  const updateLine = React.useCallback((lineId, patch) => {
    setLineState(s => ({ ...s, [lineId]: { ...s[lineId], ...patch } }));
  }, []);

  if (view === "walk" && active) {
    return <YardWalkthrough
      pod={active}
      lineState={lineState}
      updateLine={updateLine}
      onExit={() => setView("detail")}
      onComplete={() => setView("detail")}
    />;
  }

  return (
    <div className="yard-shell">
      <YardTopbar online={online} queueCount={queueCount}/>
      {view === "list" && (
        <YardLoadsList
          pods={pods}
          lineState={lineState}
          onOpen={(id) => { setActiveId(id); setView("detail"); }}
        />
      )}
      {view === "detail" && active && (
        <YardLoadDetail
          pod={active}
          lineState={lineState}
          onBack={() => setView("list")}
          onWalk={() => setView("walk")}
          onIssueGRN={() => onIssueGRN(active)}
          updateLine={updateLine}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TOPBAR — connection + queue
// ════════════════════════════════════════════════════════════════════════════
function YardTopbar({ online, queueCount }) {
  return (
    <div className="yard-topbar">
      <div className="yard-topbar__brand">
        <div className="yard-topbar__logo">TG</div>
        <div>
          <div className="yard-topbar__title">Yard Receiving</div>
          <div className="yard-topbar__sub">Transvaal Galvanisers · Nigel</div>
        </div>
      </div>
      <div className={"yard-conn " + (online ? "yard-conn--online" : "yard-conn--offline")}>
        <span className="yard-conn__dot"/>
        {online ? "Online" : "Offline"}
        {queueCount > 0 && <span className="yard-conn__queue">{queueCount} queued</span>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOADS LIST — planned arrivals
// ════════════════════════════════════════════════════════════════════════════
function YardLoadsList({ pods, lineState, onOpen }) {
  const [filter, setFilter] = React.useState("today"); // today | all | done

  const enriched = pods.map(p => {
    const total = p.lines.length;
    const done = p.lines.filter(l => {
      const ls = lineState[l.id];
      return ls && ls.received;
    }).length;
    const flagged = p.lines.filter(l => {
      const ls = lineState[l.id];
      return ls && (ls.discrepancy && ls.discrepancy !== "none" || ls.hasDefects);
    }).length;
    return { ...p, _total: total, _done: done, _flagged: flagged, _complete: done === total && total > 0 };
  });

  const visible = enriched.filter(p => {
    if (filter === "done") return p._complete || p.grn_number;
    if (filter === "today") return !p.grn_number;
    return true;
  });

  return (
    <div className="yard-page">
      <div className="yard-page__header">
        <div>
          <h1 className="yard-h1">Today's loads</h1>
          <p className="yard-sub">Pick a load to receive</p>
        </div>
      </div>

      <div className="yard-tabs" role="tablist">
        <button className={"yard-tab " + (filter === "today" ? "yard-tab--active" : "")} onClick={() => setFilter("today")}>
          Open <span className="yard-tab__count">{enriched.filter(p => !p.grn_number).length}</span>
        </button>
        <button className={"yard-tab " + (filter === "done" ? "yard-tab--active" : "")} onClick={() => setFilter("done")}>
          Done <span className="yard-tab__count">{enriched.filter(p => p._complete || p.grn_number).length}</span>
        </button>
        <button className={"yard-tab " + (filter === "all" ? "yard-tab--active" : "")} onClick={() => setFilter("all")}>All</button>
      </div>

      <div className="yard-loads">
        {visible.map(p => (
          <button key={p.id} className="yard-load-card" onClick={() => onOpen(p.id)}>
            <div className="yard-load-card__left">
              <div className="yard-load-card__plate">
                <Icon name="truck" size={24}/>
              </div>
            </div>
            <div className="yard-load-card__main">
              <div className="yard-load-card__row">
                <div className="yard-load-card__num">{p.delivery_note_number}</div>
                {p.grn_number && <span className="yard-pill yard-pill--success">GRN issued</span>}
                {p._complete && !p.grn_number && <span className="yard-pill yard-pill--ready">Ready for GRN</span>}
                {!p._complete && p._done > 0 && <span className="yard-pill yard-pill--progress">In progress</span>}
              </div>
              <div className="yard-load-card__customer">{p.customer_name}</div>
              <div className="yard-load-card__meta">
                <span><Icon name="truck" size={14}/> {p.vehicle_registration}</span>
                <span>·</span>
                <span>{p.lines.length} line{p.lines.length !== 1 ? "s" : ""}</span>
                {p._flagged > 0 && <><span>·</span><span style={{ color: "var(--yard-amber)" }}><Icon name="flag" size={14}/> {p._flagged} flagged</span></>}
              </div>
            </div>
            <div className="yard-load-card__right">
              {p._done > 0 && (
                <div className="yard-progress-ring" style={{ "--p": Math.round((p._done/p._total)*100) }}>
                  <div className="yard-progress-ring__inner">{p._done}/{p._total}</div>
                </div>
              )}
              <Icon name="chevR" size={28}/>
            </div>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="yard-empty">
            <div className="yard-empty__title">Nothing in this view</div>
            <div className="yard-empty__sub">Try a different tab</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOAD DETAIL — header + line list + progress
// ════════════════════════════════════════════════════════════════════════════
function YardLoadDetail({ pod, lineState, onBack, onWalk, onIssueGRN, updateLine }) {
  const total = pod.lines.length;
  const done = pod.lines.filter(l => lineState[l.id]?.received).length;
  const flagged = pod.lines.filter(l => {
    const ls = lineState[l.id];
    return ls && ((ls.discrepancy && ls.discrepancy !== "none") || ls.hasDefects);
  }).length;
  const allDone = done === total && total > 0;
  const firstUndoneIdx = pod.lines.findIndex(l => !lineState[l.id]?.received);

  return (
    <div className="yard-page yard-detail">
      <div className="yard-detail__topbar">
        <button className="yard-back" onClick={onBack}>
          <Icon name="chevL" size={28}/> Loads
        </button>
        <span className="yard-detail__num">{pod.delivery_note_number}</span>
      </div>

      <div className="yard-detail__hero">
        <div className="yard-detail__hero-left">
          <div className="yard-detail__customer">{pod.customer_name}</div>
          <div className="yard-detail__meta">
            <div><span className="k">PO</span><span className="v mono">{pod.purchase_order_number}</span></div>
            <div><span className="k">Vehicle</span><span className="v mono">{pod.vehicle_registration}</span></div>
            {pod.weighbridge_ticket_number && <div><span className="k">WB</span><span className="v mono">{pod.weighbridge_ticket_number}</span></div>}
            <div><span className="k">Lines</span><span className="v">{total}</span></div>
          </div>
        </div>
        <div className="yard-detail__hero-right">
          <div className="yard-bigring" style={{ "--p": Math.round((done/Math.max(total,1))*100) }}>
            <div className="yard-bigring__inner">
              <div className="yard-bigring__num">{done}<span>/{total}</span></div>
              <div className="yard-bigring__lbl">Received</div>
            </div>
          </div>
          {flagged > 0 && <div className="yard-detail__flagged"><Icon name="flag" size={16}/> {flagged} flagged</div>}
        </div>
      </div>

      <div className="yard-detail__cta">
        {!allDone && !pod.grn_number && (
          <button className="yard-btn-primary yard-btn-xl" onClick={onWalk}>
            <Icon name="play" size={22}/>
            {firstUndoneIdx > 0 ? "Resume walkthrough" : "Start walkthrough"}
            <span className="yard-btn-xl__sub">{total - done} line{total-done !== 1 ? "s" : ""} to check</span>
          </button>
        )}
        {allDone && !pod.grn_number && (
          <button className="yard-btn-success yard-btn-xl" onClick={onIssueGRN}>
            <Icon name="check" size={22}/>
            Issue GRN
            <span className="yard-btn-xl__sub">All lines reconciled</span>
          </button>
        )}
        {pod.grn_number && (
          <button className="yard-btn-ghost yard-btn-xl" onClick={onIssueGRN}>
            <Icon name="doc" size={22}/>
            View GRN <span className="mono">{pod.grn_number}</span>
          </button>
        )}
      </div>

      <div className="yard-detail__list-header">
        <span>Line items</span>
        <button className="yard-link" onClick={onWalk}>Open in walkthrough →</button>
      </div>
      <div className="yard-detail__lines">
        {pod.lines.map((l, idx) => (
          <YardLineSummary
            key={l.id}
            line={l}
            idx={idx}
            state={lineState[l.id] || {}}
          />
        ))}
      </div>
    </div>
  );
}

function YardLineSummary({ line, idx, state }) {
  const received = state.received;
  const flagged = (state.discrepancy && state.discrepancy !== "none") || state.hasDefects;
  const cls = received ? (flagged ? "yard-line--flagged" : "yard-line--ok") : "yard-line--pending";
  return (
    <div className={"yard-line " + cls}>
      <div className="yard-line__num">{String(idx+1).padStart(2,"0")}</div>
      <div className="yard-line__main">
        <div className="yard-line__desc">{line.description}</div>
        <div className="yard-line__sub">
          <span className="mono">{line.item_code}</span>
          <span> · {line.expected_quantity} {line.unit_of_measure} expected</span>
        </div>
      </div>
      <div className="yard-line__status">
        {!received && <span className="yard-pill yard-pill--neutral">Pending</span>}
        {received && !flagged && <span className="yard-pill yard-pill--success"><Icon name="check" size={12}/> Received</span>}
        {received && flagged && <span className="yard-pill yard-pill--warn"><Icon name="flag" size={12}/> Flagged</span>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WALKTHROUGH — full-screen, one line at a time
// ════════════════════════════════════════════════════════════════════════════
function YardWalkthrough({ pod, lineState, updateLine, onExit, onComplete }) {
  // Start at the first un-received line
  const firstUndone = pod.lines.findIndex(l => !lineState[l.id]?.received);
  const [idx, setIdx] = React.useState(firstUndone === -1 ? 0 : firstUndone);
  const [step, setStep] = React.useState("qty"); // qty | type | process | packaging | defects | review

  const line = pod.lines[idx];
  const state = lineState[line.id] || {};
  const total = pod.lines.length;

  const set = React.useCallback((patch) => updateLine(line.id, patch), [line.id, updateLine]);

  // Step ordering: qty → discrepancy → item type → process → packaging → defects → review
  const STEPS = ["qty", "type", "process", "packaging", "defects", "review"];
  const stepIdx = STEPS.indexOf(step);

  const goNext = () => {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]);
  };
  const goPrev = () => {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1]);
    else if (idx > 0) { setIdx(idx - 1); setStep("review"); }
    else onExit();
  };

  const markReceived = () => {
    set({ received: true });
    if (idx < total - 1) {
      setIdx(idx + 1);
      setStep("qty");
    } else {
      onComplete();
    }
  };

  return (
    <div className="yard-walk">
      <div className="yard-walk__topbar">
        <button className="yard-walk__close" onClick={onExit}>
          <Icon name="close" size={24}/>
        </button>
        <div className="yard-walk__breadcrumb">
          <div className="yard-walk__delivery">{pod.delivery_note_number} · {pod.customer_name}</div>
          <div className="yard-walk__progress">
            Line <strong>{idx+1}</strong> of <strong>{total}</strong>
          </div>
        </div>
        <div className="yard-walk__steps">
          {STEPS.slice(0,5).map((s, i) => (
            <span key={s} className={"yard-walk__dot " + (i < stepIdx ? "done" : i === stepIdx ? "now" : "")}/>
          ))}
        </div>
      </div>

      {/* Line context — always visible at top */}
      <div className="yard-walk__line-card">
        <div className="yard-walk__line-num">{String(idx+1).padStart(2,"0")}</div>
        <div className="yard-walk__line-info">
          <div className="yard-walk__line-desc">{line.description}</div>
          <div className="yard-walk__line-meta">
            <span className="mono">{line.item_code}</span>
            {line.material_size && <span> · {line.material_size}</span>}
            {line.weight && <span> · {line.weight} kg/u</span>}
          </div>
        </div>
        <div className="yard-walk__line-expected">
          <div className="k">Expected</div>
          <div className="v mono">{line.expected_quantity}</div>
          <div className="u">{line.unit_of_measure}</div>
        </div>
      </div>

      {/* Step body */}
      <div className="yard-walk__body">
        {step === "qty"      && <StepQuantity  line={line} state={state} set={set}/>}
        {step === "type"     && <StepItemType  line={line} state={state} set={set}/>}
        {step === "process"  && <StepProcess   line={line} state={state} set={set}/>}
        {step === "packaging" && <StepPackaging line={line} state={state} set={set}/>}
        {step === "defects"  && <StepDefects   line={line} state={state} set={set}/>}
        {step === "review"   && <StepReview    line={line} state={state} set={set} idx={idx} total={total}/>}
      </div>

      {/* Bottom action bar — thumb-reach */}
      <div className="yard-walk__footer">
        <button className="yard-btn-ghost yard-btn-lg" onClick={goPrev}>
          <Icon name="chevL" size={22}/> Back
        </button>
        {step !== "review" ? (
          <button
            className="yard-btn-primary yard-btn-lg yard-btn-flex"
            onClick={goNext}
            disabled={!canAdvance(step, state)}
          >
            Next <Icon name="chevR" size={22}/>
          </button>
        ) : (
          <button className="yard-btn-success yard-btn-lg yard-btn-flex" onClick={markReceived}>
            <Icon name="check" size={22}/> {idx === total - 1 ? "Finish load" : "Confirm & next line"}
          </button>
        )}
      </div>
    </div>
  );
}

function canAdvance(step, state) {
  if (step === "qty") return state.received_quantity != null && state.discrepancy;
  if (step === "type") return !!state.item_type;
  if (step === "process") return !!state.process;
  if (step === "packaging") return !!state.packaging;
  if (step === "defects") return state.defects_done === true;
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 1 — Quantity & discrepancy
// ────────────────────────────────────────────────────────────────────────────
function StepQuantity({ line, state, set }) {
  const expected = line.expected_quantity;
  const received = state.received_quantity ?? expected;
  const discrepancy = state.discrepancy;

  const setQty = (q) => {
    const clean = Math.max(0, q);
    let auto = "none";
    if (clean < expected) auto = "short";
    else if (clean > expected) auto = "over";
    set({ received_quantity: clean, discrepancy: auto });
  };

  return (
    <div className="walk-step">
      <h2 className="walk-step__title">How many did you receive?</h2>
      <p className="walk-step__sub">Expected <strong>{expected} {line.unit_of_measure}</strong></p>

      <div className="big-counter">
        <button className="big-counter__btn" onClick={() => setQty(received - 1)} aria-label="Decrease">
          <Icon name="minus" size={36}/>
        </button>
        <div className="big-counter__display">
          <input
            type="number"
            value={received}
            onChange={e => setQty(parseInt(e.target.value) || 0)}
            inputMode="numeric"
            aria-label="Received quantity"
          />
          <span className="big-counter__unit">{line.unit_of_measure}</span>
        </div>
        <button className="big-counter__btn" onClick={() => setQty(received + 1)} aria-label="Increase">
          <Icon name="plus" size={36}/>
        </button>
      </div>

      <div className="qty-shortcuts">
        <button className="qty-chip" onClick={() => setQty(expected)}>= Expected</button>
        <button className="qty-chip" onClick={() => setQty(expected - 1)}>−1</button>
        <button className="qty-chip" onClick={() => setQty(expected - 5)}>−5</button>
        <button className="qty-chip" onClick={() => setQty(expected + 1)}>+1</button>
      </div>

      <div className="discrepancy-banner" data-disc={discrepancy}>
        {discrepancy === "none"  && <><Icon name="check" size={20}/> Matches the delivery note</>}
        {discrepancy === "short" && <><Icon name="alert" size={20}/> Short {expected - received} {line.unit_of_measure}</>}
        {discrepancy === "over"  && <><Icon name="alert" size={20}/> Over {received - expected} {line.unit_of_measure}</>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — Item type (radio cards)
// ────────────────────────────────────────────────────────────────────────────
function StepItemType({ line, state, set }) {
  const value = state.item_type;
  const opts = [
    { v: "blacksteel", l: "Black Steel", d: "Untreated steel for galvanising" },
    { v: "galvanised", l: "Galvanised",  d: "Already galvanised — strip / regalv" },
    { v: "other",      l: "Other",       d: "Specify in notes" },
  ];
  return (
    <div className="walk-step">
      <h2 className="walk-step__title">What kind of material?</h2>
      <p className="walk-step__sub">This drives which processes are available</p>
      <div className="big-radio">
        {opts.map(o => (
          <button
            key={o.v}
            className={"big-radio__opt " + (value === o.v ? "big-radio__opt--on" : "")}
            onClick={() => {
              // If current process is now disabled by the new item type, clear it
              const disabled = DISABLED_PROC[o.v] || [];
              const patch = { item_type: o.v };
              if (state.process && disabled.includes(state.process)) patch.process = null;
              set(patch);
            }}
          >
            <div className="big-radio__check">{value === o.v && <Icon name="check" size={22}/>}</div>
            <div>
              <div className="big-radio__label">{o.l}</div>
              <div className="big-radio__desc">{o.d}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3 — Process (filtered by item type)
// ────────────────────────────────────────────────────────────────────────────
function StepProcess({ line, state, set }) {
  const value = state.process;
  const itemType = state.item_type;
  const disabled = DISABLED_PROC[itemType] || [];
  const opts = PROCESS_OPTIONS_YARD.filter(o => !disabled.includes(o.value));

  return (
    <div className="walk-step">
      <h2 className="walk-step__title">Which process?</h2>
      <p className="walk-step__sub">{opts.length} options available for {itemType}</p>
      <div className="proc-grid">
        {opts.map(o => (
          <button
            key={o.value}
            className={"proc-chip " + (value === o.value ? "proc-chip--on" : "")}
            onClick={() => set({ process: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 4 — Packaging
// ────────────────────────────────────────────────────────────────────────────
function StepPackaging({ line, state, set }) {
  const value = state.packaging;
  const opts = [
    { v: "pallet", l: "Pallet" },
    { v: "crate",  l: "Crate" },
    { v: "bundle", l: "Bundle" },
    { v: "loose",  l: "Loose" },
    { v: "bin",    l: "Bin" },
    { v: "other",  l: "Other" },
  ];
  return (
    <div className="walk-step">
      <h2 className="walk-step__title">How is it packaged?</h2>
      <div className="big-grid">
        {opts.map(o => (
          <button key={o.v}
                  className={"big-grid__cell " + (value === o.v ? "big-grid__cell--on" : "")}
                  onClick={() => set({ packaging: o.v })}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 5 — Defects (compressed yard version)
// ────────────────────────────────────────────────────────────────────────────
function StepDefects({ line, state, set }) {
  const defects = state.defects || defaultsFor();
  const setDefect = (key, val) => {
    const newDef = { ...defects, [key]: val };
    set({ defects: newDef, hasDefects: hasAnyYardDefect(newDef), defects_done: true });
  };
  const skipAll = () => {
    set({ defects: defaultsFor(), hasDefects: false, defects_done: true });
  };

  return (
    <div className="walk-step">
      <h2 className="walk-step__title">Any defects?</h2>
      <p className="walk-step__sub">Tap a row that doesn't match — leave the rest</p>

      <button className="walk-skip-all" onClick={skipAll}>
        <Icon name="check" size={18}/> All clean — no defects
      </button>

      <div className="defect-list">
        {YARD_DEFECTS.map(d => {
          const val = defects[d.key] ?? d.opts[0];
          const flagged = val !== d.opts[0];
          return (
            <div key={d.key} className={"defect-row " + (flagged ? "defect-row--on" : "")}>
              <div className="defect-row__label">{d.label}</div>
              <div className="defect-row__opts">
                {d.opts.map(o => (
                  <button key={o}
                          className={"defect-pill " + (val === o ? "defect-pill--on" : "")}
                          onClick={() => setDefect(d.key, o)}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 6 — Review before confirming
// ────────────────────────────────────────────────────────────────────────────
function StepReview({ line, state, idx, total }) {
  const flagged = (state.discrepancy && state.discrepancy !== "none") || state.hasDefects;
  const flaggedDefects = YARD_DEFECTS.filter(d => state.defects && state.defects[d.key] !== d.opts[0]);

  return (
    <div className="walk-step">
      <h2 className="walk-step__title">Review line {idx+1}</h2>
      <p className="walk-step__sub">Confirm before moving on{idx < total-1 ? " to the next line" : ""}</p>

      <div className="review-card">
        <div className="review-row">
          <span className="k">Received</span>
          <span className="v mono">{state.received_quantity} / {line.expected_quantity} {line.unit_of_measure}</span>
        </div>
        <div className="review-row">
          <span className="k">Status</span>
          <span className="v">
            {state.discrepancy === "none" && <span className="yard-pill yard-pill--success">Match</span>}
            {state.discrepancy === "short" && <span className="yard-pill yard-pill--danger">Short {line.expected_quantity - state.received_quantity}</span>}
            {state.discrepancy === "over"  && <span className="yard-pill yard-pill--warn">Over {state.received_quantity - line.expected_quantity}</span>}
          </span>
        </div>
        <div className="review-row"><span className="k">Material</span><span className="v">{state.item_type}</span></div>
        <div className="review-row"><span className="k">Process</span><span className="v">{(PROCESS_OPTIONS_YARD.find(p => p.value === state.process) || {}).label}</span></div>
        <div className="review-row"><span className="k">Packaging</span><span className="v">{state.packaging}</span></div>
        <div className="review-row review-row--col">
          <span className="k">Defects</span>
          {flaggedDefects.length === 0 ? (
            <span className="yard-pill yard-pill--success" style={{ alignSelf: "flex-start" }}><Icon name="check" size={12}/> None</span>
          ) : (
            <div className="review-defects">
              {flaggedDefects.map(d => (
                <span key={d.key} className="yard-pill yard-pill--warn">
                  {d.label}: {state.defects[d.key]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {flagged && (
        <div className="review-warn">
          <Icon name="alert" size={18}/>
          This line will be flagged on the GRN
        </div>
      )}
    </div>
  );
}

Object.assign(window, { YardView });
