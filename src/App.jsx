import { useState, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

const STORAGE_KEY = "cyclestock:bikes";

const BIKE_TYPES = ["Road","Mountain","Hybrid","City / Commuter","BMX","Kids","Folding","Gravel","Electric (e-Bike)","Cruiser","Cargo","Tandem","Tricycle","Other"];
const FRAME_SIZES = ["XS (13\"–14\")","S (15\"–16\")","M (17\"–18\")","L (19\"–20\")","XL (21\"–22\")","XXL (23\"+)","One Size"];
const WHEEL_SIZES = ["12\"","16\"","20\"","24\"","26\"","27.5\" (650b)","29\"","700c"];
const MATERIALS = ["Aluminium","Carbon Fibre","Steel","Chromoly Steel","Titanium","Other"];
const GEARS = ["Single Speed","3-speed","7-speed","8-speed","9-speed","10-speed","11-speed","12-speed","21-speed","24-speed","27-speed","Electric Assist"];
const BRAKES = ["Disc — Hydraulic","Disc — Mechanical","Rim — V-Brake","Rim — Caliper","Coaster (Backpedal)","Other"];
const CONDITIONS = ["New","Like New","Excellent","Good","Fair","Poor","For Parts"];
const STATUSES = ["Available","Reserved","Sold","In Service"];

const EMPTY_FORM = { brand:"", model:"", year:"", color:"", type:"", frameSize:"", wheel:"", material:"", gears:"", brakes:"", condition:"", status:"Available", price:"", serial:"", notes:"" };

function uid() { return "BC-" + Date.now().toString(36).toUpperCase(); }
function fmt(n) { return n ? "$" + Number(n).toLocaleString() : "—"; }

const statusStyles = {
  Available: { bg:"#d8f3dc", color:"#2d6a4f" },
  Reserved:  { bg:"#fff3cd", color:"#a0621a" },
  Sold:      { bg:"#fde8e4", color:"#c0392b" },
  "In Service": { bg:"#dce8ff", color:"#2c5fb3" },
};

function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:"100%", background:"#f5f2ec", border:"1px solid #ddd8ce", color: value ? "#1a1a1a" : "#8a8278",
        fontFamily:"'DM Mono',monospace", fontSize:"0.8rem", padding:"0.46rem 0.62rem", borderRadius:6, outline:"none" }}>
      <option value="">{placeholder || "Select…"}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Input({ value, onChange, placeholder, type="text" }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width:"100%", background:"#f5f2ec", border:"1px solid #ddd8ce", color:"#1a1a1a",
        fontFamily:"'DM Mono',monospace", fontSize:"0.8rem", padding:"0.46rem 0.62rem", borderRadius:6, outline:"none" }} />
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:"0.75rem" }}>
      <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.16em", color:"#8a8278", marginBottom:"0.25rem" }}>{label}</div>
      {children}
    </div>
  );
}

function BikeCard({ bike, onEdit, onDelete }) {
  const st = statusStyles[bike.status] || statusStyles.Available;
  const specs = [
    bike.frameSize && ["Frame", bike.frameSize],
    bike.wheel     && ["Wheel", bike.wheel],
    bike.material  && ["Material", bike.material],
    bike.gears     && ["Gears", bike.gears],
    bike.brakes    && ["Brakes", bike.brakes],
    bike.condition && ["Condition", bike.condition],
  ].filter(Boolean);

  return (
    <div style={{ background:"#fff", border:"1px solid #ddd8ce", borderRadius:12, overflow:"hidden",
      transition:"box-shadow 0.2s, transform 0.15s", cursor:"default" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 8px 28px rgba(0,0,0,0.1)"; e.currentTarget.style.transform="translateY(-3px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}>
      {/* top bar */}
      <div style={{ background:"#d8f3dc", padding:"0.7rem 0.9rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.14em",
          background:"#2d6a4f", color:"#fff", padding:"0.18rem 0.5rem", borderRadius:20 }}>
          {bike.type || "Bicycle"}
        </span>
        <span style={{ fontSize:"0.58rem", fontWeight:500, textTransform:"uppercase", letterSpacing:"0.1em",
          background: st.bg, color: st.color, padding:"0.18rem 0.5rem", borderRadius:20 }}>
          {bike.status}
        </span>
      </div>
      {/* body */}
      <div style={{ padding:"0.85rem 0.9rem" }}>
        <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.2rem", lineHeight:1.1 }}>{bike.brand}</div>
        <div style={{ fontSize:"0.72rem", color:"#8a8278", marginBottom:"0.7rem" }}>
          {bike.model}{bike.year ? ` · ${bike.year}` : ""}{bike.color ? ` · ${bike.color}` : ""}
        </div>
        {specs.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.4rem 0.8rem", marginBottom:"0.7rem" }}>
            {specs.map(([l,v]) => (
              <div key={l}>
                <div style={{ fontSize:"0.55rem", textTransform:"uppercase", letterSpacing:"0.12em", color:"#8a8278" }}>{l}</div>
                <div style={{ fontSize:"0.75rem", color:"#1a1a1a", marginTop:"0.02rem" }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {bike.price && <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.35rem", color:"#2d6a4f" }}>{fmt(bike.price)}</div>}
        {bike.serial && (
          <div style={{ fontSize:"0.6rem", color:"#8a8278", background:"#eaf4ee", border:"1px solid #ddd8ce",
            padding:"0.1rem 0.42rem", borderRadius:4, display:"inline-block", marginTop:"0.3rem" }}>
            SN: {bike.serial}
          </div>
        )}
        {bike.notes && <div style={{ fontSize:"0.68rem", color:"#8a8278", marginTop:"0.4rem", lineHeight:1.6 }}>{bike.notes}</div>}
      </div>
      {/* actions */}
      <div style={{ display:"flex", gap:"0.45rem", padding:"0 0.9rem 0.9rem" }}>
        {[["✎ Edit", onEdit, "#2d6a4f"], ["✕ Remove", onDelete, "#c0392b"]].map(([label, fn, hoverColor]) => (
          <button key={label} onClick={fn}
            style={{ flex:1, padding:"0.35rem 0.5rem", fontFamily:"'DM Mono',monospace", fontSize:"0.65rem",
              textTransform:"uppercase", letterSpacing:"0.1em", border:"1px solid #ddd8ce", background:"transparent",
              color:"#8a8278", cursor:"pointer", borderRadius:6, transition:"all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = hoverColor; e.currentTarget.style.color = hoverColor; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="#ddd8ce"; e.currentTarget.style.color="#8a8278"; }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BikeForm({ form, setForm, onSubmit, submitLabel, onCancel }) {
  const f = (key) => (val) => setForm(p => ({ ...p, [key]: val }));
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Brand *"><Input value={form.brand} onChange={f("brand")} placeholder="Trek, Giant…" /></Field>
        <Field label="Model *"><Input value={form.model} onChange={f("model")} placeholder="Marlin, FX3…" /></Field>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Year"><Input type="number" value={form.year} onChange={f("year")} placeholder="2024" /></Field>
        <Field label="Color"><Input value={form.color} onChange={f("color")} placeholder="Matte Blue" /></Field>
      </div>
      <Field label="Bicycle Type"><Select value={form.type} onChange={f("type")} options={BIKE_TYPES} /></Field>
      <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.2em", color:"#8a8278",
        margin:"0.9rem 0 0.5rem", paddingBottom:"0.4rem", borderBottom:"1px solid #e8e4dc" }}>
        Frame & Build
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Frame Size"><Select value={form.frameSize} onChange={f("frameSize")} options={FRAME_SIZES} /></Field>
        <Field label="Wheel Size"><Select value={form.wheel} onChange={f("wheel")} options={WHEEL_SIZES} /></Field>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Frame Material"><Select value={form.material} onChange={f("material")} options={MATERIALS} /></Field>
        <Field label="Speeds / Gears"><Select value={form.gears} onChange={f("gears")} options={GEARS} /></Field>
      </div>
      <Field label="Brake Type"><Select value={form.brakes} onChange={f("brakes")} options={BRAKES} /></Field>
      <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.2em", color:"#8a8278",
        margin:"0.9rem 0 0.5rem", paddingBottom:"0.4rem", borderBottom:"1px solid #e8e4dc" }}>
        Inventory Details
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Condition"><Select value={form.condition} onChange={f("condition")} options={CONDITIONS} /></Field>
        <Field label="Status"><Select value={form.status} onChange={f("status")} options={STATUSES} /></Field>
      </div>
      <Field label="Price ($)"><Input type="number" value={form.price} onChange={f("price")} placeholder="350" /></Field>
      <Field label="Serial Number"><Input value={form.serial} onChange={f("serial")} placeholder="optional — for theft tracking" /></Field>
      <Field label="Notes">
        <textarea value={form.notes} onChange={e => f("notes")(e.target.value)} placeholder="Accessories, upgrades, damage…"
          style={{ width:"100%", background:"#f5f2ec", border:"1px solid #ddd8ce", color:"#1a1a1a",
            fontFamily:"'DM Mono',monospace", fontSize:"0.8rem", padding:"0.46rem 0.62rem", borderRadius:6,
            outline:"none", resize:"vertical", minHeight:56 }} />
      </Field>
      <div style={{ display:"flex", gap:"0.7rem", marginTop:"0.4rem" }}>
        {onCancel && (
          <button onClick={onCancel}
            style={{ padding:"0.65rem 1rem", fontFamily:"'DM Mono',monospace", fontSize:"0.75rem",
              border:"1px solid #ddd8ce", background:"transparent", color:"#8a8278", cursor:"pointer", borderRadius:8 }}>
            Cancel
          </button>
        )}
        <button onClick={onSubmit}
          style={{ flex:1, background:"#2d6a4f", color:"#fff", border:"none",
            fontFamily:"'DM Mono',monospace", fontSize:"0.8rem", fontWeight:500,
            textTransform:"uppercase", letterSpacing:"0.14em", padding:"0.7rem",
            cursor:"pointer", borderRadius:8, boxShadow:"0 4px 12px rgba(45,106,79,0.3)" }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export default function CycleStock() {
  const [bikes, setBikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("grid");
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("inventory"); // "inventory" | "add"

  // Load from persistent storage
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "inventory", "bikes"));
        if (snap.exists()) setBikes(snap.data().list || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (newBikes) => {
    setSaving(true);
    try {
      await setDoc(doc(db, "inventory", "bikes"), { list: newBikes });
    } catch (e) { console.error(e); }
    setSaving(false);
  }, []);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const addBike = async () => {
    if (!form.brand.trim() || !form.model.trim()) { notify("⚠ Brand and Model are required"); return; }
    const newBike = { ...form, id: uid(), addedAt: Date.now() };
    const updated = [newBike, ...bikes];
    setBikes(updated);
    await persist(updated);
    setForm(EMPTY_FORM);
    setTab("inventory");
    notify("✓ Bicycle added!");
  };

  const deleteBike = async (id) => {
    if (!confirm("Remove this bicycle from inventory?")) return;
    const updated = bikes.filter(b => b.id !== id);
    setBikes(updated);
    await persist(updated);
    notify("Bicycle removed");
  };

  const openEdit = (bike) => {
    setEditId(bike.id);
    setEditForm({ ...EMPTY_FORM, ...bike });
  };

  const saveEdit = async () => {
    if (!editForm.brand.trim() || !editForm.model.trim()) { notify("⚠ Brand and Model required"); return; }
    const updated = bikes.map(b => b.id === editId ? { ...b, ...editForm } : b);
    setBikes(updated);
    await persist(updated);
    setEditId(null);
    notify("✓ Bicycle updated!");
  };

  const filtered = bikes
    .filter(b => {
      const q = search.toLowerCase();
      const txt = Object.values(b).join(" ").toLowerCase();
      return (!q || txt.includes(q))
        && (!filterStatus || b.status === filterStatus)
        && (!filterType || b.type === filterType);
    })
    .sort((a, b) => {
      if (sortBy === "newest") return b.addedAt - a.addedAt;
      if (sortBy === "price-asc") return (Number(a.price)||0) - (Number(b.price)||0);
      if (sortBy === "price-desc") return (Number(b.price)||0) - (Number(a.price)||0);
      if (sortBy === "brand") return a.brand.localeCompare(b.brand);
      if (sortBy === "year-desc") return (Number(b.year)||0) - (Number(a.year)||0);
      return 0;
    });

  const totalValue = bikes.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const availCount = bikes.filter(b => b.status === "Available").length;

  const sel = (val, onChange, opts, placeholder) => (
    <select value={val} onChange={e => onChange(e.target.value)}
      style={{ background:"#fff", border:"1px solid #ddd8ce", color: val ? "#1a1a1a" : "#8a8278",
        fontFamily:"'DM Mono',monospace", fontSize:"0.75rem", padding:"0.42rem 0.6rem",
        borderRadius:6, outline:"none", cursor:"pointer" }}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div style={{ fontFamily:"'DM Mono',monospace", background:"#f5f2ec", minHeight:"100vh", color:"#1a1a1a" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');`}</style>

      {/* HEADER */}
      <div style={{ background:"#2d6a4f", padding:"0 1.5rem", height:64, display:"flex",
        alignItems:"center", justifyContent:"space-between", boxShadow:"0 2px 12px rgba(45,106,79,0.25)",
        position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:"0.35rem" }}>
          <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.55rem", color:"#fff" }}>
            Cycle<span style={{ color:"#52b788" }}>Stock</span>
          </span>
          <span style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.2em", color:"rgba(255,255,255,0.45)" }}>
            Bicycle Inventory
          </span>
        </div>
        <div style={{ display:"flex", gap:"2rem", alignItems:"center" }}>
          {saving && <span style={{ fontSize:"0.6rem", color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em" }}>saving…</span>}
          {[["Total", bikes.length], ["Available", availCount], ["Value", totalValue ? "$"+totalValue.toLocaleString() : "$0"]].map(([l,v]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.35rem", color:"#fff", lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:"0.56rem", textTransform:"uppercase", letterSpacing:"0.18em", color:"rgba(255,255,255,0.5)" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MOBILE TABS */}
      <div style={{ display:"flex", borderBottom:"2px solid #ddd8ce", background:"#fff" }}>
        {[["inventory","🚲 Inventory"], ["add","＋ Add Bike"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex:1, padding:"0.8rem", fontFamily:"'DM Mono',monospace", fontSize:"0.75rem",
              textTransform:"uppercase", letterSpacing:"0.12em", border:"none", cursor:"pointer",
              background: tab===key ? "#2d6a4f" : "transparent",
              color: tab===key ? "#fff" : "#8a8278",
              borderBottom: tab===key ? "2px solid #2d6a4f" : "none" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display:"flex", minHeight:"calc(100vh - 100px)" }}>

        {/* SIDEBAR — Add Form */}
        <aside style={{ width:300, minWidth:300, background:"#fff", borderRight:"1px solid #ddd8ce",
          padding:"1.3rem 1.2rem", overflowY:"auto",
          display: tab === "add" ? "block" : "none" }}>
          <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.1rem", color:"#2d6a4f",
            marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid #d8f3dc" }}>
            🚲 Add New Bicycle
          </div>
          <BikeForm form={form} setForm={setForm} onSubmit={addBike} submitLabel="＋ Add to Inventory" />
        </aside>

        {/* MAIN PANEL */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", display: tab === "inventory" ? "flex" : "none" }}>
          {/* TOOLBAR */}
          <div style={{ background:"#fff", borderBottom:"1px solid #ddd8ce", padding:"0.8rem 1.2rem",
            display:"flex", gap:"0.6rem", alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ position:"relative", flex:1, minWidth:160 }}>
              <span style={{ position:"absolute", left:"0.6rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.8rem" }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bikes…"
                style={{ width:"100%", paddingLeft:"2rem", background:"#f5f2ec", border:"1px solid #ddd8ce",
                  fontFamily:"'DM Mono',monospace", fontSize:"0.78rem", padding:"0.42rem 0.6rem 0.42rem 2rem",
                  borderRadius:6, outline:"none", color:"#1a1a1a" }} />
            </div>
            {sel(filterStatus, setFilterStatus, STATUSES, "All Status")}
            {sel(filterType, setFilterType, BIKE_TYPES, "All Types")}
            {sel(sortBy, setSortBy, ["newest","price-asc","price-desc","brand","year-desc"], "Sort")}
            <div style={{ display:"flex", gap:"0.25rem" }}>
              {[["grid","⊞"],["list","☰"]].map(([v,icon]) => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ background: viewMode===v ? "#2d6a4f" : "#f5f2ec",
                    border:"1px solid #ddd8ce", color: viewMode===v ? "#fff" : "#8a8278",
                    padding:"0.4rem 0.65rem", cursor:"pointer", borderRadius:6, fontSize:"0.9rem" }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* INVENTORY */}
          <div style={{ flex:1, padding:"1.2rem", overflowY:"auto" }}>
            {loading ? (
              <div style={{ textAlign:"center", padding:"4rem", color:"#8a8278", fontSize:"0.8rem" }}>Loading inventory…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:"center", padding:"5rem 2rem", color:"#8a8278" }}>
                <div style={{ fontSize:"4rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
                <p style={{ fontSize:"0.78rem", lineHeight:2 }}>
                  {bikes.length ? "No bikes match your search or filters." : "No bicycles yet.\nTap \"+ Add Bike\" to get started."}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:"1rem" }}>
                {filtered.map(b => (
                  <BikeCard key={b.id} bike={b} onEdit={() => openEdit(b)} onDelete={() => deleteBike(b.id)} />
                ))}
              </div>
            ) : (
              <div style={{ background:"#fff", borderRadius:8, overflow:"hidden", border:"1px solid #ddd8ce" }}>
                {/* List header */}
                <div style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 80px 90px 90px 110px 140px",
                  gap:"0.5rem", padding:"0.55rem 1rem", fontSize:"0.58rem", textTransform:"uppercase",
                  letterSpacing:"0.12em", color:"#8a8278", borderBottom:"2px solid #ddd8ce", background:"#f5f2ec" }}>
                  {["Brand & Model","Type","Frame","Wheel","Condition","Price","Status / Actions"].map(h => <span key={h}>{h}</span>)}
                </div>
                {filtered.map(b => {
                  const st = statusStyles[b.status] || statusStyles.Available;
                  return (
                    <div key={b.id} style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 80px 90px 90px 110px 140px",
                      gap:"0.5rem", padding:"0.65rem 1rem", alignItems:"center", fontSize:"0.78rem",
                      borderBottom:"1px solid #ddd8ce" }}
                      onMouseEnter={e => e.currentTarget.style.background="#f5f2ec"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                      <div>
                        <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"0.95rem" }}>{b.brand} {b.model}</div>
                        <div style={{ fontSize:"0.66rem", color:"#8a8278" }}>{b.year}{b.color ? ` · ${b.color}` : ""}</div>
                      </div>
                      <span>{b.type || "—"}</span>
                      <span>{b.frameSize || "—"}</span>
                      <span>{b.wheel || "—"}</span>
                      <span>{b.condition || "—"}</span>
                      <span style={{ color:"#2d6a4f", fontWeight:500 }}>{fmt(b.price)}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.4rem" }}>
                        <span style={{ fontSize:"0.58rem", fontWeight:500, textTransform:"uppercase",
                          letterSpacing:"0.1em", background: st.bg, color: st.color,
                          padding:"0.18rem 0.5rem", borderRadius:20 }}>{b.status}</span>
                        {["✎","✕"].map((icon, i) => (
                          <button key={i} onClick={() => i===0 ? openEdit(b) : deleteBike(b.id)}
                            style={{ background:"transparent", border:"1px solid #ddd8ce", color:"#8a8278",
                              padding:"0.22rem 0.4rem", cursor:"pointer", borderRadius:4, fontSize:"0.75rem" }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = i===0 ? "#2d6a4f" : "#c0392b"; e.currentTarget.style.color = i===0 ? "#2d6a4f" : "#c0392b"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor="#ddd8ce"; e.currentTarget.style.color="#8a8278"; }}>
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Desktop sidebar — always show Add form */}
        <aside style={{ width:300, minWidth:300, background:"#fff", borderRight:"1px solid #ddd8ce",
          padding:"1.3rem 1.2rem", overflowY:"auto",
          display: tab === "add" ? "none" : "block" }}>
          <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.1rem", color:"#2d6a4f",
            marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid #d8f3dc" }}>
            🚲 Add New Bicycle
          </div>
          <BikeForm form={form} setForm={setForm} onSubmit={addBike} submitLabel="＋ Add to Inventory" />
        </aside>
      </div>

      {/* EDIT MODAL */}
      {editId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(26,26,26,0.55)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}
          onClick={e => { if (e.target === e.currentTarget) setEditId(null); }}>
          <div style={{ background:"#fff", borderRadius:14, border:"1px solid #ddd8ce", padding:"1.5rem",
            width:500, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto",
            boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.25rem", color:"#2d6a4f",
              display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:"1.1rem", paddingBottom:"0.6rem", borderBottom:"2px solid #d8f3dc" }}>
              Edit Bicycle
              <button onClick={() => setEditId(null)}
                style={{ background:"none", border:"none", fontSize:"1rem", color:"#8a8278", cursor:"pointer" }}>✕</button>
            </div>
            <BikeForm form={editForm} setForm={setEditForm} onSubmit={saveEdit}
              submitLabel="Save Changes" onCancel={() => setEditId(null)} />
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position:"fixed", bottom:"1.5rem", right:"1.5rem", background:"#2d6a4f", color:"#fff",
          fontSize:"0.78rem", padding:"0.65rem 1.2rem", borderRadius:8, zIndex:300,
          boxShadow:"0 6px 20px rgba(45,106,79,0.35)", animation:"fadeUp 0.3s ease" }}>
          {toast}
        </div>
      )}
      <style>{`.fadeUp { animation: fadeUp 0.3s ease; } @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }`}</style>
    </div>
  );
}
