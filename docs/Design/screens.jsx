// ════════════════════════════════════════════════════════════════════════════
// RECEIPTS — matches the live app's list+expand pattern, with a new "Issue GRN"
// action appearing in the footer once the receipt is ready.
// ════════════════════════════════════════════════════════════════════════════

// Status transitions (copied from frontend/src/pages/Receipts.tsx NEXT_STATUSES)
const NEXT_STATUSES = {
  draft:        ["received"],
  received:     ["matched", "quality_hold"],
  quality_hold: ["received", "matched"],
  matched:      ["archived"],
  archived:     [],
};

// When is a receipt "GRN-able"? matches business logic: header is captured,
// lines have been walked through, any discrepancies flagged.
function canIssueGRN(r) {
  return r.status === "received" || r.status === "matched" || r.status === "quality_hold";
}

function lineSummary(line) {
  const bits = [];
  if (line.material_size) bits.push(line.material_size);
  if (line.material_length && line.material_length !== "—") bits.push((parseInt(line.material_length)/1000).toFixed(1) + " m");
  if (line.weight) bits.push(line.weight + " kg/u");
  return bits.join(" · ");
}

function ReceiptsList({ pods, onIssueGRN, pendingOpenId, onOpened }) {
  const [search, setSearch] = React.useState("");
  const [expandedId, setExpandedId] = React.useState(null);

  React.useEffect(() => {
    if (pendingOpenId) {
      setExpandedId(pendingOpenId);
      onOpened && onOpened();
    }
  }, [pendingOpenId]);

  const q = search.toLowerCase();
  const filtered = q
    ? pods.filter(r =>
        r.receipt_number?.toLowerCase().includes(q) ||
        r.customer_name?.toLowerCase().includes(q) ||
        r.supplier_name?.toLowerCase().includes(q) ||
        r.delivery_note_number?.toLowerCase().includes(q) ||
        r.weighbridge_ticket_number?.toLowerCase().includes(q))
    : pods;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Receipts</h1>
          <p className="page-subtitle">{filtered.length} receipt{filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm"><Icon name="sync" size={15}/> Refresh</button>
        </div>
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <input
          type="search"
          className="search-input"
          placeholder="Search receipt, customer, delivery note…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="receipt-list">
        {filtered.map(r => (
          <ReceiptCard
            key={r.id}
            receipt={r}
            expanded={expandedId === r.id}
            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            onIssueGRN={() => onIssueGRN(r)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <p className="empty-state__title">No matching receipts</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Single receipt card — expandable; mirrors the live app with a GRN slot added.
// ──────────────────────────────────────────────────────────────────────────
function ReceiptCard({ receipt, expanded, onToggle, onIssueGRN }) {
  const [edits, setEdits] = React.useState({});
  const [lineEdits, setLineEdits] = React.useState({});

  const val = (field) => edits[field] ?? receipt[field] ?? "";
  const patch = (field, v) => setEdits(e => ({ ...e, [field]: v }));
  const dirty = Object.keys(edits).length > 0;

  const lineVal = (lineId, field, original) => {
    const e = lineEdits[lineId];
    return e && field in e ? e[field] : original;
  };
  const patchLine = (lineId, field, v) =>
    setLineEdits(le => ({ ...le, [lineId]: { ...le[lineId], [field]: v } }));

  const grnAble = canIssueGRN(receipt);
  const hasGRN = receipt.grn_number != null;

  return (
    <div className={"receipt-card" + (expanded ? " receipt-card--open" : "")}>
      <button className="receipt-card__row" onClick={onToggle}>
        <div className="receipt-card__icon"><Icon name="doc" size={18}/></div>
        <div className="receipt-card__info">
          <span className="receipt-card__num">{receipt.delivery_note_number || receipt.receipt_number}</span>
          <span className="receipt-card__supplier">
            {receipt.customer_name}
            {receipt.weighbridge_ticket_number ? ` · WB ${receipt.weighbridge_ticket_number}` : ""}
          </span>
        </div>
        <div className="receipt-card__right">
          <StatusBadge status={receipt.status}/>
          {hasGRN && (
            <span className="grn-chip" title={"GRN issued — " + receipt.grn_number}>
              <Icon name="check" size={11}/> {receipt.grn_number}
            </span>
          )}
          <span className="receipt-card__date">{fmtDate(receipt.received_at)}</span>
          <Icon name="chevDown" size={18}
                className={"receipt-card__chev" + (expanded ? " receipt-card__chev--open" : "")}/>
        </div>
      </button>

      {expanded && (
        <div className="receipt-card__detail">
          {/* Header fields — editable inline (exact pattern from live app) */}
          <div className="detail-header-grid">
            <EditField label="Customer"        value={val("customer_name")}             onChange={v => patch("customer_name", v)}/>
            <EditField label="Fabricator"      value={val("supplier_name")}             onChange={v => patch("supplier_name", v)}/>
            <EditField label="Delivery Note"   value={val("delivery_note_number")}      onChange={v => patch("delivery_note_number", v)} mono/>
            <EditField label="Order #"         value={val("purchase_order_number")}     onChange={v => patch("purchase_order_number", v)} mono/>
            <EditField label="Weighbridge #"   value={val("weighbridge_ticket_number")} onChange={v => patch("weighbridge_ticket_number", v)} mono/>
            <EditField label="Vehicle Reg"     value={val("vehicle_registration")}      onChange={v => patch("vehicle_registration", v)} mono/>
            <EditField label="Job Number"      value={val("job_number")}                onChange={v => patch("job_number", v)} mono/>
            <div className="edit-field">
              <div className="edit-field__label">Date</div>
              <div className="edit-field__static">{fmtDate(receipt.received_at)}</div>
            </div>
            <div className="edit-field">
              <div className="edit-field__label">Sync</div>
              <div className="edit-field__static" style={{ color: "var(--text-muted)" }}>{receipt.sync_status}</div>
            </div>
          </div>

          <div className="detail-header-actions">
            {receipt.docuware_doc_url && (
              <a className="docuware-link" href="#" onClick={e => e.preventDefault()}>
                <Icon name="external" size={13}/> View in DocuWare
              </a>
            )}
            {dirty && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
                      onClick={() => setEdits({})}>
                Save Details
              </button>
            )}
          </div>

          <div className="detail-rule"/>

          {/* Line items */}
          <div className="lines-section">
            <div className="lines-section__title">
              Line Items ({receipt.lines.length})
            </div>
            <div className="lines-list">
              {receipt.lines.map(l => (
                <LineItem
                  key={l.id}
                  line={l}
                  receiptStatus={receipt.status}
                  lineVal={(f) => lineVal(l.id, f, l[f])}
                  patchLine={(f, v) => patchLine(l.id, f, v)}
                />
              ))}
            </div>
          </div>

          <div className="detail-rule"/>

          {/* Footer — status transitions + GRN integration point */}
          <div className="detail-footer">
            <div className="detail-footer__status">
              <span className="detail-footer__label">Current status</span>
              <StatusBadge status={receipt.status}/>
            </div>

            <div className="detail-footer__actions">
              {/* Existing status-transition buttons (match live app exactly) */}
              {(NEXT_STATUSES[receipt.status] || []).map(ns => (
                <button key={ns}
                        className={"btn btn-sm " + (ns === "matched" ? "btn-success" : ns === "quality_hold" ? "btn-danger" : "btn-ghost")}>
                  <Icon name="arrow" size={13}/> Mark {STATUS_META[ns]?.label}
                </button>
              ))}

              {/* NEW: Issue GRN — the single touchpoint for this feature */}
              {grnAble && !hasGRN && (
                <button className="btn btn-primary btn-sm btn-grn" onClick={onIssueGRN}>
                  <Icon name="doc" size={13}/> Issue GRN
                </button>
              )}
              {hasGRN && (
                <button className="btn btn-ghost btn-sm" onClick={onIssueGRN}>
                  <Icon name="doc" size={13}/> View GRN {receipt.grn_number}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Line item — compact summary + inline expand for qty/defect editing.
// This mirrors the live app's line display (with the existing defect modal
// being opened via the "Capture Defects" button — shown here as a link).
// ──────────────────────────────────────────────────────────────────────────
function LineItem({ line, receiptStatus, lineVal, patchLine }) {
  const [open, setOpen] = React.useState(false);
  const received = lineVal("received_quantity");
  const qtyDisc = lineVal("quantity_discrepancy");
  const condNotes = lineVal("condition_notes");
  const hasDefects = !!condNotes;
  const stateCls =
    hasDefects ? "line--defect" :
    qtyDisc === "short" ? "line--short" :
    qtyDisc === "over"  ? "line--over"  :
    "line--ok";

  return (
    <div className={"line-item " + stateCls}>
      <div className="line-item__head" onClick={() => setOpen(!open)}>
        <div className="line-item__num">{String(line.line_number).padStart(2,"0")}</div>
        <div className="line-item__info">
          <div className="line-item__desc">{line.description}</div>
          <div className="line-item__sub">
            <span className="mono">{line.item_code}</span>
            {lineSummary(line) ? " · " + lineSummary(line) : ""}
          </div>
        </div>
        <div className="line-item__qty">
          <span className="got">{received}</span>
          <span className="exp">/ {line.expected_quantity}</span>
          <span className="unit">{line.unit_of_measure}</span>
        </div>
        <div className="line-item__flags">
          {qtyDisc === "short" && <span className="badge badge-red">Short {line.expected_quantity - received}</span>}
          {qtyDisc === "over"  && <span className="badge badge-amber">Over {received - line.expected_quantity}</span>}
          {hasDefects && <span className="badge badge-amber"><Icon name="flag" size={10}/> Defects</span>}
          {!hasDefects && qtyDisc === "none" && <span className="badge badge-green"><Icon name="check" size={10}/> Clean</span>}
        </div>
        <Icon name="chevDown" size={14}
              className={"line-item__chev" + (open ? " line-item__chev--open" : "")}/>
      </div>

      {open && (
        <div className="line-item__body">
          <div className="line-item__grid">
            <div className="field">
              <label>Received qty</label>
              <div className="qty-stepper">
                <button onClick={() => patchLine("received_quantity", Math.max(0, received - 1))}><Icon name="minus" size={14}/></button>
                <input type="number" value={received} onChange={e => patchLine("received_quantity", parseInt(e.target.value)||0)}/>
                <button onClick={() => patchLine("received_quantity", received + 1)}><Icon name="plus" size={14}/></button>
              </div>
            </div>
            <div className="field">
              <label>Discrepancy</label>
              <select value={qtyDisc} onChange={e => patchLine("quantity_discrepancy", e.target.value)}>
                <option value="none">None</option>
                <option value="short">Short Supplied</option>
                <option value="over">Over Supplied</option>
              </select>
            </div>
            <div className="field">
              <label>Item type</label>
              <select value={lineVal("item_type") || ""} onChange={e => patchLine("item_type", e.target.value)}>
                <option value="">—</option>
                <option value="blacksteel">Black Steel</option>
                <option value="galvanised">Galvanised</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label>Process</label>
              <select value={lineVal("process") || ""} onChange={e => patchLine("process", e.target.value)}>
                <option value="">—</option>
                <option value="galvanising">Galvanising</option>
                <option value="double_dip">Double-Dip</option>
                <option value="strip_regalvanise">Strip &amp; Regalvanise</option>
                <option value="shotblast_galvanising">Shotblast &amp; Galvanising</option>
              </select>
            </div>
          </div>

          <div className="line-item__defects">
            <div className="field" style={{ flex: 1 }}>
              <label>Condition notes</label>
              <div className="condition-notes-display">
                {condNotes || <span style={{ color: "var(--text-muted)" }}>No defects captured</span>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm">
              <Icon name="flag" size={13}/> Capture defects
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — matches live app, with a new "Ready to issue GRN" tile.
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ pods, onOpenReceipt, onIssueGRN }) {
  const counts = pods.reduce((a, p) => { a[p.status] = (a[p.status]||0)+1; return a; },
                             { draft:0, received:0, quality_hold:0, matched:0, archived:0 });
  const readyForGRN = pods.filter(p => canIssueGRN(p) && !p.grn_number);
  const grnIssued = pods.filter(p => p.grn_number);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Operational overview</p>
        </div>
      </div>

      <div className="pipeline-banner">
        <div className="pipeline-phase pipeline-phase--active">
          <div className="pipeline-phase__number">1</div>
          <div><div className="pipeline-phase__name">Receipting</div><div className="pipeline-phase__status" style={{ color: "var(--blue)" }}>Active</div></div>
        </div>
        <div className="pipeline-connector"/>
        <div className="pipeline-phase pipeline-phase--soon"><div className="pipeline-phase__number">2</div><div><div className="pipeline-phase__name">Dispatching</div><div className="pipeline-phase__status">Coming soon</div></div></div>
        <div className="pipeline-connector"/>
        <div className="pipeline-phase pipeline-phase--soon"><div className="pipeline-phase__number">3</div><div><div className="pipeline-phase__name">Processing</div><div className="pipeline-phase__status">Coming soon</div></div></div>
      </div>

      <div style={{ height: 16 }}/>

      <div className="section">
        <div className="section__header"><h2 className="section__title">Receipt status</h2></div>
        <div className="status-grid" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          {Object.entries(counts).map(([k,v]) => (
            <div key={k} className="status-cell">
              <div className="n" style={{ color: k==="quality_hold" ? "var(--amber)" : k==="matched" ? "var(--green)" : k==="received" ? "var(--blue)" : "var(--text-primary)" }}>{v}</div>
              <div className="k">{STATUS_META[k]?.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 16 }}/>

      {/* NEW: Ready-to-GRN queue — dashboard integration */}
      <div className="section grn-ready-section">
        <div className="section__header">
          <div>
            <h2 className="section__title">Ready to issue GRN</h2>
            <p className="section__sub">Receipts that have been walked through and are ready for a goods received note.</p>
          </div>
          <span className="badge badge-blue">{readyForGRN.length} ready</span>
        </div>
        {readyForGRN.length === 0 ? (
          <div style={{ padding: "2rem 1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            No receipts are waiting for a GRN right now.
          </div>
        ) : (
          <div className="grn-ready-list">
            {readyForGRN.map(p => (
              <div key={p.id} className="grn-ready-row">
                <div className="grn-ready-row__icon"><Icon name="doc" size={16}/></div>
                <div className="grn-ready-row__info">
                  <div className="grn-ready-row__num">{p.delivery_note_number || p.receipt_number}</div>
                  <div className="grn-ready-row__sub">{p.customer_name} · {p.lines.length} line{p.lines.length!==1?"s":""}</div>
                </div>
                <StatusBadge status={p.status}/>
                <button className="btn btn-ghost btn-sm" onClick={() => onOpenReceipt(p.id)}>Open</button>
                <button className="btn btn-primary btn-sm" onClick={() => onIssueGRN(p)}>
                  <Icon name="doc" size={13}/> Issue GRN
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 16 }}/>

      <div className="section">
        <div className="section__header">
          <h2 className="section__title">Recently issued GRNs</h2>
          <span className="section__action">View all →</span>
        </div>
        {grnIssued.length === 0 ? (
          <div style={{ padding: "2rem 1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            No GRNs issued yet.
          </div>
        ) : (
          <div>
            {grnIssued.map((p, i) => (
              <div key={p.id} className="grn-history-row" style={{ borderBottom: i<grnIssued.length-1 ? "1px solid var(--border)" : "none" }}>
                <div className="grn-ready-row__icon" style={{ background: "var(--green-dim)", color: "var(--green)" }}><Icon name="check" size={16}/></div>
                <div className="grn-ready-row__info">
                  <div className="grn-ready-row__num">{p.grn_number}</div>
                  <div className="grn-ready-row__sub">{p.customer_name} · against {p.delivery_note_number}</div>
                </div>
                <span className="grn-ready-row__meta">{fmtDate(p.grn_issued_at)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => onIssueGRN(p)}>View</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// GRN MODAL — full-screen overlay with document preview + issue/email/print.
// Reads directly from the captured receipt data.
// ════════════════════════════════════════════════════════════════════════════
function GRNModal({ receipt, onClose }) {
  const [emailOpen, setEmailOpen] = React.useState(false);
  if (!receipt) return null;

  const alreadyIssued = !!receipt.grn_number;
  const grnNumber = receipt.grn_number || ("GRN-" + (receipt.receipt_number || "").replace(/[^0-9]/g, ""));
  const today = new Date();
  const issuedDate = receipt.grn_issued_at ? new Date(receipt.grn_issued_at) : today;
  const dateStr = issuedDate.toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });

  const totals = receipt.lines.reduce((a, l) => {
    a.expected += l.expected_quantity;
    a.received += l.received_quantity;
    a.weight += l.received_quantity * parseFloat(l.weight || 0);
    if (l.quantity_discrepancy === "short") a.short++;
    if (l.quantity_discrepancy === "over") a.over++;
    if (l.condition_notes) a.flagged++;
    return a;
  }, { expected:0, received:0, weight:0, short:0, over:0, flagged:0 });

  const hasNotes = receipt.notes || receipt.lines.some(l => l.condition_notes);
  const lineFlag = (l) => {
    if (l.condition_notes) return ["damage", "Condition"];
    if (l.quantity_discrepancy === "short") return ["short", `Short ${l.expected_quantity - l.received_quantity}`];
    if (l.quantity_discrepancy === "over")  return ["over",  `Over ${l.received_quantity - l.expected_quantity}`];
    return [null, null];
  };

  // Deterministic QR-like pattern
  const qrCells = Array.from({length: 100}, (_, i) => {
    const h = (grnNumber.charCodeAt(i % grnNumber.length) + i * 7) % 5;
    return h < 2;
  });
  [0,1,2,10,11,12,20,21,22,7,8,9,17,18,19,27,28,29,70,71,72,80,81,82,90,91,92].forEach(i => qrCells[i] = (i%3)!==1);

  return (
    <div className="grn-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="grn-modal">
        <div className="grn-modal__header">
          <div>
            <div className="grn-modal__eyebrow">
              {alreadyIssued ? <><Icon name="check" size={13}/> GRN issued {fmtDate(receipt.grn_issued_at)}</>
                             : <>Preview — not yet issued</>}
            </div>
            <h2 className="grn-modal__title">Goods Received Note <span className="mono" style={{ color: "var(--blue)" }}>{grnNumber}</span></h2>
            <p className="grn-modal__sub">Against {receipt.delivery_note_number} — {receipt.customer_name}</p>
          </div>
          <div className="grn-modal__actions">
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="print" size={14}/> Print</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEmailOpen(true)}><Icon name="mail" size={14}/> Email</button>
            {!alreadyIssued && (
              <button className="btn btn-success btn-sm" onClick={onClose}><Icon name="check" size={14}/> Issue GRN</button>
            )}
            <button className="btn-icon" onClick={onClose} aria-label="Close"><Icon name="close" size={18}/></button>
          </div>
        </div>

        <div className="grn-modal__body">
          <div className="grn-doc-wrap">
            <div className="grn-doc">
              <div className="grn-header">
                <div className="grn-header__brand">
                  <div className="grn-logo">TG</div>
                  <div>
                    <div style={{ fontSize: "13pt", fontWeight: 800, letterSpacing: "-0.02em" }}>Transvaal Galvanisers</div>
                    <div className="grn-header__sub">3 3rd Avenue, Voorsterkroon, Nigel 1491 · +27 11 739 6000 · info@transvaalgalv.co.za</div>
                    <div className="grn-header__sub">VAT 4030104541 · Reg M1985/001541/07</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="grn-header__title">Goods Received Note</div>
                  <div className="grn-header__number">{grnNumber}</div>
                  <div className="grn-header__sub">Issued {dateStr}</div>
                  <div className="grn-header__sub">Source POD · {receipt.receipt_number}</div>
                </div>
              </div>

              <div className="grn-meta">
                <div><div className="k">Customer</div><div className="v">{receipt.customer_name}</div></div>
                <div><div className="k">Purchase order</div><div className="v mono">{receipt.purchase_order_number}</div></div>
                <div><div className="k">Delivery note</div><div className="v mono">{receipt.delivery_note_number}</div></div>
                <div><div className="k">Vehicle</div><div className="v mono">{receipt.vehicle_registration}</div></div>
                <div><div className="k">Weighbridge</div><div className="v mono">{receipt.weighbridge_ticket_number || "—"}</div></div>
                <div><div className="k">Received</div><div className="v">{fmtDate(receipt.received_at)}</div></div>
              </div>

              <div>
                <h2>Line items</h2>
                <table className="grn-table">
                  <thead>
                    <tr>
                      <th style={{ width: "22pt" }}>#</th>
                      <th style={{ width: "60pt" }}>Code</th>
                      <th>Description</th>
                      <th className="num" style={{ width: "40pt" }}>Exp</th>
                      <th className="num" style={{ width: "40pt" }}>Rec'd</th>
                      <th className="num" style={{ width: "38pt" }}>Unit</th>
                      <th className="num" style={{ width: "50pt" }}>kg/u</th>
                      <th className="num" style={{ width: "50pt" }}>Line kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.lines.map(l => {
                      const [flagKey, flagLabel] = lineFlag(l);
                      const lineKg = l.received_quantity * parseFloat(l.weight || 0);
                      return (
                        <tr key={l.id} data-flag={flagKey}>
                          <td className="i">{String(l.line_number).padStart(2,"0")}</td>
                          <td className="i" style={{ color: "#475569", fontSize: "8pt" }}>{l.item_code}</td>
                          <td className="desc" data-flag-label={flagLabel}>
                            {l.description}
                            {l.condition_notes && <div className="desc-sub">{l.condition_notes}</div>}
                          </td>
                          <td className="num">{l.expected_quantity}</td>
                          <td className="num q">{l.received_quantity}</td>
                          <td className="num">{l.unit_of_measure}</td>
                          <td className="num">{parseFloat(l.weight || 0).toFixed(2)}</td>
                          <td className="num">{Math.round(lineKg).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grn-totals">
                <span className="k">Total expected units</span><span className="v">{totals.expected.toLocaleString()}</span>
                <span className="k">Total received units</span><span className="v">{totals.received.toLocaleString()}</span>
                <span className="k">Variance</span>
                <span className="v" style={{ color: totals.received === totals.expected ? "#10b981" : totals.received < totals.expected ? "#dc2626" : "#ca8a04" }}>
                  {totals.received - totals.expected > 0 ? "+" : ""}{(totals.received - totals.expected).toLocaleString()}
                </span>
                <div className="div"/>
                <span className="k">Estimated net mass received</span>
                <span className="v lg">{Math.round(totals.weight).toLocaleString()} kg</span>
              </div>

              {hasNotes && (
                <div className="grn-notes">
                  <h2>Receiving notes</h2>
                  {receipt.notes && <div>{receipt.notes}</div>}
                  {receipt.lines.filter(l => l.condition_notes).map(l => (
                    <div key={l.id} style={{ marginTop: 4 }}>
                      <strong>Line {l.line_number} — {l.description}:</strong> {l.condition_notes}
                    </div>
                  ))}
                </div>
              )}

              <div className="grn-sigs">
                <div className="grn-sig">
                  <div className="line"></div>
                  <div className="k">Received by — Transvaal Galvanisers</div>
                  <div style={{ fontSize: "7.5pt", color: "#94a3b8", marginTop: 2 }}>Name, date, signature</div>
                </div>
                <div className="grn-sig">
                  <div className="line"></div>
                  <div className="k">Delivered by — Driver</div>
                  <div style={{ fontSize: "7.5pt", color: "#94a3b8", marginTop: 2 }}>Name, date, signature</div>
                </div>
              </div>

              <div className="grn-qr" title="Scan for digital record">
                {qrCells.map((on, i) => <div key={i} style={{ background: on ? "#0f172a" : "#fff" }}/>)}
              </div>

              <div className="grn-footer">
                This GRN is generated from the signed POD on file in DocuWare. · Page 1 of 1 · {grnNumber}
              </div>
            </div>
          </div>
        </div>
      </div>

      {emailOpen && (
        <div className="grn-modal-overlay" style={{ zIndex: 10000 }} onClick={e => e.target === e.currentTarget && setEmailOpen(false)}>
          <div className="email-modal">
            <div className="email-modal__header">
              <h3>Email GRN to customer</h3>
              <button className="btn-icon" onClick={() => setEmailOpen(false)}><Icon name="close" size={16}/></button>
            </div>
            <div className="email-modal__body">
              <div className="field"><label>To</label><input defaultValue={`receiving@${(receipt.customer_name||"").toLowerCase().split(" ")[0]}.co.za`}/></div>
              <div className="field"><label>Cc</label><input defaultValue="danes@transvaalgalv.co.za"/></div>
              <div className="field"><label>Subject</label><input defaultValue={`GRN ${grnNumber} — ${receipt.purchase_order_number} — ${dateStr}`}/></div>
              <div className="field"><label>Message</label>
                <textarea rows={5} defaultValue={`Hi team,\n\nAttached is the GRN for delivery note ${receipt.delivery_note_number} received ${dateStr}.\n\n${totals.short > 0 || totals.flagged > 0 ? "Please note discrepancies are itemised on the GRN." : "All lines reconciled clean against the POD."}\n\nKind regards,\nTransvaal Galvanisers`}/>
              </div>
              <label style={{ display: "flex", gap: 8, fontSize: "0.8125rem", color: "var(--text-secondary)", alignItems: "center" }}>
                <input type="checkbox" defaultChecked/> Attach {grnNumber}.pdf
              </label>
            </div>
            <div className="email-modal__footer">
              <button className="btn btn-ghost" onClick={() => setEmailOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setEmailOpen(false)}><Icon name="mail" size={14}/> Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Placeholder for Admin / Settings
// ════════════════════════════════════════════════════════════════════════════
function PlaceholderScreen({ title }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">This section is part of the existing app — not the focus of this prototype.</p>
        </div>
      </div>
      <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "3rem" }}>
        Unchanged from the live app.
      </div>
    </div>
  );
}

Object.assign(window, { ReceiptsList, Dashboard, GRNModal, PlaceholderScreen, canIssueGRN });
