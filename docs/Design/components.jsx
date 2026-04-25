// Icons — matches existing app's SVG style (stroke 2, 24×24 viewbox)
const Icon = ({ name, size = 16, className, ...p }) => {
  const paths = {
    dash:      <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    doc:       <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>,
    admin:     <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    settings:  <><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></>,
    logout:    <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    chevL:     <polyline points="15 18 9 12 15 6"/>,
    chevR:     <polyline points="9 18 15 12 9 6"/>,
    chevDown:  <polyline points="6 9 12 15 18 9"/>,
    check:     <polyline points="20 6 9 17 4 12"/>,
    close:     <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    plus:      <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    minus:     <line x1="5" y1="12" x2="19" y2="12"/>,
    search:    <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></>,
    sync:      <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    print:     <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    mail:      <><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></>,
    external:  <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>,
    alert:     <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    flag:      <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>,
    info:      <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
    arrow:     <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    trash:     <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></>,
    edit:      <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></>,
    truck:     <><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
    play:      <polygon points="5 3 19 12 5 21 5 3"/>,
    wifi:      <><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>,
    yard:      <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...p}>
      {paths[name]}
    </svg>
  );
};

// Sidebar — matches the live Layout.tsx exactly
function Sidebar({ route, setRoute }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "dash" },
    { id: "yard",      label: "Yard",      icon: "yard" },
    { id: "receipts",  label: "Receipts",  icon: "doc" },
    { id: "admin",     label: "Admin",     icon: "admin" },
    { id: "settings",  label: "Settings",  icon: "settings" },
  ];

  return (
    <aside className={"sidebar" + (collapsed ? " sidebar--collapsed" : "")}>
      <div className="sidebar__header">
        {!collapsed && (
          <div className="sidebar__brand">
            <div className="sidebar__brand-icon">TG</div>
            <div>
              <div className="sidebar__brand-name">Transvaal Galv</div>
              <div className="sidebar__brand-sub">Management</div>
            </div>
          </div>
        )}
        <button className="sidebar__toggle" onClick={() => setCollapsed(c=>!c)} aria-label={collapsed?"Expand":"Collapse"}>
          <Icon name={collapsed ? "chevR" : "chevL"} size={17}/>
        </button>
      </div>
      <nav className="sidebar__nav">
        {nav.map(n => (
          <button key={n.id} className={"sidebar__link" + (route === n.id ? " active" : "")}
                  onClick={() => setRoute(n.id)} title={collapsed ? n.label : undefined}>
            <Icon name={n.icon} size={18}/>
            {!collapsed && <span>{n.label}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        {!collapsed && (
          <div className="sidebar__footer-credit">
            <span className="ayoh-mark">AYOH</span>
            <span>Powered by AYOH</span>
          </div>
        )}
        <button className="sidebar__link sidebar__logout" title={collapsed ? "Sign out" : undefined}>
          <Icon name="logout" size={18}/>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return <span className={"badge " + meta.badge}>{meta.label}</span>;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }) +
    " · " + d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

// Editable inline field (matches live app's EditField pattern)
function EditField({ label, value, onChange, mono }) {
  return (
    <div className="edit-field">
      <div className="edit-field__label">{label}</div>
      <input
        className={"edit-field__input" + (mono ? " mono" : "")}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

Object.assign(window, { Icon, Sidebar, StatusBadge, fmtDate, fmtDateTime, EditField });
