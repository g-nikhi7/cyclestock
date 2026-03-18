import { useState, useEffect, useCallback, useRef } from "react";
import { auth, db, storage } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import QRCode from "qrcode";

// ── UOFL THEME COLORS ────────────────────────────────────────
const R      = "#AD0000";
const BG     = "#fdf8f8";
const BORDER = "#e8d5d5";
const MUTED  = "#888888";

// ── CONSTANTS ────────────────────────────────────────────────
const BIKE_TYPES  = ["Road","Mountain","Hybrid","City / Commuter","BMX","Kids","Folding","Gravel","Electric (e-Bike)","Cruiser","Cargo","Tandem","Tricycle","Other"];
const FRAME_SIZES = ['XS (13"–14")','S (15"–16")','M (17"–18")','L (19"–20")','XL (21"–22")','XXL (23"+)',"One Size"];
const WHEEL_SIZES = ['12"','16"','20"','24"','26"','27.5" (650b)','29"',"700c"];
const MATERIALS   = ["Aluminium","Carbon Fibre","Steel","Chromoly Steel","Titanium","Other"];
const GEARS       = ["Single Speed","3-speed","7-speed","8-speed","9-speed","10-speed","11-speed","12-speed","21-speed","24-speed","27-speed","Electric Assist"];
const BRAKES      = ["Disc — Hydraulic","Disc — Mechanical","Rim — V-Brake","Rim — Caliper","Coaster (Backpedal)","Other"];
const CONDITIONS  = ["New","Like New","Excellent","Good","Fair","Poor","For Parts"];
const STATUSES    = ["Available","Reserved","Sold","In Service"];
const EMPTY_FORM  = { brand:"",model:"",year:"",color:"",type:"",frameSize:"",wheel:"",material:"",gears:"",brakes:"",condition:"",status:"Available",price:"",serial:"",notes:"" };

const STATUS_STYLES = {
  Available:    { bg:"#fde8e8", color: R },
  Reserved:     { bg:"#fff3cd", color:"#a0621a" },
  Sold:         { bg:"#e8e8e8", color:"#333" },
  "In Service": { bg:"#dce8ff", color:"#2c5fb3" },
};

function uid()         { return "BC-" + Date.now().toString(36).toUpperCase(); }
function fmt(n)        { return n ? "$" + Number(n).toLocaleString() : "—"; }
function genBikeCode() { return Math.floor(1000000000 + Math.random() * 9000000000).toString(); }

// ── QR IMAGE GENERATOR ───────────────────────────────────────
async function generateQRImage(bikeCode, brand, model) {
  const qrDataUrl = await QRCode.toDataURL(bikeCode, {
    width: 200, margin: 2,
    color: { dark: "#AD0000", light: "#ffffff" },
  });
  const canvas = document.createElement("canvas");
  canvas.width = 300; canvas.height = 340;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 300, 340);
  ctx.fillStyle = "#AD0000";
  ctx.fillRect(0, 0, 300, 52);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "center";
  ctx.fillText("UofL CycleStock", 150, 22);
  ctx.font = "11px Arial";
  ctx.fillText(`${brand} ${model}`, 150, 41);
  const img = new Image();
  img.src = qrDataUrl;
  await new Promise(res => { img.onload = res; });
  ctx.drawImage(img, 50, 58, 200, 200);
  ctx.strokeStyle = "#e8d5d5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 268); ctx.lineTo(280, 268);
  ctx.stroke();
  ctx.fillStyle = "#888888";
  ctx.font = "11px Arial";
  ctx.textAlign = "center";
  ctx.fillText("UNIQUE BIKE CODE", 150, 288);
  ctx.fillStyle = "#AD0000";
  ctx.font = "bold 24px monospace";
  ctx.fillText(bikeCode, 150, 320);
  return canvas.toDataURL("image/png");
}

// ── SHARED UI ────────────────────────────────────────────────
function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{ width:"100%", background:"#fff", border:`1px solid ${BORDER}`, color:"#1a1a1a",
        fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none" }}
      onFocus={e => (e.target.style.borderColor = R)}
      onBlur={e  => (e.target.style.borderColor = BORDER)} />
  );
}

function Sel({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:"100%", background:"#fff", border:`1px solid ${BORDER}`,
        color: value ? "#1a1a1a" : MUTED, fontFamily:"inherit",
        fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none" }}>
      <option value="">{placeholder || "Select…"}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:"0.8rem" }}>
      <div style={{ fontSize:"0.62rem", textTransform:"uppercase", letterSpacing:"0.14em", color: MUTED, marginBottom:"0.28rem" }}>
        {label}{required && <span style={{ color: R }}> *</span>}
      </div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, full, style: ext = {} }) {
  const base = { padding:"0.55rem 1.1rem", fontFamily:"inherit", fontSize:"0.8rem", fontWeight:600,
    cursor: disabled ? "not-allowed" : "pointer", borderRadius:7, transition:"opacity 0.15s",
    opacity: disabled ? 0.6 : 1, width: full ? "100%" : undefined };
  const v = {
    primary:   { background: R, color:"#fff", border:"none" },
    secondary: { background:"transparent", color: R, border:`1px solid ${R}` },
    ghost:     { background:"transparent", color: MUTED, border:`1px solid ${BORDER}` },
    danger:    { background:"transparent", color:"#c0392b", border:"1px solid #c0392b" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...ext }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.82"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
      {children}
    </button>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position:"fixed", bottom:"1.5rem", right:"1.5rem",
      background: msg.startsWith("⚠") ? "#c0392b" : "#1a1a1a",
      color:"#fff", fontSize:"0.8rem", padding:"0.65rem 1.2rem",
      borderRadius:8, zIndex:400, boxShadow:"0 6px 20px rgba(0,0,0,0.25)" }}>
      {msg}
    </div>
  );
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ color:"#c0392b", fontSize:"0.78rem", background:"#fde8e8",
      padding:"0.5rem 0.7rem", borderRadius:6, marginBottom:"0.8rem" }}>
      {msg}
    </div>
  );
}

// ── HEADER ───────────────────────────────────────────────────
function Header({ subtitle, right }) {
  return (
    <div style={{ background: R, padding:"0 1.5rem", height:62,
      display:"flex", alignItems:"center", justifyContent:"space-between",
      boxShadow:"0 2px 16px rgba(0,0,0,0.25)", position:"sticky", top:0, zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:"0.8rem" }}>
        <span style={{ fontSize:"1.5rem" }}>🚲</span>
        <div>
          <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:"#fff", fontWeight:"bold", lineHeight:1 }}>CycleStock</div>
          <div style={{ fontSize:"0.48rem", color:"rgba(255,255,255,0.6)", textTransform:"uppercase", letterSpacing:"0.22em" }}>
            University of Louisville{subtitle ? ` · ${subtitle}` : ""}
          </div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>{right}</div>
    </div>
  );
}

// ── LOGIN PAGE ───────────────────────────────────────────────
function LoginPage({ onSignup }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const submit = async () => {
    if (!email || !password) { setError("Please fill in all fields"); return; }
    setLoading(true); setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      const m = {
        "auth/user-not-found":    "No account found with this email",
        "auth/wrong-password":    "Incorrect password",
        "auth/invalid-credential":"Invalid email or password",
        "auth/invalid-email":     "Invalid email address",
      };
      setError(m[e.code] || "Login failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background: BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:"0.9rem",
            background: R, padding:"0.9rem 1.6rem", borderRadius:14, marginBottom:"1rem",
            boxShadow:"0 4px 20px rgba(173,0,0,0.3)" }}>
            <span style={{ fontSize:"2.2rem" }}>🚲</span>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.5rem", color:"#fff", fontWeight:"bold", lineHeight:1 }}>CycleStock</div>
              <div style={{ fontSize:"0.58rem", color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.2em" }}>
                University of Louisville
              </div>
            </div>
          </div>
          <div style={{ fontSize:"0.82rem", color: MUTED }}>Sign in to access the inventory</div>
        </div>
        <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${BORDER}`, padding:"2rem", boxShadow:"0 4px 20px rgba(173,0,0,0.08)" }}>
          <Field label="Email Address"><Input value={email} onChange={setEmail} placeholder="you@louisville.edu" type="email" /></Field>
          <Field label="Password"><Input value={password} onChange={setPassword} placeholder="••••••••" type="password" /></Field>
          <ErrBox msg={error} />
          <Btn onClick={submit} disabled={loading} full>{loading ? "Signing in…" : "Sign In"}</Btn>
          <div style={{ textAlign:"center", marginTop:"1.2rem", fontSize:"0.78rem", color: MUTED }}>
            Don't have an account?{" "}
            <span onClick={onSignup} style={{ color: R, cursor:"pointer", fontWeight:600 }}>Create Account</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SIGNUP PAGE ──────────────────────────────────────────────
function SignupPage({ onLogin }) {
  const [form, setForm] = useState({ firstName:"", middleName:"", lastName:"", email:"", phone:"", userType:"", password:"", confirm:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const f = key => val => setForm(p => ({ ...p, [key]: val }));

  const submit = async () => {
    if (!form.firstName || !form.lastName || !form.email || !form.password) { setError("Please fill in all required fields"); return; }
    if (form.password !== form.confirm)  { setError("Passwords do not match"); return; }
    if (form.password.length < 6)        { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await sendEmailVerification(user);
      await setDoc(doc(db, "users", user.uid), {
        firstName: form.firstName, middleName: form.middleName || "",
        lastName: form.lastName, email: form.email,
        phone: form.phone || "", userType: form.userType || "General Public",
        role: "viewer", createdAt: Date.now(),
      });
    } catch (e) {
      const m = {
        "auth/email-already-in-use": "An account with this email already exists",
        "auth/invalid-email":        "Invalid email address",
        "auth/weak-password":        "Password too weak — use at least 6 characters",
      };
      setError(m[e.code] || "Signup failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background: BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div style={{ width:"100%", maxWidth:480 }}>
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontFamily:"Georgia,serif", fontSize:"1.6rem", color: R, fontWeight:"bold" }}>🚲 CycleStock</div>
          <div style={{ fontSize:"0.65rem", color: MUTED, textTransform:"uppercase", letterSpacing:"0.18em" }}>University of Louisville</div>
          <div style={{ fontSize:"0.82rem", color:"#444", marginTop:"0.3rem" }}>Create your account</div>
        </div>
        <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${BORDER}`, padding:"2rem", boxShadow:"0 4px 20px rgba(173,0,0,0.08)" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.7rem" }}>
            <Field label="First Name" required><Input value={form.firstName} onChange={f("firstName")} placeholder="John" /></Field>
            <Field label="Last Name"  required><Input value={form.lastName}  onChange={f("lastName")}  placeholder="Doe" /></Field>
          </div>
          <Field label="Middle Name"><Input value={form.middleName} onChange={f("middleName")} placeholder="Optional" /></Field>
          <Field label="Email Address" required><Input value={form.email} onChange={f("email")} placeholder="you@louisville.edu" type="email" /></Field>
          <Field label="Phone Number"><Input value={form.phone} onChange={f("phone")} placeholder="Optional" type="tel" /></Field>
          <Field label="I am a…"><Sel value={form.userType} onChange={f("userType")} options={["UofL Student","Other Student","General Public"]} /></Field>
          <Field label="Password"         required><Input value={form.password} onChange={f("password")} placeholder="Min. 6 characters" type="password" /></Field>
          <Field label="Confirm Password" required><Input value={form.confirm}   onChange={f("confirm")}   placeholder="Repeat password"    type="password" /></Field>
          <ErrBox msg={error} />
          <Btn onClick={submit} disabled={loading} full>{loading ? "Creating Account…" : "Create Account"}</Btn>
          <p style={{ textAlign:"center", marginTop:"0.8rem", fontSize:"0.72rem", color: MUTED }}>
            A verification link will be sent to your email.
          </p>
          <div style={{ textAlign:"center", marginTop:"0.5rem", fontSize:"0.78rem", color: MUTED }}>
            Already have an account?{" "}
            <span onClick={onLogin} style={{ color: R, cursor:"pointer", fontWeight:600 }}>Sign In</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── VERIFY EMAIL PAGE ────────────────────────────────────────
function VerifyEmailPage({ user }) {
  const [checking, setChecking] = useState(false);
  const [resent, setResent]     = useState(false);
  const [error, setError]       = useState("");

  const checkVerification = async () => {
    setChecking(true); setError("");
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) { window.location.reload(); }
      else { setError("Not verified yet — please click the link in your email first."); }
    } catch (e) { setError("Error checking. Please try again."); }
    setChecking(false);
  };

  const resend = async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      setResent(true); setTimeout(() => setResent(false), 4000);
    } catch (e) { setError("Could not resend. Wait a moment and try again."); }
  };

  return (
    <div style={{ minHeight:"100vh", background: BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${BORDER}`,
        padding:"2.5rem 2rem", maxWidth:420, width:"100%", textAlign:"center",
        boxShadow:"0 4px 20px rgba(173,0,0,0.08)" }}>
        <div style={{ fontSize:"3.5rem", marginBottom:"1rem" }}>📧</div>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color: R, fontWeight:"bold", marginBottom:"0.5rem" }}>
          Verify Your Email
        </div>
        <div style={{ fontSize:"0.82rem", color:"#555", lineHeight:1.8, marginBottom:"1.5rem" }}>
          We sent a verification link to<br />
          <strong>{user.email}</strong><br />
          Click the link in your email, then come back here.
        </div>
        <ErrBox msg={error} />
        {resent && (
          <div style={{ color:"#2d6a4f", fontSize:"0.78rem", background:"#d8f3dc", padding:"0.5rem", borderRadius:6, marginBottom:"0.8rem" }}>
            ✓ Verification email resent!
          </div>
        )}
        <div style={{ display:"flex", gap:"0.7rem", justifyContent:"center", flexWrap:"wrap" }}>
          <Btn onClick={checkVerification} disabled={checking}>{checking ? "Checking…" : "I've Verified My Email ✓"}</Btn>
          <Btn onClick={resend} variant="secondary">Resend Email</Btn>
        </div>
        <div style={{ marginTop:"1rem" }}>
          <span onClick={() => signOut(auth)} style={{ fontSize:"0.72rem", color: MUTED, cursor:"pointer" }}>Sign out</span>
        </div>
      </div>
    </div>
  );
}

// ── BIKE FORM ────────────────────────────────────────────────
function BikeForm({ form, setForm, onSubmit, submitLabel, onCancel, imageFile, setImageFile, existingImageUrl }) {
  const fileRef = useRef();
  const f = key => val => setForm(p => ({ ...p, [key]: val }));
  const preview = imageFile ? URL.createObjectURL(imageFile) : existingImageUrl;
  const div = label => (
    <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.18em",
      color: MUTED, margin:"0.9rem 0 0.5rem", paddingBottom:"0.35rem", borderBottom:`1px solid ${BORDER}` }}>
      {label}
    </div>
  );

  return (
    <div>
      <Field label="Bike Photo">
        <div onClick={() => fileRef.current.click()}
          style={{ border:`2px dashed ${BORDER}`, borderRadius:8, padding:"0.8rem",
            textAlign:"center", cursor:"pointer", background: BG }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = R)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = BORDER)}>
          {preview
            ? <><img src={preview} alt="preview" style={{ width:"100%", maxHeight:160, objectFit:"cover", borderRadius:6 }} /><div style={{ fontSize:"0.68rem", color: MUTED, marginTop:"0.3rem" }}>Click to change photo</div></>
            : <><div style={{ fontSize:"2rem", opacity:0.4 }}>📷</div><div style={{ fontSize:"0.75rem", color: MUTED }}>Click to upload photo</div></>
          }
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
          onChange={e => setImageFile(e.target.files[0] || null)} />
      </Field>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Brand" required><Input value={form.brand} onChange={f("brand")} placeholder="Trek, Giant…" /></Field>
        <Field label="Model" required><Input value={form.model} onChange={f("model")} placeholder="Marlin, FX3…" /></Field>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Year"><Input type="number" value={form.year} onChange={f("year")} placeholder="2024" /></Field>
        <Field label="Color"><Input value={form.color} onChange={f("color")} placeholder="Cardinal Red" /></Field>
      </div>
      <Field label="Bicycle Type"><Sel value={form.type} onChange={f("type")} options={BIKE_TYPES} /></Field>
      {div("Frame & Build")}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Frame Size"><Sel value={form.frameSize} onChange={f("frameSize")} options={FRAME_SIZES} /></Field>
        <Field label="Wheel Size"><Sel value={form.wheel} onChange={f("wheel")} options={WHEEL_SIZES} /></Field>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Frame Material"><Sel value={form.material} onChange={f("material")} options={MATERIALS} /></Field>
        <Field label="Speeds / Gears"><Sel value={form.gears} onChange={f("gears")} options={GEARS} /></Field>
      </div>
      <Field label="Brake Type"><Sel value={form.brakes} onChange={f("brakes")} options={BRAKES} /></Field>
      {div("Inventory Details")}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
        <Field label="Condition"><Sel value={form.condition} onChange={f("condition")} options={CONDITIONS} /></Field>
        <Field label="Status"><Sel value={form.status} onChange={f("status")} options={STATUSES} /></Field>
      </div>
      <Field label="Price ($)"><Input type="number" value={form.price} onChange={f("price")} placeholder="350" /></Field>
      <Field label="Serial Number"><Input value={form.serial} onChange={f("serial")} placeholder="Optional" /></Field>
      <Field label="Notes">
        <textarea value={form.notes} onChange={e => f("notes")(e.target.value)} placeholder="Accessories, upgrades, damage…"
          style={{ width:"100%", background:"#fff", border:`1px solid ${BORDER}`, color:"#1a1a1a",
            fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem",
            borderRadius:6, outline:"none", resize:"vertical", minHeight:60 }} />
      </Field>
      <div style={{ display:"flex", gap:"0.7rem", marginTop:"0.5rem" }}>
        {onCancel && <Btn onClick={onCancel} variant="ghost">Cancel</Btn>}
        <Btn onClick={onSubmit} style={{ flex:1, padding:"0.7rem" }}>{submitLabel}</Btn>
      </div>
    </div>
  );
}

// ── ADMIN BIKE CARD ──────────────────────────────────────────
function AdminBikeCard({ bike, onEdit, onDelete, onQR }) {
  const st = STATUS_STYLES[bike.status] || STATUS_STYLES.Available;
  return (
    <div style={{ background:"#fff", border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden", transition:"box-shadow 0.2s, transform 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 8px 28px rgba(173,0,0,0.12)"; e.currentTarget.style.transform="translateY(-3px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}>
      {bike.imageUrl
        ? <img src={bike.imageUrl} alt={bike.brand} style={{ width:"100%", height:160, objectFit:"cover" }} />
        : <div style={{ height:80, background: BG, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"2.5rem", opacity:0.25 }}>🚲</div>
      }
      <div style={{ padding:"0.65rem 0.9rem 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"0.57rem", textTransform:"uppercase", letterSpacing:"0.14em", background: R, color:"#fff", padding:"0.18rem 0.5rem", borderRadius:20 }}>
          {bike.type || "Bicycle"}
        </span>
        <span style={{ fontSize:"0.57rem", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em", background: st.bg, color: st.color, padding:"0.18rem 0.5rem", borderRadius:20 }}>
          {bike.status}
        </span>
      </div>
      <div style={{ padding:"0.55rem 0.9rem" }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.1rem" }}>{bike.brand}</div>
        <div style={{ fontSize:"0.7rem", color: MUTED }}>
          {bike.model}{bike.year ? ` · ${bike.year}` : ""}{bike.color ? ` · ${bike.color}` : ""}
        </div>
        {bike.bikeCode && (
          <div style={{ fontSize:"0.63rem", color: R, background:"#fde8e8", padding:"0.15rem 0.5rem", borderRadius:4, display:"inline-block", fontFamily:"monospace", marginTop:"0.3rem" }}>
            #{bike.bikeCode}
          </div>
        )}
        {bike.price && <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color: R, marginTop:"0.3rem" }}>{fmt(bike.price)}</div>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.4rem", padding:"0 0.9rem 0.9rem" }}>
        <Btn onClick={onEdit}   variant="ghost"    style={{ fontSize:"0.64rem", padding:"0.3rem 0.4rem" }}>✎ Edit</Btn>
        <Btn onClick={onQR}     variant="secondary" style={{ fontSize:"0.64rem", padding:"0.3rem 0.4rem" }}>📱 QR</Btn>
        <Btn onClick={onDelete} variant="danger"   style={{ fontSize:"0.64rem", padding:"0.3rem 0.4rem" }}>✕ Del</Btn>
      </div>
    </div>
  );
}

// ── PUBLIC BIKE CARD ─────────────────────────────────────────
function PublicBikeCard({ bike }) {
  return (
    <div style={{ background:"#fff", border:`1px solid ${BORDER}`, borderRadius:12, overflow:"hidden", transition:"box-shadow 0.2s, transform 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 8px 28px rgba(173,0,0,0.1)"; e.currentTarget.style.transform="translateY(-3px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}>
      {bike.imageUrl
        ? <img src={bike.imageUrl} alt={bike.brand} style={{ width:"100%", height:180, objectFit:"cover" }} />
        : <div style={{ height:120, background: BG, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"3rem", opacity:0.2 }}>🚲</div>
      }
      <div style={{ padding:"0.7rem 0.9rem 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"0.57rem", textTransform:"uppercase", letterSpacing:"0.14em", background: R, color:"#fff", padding:"0.18rem 0.5rem", borderRadius:20 }}>
          {bike.type || "Bicycle"}
        </span>
        <span style={{ fontSize:"0.57rem", fontWeight:600, textTransform:"uppercase", background:"#fde8e8", color: R, padding:"0.18rem 0.5rem", borderRadius:20 }}>Available</span>
      </div>
      <div style={{ padding:"0.6rem 0.9rem 1rem" }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.1rem" }}>{bike.brand}</div>
        <div style={{ fontSize:"0.7rem", color: MUTED, marginBottom:"0.5rem" }}>
          {bike.model}{bike.year ? ` · ${bike.year}` : ""}{bike.color ? ` · ${bike.color}` : ""}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.35rem", marginBottom:"0.4rem" }}>
          {[bike.frameSize && ["Frame",bike.frameSize], bike.wheel && ["Wheel",bike.wheel],
            bike.gears && ["Gears",bike.gears], bike.condition && ["Condition",bike.condition]
          ].filter(Boolean).map(([l,v]) => (
            <span key={l} style={{ fontSize:"0.62rem", background: BG, border:`1px solid ${BORDER}`, padding:"0.1rem 0.45rem", borderRadius:20 }}>
              <span style={{ color: MUTED }}>{l}: </span><strong>{v}</strong>
            </span>
          ))}
        </div>
        {bike.price && <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color: R }}>{fmt(bike.price)}</div>}
      </div>
    </div>
  );
}

// ── ADMIN DASHBOARD ──────────────────────────────────────────
function AdminDashboard({ userProfile }) {
  const [bikes, setBikes]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);
  const [tab, setTab]                   = useState("inventory");
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [imageFile, setImageFile]       = useState(null);
  const [editId, setEditId]             = useState(null);
  const [editForm, setEditForm]         = useState(EMPTY_FORM);
  const [editImg, setEditImg]           = useState(null);
  const [search, setSearch]             = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType]     = useState("");
  const [viewMode, setViewMode]         = useState("grid");

  const notify = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "inventory", "bikes"));
        if (snap.exists()) setBikes(snap.data().list || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async newBikes => {
    setSaving(true);
    try { await setDoc(doc(db, "inventory", "bikes"), { list: newBikes }); }
    catch (e) { notify("⚠ Save failed — check connection"); }
    setSaving(false);
  }, []);

  const uploadImage = async (file, bikeId) => {
    if (!file) return null;
    const imgRef = storageRef(storage, `bike-images/${bikeId}`);
    await uploadBytes(imgRef, file);
    return await getDownloadURL(imgRef);
  };

  const addBike = async () => {
    if (!form.brand.trim() || !form.model.trim()) { notify("⚠ Brand and Model are required"); return; }
    setSaving(true);
    try {
      const bikeId   = uid();
      const bikeCode = genBikeCode();
      const imageUrl = await uploadImage(imageFile, bikeId);
      const newBike  = { ...form, id: bikeId, bikeCode, imageUrl, addedAt: Date.now() };
      const updated  = [newBike, ...bikes];
      setBikes(updated); await persist(updated);
      setForm(EMPTY_FORM); setImageFile(null); setTab("inventory");
      notify("✓ Bicycle added to inventory!");
    } catch (e) { notify("⚠ Failed to add bike"); }
    setSaving(false);
  };

  const openEdit  = bike => { setEditId(bike.id); setEditForm({ ...EMPTY_FORM, ...bike }); setEditImg(null); };

  const saveEdit = async () => {
    if (!editForm.brand.trim() || !editForm.model.trim()) { notify("⚠ Brand and Model required"); return; }
    setSaving(true);
    try {
      const imageUrl = editImg ? await uploadImage(editImg, editId) : editForm.imageUrl;
      const updated  = bikes.map(b => b.id === editId ? { ...b, ...editForm, imageUrl } : b);
      setBikes(updated); await persist(updated); setEditId(null);
      notify("✓ Bicycle updated!");
    } catch (e) { notify("⚠ Failed to update"); }
    setSaving(false);
  };

  const deleteBike = async id => {
    if (!confirm("Remove this bicycle from inventory?")) return;
    const updated = bikes.filter(b => b.id !== id);
    setBikes(updated); await persist(updated); notify("Bicycle removed");
  };

  const downloadQR = async bike => {
    try {
      const code    = bike.bikeCode || genBikeCode();
      const imgData = await generateQRImage(code, bike.brand, bike.model);
      const a = document.createElement("a");
      a.href = imgData; a.download = `${bike.brand}-${bike.model}-QR.png`; a.click();
      notify("✓ QR code downloaded!");
    } catch (e) { notify("⚠ Failed to generate QR"); }
  };

  const filtered = bikes.filter(b => {
    const q   = search.toLowerCase();
    const txt = Object.values(b).join(" ").toLowerCase();
    return (!q || txt.includes(q)) && (!filterStatus || b.status === filterStatus) && (!filterType || b.type === filterType);
  });

  const totalValue = bikes.reduce((s, b) => s + (Number(b.price) || 0), 0);

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background: BG, minHeight:"100vh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');`}</style>

      <Header subtitle="Admin" right={
        <>
          {saving && <span style={{ fontSize:"0.58rem", color:"rgba(255,255,255,0.55)" }}>saving…</span>}
          {[["Total", bikes.length], ["Available", bikes.filter(b=>b.status==="Available").length], ["Value", totalValue ? "$"+totalValue.toLocaleString() : "$0"]].map(([l,v]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:"#fff", lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:"0.48rem", textTransform:"uppercase", letterSpacing:"0.15em", color:"rgba(255,255,255,0.5)" }}>{l}</div>
            </div>
          ))}
          <span style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.7)" }}>{userProfile?.firstName}</span>
          <button onClick={() => signOut(auth)}
            style={{ background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", padding:"0.3rem 0.7rem", borderRadius:6, cursor:"pointer", fontSize:"0.7rem", fontFamily:"inherit" }}>
            Sign Out
          </button>
        </>
      } />

      <div style={{ display:"flex", background:"#fff", borderBottom:`2px solid ${BORDER}` }}>
        {[["inventory","🚲 Inventory"],["add","＋ Add Bike"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex:1, padding:"0.75rem", fontFamily:"inherit", fontSize:"0.75rem",
              textTransform:"uppercase", letterSpacing:"0.1em", border:"none", cursor:"pointer",
              background: tab===key ? R : "transparent", color: tab===key ? "#fff" : MUTED }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display:"flex", minHeight:"calc(100vh - 104px)" }}>
        {tab === "add" && (
          <div style={{ flex:1, overflowY:"auto" }}>
            <div style={{ maxWidth:520, margin:"0 auto", padding:"1.5rem" }}>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color: R, marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:`2px solid ${BORDER}` }}>
                🚲 Add New Bicycle
              </div>
              <BikeForm form={form} setForm={setForm} onSubmit={addBike}
                submitLabel={saving ? "Adding…" : "＋ Add to Inventory"}
                imageFile={imageFile} setImageFile={setImageFile} />
            </div>
          </div>
        )}

        {tab === "inventory" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ background:"#fff", borderBottom:`1px solid ${BORDER}`, padding:"0.8rem 1.2rem", display:"flex", gap:"0.6rem", alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ position:"relative", flex:1, minWidth:160 }}>
                <span style={{ position:"absolute", left:"0.6rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.82rem" }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bikes…"
                  style={{ width:"100%", background: BG, border:`1px solid ${BORDER}`, fontFamily:"inherit", fontSize:"0.78rem", padding:"0.42rem 0.6rem 0.42rem 2rem", borderRadius:6, outline:"none" }} />
              </div>
              {[[filterStatus,setFilterStatus,STATUSES,"All Status"],[filterType,setFilterType,BIKE_TYPES,"All Types"]].map(([val,set,opts,ph],i) => (
                <select key={i} value={val} onChange={e => set(e.target.value)}
                  style={{ background:"#fff", border:`1px solid ${BORDER}`, fontFamily:"inherit", fontSize:"0.75rem", padding:"0.42rem 0.6rem", borderRadius:6, outline:"none" }}>
                  <option value="">{ph}</option>
                  {opts.map(o => <option key={o}>{o}</option>)}
                </select>
              ))}
              <div style={{ display:"flex", gap:"0.25rem" }}>
                {[["grid","⊞"],["list","☰"]].map(([v,icon]) => (
                  <button key={v} onClick={() => setViewMode(v)}
                    style={{ background: viewMode===v ? R : BG, border:`1px solid ${BORDER}`, color: viewMode===v ? "#fff" : MUTED, padding:"0.38rem 0.62rem", cursor:"pointer", borderRadius:6, fontSize:"0.9rem" }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex:1, padding:"1.2rem", overflowY:"auto" }}>
              {loading ? (
                <div style={{ textAlign:"center", padding:"4rem", color: MUTED }}>Loading inventory…</div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign:"center", padding:"4rem", color: MUTED }}>
                  <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
                  <p style={{ fontSize:"0.78rem" }}>{bikes.length ? "No bikes match your search." : "No bikes yet — tap + Add Bike!"}</p>
                </div>
              ) : viewMode === "grid" ? (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:"1rem" }}>
                  {filtered.map(b => (
                    <AdminBikeCard key={b.id} bike={b} onEdit={() => openEdit(b)} onDelete={() => deleteBike(b.id)} onQR={() => downloadQR(b)} />
                  ))}
                </div>
              ) : (
                <div style={{ background:"#fff", borderRadius:8, border:`1px solid ${BORDER}`, overflow:"hidden" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 80px 90px 90px 110px 130px", gap:"0.5rem", padding:"0.55rem 1rem", fontSize:"0.57rem", textTransform:"uppercase", letterSpacing:"0.12em", color: MUTED, borderBottom:`2px solid ${BORDER}`, background: BG }}>
                    {["Brand & Model","Type","Frame","Wheel","Condition","Price","Status/Actions"].map(h => <span key={h}>{h}</span>)}
                  </div>
                  {filtered.map(b => {
                    const st = STATUS_STYLES[b.status] || STATUS_STYLES.Available;
                    return (
                      <div key={b.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 80px 90px 90px 110px 130px", gap:"0.5rem", padding:"0.65rem 1rem", alignItems:"center", fontSize:"0.78rem", borderBottom:`1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = BG)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <div>
                          <div style={{ fontWeight:700 }}>{b.brand} {b.model}</div>
                          <div style={{ fontSize:"0.64rem", color: MUTED }}>{b.year}{b.color?` · ${b.color}`:""}</div>
                          {b.bikeCode && <div style={{ fontSize:"0.6rem", color: R, fontFamily:"monospace" }}>#{b.bikeCode}</div>}
                        </div>
                        <span>{b.type||"—"}</span>
                        <span>{b.frameSize||"—"}</span>
                        <span>{b.wheel||"—"}</span>
                        <span>{b.condition||"—"}</span>
                        <span style={{ color: R, fontWeight:600 }}>{fmt(b.price)}</span>
                        <div style={{ display:"flex", alignItems:"center", gap:"0.3rem" }}>
                          <span style={{ fontSize:"0.58rem", background: st.bg, color: st.color, padding:"0.15rem 0.4rem", borderRadius:10 }}>{b.status}</span>
                          {[["✎",() => openEdit(b)],["📱",() => downloadQR(b)],["✕",() => deleteBike(b.id)]].map(([icon,fn],i) => (
                            <button key={i} onClick={fn}
                              style={{ background:"transparent", border:`1px solid ${BORDER}`, color: MUTED, padding:"0.2rem 0.35rem", cursor:"pointer", borderRadius:4, fontSize:"0.72rem" }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = i===2?"#c0392b":R; e.currentTarget.style.color = i===2?"#c0392b":R; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor=BORDER; e.currentTarget.style.color=MUTED; }}>
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
        )}
      </div>

      {editId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}
          onClick={e => { if (e.target===e.currentTarget) setEditId(null); }}>
          <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${BORDER}`, padding:"1.5rem", width:520, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color: R, display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:`2px solid ${BORDER}` }}>
              Edit Bicycle
              <button onClick={() => setEditId(null)} style={{ background:"none", border:"none", fontSize:"1rem", color: MUTED, cursor:"pointer" }}>✕</button>
            </div>
            <BikeForm form={editForm} setForm={setEditForm} onSubmit={saveEdit}
              submitLabel={saving ? "Saving…" : "Save Changes"} onCancel={() => setEditId(null)}
              imageFile={editImg} setImageFile={setEditImg} existingImageUrl={editForm.imageUrl} />
          </div>
        </div>
      )}
      <Toast msg={toast} />
    </div>
  );
}

// ── PUBLIC DASHBOARD ─────────────────────────────────────────
function PublicDashboard({ userProfile }) {
  const [bikes, setBikes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "inventory", "bikes"));
        if (snap.exists()) setBikes((snap.data().list || []).filter(b => b.status === "Available"));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const filtered = bikes.filter(b => {
    const q = search.toLowerCase();
    return (!q || Object.values(b).join(" ").toLowerCase().includes(q)) && (!filterType || b.type === filterType);
  });

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background: BG, minHeight:"100vh" }}>
      <Header right={
        <>
          <span style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.7)" }}>Welcome, {userProfile?.firstName}</span>
          <button onClick={() => signOut(auth)}
            style={{ background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", padding:"0.3rem 0.7rem", borderRadius:6, cursor:"pointer", fontSize:"0.7rem", fontFamily:"inherit" }}>
            Sign Out
          </button>
        </>
      } />

      <div style={{ background:"#1a1a1a", padding:"2.5rem 1.5rem", textAlign:"center", borderBottom:`3px solid ${R}` }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"2rem", color:"#fff", marginBottom:"0.4rem" }}>Available Bicycles</div>
        <div style={{ fontSize:"0.8rem", color:"rgba(255,255,255,0.5)" }}>
          {bikes.length} bike{bikes.length !== 1 ? "s" : ""} currently available at UofL
        </div>
      </div>

      <div style={{ background:"#fff", borderBottom:`1px solid ${BORDER}`, padding:"0.8rem 1.2rem", display:"flex", gap:"0.6rem", flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:1, minWidth:160 }}>
          <span style={{ position:"absolute", left:"0.6rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.82rem" }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bikes…"
            style={{ width:"100%", background: BG, border:`1px solid ${BORDER}`, fontFamily:"inherit", fontSize:"0.78rem", padding:"0.42rem 0.6rem 0.42rem 2rem", borderRadius:6, outline:"none" }} />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background:"#fff", border:`1px solid ${BORDER}`, fontFamily:"inherit", fontSize:"0.75rem", padding:"0.42rem 0.6rem", borderRadius:6, outline:"none" }}>
          <option value="">All Types</option>
          {BIKE_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div style={{ padding:"1.5rem" }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"4rem", color: MUTED }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"4rem", color: MUTED }}>
            <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
            <p style={{ fontSize:"0.78rem" }}>No available bikes found.</p>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:"1rem" }}>
            {filtered.map(b => <PublicBikeCard key={b.id} bike={b} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState]     = useState("loading");
  const [user, setUser]               = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [page, setPage]               = useState("login");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async firebaseUser => {
      if (!firebaseUser) {
        setAuthState("unauthenticated"); setUser(null); setUserProfile(null); return;
      }
      setUser(firebaseUser);
      if (!firebaseUser.emailVerified) { setAuthState("unverified"); return; }
      try {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) setUserProfile(snap.data());
      } catch (e) { console.error(e); }
      setAuthState("authenticated");
    });
    return unsub;
  }, []);

  if (authState === "loading") {
    return (
      <div style={{ minHeight:"100vh", background: BG, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ textAlign:"center", color: MUTED }}>
          <div style={{ fontSize:"3rem", marginBottom:"0.8rem" }}>🚲</div>
          <div style={{ fontSize:"0.82rem" }}>Loading CycleStock…</div>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return page === "login"
      ? <LoginPage  onSignup={() => setPage("signup")} />
      : <SignupPage onLogin={() => setPage("login")} />;
  }

  if (authState === "unverified") return <VerifyEmailPage user={user} />;

  const role = userProfile?.role;
  if (role === "admin") return <AdminDashboard userProfile={userProfile} />;
  return <PublicDashboard userProfile={userProfile} />;
}