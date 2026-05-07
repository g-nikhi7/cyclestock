import { useState, useEffect, useCallback, useRef } from "react";
import { auth, db, storage } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, collection, addDoc, getDocs,
  orderBy, query, updateDoc, where, deleteDoc
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import QRCode from "qrcode";
import ExcelJS from "exceljs";

// ── THEME ──────────────────────────────────────────────────────
const RHex   = "#AD0000";
const BG     = "#faf7f7";
const SURF   = "#ffffff";
const BORDER = "#e8d5d5";
const MUTED  = "#888888";
const BLACK  = "#1a1a1a";
const LGRAY  = "#f5f0f0";
const GREEN  = "#2d6a4f";

// ── CONSTANTS ──────────────────────────────────────────────────
const BIKE_TYPES  = ["Road","Mountain","Hybrid","City / Commuter","BMX","Kids","Folding","Gravel","Electric (e-Bike)","Cruiser","Cargo","Tandem","Tricycle","Other"];
const FRAME_SIZES = ['XS (13"–14")','S (15"–16")','M (17"–18")','L (19"–20")','XL (21"–22")','XXL (23"+)',"One Size"];
const WHEEL_SIZES = ['12"','16"','20"','24"','26"','27.5" (650b)','29"',"700c"];
const MATERIALS   = ["Aluminium","Carbon Fibre","Steel","Chromoly Steel","Titanium","Other"];
const GEARS       = ["Single Speed","3-speed","7-speed","8-speed","9-speed","10-speed","11-speed","12-speed","21-speed","24-speed","27-speed","Electric Assist"];
const BRAKES      = ["Disc — Hydraulic","Disc — Mechanical","Rim — V-Brake","Rim — Caliper","Coaster (Backpedal)","Other"];
const CONDITIONS  = ["New","Like New","Excellent","Good","Fair","Poor","For Parts"];
const STATUSES    = ["Available","Reserved","Sold","In Service"];
const EMPTY_FORM  = { brand:"",model:"",year:"",color:"",type:"",frameSize:"",wheel:"",material:"",gears:"",brakes:"",condition:"",status:"Available",serial:"",notes:"" };

const STATUS_STYLES = {
  Available:    { bg:"#fde8e8", color:RHex },
  Reserved:     { bg:"#fff3cd", color:"#a0621a" },
  Sold:         { bg:"#e8e8e8", color:"#333" },
  "In Service": { bg:"#dce8ff", color:"#2c5fb3" },
};
const REQUEST_STATUS = {
  Pending:  { bg:"#fff3cd", color:"#a0621a" },
  Approved: { bg:"#d8f3dc", color:"#2d6a4f" },
  Active:   { bg:"#e8f4fd", color:"#1a6ba0" },
  Rejected: { bg:"#fde8e8", color:"#c0392b" },
  Returned: { bg:"#dce8ff", color:"#2c5fb3" },
};

// ── HELPERS ────────────────────────────────────────────────────
function uid()         { return "BC-" + Date.now().toString(36).toUpperCase(); }
function genBikeCode() { return Math.floor(1000000000 + Math.random() * 9000000000).toString(); }
function fmtDate(ts)   { return ts ? new Date(ts).toLocaleDateString("en-US",{ month:"short", day:"numeric", year:"numeric" }) : "—"; }

function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hrs   = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)  return "just now";
  if (mins < 60) return mins + " min ago";
  if (hrs  < 24) return hrs  + " hr ago";
  return days + " day" + (days !== 1 ? "s" : "") + " ago";
}

function daysLeft(returnDateTs) {
  if (!returnDateTs) return null;
  const diff = Math.ceil((returnDateTs - Date.now()) / 86400000);
  return diff;
}

function getRentalBadge(count) {
  if (count >= 10) return { icon:"🏆", label:"Campus Champion" };
  if (count >= 5)  return { icon:"🚲", label:"Regular Rider" };
  if (count >= 1)  return { icon:"🎉", label:"First Ride" };
  return null;
}

// ── QR IMAGE ───────────────────────────────────────────────────
async function generateQRImage(bikeCode, brand, model) {
  const qrDataUrl = await QRCode.toDataURL(bikeCode, { width:200, margin:2, color:{ dark:"AD0000", light:"ffffff" } });
  const canvas = document.createElement("canvas");
  canvas.width = 300; canvas.height = 340;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,300,340);
  ctx.fillStyle=RHex; ctx.fillRect(0,0,300,52);
  ctx.fillStyle="#ffffff"; ctx.font="bold 15px Arial"; ctx.textAlign="center";
  ctx.fillText("UofL Bikeshare", 150, 22);
  ctx.font="11px Arial"; ctx.fillText(brand+" "+model, 150, 41);
  const img = new Image(); img.src = qrDataUrl;
  await new Promise(r => { img.onload = r; });
  ctx.drawImage(img, 50, 58, 200, 200);
  ctx.strokeStyle=BORDER; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(20,268); ctx.lineTo(280,268); ctx.stroke();
  ctx.fillStyle=MUTED; ctx.font="11px Arial"; ctx.fillText("UNIQUE BIKE CODE", 150, 288);
  ctx.fillStyle=RHex; ctx.font="bold 24px monospace"; ctx.fillText(bikeCode, 150, 320);
  return canvas.toDataURL("image/png");
}

// ── WAIVER TEXT ────────────────────────────────────────────────
const WAIVER_TEXT = `UNIVERSITY OF LOUISVILLE (UofL) BIKESHARE
ASSUMPTION OF RISK AND WAIVER FORM

I, being over 18 years of age, desire to participate in the UofL Bikeshare Program. I am aware that riding a bicycle can be a dangerous activity involving MANY RISKS OF INJURY. I understand that the dangers and risk of riding a bicycle include, but are not limited to, death, serious neck and spinal injuries which may result in complete or partial paralysis, brain damage, serious injury to virtually all internal organs, serious injury to virtually all bones, joints ligaments, muscles, tendons, and other aspects of the muscular skeletal system and serious injury or impairment of other aspects of my body, general health and wellbeing.

I hereby represent that I am in good physical condition and do not know of any condition or reason that I should not be able to operate one of the bicycles provided through the UofL Bikeshare Program. I further acknowledge that UofL has no duty to supervise, monitor or provide assistance (medical or otherwise) in connection with my use of a bicycle.

I understand and assume all of the risks involved with respect to my riding or otherwise operating a bicycle provided through the UofL Bikeshare Program. I am solely responsible for any claim or harm that might occur to myself, third parties, or any property. I hereby agree to hold the University of Louisville, its employees, agents, representatives, and volunteers harmless from any and all obligations, liabilities, claims, demands, costs, and expenses, including attorney's fees, of any kind and nature whatsoever which may arise by or in connection with my operation of one of the bicycles provided by the UofL Bikeshare Program.

FINANCIAL LIABILITY
I understand that I am responsible for the care and on-time return of this bicycle. If the bicycle is lost, stolen, or irreparably damaged due to my neglect; or if the helmet, key and/or lock are lost or damaged, I agree to pay the following repair/replacement costs:
• Bicycle: $200
• Helmet: $30
• Lock: $30
• Key: $10

Furthermore, I understand that this bicycle is due back at the point of loan before the facility closes today and that a late fee of $5.00 per day will accrue if I am tardy in the return of this bicycle. Failure to pay these fines will void my ability to check out bikes from the UofL Bikeshare Program in the future and will result in UofL withholding my transcripts and class registration privileges.

In signing this Waiver, I acknowledge and represent that I have read it, understand it, and sign it voluntarily as my own free act and deed; no oral representations, statements or inducements, apart from this waiver have been made.`;

// ── GLOBAL STYLES ──────────────────────────────────────────────
const GLOBAL_STYLES = `
  @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
  * { box-sizing: border-box; }
`;

// ── SHARED UI ──────────────────────────────────────────────────
function Input({ value, onChange, placeholder, type="text", disabled }) {
  return (
    <input type={type} value={value} placeholder={placeholder} disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{ width:"100%", background:disabled?"#f5f5f5":SURF, border:"1px solid "+BORDER,
        color:BLACK, fontFamily:"inherit", fontSize:"0.85rem",
        padding:"0.5rem 0.7rem", borderRadius:6, outline:"none", opacity:disabled?0.7:1 }}
      onFocus={e => { if (!disabled) e.target.style.borderColor=RHex; }}
      onBlur={e  => { e.target.style.borderColor=BORDER; }} />
  );
}

function Sel({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:"100%", background:SURF, border:"1px solid "+BORDER,
        color:value?BLACK:MUTED, fontFamily:"inherit",
        fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none" }}>
      <option value="">{placeholder||"Select…"}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:"0.8rem" }}>
      <div style={{ fontSize:"0.62rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, marginBottom:"0.28rem" }}>
        {label}{required && <span style={{ color:RHex }}> *</span>}
      </div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant="primary", disabled, full, small, style:ext={} }) {
  const base = { padding:small?"0.38rem 0.75rem":"0.58rem 1.1rem", fontFamily:"inherit",
    fontSize:small?"0.74rem":"0.82rem", fontWeight:600, cursor:disabled?"not-allowed":"pointer",
    borderRadius:7, transition:"all 0.18s", opacity:disabled?0.6:1,
    width:full?"100%":undefined, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:"0.3rem" };
  const v = {
    primary:  { background:RHex,   color:"#fff", border:"none", boxShadow:"0 3px 10px rgba(173,0,0,0.25)" },
    secondary:{ background:"transparent", color:RHex, border:"1.5px solid "+RHex },
    ghost:    { background:"transparent", color:MUTED, border:"1px solid "+BORDER },
    danger:   { background:"transparent", color:"#c0392b", border:"1px solid #c0392b" },
    dark:     { background:BLACK, color:"#fff", border:"none" },
    green:    { background:GREEN, color:"#fff", border:"none", boxShadow:"0 3px 10px rgba(45,106,79,0.25)" },
    approve:  { background:"#2d6a4f", color:"#fff", border:"none" },
    reject:   { background:"#c0392b", color:"#fff", border:"none" },
    blue:     { background:"#2c5fb3", color:"#fff", border:"none" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...ext }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.opacity="0.82"; e.currentTarget.style.transform="translateY(-1px)"; }}}
      onMouseLeave={e => { e.currentTarget.style.opacity="1"; e.currentTarget.style.transform="none"; }}>
      {children}
    </button>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position:"fixed", bottom:"1.5rem", right:"1.5rem",
      background:msg.startsWith("⚠")?"#c0392b":BLACK, color:"#fff",
      fontSize:"0.8rem", padding:"0.7rem 1.3rem", borderRadius:8,
      zIndex:600, boxShadow:"0 6px 20px rgba(0,0,0,0.25)", animation:"slideUp 0.3s ease" }}>
      {msg}
    </div>
  );
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ color:"#c0392b", fontSize:"0.78rem", background:"#fde8e8",
      padding:"0.5rem 0.7rem", borderRadius:6, marginBottom:"0.8rem", lineHeight:1.5 }}>
      {msg}
    </div>
  );
}

function Skeleton({ w="100%", h=16, radius=6, style:ext={} }) {
  return <div style={{ width:w, height:h, borderRadius:radius, background:"linear-gradient(90deg,#f0e8e8 25%,#e8d8d8 50%,#f0e8e8 75%)", backgroundSize:"200% 100%", animation:"shimmer 1.5s infinite", ...ext }} />;
}

function SkeletonCard() {
  return (
    <div style={{ background:SURF, border:"1px solid "+BORDER, borderRadius:14, overflow:"hidden" }}>
      <Skeleton h={180} radius={0} />
      <div style={{ padding:"0.9rem" }}>
        <Skeleton h={20} w="60%" style={{ marginBottom:8 }} />
        <Skeleton h={14} w="80%" style={{ marginBottom:16 }} />
        <Skeleton h={12} w="40%" style={{ marginBottom:8 }} />
        <Skeleton h={38} radius={8} />
      </div>
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <button onClick={copy}
      style={{ background:copied?"#d8f3dc":"transparent", border:"1px solid "+BORDER, color:copied?GREEN:MUTED,
        padding:"0.18rem 0.45rem", borderRadius:4, cursor:"pointer", fontSize:"0.68rem", fontFamily:"inherit",
        transition:"all 0.2s", marginLeft:"0.3rem" }}>
      {copied ? "✓" : "📋"}
    </button>
  );
}

// ── NOTIFICATION BELL ──────────────────────────────────────────
function NotificationBell({ notifications, onMarkRead, onClearAll }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(n => !n.read).length;
  return (
    <div style={{ position:"relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)",
          color:"#fff", width:38, height:38, borderRadius:8, cursor:"pointer",
          fontSize:"1.1rem", position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        🔔
        {unread > 0 && (
          <span style={{ position:"absolute", top:-4, right:-4, background:"#ff4444",
            color:"#fff", fontSize:"0.58rem", fontWeight:700, width:18, height:18,
            borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
            border:"2px solid "+RHex }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div style={{ position:"fixed", inset:0, zIndex:149 }} onClick={() => setOpen(false)} />
          <div style={{ position:"absolute", right:0, top:44, width:320, background:SURF,
            border:"1px solid "+BORDER, borderRadius:12, boxShadow:"0 8px 30px rgba(0,0,0,0.15)",
            zIndex:150, overflow:"hidden" }}>
            <div style={{ padding:"0.8rem 1rem", borderBottom:"1px solid "+BORDER,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontWeight:700, fontSize:"0.85rem", color:BLACK }}>🔔 Notifications</div>
              {notifications.length > 0 && (
                <span onClick={onClearAll} style={{ fontSize:"0.7rem", color:RHex, cursor:"pointer", fontWeight:600 }}>Clear all</span>
              )}
            </div>
            <div style={{ maxHeight:320, overflowY:"auto" }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign:"center", padding:"2rem", color:MUTED, fontSize:"0.8rem" }}>No notifications yet</div>
              ) : notifications.map(n => (
                <div key={n.id} onClick={() => onMarkRead(n.id)}
                  style={{ padding:"0.75rem 1rem", borderBottom:"1px solid "+BORDER,
                    background:n.read?SURF:"#fff8f8", cursor:"pointer",
                    borderLeft:"3px solid "+(n.read?"transparent":RHex) }}
                  onMouseEnter={e => (e.currentTarget.style.background="#fdf0f0")}
                  onMouseLeave={e => (e.currentTarget.style.background=n.read?SURF:"#fff8f8")}>
                  <div style={{ fontSize:"0.82rem", color:BLACK, fontWeight:n.read?400:600 }}>{n.message}</div>
                  <div style={{ fontSize:"0.68rem", color:MUTED, marginTop:"0.2rem" }}>{timeAgo(n.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── TOP NAV ────────────────────────────────────────────────────
function TopNav({ page, setPage, userProfile, onSignOut, role, notifications, onMarkNotifRead, onClearNotifs, darkMode, toggleDark, pendingCount }) {
  return (
    <nav style={{ background:RHex, position:"sticky", top:0, zIndex:200, boxShadow:"0 2px 16px rgba(0,0,0,0.25)" }}>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 1.5rem",
        height:62, display:"flex", alignItems:"center", justifyContent:"space-between" }}>

        <div onClick={() => setPage("home")} style={{ display:"flex", alignItems:"center", gap:"0.7rem", cursor:"pointer" }}>
          <span style={{ fontSize:"1.6rem" }}>🚲</span>
          <div>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:"#fff", fontWeight:"bold", lineHeight:1 }}>UofL Bikeshare</div>
            <div style={{ fontSize:"0.48rem", color:"rgba(255,255,255,0.6)", textTransform:"uppercase", letterSpacing:"0.22em" }}>Sustainability · University of Louisville</div>
          </div>
        </div>

        <div style={{ display:"flex", gap:"0.2rem", alignItems:"center" }}>
          {(role === "admin"
            ? [{key:"about",label:"About"},{key:"howitworks",label:"How It Works"},{key:"contact",label:"Contact"}]
            : [{key:"home",label:"Home"},{key:"about",label:"About"},{key:"howitworks",label:"How It Works"},{key:"contact",label:"Contact"}]
          ).map(({ key, label }) => (
            <button key={key} onClick={() => setPage(key)}
              style={{ background:page===key?"rgba(255,255,255,0.2)":"transparent",
                border:"none", color:"#fff", padding:"0.45rem 0.85rem",
                borderRadius:6, cursor:"pointer", fontSize:"0.8rem",
                fontFamily:"inherit", fontWeight:page===key?700:400, transition:"background 0.15s" }}
              onMouseEnter={e => { if (page!==key) e.currentTarget.style.background="rgba(255,255,255,0.12)"; }}
              onMouseLeave={e => { if (page!==key) e.currentTarget.style.background="transparent"; }}>
              {label}
            </button>
          ))}
          {role !== "admin" && (
            <button onClick={() => setPage("myrentals")}
              style={{ background:page==="myrentals"?"rgba(255,255,255,0.2)":"transparent",
                border:"none", color:"#fff", padding:"0.45rem 0.85rem",
                borderRadius:6, cursor:"pointer", fontSize:"0.8rem", fontFamily:"inherit" }}>
              📋 My Rentals
            </button>
          )}
          {role === "admin" && (
            <button onClick={() => setPage("admin")}
              style={{ background:page==="admin"?"rgba(255,255,255,0.2)":"transparent",
                border:"none", color:"#fff", padding:"0.45rem 0.85rem",
                borderRadius:6, cursor:"pointer", fontSize:"0.8rem", fontFamily:"inherit",
                fontWeight:page==="admin"?700:400, position:"relative" }}>
              🛠 Admin
              {pendingCount > 0 && (
                <span style={{ position:"absolute", top:-4, right:-4, background:"#ff4444",
                  color:"#fff", fontSize:"0.58rem", fontWeight:700, width:16, height:16,
                  borderRadius:"50%", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:"0.6rem" }}>
          <button onClick={toggleDark}
            style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)",
              color:"#fff", width:38, height:38, borderRadius:8, cursor:"pointer",
              fontSize:"1rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {darkMode ? "☀️" : "🌙"}
          </button>
          {role === "admin" && (
            <NotificationBell notifications={notifications} onMarkRead={onMarkNotifRead} onClearAll={onClearNotifs} />
          )}
          <button onClick={() => setPage("profile")}
            style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)",
              color:"#fff", padding:"0.3rem 0.75rem", borderRadius:8, cursor:"pointer",
              fontSize:"0.75rem", fontFamily:"inherit" }}>
            👤 {userProfile?.firstName}
          </button>
          <Btn onClick={onSignOut} variant="ghost"
            style={{ color:"#fff", borderColor:"rgba(255,255,255,0.4)", fontSize:"0.72rem", padding:"0.3rem 0.7rem" }} small>
            Sign Out
          </Btn>
        </div>
      </div>
    </nav>
  );
}

// ── FOOTER ─────────────────────────────────────────────────────
function Footer({ setPage }) {
  return (
    <footer style={{ background:"#111", color:"#ccc", marginTop:"auto" }}>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"3rem 1.5rem 2rem",
        display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:"3rem" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", marginBottom:"1rem" }}>
            <span style={{ fontSize:"1.8rem" }}>🚲</span>
            <div>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:"#fff", fontWeight:"bold" }}>UofL Bikeshare</div>
              <div style={{ fontSize:"0.6rem", color:"#888", textTransform:"uppercase", letterSpacing:"0.18em" }}>University of Louisville</div>
            </div>
          </div>
          <p style={{ fontSize:"0.82rem", lineHeight:1.8, color:"#999", maxWidth:320 }}>
            The UofL Free Bikeshare Program helps you ditch the car and discover the joys of getting around under your own power. Open to all UofL students, faculty, and staff.
          </p>
          <div style={{ marginTop:"1.2rem" }}>
            <a href="https://louisville.edu/sustainability/operations/bikeshare" target="_blank" rel="noreferrer"
              style={{ background:"rgba(173,0,0,0.3)", border:"1px solid "+RHex, color:"#fff",
                padding:"0.35rem 0.8rem", borderRadius:20, fontSize:"0.72rem",
                textDecoration:"none", display:"inline-flex", alignItems:"center", gap:"0.3rem" }}>
              🌐 UofL Sustainability
            </a>
          </div>
          <div style={{ marginTop:"1rem" }}>
            <div style={{ fontSize:"0.62rem", color:"#666", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"0.5rem" }}>Follow Us — Coming Soon</div>
            <div style={{ display:"flex", gap:"0.5rem" }}>
              {["📘 Facebook","📸 Instagram","🐦 Twitter/X"].map(s => (
                <span key={s} style={{ background:"#222", border:"1px solid #333", color:"#666", padding:"0.28rem 0.6rem", borderRadius:4, fontSize:"0.68rem" }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize:"0.65rem", textTransform:"uppercase", letterSpacing:"0.18em", color:RHex, fontWeight:700, marginBottom:"1rem" }}>Quick Links</div>
          {[["Home","home"],["About the Program","about"],["How It Works","howitworks"],["Browse Bikes","home"],["My Rentals","myrentals"],["Contact Us","contact"]].map(([label,key]) => (
            <div key={label} style={{ marginBottom:"0.6rem" }}>
              <span onClick={() => { setPage(key); window.scrollTo(0,0); }}
                style={{ color:"#aaa", fontSize:"0.82rem", cursor:"pointer" }}
                onMouseEnter={e => (e.currentTarget.style.color="#fff")}
                onMouseLeave={e => (e.currentTarget.style.color="#aaa")}>
                → {label}
              </span>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize:"0.65rem", textTransform:"uppercase", letterSpacing:"0.18em", color:RHex, fontWeight:700, marginBottom:"1rem" }}>Contact Us</div>
          {[
            ["📧","Email","cycleadmin@gmail.com","mailto:cycleadmin@gmail.com"],
            ["🏛️","Department","UofL Sustainability","https://louisville.edu/sustainability"],
            ["📍","Location","UofL Urban & Public Affairs","https://www.google.com/maps/place/University+Of+Louisville+Urban+%26+Public+Affairs/@38.2220385,-85.7742008,2377m/data=!3m2!1e3!4b1!4m6!3m5!1s0x88690d5ef904c3b3:0xedd39dac5a3b460d!8m2!3d38.2220389!4d-85.763901"],
          ].map(([icon,label,val,href]) => (
            <div key={label} style={{ marginBottom:"0.9rem" }}>
              <div style={{ fontSize:"0.6rem", color:"#666", textTransform:"uppercase", letterSpacing:"0.12em" }}>{label}</div>
              <a href={href} target="_blank" rel="noreferrer"
                style={{ color:"#ccc", fontSize:"0.82rem", textDecoration:"none" }}
                onMouseEnter={e => (e.currentTarget.style.color="#fff")}
                onMouseLeave={e => (e.currentTarget.style.color="#ccc")}>
                {icon} {val}
              </a>
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop:"1px solid #222", padding:"1rem 1.5rem",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        maxWidth:1200, margin:"0 auto" }}>
        <div style={{ fontSize:"0.72rem", color:"#555" }}>© 2025 UofL Bikeshare · University of Louisville Sustainability</div>
        <div style={{ display:"flex", gap:"1.2rem" }}>
          {[["Privacy Policy","https://louisville.edu/privacy"],["Terms of Use","https://louisville.edu/about-ul/terms-of-use"],["Accessibility","https://louisville.edu/accessibility"]].map(([l,href]) => (
            <a key={l} href={href} target="_blank" rel="noreferrer"
              style={{ fontSize:"0.72rem", color:"#555", textDecoration:"none" }}
              onMouseEnter={e => (e.currentTarget.style.color="#aaa")}
              onMouseLeave={e => (e.currentTarget.style.color="#555")}>
              {l}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

// ── ABOUT PAGE ─────────────────────────────────────────────────
function AboutPage() {
  return (
    <div style={{ background:BG, minHeight:"100vh" }}>
      <div style={{ background:"linear-gradient(135deg, #7A0000 0%, "+RHex+" 60%, #1a1a1a 100%)",
        padding:"5rem 1.5rem", textAlign:"center", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, opacity:0.08,
          backgroundImage:"repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)",
          backgroundSize:"20px 20px" }} />
        <div style={{ position:"relative" }}>
          <div style={{ fontSize:"4rem", marginBottom:"1rem" }}>🚲</div>
          <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2.8rem", color:"#fff", margin:"0 0 1rem", lineHeight:1.2 }}>About UofL Bikeshare</h1>
          <p style={{ fontSize:"1.1rem", color:"rgba(255,255,255,0.8)", maxWidth:600, margin:"0 auto", lineHeight:1.8 }}>
            Sustainable transportation for the University of Louisville community — free for all students, faculty, and staff.
          </p>
        </div>
      </div>

      <div style={{ maxWidth:1000, margin:"0 auto", padding:"3rem 1.5rem" }}>
        <div style={{ background:SURF, borderRadius:16, padding:"2.5rem", border:"1px solid "+BORDER, marginBottom:"2rem", boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
          <div style={{ display:"flex", gap:"1rem", alignItems:"flex-start" }}>
            <div style={{ background:RHex, borderRadius:12, padding:"0.8rem", fontSize:"1.8rem", lineHeight:1, flexShrink:0 }}>🌿</div>
            <div>
              <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.6rem", color:BLACK, margin:"0 0 0.8rem" }}>Our Mission</h2>
              <p style={{ fontSize:"0.95rem", color:"#555", lineHeight:1.9, margin:0 }}>
                The UofL Bikeshare Program is a free, sustainable transportation initiative open to all University of Louisville students, faculty, and staff. Launched to promote eco-friendly commuting on campus, the program provides bicycles, helmets, and locks at no cost. Our goal is to reduce car dependency, encourage physical activity, and make getting around the UofL campus easier and more enjoyable for everyone in our community.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"1.2rem", marginBottom:"2rem" }}>
          {[["🚲","150+","Bikes Available"],["📍","1","Campus Location"],["🎓","2009","Est. Year"]].map(([icon,big,label]) => (
            <div key={label} style={{ background:RHex, borderRadius:14, padding:"2rem", textAlign:"center", color:"#fff", boxShadow:"0 4px 16px rgba(173,0,0,0.3)" }}>
              <div style={{ fontSize:"2rem", marginBottom:"0.5rem" }}>{icon}</div>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"2.5rem", fontWeight:"bold", lineHeight:1 }}>{big}</div>
              <div style={{ fontSize:"0.75rem", opacity:0.8, marginTop:"0.3rem", textTransform:"uppercase", letterSpacing:"0.12em" }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ background:SURF, borderRadius:16, padding:"2.5rem", border:"1px solid "+BORDER, marginBottom:"2rem", boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
          <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.6rem", color:BLACK, margin:"0 0 1.5rem" }}>How the Program Works</h2>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1.2rem" }}>
            {[["🪪","Show Your UofL ID","Present your valid UofL ID at the bikeshare checkout location to borrow a bike, helmet, and lock — completely free."],
              ["📋","Sign the Waiver","Complete the Assumption of Risk and Waiver Form digitally through our platform before checking out your bicycle."],
              ["🔒","Use the U-Lock","Always lock your bike securely with the provided U-lock whenever you park. Lock the frame and wheel!"],
              ["⏰","Return on Time","Bikes are due back before the facility closes. A late fee of $5/day applies."]
            ].map(([icon,title,desc]) => (
              <div key={title} style={{ display:"flex", gap:"0.9rem", padding:"1.2rem", background:LGRAY, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ fontSize:"1.6rem", flexShrink:0, lineHeight:1, marginTop:"0.1rem" }}>{icon}</div>
                <div>
                  <div style={{ fontSize:"0.9rem", fontWeight:700, color:BLACK, marginBottom:"0.3rem" }}>{title}</div>
                  <div style={{ fontSize:"0.8rem", color:"#666", lineHeight:1.7 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:"#1a1a1a", borderRadius:16, padding:"2.5rem", marginBottom:"2rem", border:"1px solid #333" }}>
          <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.5rem", color:"#fff", margin:"0 0 1rem" }}>⚠️ Financial Responsibility</h2>
          <p style={{ fontSize:"0.88rem", color:"#aaa", lineHeight:1.8, marginBottom:"1.2rem" }}>You are responsible for the care and on-time return of the bicycle. If lost, stolen, or damaged due to your neglect, the following replacement costs apply:</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.8rem" }}>
            {[["🚲","Bicycle","$200"],["⛑️","Helmet","$30"],["🔒","Lock","$30"],["🔑","Key","$10"]].map(([icon,item,cost]) => (
              <div key={item} style={{ background:"#2a2a2a", borderRadius:10, padding:"1rem", textAlign:"center", border:"1px solid #333" }}>
                <div style={{ fontSize:"1.4rem", marginBottom:"0.3rem" }}>{icon}</div>
                <div style={{ color:"#fff", fontSize:"0.82rem", fontWeight:600 }}>{item}</div>
                <div style={{ color:RHex, fontSize:"1.1rem", fontWeight:"bold", marginTop:"0.3rem" }}>{cost}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:SURF, borderRadius:16, padding:"2.5rem", border:"1px solid "+BORDER, boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
          <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.6rem", color:BLACK, margin:"0 0 1.2rem" }}>Who Can Use the Program?</h2>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"1rem" }}>
            {[["🎓","Students","All enrolled UofL students with a valid UofL ID"],["👩‍🏫","Faculty","UofL faculty members across all campuses"],["🏢","Staff","University employees and administrative staff"]].map(([icon,title,desc]) => (
              <div key={title} style={{ textAlign:"center", padding:"1.5rem", background:LGRAY, borderRadius:12, border:"1px solid "+BORDER }}>
                <div style={{ fontSize:"2.5rem", marginBottom:"0.6rem" }}>{icon}</div>
                <div style={{ fontWeight:700, color:BLACK, fontSize:"1rem", marginBottom:"0.4rem" }}>{title}</div>
                <div style={{ fontSize:"0.78rem", color:MUTED, lineHeight:1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HOW IT WORKS ───────────────────────────────────────────────
function HowItWorksPage({ setPage }) {
  const steps = [
    { num:"01", icon:"👤", title:"Create Your Account", desc:"Sign up with your @louisville.edu email. Choose Student, Staff, or Faculty. A verification email confirms your account.", color:RHex },
    { num:"02", icon:"🔍", title:"Browse Available Bikes", desc:"After logging in, browse all currently available bicycles. Filter by type, size, or search by brand.", color:"#c0392b" },
    { num:"03", icon:"🚲", title:"Request to Rent", desc:"Click 'Rent This Bike', read the UofL Waiver Form, fill in your details and submit your request.", color:"#8B0000" },
    { num:"04", icon:"📋", title:"Admin Approval", desc:"Your request goes to the Bikeshare admin team. You'll be notified once approved or if more info is needed.", color:"#7A0000" },
    { num:"05", icon:"🪪", title:"Pick Up Your Bike", desc:"Visit the pickup location with your UofL ID. Admin scans the bike QR code to confirm. Helmet and lock included!", color:"#6B0000" },
    { num:"06", icon:"⏰", title:"Return on Time", desc:"Return the bike before closing. Late fees of $5/day apply. Lost or damaged equipment must be replaced.", color:"#5A0000" },
  ];
  return (
    <div style={{ background:BG, minHeight:"100vh" }}>
      <div style={{ background:BLACK, padding:"4rem 1.5rem", textAlign:"center", borderBottom:"3px solid "+RHex }}>
        <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>📖</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2.5rem", color:"#fff", margin:"0 0 1rem" }}>How It Works</h1>
        <p style={{ fontSize:"1rem", color:"rgba(255,255,255,0.6)", maxWidth:500, margin:"0 auto", lineHeight:1.8 }}>6 simple steps to start riding campus for free.</p>
      </div>
      <div style={{ maxWidth:900, margin:"0 auto", padding:"3rem 1.5rem" }}>
        {steps.map(({ num, icon, title, desc, color }) => (
          <div key={num} style={{ display:"flex", gap:"1.5rem", marginBottom:"1.5rem",
            background:SURF, borderRadius:14, padding:"1.8rem",
            border:"1px solid "+BORDER, boxShadow:"0 3px 14px rgba(0,0,0,0.06)",
            transition:"transform 0.2s, box-shadow 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.transform="translateX(6px)"; e.currentTarget.style.boxShadow="0 6px 20px rgba(173,0,0,0.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="0 3px 14px rgba(0,0,0,0.06)"; }}>
            <div style={{ flexShrink:0, textAlign:"center" }}>
              <div style={{ background:color, width:56, height:56, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.5rem", marginBottom:"0.3rem" }}>{icon}</div>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.4rem", color, fontWeight:"bold" }}>{num}</div>
            </div>
            <div>
              <h3 style={{ fontFamily:"Georgia,serif", fontSize:"1.25rem", color:BLACK, margin:"0 0 0.6rem" }}>{title}</h3>
              <p style={{ fontSize:"0.88rem", color:"#666", lineHeight:1.8, margin:0 }}>{desc}</p>
            </div>
          </div>
        ))}
        <div style={{ background:RHex, borderRadius:16, padding:"2.5rem", textAlign:"center", boxShadow:"0 8px 30px rgba(173,0,0,0.3)" }}>
          <div style={{ fontSize:"2rem", marginBottom:"0.8rem" }}>🚲</div>
          <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.8rem", color:"#fff", margin:"0 0 0.6rem" }}>Ready to Ride?</h2>
          <p style={{ color:"rgba(255,255,255,0.8)", fontSize:"0.9rem", marginBottom:"1.5rem" }}>Browse available bikes and submit your rental request today.</p>
          <Btn onClick={() => setPage("home")} variant="dark" style={{ fontSize:"0.9rem", padding:"0.75rem 2rem" }}>Browse Available Bikes →</Btn>
        </div>
      </div>
    </div>
  );
}

// ── CONTACT PAGE ───────────────────────────────────────────────
function ContactPage() {
  const [form, setForm] = useState({ name:"", email:"", subject:"", message:"" });
  const [sent, setSent] = useState(false);
  const f = k => v => setForm(p => ({ ...p, [k]:v }));
  const submit = async () => {
    if (!form.name||!form.email||!form.message) return;
    try { await addDoc(collection(db, "contactMessages"), { ...form, sentAt:Date.now(), read:false }); setSent(true); }
    catch (e) { console.error(e); }
  };
  return (
    <div style={{ background:BG, minHeight:"100vh" }}>
      <div style={{ background:BLACK, padding:"4rem 1.5rem", textAlign:"center", borderBottom:"3px solid "+RHex }}>
        <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>📬</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2.5rem", color:"#fff", margin:"0 0 1rem" }}>Contact Us</h1>
        <p style={{ fontSize:"1rem", color:"rgba(255,255,255,0.6)", maxWidth:500, margin:"0 auto" }}>Have questions about the Bikeshare program? We're here to help.</p>
      </div>
      <div style={{ maxWidth:900, margin:"0 auto", padding:"3rem 1.5rem", display:"grid", gridTemplateColumns:"1fr 1.3fr", gap:"2rem" }}>
        <div>
          <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.5rem", color:BLACK, marginBottom:"1.5rem" }}>Get in Touch</h2>
          {[
            ["📧","Email","cycleadmin@gmail.com","mailto:cycleadmin@gmail.com"],
            ["🏛️","Department","UofL Sustainability","https://louisville.edu/sustainability"],
            ["📍","Location","UofL Urban & Public Affairs","https://www.google.com/maps/place/University+Of+Louisville+Urban+%26+Public+Affairs/@38.2220385,-85.7742008,2377m/data=!3m2!1e3!4b1!4m6!3m5!1s0x88690d5ef904c3b3:0xedd39dac5a3b460d!8m2!3d38.2220389!4d-85.763901"],
          ].map(([icon,label,val,href]) => (
            <div key={label} style={{ display:"flex", gap:"1rem", marginBottom:"1.2rem", padding:"1.1rem", background:SURF, borderRadius:10, border:"1px solid "+BORDER }}>
              <div style={{ background:RHex, width:42, height:42, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", flexShrink:0 }}>{icon}</div>
              <div>
                <div style={{ fontSize:"0.62rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED }}>{label}</div>
                <a href={href} target="_blank" rel="noreferrer" style={{ color:BLACK, fontSize:"0.88rem", fontWeight:500, textDecoration:"none" }}
                  onMouseEnter={e => (e.currentTarget.style.color=RHex)} onMouseLeave={e => (e.currentTarget.style.color=BLACK)}>{val}</a>
              </div>
            </div>
          ))}
          <div style={{ padding:"1.2rem", background:LGRAY, borderRadius:10, border:"1px solid "+BORDER }}>
            <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, marginBottom:"0.7rem" }}>Social Media — Coming Soon</div>
            {["📘 Facebook","📸 Instagram","🐦 Twitter/X"].map(s => <div key={s} style={{ color:"#aaa", fontSize:"0.82rem", padding:"0.3rem 0" }}>{s}</div>)}
          </div>
        </div>
        <div style={{ background:SURF, borderRadius:16, padding:"2rem", border:"1px solid "+BORDER, boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
          {sent ? (
            <div style={{ textAlign:"center", padding:"3rem 1rem" }}>
              <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>✅</div>
              <h3 style={{ fontFamily:"Georgia,serif", color:BLACK, marginBottom:"0.5rem" }}>Message Sent!</h3>
              <p style={{ color:MUTED, fontSize:"0.88rem" }}>We'll get back to you as soon as possible.</p>
              <Btn onClick={() => { setSent(false); setForm({ name:"",email:"",subject:"",message:"" }); }} variant="secondary" style={{ marginTop:"1.5rem" }}>Send Another</Btn>
            </div>
          ) : (
            <>
              <h3 style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:BLACK, marginBottom:"1.5rem" }}>Send a Message</h3>
              <Field label="Your Name" required><Input value={form.name} onChange={f("name")} placeholder="John Doe" /></Field>
              <Field label="Email Address" required><Input value={form.email} onChange={f("email")} placeholder="you@louisville.edu" type="email" /></Field>
              <Field label="Subject"><Input value={form.subject} onChange={f("subject")} placeholder="Question about bike rental…" /></Field>
              <Field label="Message" required>
                <textarea value={form.message} onChange={e => f("message")(e.target.value)} placeholder="Tell us how we can help…"
                  style={{ width:"100%", background:BG, border:"1px solid "+BORDER, color:BLACK, fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none", resize:"vertical", minHeight:120 }} />
              </Field>
              <Btn onClick={submit} disabled={!form.name||!form.email||!form.message} full style={{ marginTop:"0.5rem", padding:"0.75rem" }}>Send Message 📤</Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PROFILE PAGE ───────────────────────────────────────────────
function ProfilePage({ userProfile, setUserProfile }) {
  const [editing, setEditing]       = useState(false);
  const [form, setForm]             = useState({ phone:userProfile?.phone||"", userType:userProfile?.userType||"" });
  const [saving, setSaving]         = useState(false);
  const [rentalCount, setRentalCount] = useState(0);
  const f = k => v => setForm(p => ({ ...p, [k]:v }));

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "rentalRequests"), where("userId","==",userProfile?.uid||""));
        const snap = await getDocs(q);
        setRentalCount(snap.size);
      } catch (e) { console.error(e); }
    })();
  }, [userProfile]);

  const save = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", userProfile.uid), { phone:form.phone, userType:form.userType });
      setUserProfile(p => ({ ...p, ...form }));
      setEditing(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const badge = getRentalBadge(rentalCount);
  return (
    <div style={{ background:BG, minHeight:"100vh" }}>
      <div style={{ background:"linear-gradient(135deg, #7A0000 0%, "+RHex+" 100%)", padding:"4rem 1.5rem", textAlign:"center" }}>
        <div style={{ width:80, height:80, borderRadius:"50%", background:"rgba(255,255,255,0.2)", border:"3px solid rgba(255,255,255,0.5)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"2.5rem", margin:"0 auto 1rem" }}>👤</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2rem", color:"#fff", margin:"0 0 0.4rem" }}>{userProfile?.firstName} {userProfile?.lastName}</h1>
        <div style={{ fontSize:"0.8rem", color:"rgba(255,255,255,0.7)" }}>{userProfile?.email}</div>
        {badge && (
          <div style={{ marginTop:"1rem", display:"inline-flex", alignItems:"center", gap:"0.5rem", background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", padding:"0.4rem 1rem", borderRadius:20, color:"#fff", fontSize:"0.82rem" }}>
            {badge.icon} {badge.label}
          </div>
        )}
      </div>
      <div style={{ maxWidth:700, margin:"0 auto", padding:"2rem 1.5rem" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"1rem", marginBottom:"2rem" }}>
          {[["📋",rentalCount,"Total Rentals"],["🎓",userProfile?.userType||"—","User Type"],["📅",userProfile?.createdAt?fmtDate(userProfile.createdAt):"—","Member Since"]].map(([icon,val,label]) => (
            <div key={label} style={{ background:SURF, borderRadius:12, padding:"1.2rem", textAlign:"center", border:"1px solid "+BORDER, boxShadow:"0 3px 12px rgba(173,0,0,0.06)" }}>
              <div style={{ fontSize:"1.6rem", marginBottom:"0.4rem" }}>{icon}</div>
              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:RHex, fontWeight:"bold" }}>{val}</div>
              <div style={{ fontSize:"0.68rem", color:MUTED, textTransform:"uppercase", letterSpacing:"0.12em", marginTop:"0.2rem" }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ background:SURF, borderRadius:16, padding:"2rem", border:"1px solid "+BORDER, boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem", paddingBottom:"0.8rem", borderBottom:"1px solid "+BORDER }}>
            <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:BLACK, margin:0 }}>Profile Details</h2>
            {!editing && <Btn onClick={() => setEditing(true)} variant="secondary" small>✎ Edit Profile</Btn>}
          </div>
          {[["First Name",userProfile?.firstName],["Middle Name",userProfile?.middleName||"—"],["Last Name",userProfile?.lastName],["Email Address",userProfile?.email]].map(([label,val]) => (
            <div key={label} style={{ display:"grid", gridTemplateColumns:"140px 1fr", gap:"1rem", marginBottom:"0.8rem", padding:"0.6rem 0", borderBottom:"1px solid "+LGRAY }}>
              <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED }}>{label}</div>
              <div style={{ fontSize:"0.9rem", color:BLACK, fontWeight:500 }}>{val}</div>
            </div>
          ))}
          {editing ? (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"140px 1fr", gap:"1rem", marginBottom:"0.8rem", padding:"0.6rem 0", borderBottom:"1px solid "+LGRAY }}>
                <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, paddingTop:"0.5rem" }}>Phone Number</div>
                <Input value={form.phone} onChange={f("phone")} placeholder="502-555-0100" type="tel" />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"140px 1fr", gap:"1rem", marginBottom:"1.5rem", padding:"0.6rem 0", borderBottom:"1px solid "+LGRAY }}>
                <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, paddingTop:"0.5rem" }}>I am a…</div>
                <Sel value={form.userType} onChange={f("userType")} options={["Student","Staff","Faculty"]} />
              </div>
              <div style={{ display:"flex", gap:"0.8rem" }}>
                <Btn onClick={() => setEditing(false)} variant="ghost">Cancel</Btn>
                <Btn onClick={save} disabled={saving} style={{ flex:1 }}>{saving?"Saving…":"Save Changes"}</Btn>
              </div>
            </>
          ) : (
            [["Phone Number",userProfile?.phone||"—"],["User Type",userProfile?.userType||"—"]].map(([label,val]) => (
              <div key={label} style={{ display:"grid", gridTemplateColumns:"140px 1fr", gap:"1rem", marginBottom:"0.8rem", padding:"0.6rem 0", borderBottom:"1px solid "+LGRAY }}>
                <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED }}>{label}</div>
                <div style={{ fontSize:"0.9rem", color:BLACK, fontWeight:500 }}>{val}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── MY RENTALS PAGE ────────────────────────────────────────────
function MyRentalsPage({ userProfile, bikes, onRent }) {
  const [rentals, setRentals]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState("rentals");

  useEffect(() => {
    (async () => {
      try {
        // fetch by userId
        const q1 = query(collection(db, "rentalRequests"), where("userId","==",userProfile?.uid||""));
        const snap1 = await getDocs(q1);
        // also fetch by email as fallback for older requests
        const q2 = query(collection(db, "rentalRequests"), where("email","==",userProfile?.email||""));
        const snap2 = await getDocs(q2);
        // merge and deduplicate
        const seen = new Set();
        const data = [...snap1.docs, ...snap2.docs]
          .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
          .map(d => ({ id:d.id, ...d.data() }))
          .sort((a,b) => (b.submittedAt||0) - (a.submittedAt||0));
        setRentals(data);
      } catch (e) { console.error(e); }
      try {
        const q = query(collection(db, "favorites"), where("userId","==",userProfile?.uid||""));
        setFavorites((await getDocs(q)).docs.map(d => ({ id:d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [userProfile]);

  const removeFav = async favId => {
    try { await deleteDoc(doc(db, "favorites", favId)); setFavorites(prev => prev.filter(f => f.id!==favId)); }
    catch (e) { console.error(e); }
  };

  const favBikes = bikes.filter(b => favorites.some(f => f.bikeId===b.id));

  return (
    <div style={{ background:BG, minHeight:"100vh" }}>
      <div style={{ background:BLACK, padding:"3rem 1.5rem", textAlign:"center", borderBottom:"3px solid "+RHex }}>
        <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>📋</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2.2rem", color:"#fff", margin:"0 0 0.4rem" }}>My Rentals</h1>
        <p style={{ fontSize:"0.9rem", color:"rgba(255,255,255,0.6)" }}>Track your rental requests and favorite bikes</p>
      </div>
      <div style={{ display:"flex", background:SURF, borderBottom:"2px solid "+BORDER, maxWidth:900, margin:"0 auto" }}>
        {[["rentals","📋 My Rentals"],["favorites","❤️ Favorites"]].map(([key,label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{ flex:1, padding:"0.85rem", fontFamily:"inherit", fontSize:"0.8rem",
              textTransform:"uppercase", letterSpacing:"0.1em", border:"none", cursor:"pointer",
              background:activeTab===key?RHex:"transparent", color:activeTab===key?"#fff":MUTED }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ maxWidth:900, margin:"0 auto", padding:"2rem 1.5rem" }}>
        {activeTab === "rentals" && (
          loading ? (
            <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>Loading your rentals…</div>
          ) : rentals.length === 0 ? (
            <div style={{ textAlign:"center", padding:"4rem", background:SURF, borderRadius:16, border:"1px solid "+BORDER }}>
              <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
              <h3 style={{ fontFamily:"Georgia,serif", color:BLACK, marginBottom:"0.5rem" }}>No Rentals Yet</h3>
              <p style={{ color:MUTED, fontSize:"0.88rem" }}>Browse available bikes and submit your first rental request!</p>
            </div>
          ) : rentals.map(r => {
            const st = REQUEST_STATUS[r.status]||REQUEST_STATUS.Pending;
            const dl = daysLeft(r.returnDate);
            const isOverdue = r.status==="Approved" && dl !== null && dl < 0;
            return (
              <div key={r.id} style={{ background:SURF, borderRadius:14, padding:"1.5rem",
                border:"1px solid "+(isOverdue?"#c0392b":BORDER), marginBottom:"1rem",
                boxShadow:"0 3px 14px rgba(0,0,0,0.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"0.8rem" }}>
                  <div>
                    <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:BLACK }}>{r.bikeBrand} {r.bikeModel}</div>
                    {r.bikeCode && <div style={{ fontSize:"0.7rem", color:RHex, fontFamily:"monospace", marginTop:"0.1rem" }}>#{r.bikeCode}</div>}
                    <div style={{ fontSize:"0.72rem", color:MUTED, marginTop:"0.2rem" }}>Submitted {timeAgo(r.submittedAt)}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ background:st.bg, color:st.color, fontSize:"0.72rem", fontWeight:700, padding:"0.25rem 0.7rem", borderRadius:20, textTransform:"uppercase" }}>{r.status}</span>
                    {isOverdue && <div style={{ fontSize:"0.68rem", color:"#c0392b", marginTop:"0.3rem", fontWeight:700 }}>⚠ OVERDUE</div>}
                  </div>
                </div>
                {r.status==="Approved" && (
                  <div style={{ background:"#d8f3dc", borderRadius:10, padding:"0.8rem 1rem", marginBottom:"0.8rem", border:"1px solid #b7e4c7" }}>
                    <div style={{ fontSize:"0.8rem", color:GREEN, fontWeight:700 }}>✅ Your rental is approved!</div>
                    {r.returnDate && (
                      <div style={{ fontSize:"0.8rem", color:"#555", marginTop:"0.2rem" }}>
                        Return by: <strong>{fmtDate(r.returnDate)}</strong>
                        {dl !== null && <span style={{ marginLeft:"0.5rem", color:dl<0?"#c0392b":dl<=2?"#a0621a":GREEN, fontWeight:600 }}>
                          {dl<0 ? "("+Math.abs(dl)+" days overdue)" : dl===0 ? "(due today)" : "("+dl+" days left)"}
                        </span>}
                      </div>
                    )}
                    <div style={{ fontSize:"0.78rem", color:"#666", marginTop:"0.3rem" }}>📍 Visit pickup location with your UofL ID to collect the bike.</div>
                  </div>
                )}
                {r.status==="Active" && (
                  <div style={{ background:"#e8f4fd", borderRadius:10, padding:"0.8rem 1rem", marginBottom:"0.8rem", border:"1px solid #a8d4f0" }}>
                    <div style={{ fontSize:"0.8rem", color:"#1a6ba0", fontWeight:700 }}>🚲 Bike is with you — enjoy your ride!</div>
                    {r.returnDate && (
                      <div style={{ fontSize:"0.8rem", color:"#555", marginTop:"0.2rem" }}>
                        Return by: <strong>{fmtDate(r.returnDate)}</strong>
                        {dl !== null && <span style={{ marginLeft:"0.5rem", color:dl<0?"#c0392b":dl<=2?"#a0621a":GREEN, fontWeight:600 }}>
                          {dl<0 ? "("+Math.abs(dl)+" days overdue!)" : dl===0 ? "(due today!)" : "("+dl+" day"+(dl!==1?"s":""+" left)")}</span>}
                      </div>
                    )}
                    <div style={{ fontSize:"0.78rem", color:"#666", marginTop:"0.3rem" }}>🔒 Remember to lock the bike when parked. Return before closing time!</div>
                    {r.pickedUpAt && <div style={{ fontSize:"0.72rem", color:"#888", marginTop:"0.2rem" }}>Picked up: {fmtDate(r.pickedUpAt)}</div>}
                  </div>
                )}
                {r.status==="Returned" && (
                  <div style={{ background:LGRAY, borderRadius:10, padding:"0.8rem 1rem", marginBottom:"0.8rem", border:"1px solid "+BORDER }}>
                    <div style={{ fontSize:"0.8rem", color:MUTED, fontWeight:700 }}>📦 Bike returned — thank you!</div>
                    {r.returnedAt && <div style={{ fontSize:"0.78rem", color:MUTED, marginTop:"0.2rem" }}>Returned on: {fmtDate(r.returnedAt)}</div>}
                  </div>
                )}
                {r.status==="Rejected" && r.rejectReason && (
                  <div style={{ background:"#fde8e8", borderRadius:10, padding:"0.8rem", border:"1px solid #f5c6c6", marginBottom:"0.8rem" }}>
                    <div style={{ fontSize:"0.78rem", color:"#c0392b" }}><strong>Reason:</strong> {r.rejectReason}</div>
                  </div>
                )}
                {r.checkOutItems && (
                  <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
                    {Object.entries(r.checkOutItems).filter(([,v])=>v).map(([k]) => (
                      <span key={k} style={{ fontSize:"0.68rem", background:LGRAY, border:"1px solid "+BORDER, padding:"0.15rem 0.5rem", borderRadius:20, textTransform:"capitalize" }}>{k}</span>
                    ))}
                  </div>
                )}
                {r.status==="Approved" && bikes.find(b => b.id===r.bikeId && b.status==="Available") && (
                  <div style={{ marginTop:"0.8rem" }}>
                    <Btn onClick={() => onRent(bikes.find(b => b.id===r.bikeId))} variant="secondary" small>🔄 Rent Again</Btn>
                  </div>
                )}
              </div>
            );
          })
        )}
        {activeTab === "favorites" && (
          favBikes.length === 0 ? (
            <div style={{ textAlign:"center", padding:"4rem", background:SURF, borderRadius:16, border:"1px solid "+BORDER }}>
              <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>❤️</div>
              <h3 style={{ fontFamily:"Georgia,serif", color:BLACK, marginBottom:"0.5rem" }}>No Favorites Yet</h3>
              <p style={{ color:MUTED, fontSize:"0.88rem" }}>Tap the ❤️ on any bike to save it here.</p>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:"1rem" }}>
              {favBikes.map(bike => {
                const fav = favorites.find(f => f.bikeId===bike.id);
                return (
                  <div key={bike.id} style={{ background:SURF, border:"1px solid "+BORDER, borderRadius:14, overflow:"hidden" }}>
                    {bike.imageUrl ? <img src={bike.imageUrl} alt={bike.brand} style={{ width:"100%", height:160, objectFit:"cover" }} /> : <div style={{ height:120, background:LGRAY, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"3rem", opacity:0.2 }}>🚲</div>}
                    <div style={{ padding:"0.9rem" }}>
                      <div style={{ fontFamily:"Georgia,serif", fontSize:"1.1rem" }}>{bike.brand}</div>
                      <div style={{ fontSize:"0.72rem", color:MUTED, marginBottom:"0.8rem" }}>{bike.model}{bike.year?" · "+bike.year:""}</div>
                      <div style={{ display:"flex", gap:"0.5rem" }}>
                        <Btn onClick={() => onRent(bike)} style={{ flex:1, fontSize:"0.75rem" }} small>🚲 Rent</Btn>
                        <Btn onClick={() => removeFav(fav.id)} variant="danger" small>✕</Btn>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── WAIVER MODAL ───────────────────────────────────────────────
function WaiverModal({ bike, userProfile, onClose, onSuccess }) {
  const [step, setStep]     = useState(1);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [form, setForm]     = useState({
    fullName:(userProfile?.firstName||"")+" "+(userProfile?.lastName||""),
    uoflId:"", phone:userProfile?.phone||"", email:userProfile?.email||"",
    checkOutItems:{ bicycle:false, helmet:false, lock:false, key:false },
    financialAgreed:false,
  });
  const f = k => v => setForm(p => ({ ...p, [k]:v }));

  const submitWaiver = async () => {
    if (!form.fullName||!form.uoflId||!form.email) { setError("Please fill in all required fields"); return; }
    if (!form.financialAgreed) { setError("Please initial the financial liability section"); return; }
    setSaving(true); setError("");
    try {
      await addDoc(collection(db, "rentalRequests"), {
        bikeId:bike.id, bikeBrand:bike.brand, bikeModel:bike.model,
        bikeCode:bike.bikeCode||"", bikeImageUrl:bike.imageUrl||"",
        userId:userProfile?.uid||"", userType:userProfile?.userType||"",
        ...form, status:"Pending", submittedAt:Date.now(),
      });
      await addDoc(collection(db, "notifications"), {
        message:form.fullName+" submitted a rental request for "+bike.brand+" "+bike.model,
        type:"rental_request", read:false, createdAt:Date.now(),
      });
      // reserve bike immediately so no one else can request it
      const freshSnap = await getDoc(doc(db, "inventory", "bikes"));
      const freshBikes = freshSnap.exists() ? freshSnap.data().list || [] : [];
      const updatedBikes = freshBikes.map(b => b.id===bike.id ? { ...b, status:"Reserved" } : b);
      await setDoc(doc(db, "inventory", "bikes"), { list: updatedBikes });
      setStep(3);
    } catch (e) { setError("Failed to submit. Please try again."); }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", backdropFilter:"blur(6px)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:"1rem" }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:SURF, borderRadius:16, width:620, maxWidth:"98vw", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 24px 70px rgba(0,0,0,0.3)", border:"1px solid "+BORDER }}>
        <div style={{ background:RHex, padding:"1.2rem 1.5rem", display:"flex", justifyContent:"space-between", alignItems:"center", borderRadius:"16px 16px 0 0" }}>
          <div>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:"#fff", fontWeight:"bold" }}>UofL Bikeshare — Rental Request</div>
            <div style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.7)", marginTop:"0.1rem" }}>{bike.brand} {bike.model} · #{bike.bikeCode}</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", color:"#fff", width:32, height:32, borderRadius:6, cursor:"pointer", fontSize:"1rem" }}>✕</button>
        </div>
        <div style={{ display:"flex", borderBottom:"1px solid "+BORDER }}>
          {[["1","Read Waiver"],["2","Fill Details"],["3","Submitted"]].map(([n,label],i) => (
            <div key={n} style={{ flex:1, padding:"0.8rem", textAlign:"center", background:step===i+1?LGRAY:SURF, borderBottom:step===i+1?"3px solid "+RHex:"3px solid transparent" }}>
              <div style={{ fontSize:"0.6rem", textTransform:"uppercase", letterSpacing:"0.12em", color:step===i+1?RHex:MUTED }}>Step {n}</div>
              <div style={{ fontSize:"0.78rem", fontWeight:step===i+1?700:400, color:step===i+1?BLACK:MUTED }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:"1.5rem" }}>
          {step===1 && (
            <>
              <div style={{ background:LGRAY, border:"1px solid "+BORDER, borderRadius:8, padding:"1.2rem", maxHeight:320, overflowY:"auto", marginBottom:"1.2rem", fontSize:"0.78rem", lineHeight:1.9, color:"#444", fontFamily:"Georgia,serif", whiteSpace:"pre-line" }}>{WAIVER_TEXT}</div>
              <label style={{ display:"flex", gap:"0.7rem", alignItems:"flex-start", cursor:"pointer", padding:"0.8rem", background:LGRAY, borderRadius:8, border:"1px solid "+BORDER, marginBottom:"1.2rem" }}>
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width:18, height:18, accentColor:RHex, marginTop:"0.1rem", flexShrink:0 }} />
                <span style={{ fontSize:"0.82rem", color:BLACK, lineHeight:1.6 }}>I have read and understand the UofL Bikeshare Assumption of Risk and Waiver Form. I agree to all terms and conditions.</span>
              </label>
              <div style={{ display:"flex", gap:"0.8rem" }}>
                <Btn onClick={onClose} variant="ghost">Cancel</Btn>
                <Btn onClick={() => setStep(2)} disabled={!agreed} style={{ flex:1 }}>I Agree — Continue →</Btn>
              </div>
            </>
          )}
          {step===2 && (
            <>
              <div style={{ background:"#fde8e8", border:"1px solid #f5c6c6", borderRadius:8, padding:"0.8rem 1rem", marginBottom:"1.2rem", fontSize:"0.78rem", color:"#8B0000" }}>
                🚲 Requesting: <strong>{bike.brand} {bike.model}</strong>{bike.bikeCode&&<> · Code: <strong>#{bike.bikeCode}</strong></>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.7rem" }}>
                <Field label="Full Name" required><Input value={form.fullName} onChange={f("fullName")} placeholder="John Doe" /></Field>
                <Field label="UofL ID #" required><Input value={form.uoflId} onChange={f("uoflId")} placeholder="Student/Employee ID" /></Field>
                <Field label="Phone Number"><Input value={form.phone} onChange={f("phone")} placeholder="502-555-0100" type="tel" /></Field>
                <Field label="Email Address" required><Input value={form.email} onChange={f("email")} placeholder="you@louisville.edu" type="email" /></Field>
              </div>
              <div style={{ margin:"0.8rem 0", padding:"1rem", background:LGRAY, borderRadius:8, border:"1px solid "+BORDER }}>
                <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, marginBottom:"0.7rem" }}>Items Checking Out</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem" }}>
                  {[["bicycle","🚲 Bicycle","$200"],["helmet","⛑️ Helmet","$30"],["lock","🔒 Lock","$30"],["key","🔑 Key","$10"]].map(([k,label,cost]) => (
                    <label key={k} style={{ display:"flex", gap:"0.5rem", alignItems:"center", cursor:"pointer", padding:"0.5rem", background:SURF, borderRadius:6, border:"1px solid "+BORDER }}>
                      <input type="checkbox" checked={form.checkOutItems[k]} onChange={e => setForm(p => ({ ...p, checkOutItems:{ ...p.checkOutItems, [k]:e.target.checked } }))} style={{ accentColor:RHex }} />
                      <span style={{ fontSize:"0.82rem", flex:1 }}>{label}</span>
                      <span style={{ fontSize:"0.75rem", color:RHex, fontWeight:600 }}>{cost}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label style={{ display:"flex", gap:"0.7rem", alignItems:"flex-start", cursor:"pointer", padding:"0.8rem", background:"#fff8f8", borderRadius:8, border:"1px solid #f5c6c6", marginBottom:"1rem" }}>
                <input type="checkbox" checked={form.financialAgreed} onChange={e => f("financialAgreed")(e.target.checked)} style={{ width:18, height:18, accentColor:RHex, marginTop:"0.1rem", flexShrink:0 }} />
                <span style={{ fontSize:"0.78rem", color:BLACK, lineHeight:1.6 }}>✏️ <strong>Initial here:</strong> I agree to the financial liability terms including replacement costs and late fee policy.</span>
              </label>
              <ErrBox msg={error} />
              <div style={{ display:"flex", gap:"0.8rem" }}>
                <Btn onClick={() => setStep(1)} variant="ghost">← Back</Btn>
                <Btn onClick={submitWaiver} disabled={saving} style={{ flex:1 }}>{saving?"Submitting…":"Submit Rental Request ✓"}</Btn>
              </div>
            </>
          )}
          {step===3 && (
            <div style={{ textAlign:"center", padding:"2rem 1rem" }}>
              <div style={{ fontSize:"4rem", marginBottom:"1rem" }}>🎉</div>
              <h2 style={{ fontFamily:"Georgia,serif", color:BLACK, marginBottom:"0.5rem" }}>Request Submitted!</h2>
              <p style={{ color:MUTED, fontSize:"0.88rem", lineHeight:1.8, marginBottom:"1.5rem" }}>Your rental request for <strong>{bike.brand} {bike.model}</strong> has been submitted. The admin team will review shortly.</p>
              <div style={{ background:LGRAY, borderRadius:10, padding:"1rem", border:"1px solid "+BORDER, marginBottom:"1.5rem", textAlign:"left" }}>
                {["Admin reviews your request","You'll be notified when approved","Visit pickup with your UofL ID","Enjoy your ride — return before closing!"].map((s,i) => (
                  <div key={i} style={{ fontSize:"0.82rem", color:"#555", padding:"0.3rem 0", display:"flex", gap:"0.5rem" }}>
                    <span style={{ color:RHex, fontWeight:700 }}>→</span> {s}
                  </div>
                ))}
              </div>
              <Btn onClick={() => { onSuccess(); onClose(); }} style={{ padding:"0.75rem 2rem" }}>Done</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PUBLIC BIKE CARD ───────────────────────────────────────────
function PublicBikeCard({ bike, onRent, isFavorite, onToggleFavorite }) {
  return (
    <div style={{ background:SURF, border:"1px solid "+BORDER, borderRadius:14,
      overflow:"hidden", transition:"box-shadow 0.2s, transform 0.18s", display:"flex", flexDirection:"column" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 10px 32px rgba(173,0,0,0.12)"; e.currentTarget.style.transform="translateY(-4px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}>
      <div style={{ position:"relative" }}>
        {bike.imageUrl ? <img src={bike.imageUrl} alt={bike.brand} style={{ width:"100%", height:200, objectFit:"cover" }} /> : <div style={{ height:160, background:LGRAY, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"3.5rem", opacity:0.2 }}>🚲</div>}
        <button onClick={() => onToggleFavorite(bike)}
          style={{ position:"absolute", top:10, right:10, background:"rgba(255,255,255,0.9)", border:"none", width:36, height:36, borderRadius:"50%", cursor:"pointer", fontSize:"1.2rem", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", transition:"transform 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.transform="scale(1.15)")}
          onMouseLeave={e => (e.currentTarget.style.transform="scale(1)")}>
          {isFavorite?"❤️":"🤍"}
        </button>
      </div>
      <div style={{ padding:"0.7rem 0.9rem 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.14em", background:RHex, color:"#fff", padding:"0.2rem 0.55rem", borderRadius:20 }}>{bike.type||"Bicycle"}</span>
        <span style={{ fontSize:"0.58rem", background:"#fde8e8", color:RHex, fontWeight:600, textTransform:"uppercase", padding:"0.2rem 0.55rem", borderRadius:20 }}>Available</span>
      </div>
      <div style={{ padding:"0.7rem 0.9rem", flex:1 }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:BLACK }}>{bike.brand}</div>
        <div style={{ fontSize:"0.72rem", color:MUTED, marginBottom:"0.7rem" }}>{bike.model}{bike.year?" · "+bike.year:""}{bike.color?" · "+bike.color:""}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.35rem", marginBottom:"0.7rem" }}>
          {[bike.frameSize&&["Frame",bike.frameSize],bike.wheel&&["Wheel",bike.wheel],bike.gears&&["Gears",bike.gears],bike.condition&&["Cond.",bike.condition]].filter(Boolean).map(([l,v]) => (
            <span key={l} style={{ fontSize:"0.63rem", background:LGRAY, border:"1px solid "+BORDER, padding:"0.12rem 0.48rem", borderRadius:20 }}>
              <span style={{ color:MUTED }}>{l}: </span><strong>{v}</strong>
            </span>
          ))}
        </div>
        {bike.bikeCode && <div style={{ fontSize:"0.63rem", color:RHex, background:"#fde8e8", padding:"0.15rem 0.5rem", borderRadius:4, display:"inline-block", fontFamily:"monospace" }}>#{bike.bikeCode}</div>}
      </div>
      <div style={{ padding:"0 0.9rem 0.9rem" }}>
        <button onClick={() => onRent(bike)}
          style={{ width:"100%", background:RHex, color:"#fff", border:"none", padding:"0.7rem", borderRadius:8, cursor:"pointer", fontSize:"0.85rem", fontWeight:700, fontFamily:"inherit", transition:"all 0.18s", boxShadow:"0 3px 12px rgba(173,0,0,0.3)" }}
          onMouseEnter={e => { e.currentTarget.style.background="#8B0000"; e.currentTarget.style.transform="scale(1.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background=RHex; e.currentTarget.style.transform="none"; }}>
          🚲 Rent This Bike
        </button>
      </div>
    </div>
  );
}

// ── ADMIN BIKE CARD ────────────────────────────────────────────
function AdminBikeCard({ bike, onEdit, onDelete, onQR, onToggleAvail }) {
  const st = STATUS_STYLES[bike.status]||STATUS_STYLES.Available;
  return (
    <div style={{ background:SURF, border:"1px solid "+BORDER, borderRadius:12, overflow:"hidden", transition:"box-shadow 0.2s, transform 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 8px 28px rgba(173,0,0,0.12)"; e.currentTarget.style.transform="translateY(-3px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="none"; }}>
      {bike.imageUrl ? <img src={bike.imageUrl} alt={bike.brand} style={{ width:"100%", height:150, objectFit:"cover" }} /> : <div style={{ height:80, background:LGRAY, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"2.5rem", opacity:0.25 }}>🚲</div>}
      <div style={{ padding:"0.65rem 0.9rem 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"0.57rem", textTransform:"uppercase", letterSpacing:"0.14em", background:RHex, color:"#fff", padding:"0.18rem 0.5rem", borderRadius:20 }}>{bike.type||"Bicycle"}</span>
        <span onClick={onToggleAvail} style={{ fontSize:"0.57rem", fontWeight:600, textTransform:"uppercase", background:st.bg, color:st.color, padding:"0.18rem 0.5rem", borderRadius:20, cursor:"pointer", border:"1px solid transparent" }}
          title="Click to toggle Available ↔ In Service"
          onMouseEnter={e => (e.currentTarget.style.border="1px solid "+st.color)}
          onMouseLeave={e => (e.currentTarget.style.border="1px solid transparent")}>
          {bike.status} ↕
        </span>
      </div>
      <div style={{ padding:"0.55rem 0.9rem" }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.1rem" }}>{bike.brand}</div>
        <div style={{ fontSize:"0.7rem", color:MUTED }}>{bike.model}{bike.year?" · "+bike.year:""}{bike.color?" · "+bike.color:""}</div>
        {bike.bikeCode && <div style={{ fontSize:"0.63rem", color:RHex, background:"#fde8e8", padding:"0.15rem 0.5rem", borderRadius:4, display:"inline-block", fontFamily:"monospace", marginTop:"0.3rem" }}>#{bike.bikeCode}</div>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.4rem", padding:"0 0.9rem 0.9rem" }}>
        <Btn onClick={onEdit}   variant="ghost"     small style={{ fontSize:"0.64rem" }}>✎ Edit</Btn>
        <Btn onClick={onQR}     variant="secondary" small style={{ fontSize:"0.64rem" }}>📱 QR</Btn>
        <Btn onClick={onDelete} variant="danger"    small style={{ fontSize:"0.64rem" }}>✕ Del</Btn>
      </div>
    </div>
  );
}

// ── BIKE FORM ──────────────────────────────────────────────────
function BikeForm({ form, setForm, onSubmit, submitLabel, onCancel, imageFile, setImageFile, existingImageUrl }) {
  const fileRef = useRef();
  const f = key => val => setForm(p => ({ ...p, [key]:val }));
  const preview = imageFile ? URL.createObjectURL(imageFile) : existingImageUrl;
  const div = label => <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.18em", color:MUTED, margin:"0.9rem 0 0.5rem", paddingBottom:"0.35rem", borderBottom:"1px solid "+BORDER }}>{label}</div>;
  return (
    <div>
      <Field label="Bike Photo">
        <div onClick={() => fileRef.current.click()} style={{ border:"2px dashed "+BORDER, borderRadius:8, padding:"0.8rem", textAlign:"center", cursor:"pointer", background:BG, transition:"border-color 0.2s" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor=RHex)} onMouseLeave={e => (e.currentTarget.style.borderColor=BORDER)}>
          {preview ? <><img src={preview} alt="preview" style={{ width:"100%", maxHeight:160, objectFit:"cover", borderRadius:6 }} /><div style={{ fontSize:"0.68rem", color:MUTED, marginTop:"0.3rem" }}>Click to change photo</div></> : <><div style={{ fontSize:"2rem", opacity:0.4 }}>📷</div><div style={{ fontSize:"0.75rem", color:MUTED }}>Click to upload photo</div></>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => setImageFile(e.target.files[0]||null)} />
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
      <Field label="Serial Number"><Input value={form.serial||""} onChange={f("serial")} placeholder="Optional" /></Field>
      <Field label="Notes">
        <textarea value={form.notes} onChange={e => f("notes")(e.target.value)} placeholder="Accessories, upgrades, damage…"
          style={{ width:"100%", background:BG, border:"1px solid "+BORDER, color:BLACK, fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none", resize:"vertical", minHeight:60 }} />
      </Field>
      <div style={{ display:"flex", gap:"0.7rem", marginTop:"0.5rem" }}>
        {onCancel && <Btn onClick={onCancel} variant="ghost">Cancel</Btn>}
        <Btn onClick={onSubmit} style={{ flex:1, padding:"0.7rem" }}>{submitLabel}</Btn>
      </div>
    </div>
  );
}

// ── LOGIN PAGE ─────────────────────────────────────────────────
function LoginPage({ onSignup }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const submit = async () => {
    if (!email||!password) { setError("Please fill in all fields"); return; }
    setLoading(true); setError("");
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (e) {
      const m = { "auth/user-not-found":"No account found","auth/wrong-password":"Incorrect password","auth/invalid-credential":"Invalid email or password","auth/invalid-email":"Invalid email address" };
      setError(m[e.code]||"Login failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"stretch" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ flex:1, background:"linear-gradient(145deg, #7A0000 0%, "+RHex+" 50%, #2a0000 100%)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:"3rem", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, opacity:0.05, backgroundImage:"repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize:"24px 24px" }} />
        <div style={{ position:"relative", textAlign:"center", color:"#fff" }}>
          <div style={{ fontSize:"5rem", marginBottom:"1.5rem" }}>🚲</div>
          <div style={{ fontFamily:"Georgia,serif", fontSize:"2.2rem", fontWeight:"bold", lineHeight:1.2, marginBottom:"1rem" }}>UofL<br/>Bikeshare</div>
          <div style={{ fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.22em", opacity:0.7, marginBottom:"2rem" }}>University of Louisville<br/>Sustainability</div>
          <div style={{ fontSize:"0.9rem", opacity:0.8, lineHeight:1.9, maxWidth:280, margin:"0 auto 2rem" }}>Free bicycle rentals for students, faculty & staff. Ride sustainably across campus.</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem", maxWidth:240, margin:"0 auto" }}>
            {[["🎓","UofL ID Only"],["🌿","Sustainable"]].map(([icon,label]) => (
              <div key={label} style={{ background:"rgba(255,255,255,0.12)", borderRadius:10, padding:"0.8rem" }}>
                <div style={{ fontSize:"1.4rem" }}>{icon}</div>
                <div style={{ fontSize:"0.72rem", marginTop:"0.3rem", opacity:0.8 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ width:420, display:"flex", alignItems:"center", justifyContent:"center", padding:"2rem", background:SURF }}>
        <div style={{ width:"100%" }}>
          <div style={{ marginBottom:"2rem" }}>
            <h2 style={{ fontFamily:"Georgia,serif", fontSize:"1.8rem", color:BLACK, margin:"0 0 0.4rem" }}>Welcome Back</h2>
            <p style={{ color:MUTED, fontSize:"0.85rem", margin:0 }}>Sign in to browse and rent available bikes</p>
          </div>
          <Field label="Email Address"><Input value={email} onChange={setEmail} placeholder="you@louisville.edu" type="email" /></Field>
          <Field label="Password"><Input value={password} onChange={setPassword} placeholder="••••••••" type="password" /></Field>
          <ErrBox msg={error} />
          <Btn onClick={submit} disabled={loading} full style={{ padding:"0.75rem", fontSize:"0.9rem" }}>{loading?"Signing in…":"Sign In →"}</Btn>
          <div style={{ marginTop:"1.5rem", padding:"1rem", background:LGRAY, borderRadius:10, border:"1px solid "+BORDER }}>
            <div style={{ fontSize:"0.65rem", textTransform:"uppercase", letterSpacing:"0.14em", color:MUTED, marginBottom:"0.6rem" }}>Need Help?</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem" }}>
              {[["📧 Email Support","mailto:cycleadmin@gmail.com"],["🌐 UofL Bikeshare","https://louisville.edu/sustainability/operations/bikeshare"],["💬 Send Feedback","mailto:cycleadmin@gmail.com?subject=Feedback"],["📖 How It Works","#"]].map(([label,href]) => (
                <a key={label} href={href} target={href.startsWith("http")?"_blank":"_self"} rel="noreferrer" style={{ color:RHex, fontSize:"0.78rem", textDecoration:"none", fontWeight:600 }}>{label}</a>
              ))}
            </div>
          </div>
          <div style={{ textAlign:"center", marginTop:"1.2rem", fontSize:"0.82rem", color:MUTED }}>
            Don't have an account?{" "}<span onClick={onSignup} style={{ color:RHex, cursor:"pointer", fontWeight:700 }}>Create Account</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SIGNUP PAGE ────────────────────────────────────────────────
function SignupPage({ onLogin }) {
  const [form, setForm] = useState({ firstName:"",middleName:"",lastName:"",email:"",phone:"",userType:"",password:"",confirm:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const f = key => val => setForm(p => ({ ...p, [key]:val }));

  const submit = async () => {
    if (!form.firstName||!form.lastName||!form.email||!form.password) { setError("Please fill in all required fields"); return; }
    // Option A — @louisville.edu restriction on signup
    if (!form.email.toLowerCase().endsWith("@louisville.edu")) { setError("Only @louisville.edu email addresses are allowed to sign up."); return; }
    if (form.password!==form.confirm) { setError("Passwords do not match"); return; }
    if (form.password.length<6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await sendEmailVerification(user);
      await setDoc(doc(db, "users", user.uid), { firstName:form.firstName, middleName:form.middleName||"", lastName:form.lastName, email:form.email, phone:form.phone||"", userType:form.userType||"Student", role:"viewer", createdAt:Date.now() });
    } catch (e) {
      const m = { "auth/email-already-in-use":"An account with this email already exists","auth/invalid-email":"Invalid email address","auth/weak-password":"Password too weak" };
      setError(m[e.code]||"Signup failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"1.5rem" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ width:"100%", maxWidth:520 }}>
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontFamily:"Georgia,serif", fontSize:"1.8rem", color:RHex, fontWeight:"bold" }}>🚲 UofL Bikeshare</div>
          <div style={{ fontSize:"0.65rem", color:MUTED, textTransform:"uppercase", letterSpacing:"0.18em" }}>University of Louisville · Sustainability</div>
          <div style={{ fontSize:"0.85rem", color:"#555", marginTop:"0.4rem" }}>Create your account</div>
          <div style={{ fontSize:"0.78rem", color:MUTED, marginTop:"0.3rem", background:LGRAY, padding:"0.4rem 0.8rem", borderRadius:6, display:"inline-block", border:"1px solid "+BORDER }}>
            🔒 Only @louisville.edu email addresses are accepted
          </div>
        </div>
        <div style={{ background:SURF, borderRadius:16, border:"1px solid "+BORDER, padding:"2rem", boxShadow:"0 4px 24px rgba(173,0,0,0.08)" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
            <Field label="First Name" required><Input value={form.firstName} onChange={f("firstName")} placeholder="John" /></Field>
            <Field label="Last Name"  required><Input value={form.lastName}  onChange={f("lastName")}  placeholder="Doe" /></Field>
          </div>
          <Field label="Middle Name"><Input value={form.middleName} onChange={f("middleName")} placeholder="Optional" /></Field>
          <Field label="Email Address" required><Input value={form.email} onChange={f("email")} placeholder="you@louisville.edu" type="email" /></Field>
          <Field label="Phone Number"><Input value={form.phone} onChange={f("phone")} placeholder="Optional" type="tel" /></Field>
          <Field label="I am a…" required><Sel value={form.userType} onChange={f("userType")} options={["Student","Staff","Faculty"]} /></Field>
          <Field label="Password" required><Input value={form.password} onChange={f("password")} placeholder="Min. 6 characters" type="password" /></Field>
          <Field label="Confirm Password" required><Input value={form.confirm} onChange={f("confirm")} placeholder="Repeat password" type="password" /></Field>
          <ErrBox msg={error} />
          <Btn onClick={submit} disabled={loading} full style={{ padding:"0.75rem" }}>{loading?"Creating Account…":"Create Account →"}</Btn>
          <p style={{ textAlign:"center", marginTop:"0.8rem", fontSize:"0.72rem", color:MUTED }}>📧 A verification link will be sent to your email. Check spam if not received.</p>
          <div style={{ textAlign:"center", marginTop:"0.5rem", fontSize:"0.82rem", color:MUTED }}>
            Already have an account?{" "}<span onClick={onLogin} style={{ color:RHex, cursor:"pointer", fontWeight:700 }}>Sign In</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── VERIFY EMAIL PAGE ──────────────────────────────────────────
function VerifyEmailPage({ user }) {
  const [checking, setChecking] = useState(false);
  const [resent, setResent]     = useState(false);
  const [error, setError]       = useState("");
  const check = async () => {
    setChecking(true); setError("");
    try { await auth.currentUser.reload(); if (auth.currentUser.emailVerified) { window.location.reload(); } else { setError("Not verified yet — please click the link in your email first."); } }
    catch (e) { setError("Error checking. Please try again."); }
    setChecking(false);
  };
  const resend = async () => {
    try { await sendEmailVerification(auth.currentUser); setResent(true); setTimeout(() => setResent(false), 4000); }
    catch (e) { setError("Could not resend. Wait a moment and try again."); }
  };
  return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ background:SURF, borderRadius:16, border:"1px solid "+BORDER, padding:"2.5rem 2rem", maxWidth:420, width:"100%", textAlign:"center", boxShadow:"0 4px 24px rgba(173,0,0,0.08)" }}>
        <div style={{ fontSize:"3.5rem", marginBottom:"1rem" }}>📧</div>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:RHex, fontWeight:"bold", marginBottom:"0.5rem" }}>Verify Your Email</div>
        <div style={{ fontSize:"0.85rem", color:"#555", lineHeight:1.9, marginBottom:"1.5rem" }}>
          We sent a verification link to<br /><strong>{user.email}</strong><br />
          Click the link in your email, then come back here.<br/>
          <span style={{ fontSize:"0.78rem", color:MUTED }}>📁 Check your Spam folder if you don't see it.</span>
        </div>
        <ErrBox msg={error} />
        {resent && <div style={{ color:GREEN, fontSize:"0.78rem", background:"#d8f3dc", padding:"0.5rem", borderRadius:6, marginBottom:"0.8rem" }}>✓ Verification email resent!</div>}
        <div style={{ display:"flex", gap:"0.7rem", justifyContent:"center" }}>
          <Btn onClick={check} disabled={checking}>{checking?"Checking…":"I've Verified ✓"}</Btn>
          <Btn onClick={resend} variant="secondary">Resend Email</Btn>
        </div>
        <div style={{ marginTop:"1rem" }}><span onClick={() => signOut(auth)} style={{ fontSize:"0.72rem", color:MUTED, cursor:"pointer" }}>Sign out</span></div>
      </div>
    </div>
  );
}

// ── PUBLIC DASHBOARD ───────────────────────────────────────────
function PublicDashboard({ userProfile, setUserProfile }) {
  const [bikes, setBikes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("");
  const [rentBike, setRentBike]     = useState(null);
  const [toast, setToast]           = useState(null);
  const [page, setPage]             = useState("home");
  const [favorites, setFavorites]   = useState([]);
  const [darkMode, setDarkMode]     = useState(() => localStorage.getItem("darkMode")==="true");

  const notify = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "inventory", "bikes"));
        if (snap.exists()) setBikes((snap.data().list||[]).filter(b => b.status==="Available"));
      } catch (e) { console.error(e); }
      try {
        const q = query(collection(db, "favorites"), where("userId","==",userProfile?.uid||""));
        setFavorites((await getDocs(q)).docs.map(d => ({ id:d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const toggleFavorite = async bike => {
    const existing = favorites.find(f => f.bikeId===bike.id);
    if (existing) {
      try { await deleteDoc(doc(db,"favorites",existing.id)); setFavorites(prev => prev.filter(f => f.id!==existing.id)); notify("Removed from favorites"); }
      catch (e) { console.error(e); }
    } else {
      try {
        const ref = await addDoc(collection(db,"favorites"), { bikeId:bike.id, userId:userProfile?.uid||"", addedAt:Date.now() });
        setFavorites(prev => [...prev, { id:ref.id, bikeId:bike.id, userId:userProfile?.uid||"" }]);
        notify("❤️ Added to favorites!");
      } catch (e) { console.error(e); }
    }
  };

  const toggleDark = () => { const v=!darkMode; setDarkMode(v); localStorage.setItem("darkMode",v); };

  // re-fetch bikes when user navigates back to home so they always see fresh data
  useEffect(() => {
    if (page === "home") {
      (async () => {
        try {
          const snap = await getDoc(doc(db, "inventory", "bikes"));
          if (snap.exists()) setBikes((snap.data().list||[]).filter(b => b.status==="Available"));
        } catch (e) { console.error(e); }
      })();
    }
  }, [page]);

  // re-fetch bikes when user navigates back to home
  useEffect(() => {
    if (page === "home") {
      (async () => {
        try {
          const snap = await getDoc(doc(db, "inventory", "bikes"));
          if (snap.exists()) setBikes((snap.data().list||[]).filter(b => b.status==="Available"));
        } catch (e) { console.error(e); }
      })();
    }
  }, [page]);

  const filtered = bikes.filter(b => {
    const q = search.toLowerCase();
    return (!q||Object.values(b).join(" ").toLowerCase().includes(q)) && (!filterType||b.type===filterType);
  });

  const bgColor = darkMode?"#1a1a1a":BG;
  const cardBg  = darkMode?"#2a2a2a":SURF;

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background:bgColor, minHeight:"100vh", display:"flex", flexDirection:"column", transition:"background 0.3s" }}>
      <style>{GLOBAL_STYLES}</style>
      <TopNav page={page} setPage={setPage} userProfile={userProfile} onSignOut={() => signOut(auth)}
        role="viewer" notifications={[]} onMarkNotifRead={()=>{}} onClearNotifs={()=>{}}
        darkMode={darkMode} toggleDark={toggleDark} pendingCount={0} />

      {page==="about"      && <AboutPage />}
      {page==="howitworks" && <HowItWorksPage setPage={setPage} />}
      {page==="contact"    && <ContactPage />}
      {page==="profile"    && <ProfilePage userProfile={userProfile} setUserProfile={setUserProfile} />}
      {page==="myrentals"  && <MyRentalsPage userProfile={userProfile} bikes={bikes} onRent={setRentBike} />}

      {page==="home" && (
        <>
          <div style={{ background:"linear-gradient(135deg, #7A0000 0%, "+RHex+" 60%, #1a1a1a 100%)", padding:"4rem 1.5rem", textAlign:"center", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, opacity:0.05, backgroundImage:"repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize:"24px 24px" }} />
            <div style={{ position:"relative" }}>
              <div style={{ fontSize:"3.5rem", marginBottom:"1rem" }}>🚲</div>
              <h1 style={{ fontFamily:"Georgia,serif", fontSize:"2.5rem", color:"#fff", margin:"0 0 0.8rem", lineHeight:1.2 }}>Free Bikes for UofL Community</h1>
              <p style={{ fontSize:"1rem", color:"rgba(255,255,255,0.8)", maxWidth:520, margin:"0 auto 1.5rem", lineHeight:1.8 }}>
                Browse available bicycles and submit your rental request. All UofL students, faculty & staff ride free!
              </p>
              <div style={{ display:"inline-flex", gap:"1rem", flexWrap:"wrap", justifyContent:"center" }}>
                <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"0.4rem 1rem", fontSize:"0.8rem", color:"#fff", border:"1px solid rgba(255,255,255,0.3)" }}>
                  🪪 UofL ID Required
                </div>
                <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"0.4rem 1rem", fontSize:"0.8rem", color:"#fff", border:"1px solid rgba(255,255,255,0.3)" }}>
                  🚲 {bikes.length} bike{bikes.length!==1?"s":""} available
                </div>
              </div>
            </div>
          </div>

          {/* Search bar — fixed layout */}
          <div style={{ background:cardBg, borderBottom:"1px solid "+BORDER, padding:"0.9rem 1.5rem" }}>
            <div style={{ display:"flex", gap:"0.7rem", alignItems:"center", flexWrap:"wrap", maxWidth:1200, margin:"0 auto" }}>
              <div style={{ position:"relative", flex:1, minWidth:240 }}>
                <span style={{ position:"absolute", left:"0.7rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.85rem", pointerEvents:"none" }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by brand, model, type…"
                  style={{ width:"100%", background:bgColor, border:"1px solid "+BORDER, fontFamily:"inherit", fontSize:"0.82rem", padding:"0.5rem 0.7rem 0.5rem 2.1rem", borderRadius:8, outline:"none", color:darkMode?"#fff":BLACK }} />
              </div>
              <div style={{ flexShrink:0 }}>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  style={{ background:cardBg, border:"1px solid "+BORDER, fontFamily:"inherit", fontSize:"0.8rem", padding:"0.5rem 0.7rem", borderRadius:8, outline:"none", color:filterType?(darkMode?"#fff":BLACK):MUTED }}>
                  <option value="">All Types</option>
                  {BIKE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ fontSize:"0.8rem", color:MUTED, flexShrink:0 }}>{filtered.length} bike{filtered.length!==1?"s":""} available</div>
            </div>
          </div>

          <div style={{ flex:1, padding:"1.5rem", maxWidth:1200, margin:"0 auto", width:"100%" }}>
            {loading ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:"1.2rem" }}>
                {[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:"5rem", color:MUTED }}>
                <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
                <p style={{ fontSize:"0.85rem" }}>{bikes.length?"No bikes match your search.":"No bikes currently available."}</p>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:"1.2rem" }}>
                {filtered.map(b => (
                  <PublicBikeCard key={b.id} bike={b} onRent={setRentBike}
                    isFavorite={favorites.some(f => f.bikeId===b.id)}
                    onToggleFavorite={toggleFavorite} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Footer setPage={setPage} />
      {rentBike && <WaiverModal bike={rentBike} userProfile={userProfile} onClose={() => setRentBike(null)} onSuccess={() => notify("✓ Rental request submitted! Admin will review shortly.")} />}
      <Toast msg={toast} />
    </div>
  );
}

// ── ADMIN DASHBOARD ────────────────────────────────────────────
function AdminDashboard({ userProfile, setUserProfile }) {
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
  const [page, setPage]                 = useState("admin");
  const [messages, setMessages]         = useState([]);
  const [msgsLoading, setMsgsLoading]   = useState(false);
  const [selectedMsg, setSelectedMsg]   = useState(null);
  const [rentals, setRentals]           = useState([]);
  const [rentalsLoading, setRentalsLoading] = useState(false);
  const [filterRental, setFilterRental] = useState("Pending");
  const [rentalSearch, setRentalSearch] = useState("");
  const [users, setUsers]               = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [approveModal, setApproveModal] = useState(null);
  const [returnDate, setReturnDate]     = useState("");
  const [rejectModal, setRejectModal]   = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [darkMode, setDarkMode]         = useState(() => localStorage.getItem("darkMode")==="true");

  const notify = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "inventory", "bikes"));
        if (snap.exists()) setBikes(snap.data().list||[]);
      } catch (e) { console.error(e); }
      try {
        const q = query(collection(db, "notifications"), orderBy("createdAt","desc"));
        setNotifications((await getDocs(q)).docs.map(d => ({ id:d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      // load rentals on startup so stats bar is correct immediately
      try {
        const rq = query(collection(db, "rentalRequests"), orderBy("submittedAt","desc"));
        setRentals((await getDocs(rq)).docs.map(d => ({ id:d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      // load users count on startup
      try {
        const usnap = await getDocs(collection(db, "users"));
        setUsers(usnap.docs.map(d => ({ id:d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async newBikes => {
    setSaving(true);
    try { await setDoc(doc(db, "inventory", "bikes"), { list:newBikes }); }
    catch (e) { notify("⚠ Save failed"); }
    setSaving(false);
  }, []);

  // ── Excel Download ──────────────────────────────────────────
  const downloadExcel = async () => {
    notify("📥 Preparing Excel file…");
    try {
      const bikesData = bikes.map((b,i) => ({ "#":i+1,"Bike ID":b.id||"","Unique Code":b.bikeCode||"","Brand":b.brand||"","Model":b.model||"","Year":b.year||"","Color":b.color||"","Type":b.type||"","Frame Size":b.frameSize||"","Wheel Size":b.wheel||"","Material":b.material||"","Gears":b.gears||"","Brakes":b.brakes||"","Condition":b.condition||"","Status":b.status||"","Serial":b.serial||"","Notes":b.notes||"","Added On":b.addedAt?new Date(b.addedAt).toLocaleDateString():"" }));
      let rentalsData=[],msgsData=[],usersData=[];
      try { const s=await getDocs(collection(db,"rentalRequests")); rentalsData=s.docs.map((d,i)=>{ const r=d.data(); return {"#":i+1,"Request ID":d.id,"Bike":r.bikeBrand+" "+r.bikeModel,"Bike Code":r.bikeCode||"","Name":r.fullName||"","UofL ID":r.uoflId||"","Email":r.email||"","Phone":r.phone||"","User Type":r.userType||"","Items":Object.entries(r.checkOutItems||{}).filter(([,v])=>v).map(([k])=>k).join(", "),"Status":r.status||"Pending","Return Date":r.returnDate?new Date(r.returnDate).toLocaleDateString():"","Submitted":r.submittedAt?new Date(r.submittedAt).toLocaleDateString():""}; }); } catch(e){}
      try { const s=await getDocs(collection(db,"contactMessages")); msgsData=s.docs.map((d,i)=>{ const m=d.data(); return {"#":i+1,"Name":m.name||"","Email":m.email||"","Subject":m.subject||"","Message":m.message||"","Read":m.read?"Yes":"No","Sent":m.sentAt?new Date(m.sentAt).toLocaleDateString():""}; }); } catch(e){}
      try { const s=await getDocs(collection(db,"users")); usersData=s.docs.map((d,i)=>{ const u=d.data(); return {"#":i+1,"First Name":u.firstName||"","Last Name":u.lastName||"","Email":u.email||"","Phone":u.phone||"","User Type":u.userType||"","Role":u.role||"","Joined":u.createdAt?new Date(u.createdAt).toLocaleDateString():""}; }); } catch(e){}
      const wb = new ExcelJS.Workbook(); wb.creator="UofL Bikeshare";
      const addSheet = (data,name) => {
        if (!data.length) data=[{"No Data":"No records found"}];
        const ws=wb.addWorksheet(name);
        ws.columns=Object.keys(data[0]).map(k=>({ header:k,key:k,width:Math.max(k.length,...data.map(r=>String(r[k]||"").length))+2 }));
        ws.getRow(1).eachCell(cell => { cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFAD0000"}}; cell.font={bold:true,color:{argb:"FFFFFFFF"}}; });
        data.forEach(row=>ws.addRow(row));
      };
      addSheet(bikesData,"Bikes Inventory"); addSheet(rentalsData,"Rental Requests"); addSheet(msgsData,"Contact Messages"); addSheet(usersData,"Registered Users");
      const date=new Date().toLocaleDateString("en-US",{year:"numeric",month:"2-digit",day:"2-digit"}).replace(/\//g,"-");
      const buffer=await wb.xlsx.writeBuffer();
      const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="UofL-Bikeshare-Data-"+date+".xlsx"; a.click(); URL.revokeObjectURL(url);
      notify("✓ Excel downloaded!");
    } catch (e) { console.error(e); notify("⚠ Failed to download"); }
  };

  // ── Rental Requests ─────────────────────────────────────────
  const fetchRentals = async () => {
    setRentalsLoading(true);
    try {
      const q = query(collection(db,"rentalRequests"), orderBy("submittedAt","desc"));
      setRentals((await getDocs(q)).docs.map(d => ({ id:d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setRentalsLoading(false);
  };

  const approveRental = async () => {
    if (!approveModal) return;
    try {
      await updateDoc(doc(db,"rentalRequests",approveModal.id), { status:"Approved", returnDate:returnDate?new Date(returnDate).getTime():null, approvedAt:Date.now() });
      setRentals(prev => prev.map(r => r.id===approveModal.id ? { ...r, status:"Approved", returnDate:returnDate?new Date(returnDate).getTime():null } : r));
      // fetch fresh bikes from Firestore to avoid stale state issues
      const freshSnap = await getDoc(doc(db, "inventory", "bikes"));
      const freshBikes = freshSnap.exists() ? freshSnap.data().list || [] : bikes;
      const updatedBikes = freshBikes.map(b => b.id===approveModal.bikeId ? { ...b, status:"Reserved" } : b);
      setBikes(updatedBikes);
      await setDoc(doc(db, "inventory", "bikes"), { list: updatedBikes });
      await addDoc(collection(db,"notifications"), { message:"Rental approved for "+approveModal.fullName+" — "+approveModal.bikeBrand+" "+approveModal.bikeModel, type:"approved", read:false, createdAt:Date.now() });
      setNotifications(prev => [{ id:Date.now()+"", message:"Rental approved for "+approveModal.fullName, read:false, createdAt:Date.now() }, ...prev]);
      setApproveModal(null); setReturnDate(""); notify("✓ Rental approved!");
    } catch (e) { console.error(e); notify("⚠ Failed to approve"); }
  };

  const rejectRental = async () => {
    if (!rejectModal) return;
    try {
      await updateDoc(doc(db,"rentalRequests",rejectModal.id), { status:"Rejected", rejectReason, rejectedAt:Date.now() });
      setRentals(prev => prev.map(r => r.id===rejectModal.id ? { ...r, status:"Rejected", rejectReason } : r));
      // set bike back to Available when rejected
      const freshSnap3 = await getDoc(doc(db, "inventory", "bikes"));
      const freshBikes3 = freshSnap3.exists() ? freshSnap3.data().list || [] : [];
      const updatedBikes3 = freshBikes3.map(b => b.id===rejectModal.bikeId ? { ...b, status:"Available" } : b);
      setBikes(updatedBikes3);
      await setDoc(doc(db, "inventory", "bikes"), { list: updatedBikes3 });
      setRejectModal(null); setRejectReason(""); notify("Rental rejected");
    } catch (e) { notify("⚠ Failed to reject"); }
  };

  const markReturned = async rental => {
    try {
      await updateDoc(doc(db,"rentalRequests",rental.id), { status:"Returned", returnedAt:Date.now() });
      setRentals(prev => prev.map(r => r.id===rental.id ? { ...r, status:"Returned", returnedAt:Date.now() } : r));
      notify("✓ Marked as returned");
    } catch (e) { notify("⚠ Failed to update"); }
  };

  const confirmPickup = async rental => {
    try {
      await updateDoc(doc(db,"rentalRequests",rental.id), { status:"Active", pickedUpAt:Date.now() });
      setRentals(prev => prev.map(r => r.id===rental.id ? { ...r, status:"Active", pickedUpAt:Date.now() } : r));
      notify("✓ Pickup confirmed! Bike is now with the user.");
    } catch (e) { notify("⚠ Failed to update"); }
  };

  const resolveReturned = async (rental, action) => {
    try {
      const newStatus = action==="available" ? "Available" : "In Service";
      const updated = bikes.map(b => b.id===rental.bikeId ? { ...b, status:newStatus } : b);
      setBikes(updated); await persist(updated);
      await updateDoc(doc(db,"rentalRequests",rental.id), { resolvedStatus:newStatus, resolvedAt:Date.now() });
      setRentals(prev => prev.map(r => r.id===rental.id ? { ...r, resolvedStatus:newStatus } : r));
      notify("✓ Bike status updated to "+newStatus);
    } catch (e) { notify("⚠ Failed to resolve"); }
  };

  // ── Messages ────────────────────────────────────────────────
  const fetchMessages = async () => {
    setMsgsLoading(true);
    try {
      const q = query(collection(db,"contactMessages"), orderBy("sentAt","desc"));
      setMessages((await getDocs(q)).docs.map(d => ({ id:d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setMsgsLoading(false);
  };

  const markAsRead = async msgId => {
    try {
      await updateDoc(doc(db,"contactMessages",msgId), { read:true });
      setMessages(prev => prev.map(m => m.id===msgId ? { ...m, read:true } : m));
    } catch (e) { console.error(e); }
  };

  // ── Users ────────────────────────────────────────────────────
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const uSnap = await getDocs(collection(db,"users"));
      const usersArr = uSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      const rSnap = await getDocs(collection(db,"rentalRequests"));
      const counts = {};
      rSnap.docs.forEach(d => { const uid=d.data().userId; counts[uid]=(counts[uid]||0)+1; });
      setUsers(usersArr.map(u => ({ ...u, rentalCount:counts[u.id]||0 })));
    } catch (e) { console.error(e); }
    setUsersLoading(false);
  };

  // ── Notifications ────────────────────────────────────────────
  const markNotifRead = async id => {
    try { await updateDoc(doc(db,"notifications",id), { read:true }); setNotifications(prev => prev.map(n => n.id===id?{ ...n, read:true }:n)); }
    catch (e) { console.error(e); }
  };

  const clearNotifs = async () => {
    try {
      await Promise.all(notifications.map(n => updateDoc(doc(db,"notifications",n.id), { read:true })));
      setNotifications(prev => prev.map(n => ({ ...n, read:true })));
    } catch (e) { console.error(e); }
  };

  // ── Bikes CRUD ───────────────────────────────────────────────
  const uploadImage = async (file, bikeId) => {
    if (!file) return null;
    const imgRef = storageRef(storage,"bike-images/"+bikeId);
    await uploadBytes(imgRef, file);
    return await getDownloadURL(imgRef);
  };

  const addBike = async () => {
    if (!form.brand.trim()||!form.model.trim()) { notify("⚠ Brand and Model required"); return; }
    setSaving(true);
    try {
      const bikeId=uid(), bikeCode=genBikeCode();
      const imageUrl=await uploadImage(imageFile,bikeId);
      const newBike={ ...form, id:bikeId, bikeCode, imageUrl, addedAt:Date.now() };
      const updated=[newBike, ...bikes];
      setBikes(updated); await persist(updated);
      setForm(EMPTY_FORM); setImageFile(null); setTab("inventory");
      notify("✓ Bicycle added!");
    } catch (e) { notify("⚠ Failed to add bike"); }
    setSaving(false);
  };

  const openEdit = bike => { setEditId(bike.id); setEditForm({ ...EMPTY_FORM, ...bike }); setEditImg(null); };

  const saveEdit = async () => {
    if (!editForm.brand.trim()||!editForm.model.trim()) { notify("⚠ Brand and Model required"); return; }
    setSaving(true);
    try {
      const imageUrl=editImg?await uploadImage(editImg,editId):editForm.imageUrl;
      const updated=bikes.map(b => b.id===editId?{ ...b, ...editForm, imageUrl }:b);
      setBikes(updated); await persist(updated); setEditId(null); notify("✓ Updated!");
    } catch (e) { notify("⚠ Failed to update"); }
    setSaving(false);
  };

  const deleteBike = async id => {
    if (!confirm("Remove this bicycle?")) return;
    const updated=bikes.filter(b => b.id!==id);
    setBikes(updated); await persist(updated); notify("Bicycle removed");
  };

  const toggleBikeAvail = async bike => {
    const newStatus = bike.status==="Available" ? "In Service" : "Available";
    const updated = bikes.map(b => b.id===bike.id ? { ...b, status:newStatus } : b);
    setBikes(updated); await persist(updated);
    notify("✓ Bike status → "+newStatus);
  };

  const downloadQR = async bike => {
    try {
      const imgData=await generateQRImage(bike.bikeCode||genBikeCode(), bike.brand, bike.model);
      const a=document.createElement("a"); a.href=imgData; a.download=bike.brand+"-"+bike.model+"-QR.png"; a.click();
      notify("✓ QR downloaded!");
    } catch (e) { notify("⚠ Failed to generate QR"); }
  };

  const toggleDark = () => { const v=!darkMode; setDarkMode(v); localStorage.setItem("darkMode",v); };

  const filtered = bikes.filter(b => {
    const q=search.toLowerCase(), txt=Object.values(b).join(" ").toLowerCase();
    return (!q||txt.includes(q)) && (!filterStatus||b.status===filterStatus) && (!filterType||b.type===filterType);
  });

  const pendingCount   = rentals.filter(r => r.status==="Pending").length;
  const activeRentals  = rentals.filter(r => r.status==="Approved" || r.status==="Active");
  const returnedRentals= rentals.filter(r => r.status==="Returned");
  const overdueRentals = activeRentals.filter(r => r.returnDate && new Date(r.returnDate)<new Date());
  const unreadMsgs     = messages.filter(m => !m.read).length;

  const filteredRentals = rentals.filter(r => {
    const matchStatus = !filterRental || r.status===filterRental;
    const q = rentalSearch.toLowerCase();
    const matchSearch = !q || (r.fullName||"").toLowerCase().includes(q) || (r.uoflId||"").toLowerCase().includes(q) || (r.bikeBrand||"").toLowerCase().includes(q) || (r.bikeModel||"").toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const bgColor = darkMode?"#1a1a1a":BG;
  const cardBg  = darkMode?"#2a2a2a":SURF;

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background:bgColor, minHeight:"100vh", display:"flex", flexDirection:"column", transition:"background 0.3s" }}>
      <style>{GLOBAL_STYLES}</style>

      <TopNav page={page} setPage={setPage} userProfile={userProfile} onSignOut={() => signOut(auth)}
        role="admin" notifications={notifications} onMarkNotifRead={markNotifRead} onClearNotifs={clearNotifs}
        darkMode={darkMode} toggleDark={toggleDark} pendingCount={pendingCount} />

      {page==="about"      && <AboutPage />}
      {page==="howitworks" && <HowItWorksPage setPage={setPage} />}
      {page==="contact"    && <ContactPage />}
      {page==="profile"    && <ProfilePage userProfile={userProfile} setUserProfile={setUserProfile} />}

      {(page==="admin"||page==="home") && (
        <>
          {/* Overdue alert banner */}
          {overdueRentals.length > 0 && (
            <div onClick={() => { setTab("renting"); fetchRentals(); }}
              style={{ background:"#c0392b", padding:"0.65rem 1.5rem", display:"flex", alignItems:"center",
                justifyContent:"center", gap:"0.8rem", cursor:"pointer",
                borderBottom:"2px solid #8B0000" }}>
              <span style={{ fontSize:"1rem" }}>⚠️</span>
              <span style={{ color:"#fff", fontSize:"0.82rem", fontWeight:600 }}>
                {overdueRentals.length} rental{overdueRentals.length>1?"s are":" is"} overdue — click to view
              </span>
            </div>
          )}

          {/* Stats bar */}
          <div style={{ background:BLACK, padding:"0.85rem 1.5rem", display:"flex", gap:"1.5rem", alignItems:"center", borderBottom:"2px solid "+RHex, flexWrap:"wrap" }}>
            <div style={{ fontSize:"0.65rem", textTransform:"uppercase", letterSpacing:"0.18em", color:RHex, fontWeight:700 }}>Admin Dashboard</div>
            {saving && <span style={{ fontSize:"0.65rem", color:"#888" }}>saving…</span>}
            {[
              { label:"Total Bikes",     val:bikes.length,          icon:"🚲" },
              { label:"Pending",         val:pendingCount,           icon:"⏳", highlight:pendingCount>0 },
              { label:"Currently Renting",val:activeRentals.length, icon:"🔄", highlight:activeRentals.length>0 },
              { label:"Awaiting Return", val:returnedRentals.filter(r=>!r.resolvedStatus).length, icon:"📦" },
              { label:"Total Users",     val:users.length||"—",     icon:"👥" },
            ].map(({ label, val, icon, highlight }) => (
              <div key={label} style={{ textAlign:"center", padding:"0.3rem 0.7rem", borderRadius:8, background:highlight?"rgba(173,0,0,0.25)":undefined }}>
                <div style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:highlight?RHex:"#fff", lineHeight:1 }}>{icon} {val}</div>
                <div style={{ fontSize:"0.55rem", textTransform:"uppercase", letterSpacing:"0.15em", color:"#666" }}>{label}</div>
              </div>
            ))}
            <div style={{ marginLeft:"auto" }}>
              <Btn onClick={downloadExcel} variant="green" small style={{ fontSize:"0.78rem", padding:"0.45rem 1rem" }}>📥 Download All Data</Btn>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", background:cardBg, borderBottom:"2px solid "+BORDER, overflowX:"auto" }}>
            {[
              ["inventory","🚲 Inventory"],
              ["add","＋ Add Bike"],
              ["rentals","📋 Rentals"+(pendingCount>0?" ("+pendingCount+")":"")],
              ["renting","🔄 Currently Renting"+(activeRentals.length>0?" ("+activeRentals.length+")":"")],
              ["returned","📦 Returned"+(returnedRentals.filter(r=>!r.resolvedStatus).length>0?" ("+returnedRentals.filter(r=>!r.resolvedStatus).length+")":"")],
              ["messages","📬 Messages"+(unreadMsgs>0?" ("+unreadMsgs+")":"")],
              ["users","👥 Users"],
            ].map(([key,label]) => (
              <button key={key}
                onClick={() => { setTab(key); if (key==="messages") fetchMessages(); if (key==="rentals"||key==="renting"||key==="returned") fetchRentals(); if (key==="users") fetchUsers(); }}
                style={{ padding:"0.7rem 0.9rem", fontFamily:"inherit", fontSize:"0.74rem", minWidth:100,
                  textTransform:"uppercase", letterSpacing:"0.08em", border:"none", cursor:"pointer",
                  whiteSpace:"nowrap",
                  background:tab===key?RHex:"transparent",
                  color:tab===key?"#fff":MUTED, fontWeight:tab===key?700:400 }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ display:"flex", flex:1 }}>

            {/* ── ADD BIKE ── */}
            {tab==="add" && (
              <div style={{ flex:1, overflowY:"auto" }}>
                <div style={{ maxWidth:540, margin:"0 auto", padding:"1.5rem" }}>
                  <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex, marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid "+BORDER }}>🚲 Add New Bicycle</div>
                  <BikeForm form={form} setForm={setForm} onSubmit={addBike} submitLabel={saving?"Adding…":"＋ Add to Inventory"} imageFile={imageFile} setImageFile={setImageFile} />
                </div>
              </div>
            )}

            {/* ── INVENTORY ── */}
            {tab==="inventory" && (
              <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
                <div style={{ background:cardBg, borderBottom:"1px solid "+BORDER, padding:"0.8rem 1.2rem", display:"flex", gap:"0.6rem", alignItems:"center", flexWrap:"wrap" }}>
                  <div style={{ position:"relative", flex:1, minWidth:180 }}>
                    <span style={{ position:"absolute", left:"0.6rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.82rem" }}>🔍</span>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bikes…"
                      style={{ width:"100%", background:bgColor, border:"1px solid "+BORDER, fontFamily:"inherit", fontSize:"0.78rem", padding:"0.42rem 0.6rem 0.42rem 2rem", borderRadius:6, outline:"none", color:darkMode?"#fff":BLACK }} />
                  </div>
                  {[[filterStatus,setFilterStatus,STATUSES,"All Status"],[filterType,setFilterType,BIKE_TYPES,"All Types"]].map(([val,set,opts,ph],i) => (
                    <select key={i} value={val} onChange={e => set(e.target.value)}
                      style={{ background:cardBg, border:"1px solid "+BORDER, fontFamily:"inherit", fontSize:"0.75rem", padding:"0.42rem 0.6rem", borderRadius:6, outline:"none", color:darkMode?"#fff":BLACK }}>
                      <option value="">{ph}</option>
                      {opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ))}
                  <div style={{ display:"flex", gap:"0.25rem" }}>
                    {[["grid","⊞"],["list","☰"]].map(([v,icon]) => (
                      <button key={v} onClick={() => setViewMode(v)}
                        style={{ background:viewMode===v?RHex:bgColor, border:"1px solid "+BORDER, color:viewMode===v?"#fff":MUTED, padding:"0.38rem 0.62rem", cursor:"pointer", borderRadius:6, fontSize:"0.9rem" }}>
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ flex:1, padding:"1.2rem", overflowY:"auto" }}>
                  {loading ? (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:"1rem" }}>
                      {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
                    </div>
                  ) : filtered.length===0 ? (
                    <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>
                      <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🚲</div>
                      <p style={{ fontSize:"0.78rem" }}>{bikes.length?"No bikes match.":"No bikes yet — tap + Add Bike!"}</p>
                    </div>
                  ) : viewMode==="grid" ? (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:"1rem" }}>
                      {filtered.map(b => <AdminBikeCard key={b.id} bike={b} onEdit={() => openEdit(b)} onDelete={() => deleteBike(b.id)} onQR={() => downloadQR(b)} onToggleAvail={() => toggleBikeAvail(b)} />)}
                    </div>
                  ) : (
                    <div style={{ background:cardBg, borderRadius:8, border:"1px solid "+BORDER, overflow:"hidden" }}>
                      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 80px 90px 90px 130px", gap:"0.5rem", padding:"0.55rem 1rem", fontSize:"0.57rem", textTransform:"uppercase", letterSpacing:"0.12em", color:MUTED, borderBottom:"2px solid "+BORDER, background:bgColor }}>
                        {["Brand & Model","Type","Frame","Wheel","Status","Actions"].map(h => <span key={h}>{h}</span>)}
                      </div>
                      {filtered.map(b => {
                        const st=STATUS_STYLES[b.status]||STATUS_STYLES.Available;
                        return (
                          <div key={b.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 80px 90px 90px 130px", gap:"0.5rem", padding:"0.65rem 1rem", alignItems:"center", fontSize:"0.78rem", borderBottom:"1px solid "+BORDER, color:darkMode?"#ddd":BLACK }}
                            onMouseEnter={e => (e.currentTarget.style.background=bgColor)} onMouseLeave={e => (e.currentTarget.style.background="transparent")}>
                            <div>
                              <div style={{ fontWeight:700 }}>{b.brand} {b.model}</div>
                              <div style={{ fontSize:"0.64rem", color:MUTED }}>{b.year}{b.color?" · "+b.color:""}</div>
                              {b.bikeCode && <div style={{ fontSize:"0.6rem", color:RHex, fontFamily:"monospace" }}>#{b.bikeCode}</div>}
                            </div>
                            <span>{b.type||"—"}</span>
                            <span>{b.frameSize||"—"}</span>
                            <span>{b.wheel||"—"}</span>
                            <span onClick={() => toggleBikeAvail(b)} style={{ background:st.bg, color:st.color, fontSize:"0.62rem", padding:"0.15rem 0.5rem", borderRadius:10, fontWeight:600, cursor:"pointer" }} title="Click to toggle">{b.status}</span>
                            <div style={{ display:"flex", gap:"0.3rem" }}>
                              {[["✎",() => openEdit(b)],["📱",() => downloadQR(b)],["✕",() => deleteBike(b.id)]].map(([icon,fn],i) => (
                                <button key={i} onClick={fn}
                                  style={{ background:"transparent", border:"1px solid "+BORDER, color:MUTED, padding:"0.2rem 0.35rem", cursor:"pointer", borderRadius:4, fontSize:"0.72rem" }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor=i===2?"#c0392b":RHex; e.currentTarget.style.color=i===2?"#c0392b":RHex; }}
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

            {/* ── RENTAL REQUESTS ── */}
            {tab==="rentals" && (
              <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
                <div style={{ background:cardBg, borderBottom:"1px solid "+BORDER, padding:"0.8rem 1.2rem", display:"flex", gap:"0.7rem", alignItems:"center", flexWrap:"wrap" }}>
                  <div style={{ display:"flex", gap:"0.5rem", flexWrap:"wrap" }}>
                    {["All","Pending","Approved","Rejected","Returned"].map(s => (
                      <button key={s} onClick={() => setFilterRental(s==="All"?"":s)}
                        style={{ padding:"0.35rem 0.8rem", fontFamily:"inherit", fontSize:"0.74rem", fontWeight:600,
                          border:"1px solid "+(filterRental===(s==="All"?"":s)?RHex:BORDER),
                          background:filterRental===(s==="All"?"":s)?RHex:"transparent",
                          color:filterRental===(s==="All"?"":s)?"#fff":MUTED,
                          borderRadius:20, cursor:"pointer" }}>
                        {s}{s==="Pending"&&pendingCount>0?" ("+pendingCount+")":""}
                      </button>
                    ))}
                  </div>
                  <div style={{ position:"relative", flex:1, minWidth:180 }}>
                    <span style={{ position:"absolute", left:"0.6rem", top:"50%", transform:"translateY(-50%)", fontSize:"0.8rem" }}>🔍</span>
                    <input value={rentalSearch} onChange={e => setRentalSearch(e.target.value)} placeholder="Search by name, ID, bike…"
                      style={{ width:"100%", background:bgColor, border:"1px solid "+BORDER, fontFamily:"inherit", fontSize:"0.78rem", padding:"0.42rem 0.6rem 0.42rem 2rem", borderRadius:6, outline:"none", color:darkMode?"#fff":BLACK }} />
                  </div>
                </div>
                <div style={{ flex:1, padding:"1.2rem", overflowY:"auto" }}>
                  {rentalsLoading ? (
                    <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>Loading rental requests…</div>
                  ) : filteredRentals.length===0 ? (
                    <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>
                      <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>📋</div>
                      <p style={{ fontSize:"0.82rem" }}>No {filterRental||""} requests found</p>
                    </div>
                  ) : filteredRentals.map(r => {
                    const st=REQUEST_STATUS[r.status]||REQUEST_STATUS.Pending;
                    const dl=daysLeft(r.returnDate);
                    const isOverdue=r.status==="Approved"&&dl!==null&&dl<0;
                    return (
                      <div key={r.id} style={{ background:cardBg, borderRadius:14, padding:"1.4rem",
                        border:"1px solid "+(isOverdue?"#c0392b":r.status==="Pending"?RHex:BORDER),
                        boxShadow:"0 3px 14px rgba(0,0,0,0.06)", marginBottom:"1rem" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1rem" }}>
                          <div style={{ display:"flex", gap:"1rem", alignItems:"flex-start" }}>
                            {r.bikeImageUrl && <img src={r.bikeImageUrl} alt={r.bikeBrand} style={{ width:64, height:64, borderRadius:8, objectFit:"cover" }} />}
                            <div>
                              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:darkMode?"#fff":BLACK }}>{r.bikeBrand} {r.bikeModel}</div>
                              {r.bikeCode && <div style={{ fontSize:"0.68rem", color:RHex, fontFamily:"monospace" }}>#{r.bikeCode}</div>}
                              <div style={{ fontSize:"0.72rem", color:MUTED, marginTop:"0.2rem" }}>{timeAgo(r.submittedAt)}</div>
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <span style={{ background:st.bg, color:st.color, fontSize:"0.72rem", fontWeight:700, padding:"0.28rem 0.75rem", borderRadius:20, textTransform:"uppercase" }}>{r.status}</span>
                            {isOverdue && <div style={{ fontSize:"0.68rem", color:"#c0392b", marginTop:"0.25rem", fontWeight:700 }}>⚠ OVERDUE</div>}
                          </div>
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.8rem", padding:"0.8rem", background:bgColor, borderRadius:8, marginBottom:"0.8rem" }}>
                          {[["👤 Name",r.fullName],["🪪 UofL ID",r.uoflId],["📧 Email",r.email],["🎓 Type",r.userType]].map(([label,val]) => (
                            <div key={label}>
                              <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.12em", color:MUTED }}>{label}</div>
                              <div style={{ fontSize:"0.8rem", color:darkMode?"#ddd":BLACK, fontWeight:500, display:"flex", alignItems:"center" }}>
                                {val||"—"}
                                {label==="📧 Email"&&val && <CopyBtn text={val} />}
                              </div>
                            </div>
                          ))}
                        </div>
                        {r.checkOutItems && (
                          <div style={{ display:"flex", gap:"0.5rem", flexWrap:"wrap", marginBottom:"0.8rem" }}>
                            {Object.entries(r.checkOutItems).filter(([,v])=>v).map(([k]) => (
                              <span key={k} style={{ fontSize:"0.68rem", background:LGRAY, border:"1px solid "+BORDER, padding:"0.15rem 0.5rem", borderRadius:20, textTransform:"capitalize" }}>{k}</span>
                            ))}
                          </div>
                        )}
                        {r.status==="Approved"&&r.returnDate && (
                          <div style={{ fontSize:"0.8rem", color:GREEN, marginBottom:"0.8rem" }}>
                            📅 Return by: <strong>{fmtDate(r.returnDate)}</strong>
                            {dl!==null && <span style={{ marginLeft:"0.5rem", color:dl<0?"#c0392b":dl<=2?"#a0621a":GREEN, fontWeight:600 }}>{dl<0?"("+Math.abs(dl)+" days overdue)":dl===0?"(due today)":"("+dl+" days left)"}</span>}
                          </div>
                        )}
                        {r.status==="Rejected"&&r.rejectReason && (
                          <div style={{ fontSize:"0.78rem", color:"#c0392b", background:"#fde8e8", padding:"0.5rem 0.7rem", borderRadius:6, marginBottom:"0.8rem" }}>Reason: {r.rejectReason}</div>
                        )}
                        {r.status==="Pending" && (
                          <div style={{ display:"flex", gap:"0.7rem" }}>
                            <Btn onClick={() => { setApproveModal(r); setReturnDate(""); }} variant="approve" small style={{ flex:1 }}>✅ Approve</Btn>
                            <Btn onClick={() => { setRejectModal(r); setRejectReason(""); }} variant="reject" small style={{ flex:1 }}>✕ Reject</Btn>
                          </div>
                        )}
                        {r.status==="Approved" && (
                          <Btn onClick={() => confirmPickup(r)} variant="approve" small style={{ width:"100%" }}>
                            🪪 Confirm Pickup
                          </Btn>
                        )}
                        {r.status==="Active" && (
                          <Btn onClick={() => markReturned(r)} variant="blue" small style={{ width:"100%" }}>
                            📦 Mark as Returned
                          </Btn>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── CURRENTLY RENTING ── */}
            {tab==="renting" && (
              <div style={{ flex:1, padding:"1.5rem", overflowY:"auto" }}>
                <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex, marginBottom:"1.2rem" }}>
                  🔄 Currently Renting <span style={{ fontSize:"0.75rem", color:MUTED, fontWeight:400 }}>({activeRentals.length} active)</span>
                </div>
                {rentalsLoading ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>Loading…</div>
                ) : activeRentals.length===0 ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>
                    <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>🔄</div>
                    <p style={{ fontSize:"0.82rem" }}>No active rentals right now</p>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
                    {activeRentals.map(r => {
                      const dl = daysLeft(r.returnDate);
                      const isOverdue = dl!==null && dl<0;
                      const totalDays = r.returnDate && r.approvedAt ? Math.ceil((r.returnDate-r.approvedAt)/86400000) : null;
                      const usedDays  = r.approvedAt ? Math.ceil((Date.now()-r.approvedAt)/86400000) : null;
                      const progress  = totalDays && usedDays ? Math.min(100, Math.round((usedDays/totalDays)*100)) : null;
                      const progressColor = isOverdue?"#c0392b":dl!==null&&dl<=2?"#a0621a":GREEN;
                      return (
                        <div key={r.id} style={{ background:cardBg, borderRadius:14, padding:"1.4rem",
                          border:"1px solid "+(isOverdue?"#c0392b":BORDER),
                          boxShadow:"0 3px 14px rgba(0,0,0,0.06)" }}>
                          <div style={{ display:"flex", gap:"1rem", alignItems:"flex-start", marginBottom:"1rem" }}>
                            {r.bikeImageUrl && <img src={r.bikeImageUrl} alt={r.bikeBrand} style={{ width:72, height:72, borderRadius:10, objectFit:"cover" }} />}
                            <div style={{ flex:1 }}>
                              <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:darkMode?"#fff":BLACK }}>{r.bikeBrand} {r.bikeModel}</div>
                              {r.bikeCode && <div style={{ fontSize:"0.68rem", color:RHex, fontFamily:"monospace" }}>#{r.bikeCode}</div>}
                              {isOverdue ? (
                                <div style={{ fontSize:"0.78rem", color:"#c0392b", fontWeight:700, marginTop:"0.3rem" }}>⚠ OVERDUE by {Math.abs(dl)} day{Math.abs(dl)!==1?"s":""}</div>
                              ) : dl!==null ? (
                                <div style={{ fontSize:"0.78rem", color:progressColor, fontWeight:600, marginTop:"0.3rem" }}>
                                  {dl===0?"Due today":dl+" day"+(dl!==1?"s":"")+" left"}
                                </div>
                              ) : null}
                            </div>
                            <div style={{ background:isOverdue?"#fde8e8":"#d8f3dc", color:isOverdue?"#c0392b":GREEN, fontSize:"0.72rem", fontWeight:700, padding:"0.28rem 0.75rem", borderRadius:20 }}>
                              {isOverdue?"OVERDUE":"ACTIVE"}
                            </div>
                          </div>

                          {/* Progress bar */}
                          {progress !== null && (
                            <div style={{ marginBottom:"1rem" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.68rem", color:MUTED, marginBottom:"0.3rem" }}>
                                <span>Rental period</span>
                                <span>{progress}% used</span>
                              </div>
                              <div style={{ height:6, background:LGRAY, borderRadius:3, overflow:"hidden" }}>
                                <div style={{ height:"100%", width:progress+"%", background:progressColor, borderRadius:3, transition:"width 0.3s" }} />
                              </div>
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.65rem", color:MUTED, marginTop:"0.2rem" }}>
                                <span>Approved: {fmtDate(r.approvedAt)}</span>
                                <span>Due: {fmtDate(r.returnDate)}</span>
                              </div>
                            </div>
                          )}

                          {/* Renter info */}
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.8rem", padding:"0.8rem", background:bgColor, borderRadius:8, marginBottom:"0.8rem" }}>
                            {[["👤 Name",r.fullName],["🪪 UofL ID",r.uoflId],["📧 Email",r.email],["🎓 Type",r.userType]].map(([label,val]) => (
                              <div key={label}>
                                <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.12em", color:MUTED }}>{label}</div>
                                <div style={{ fontSize:"0.8rem", color:darkMode?"#ddd":BLACK, fontWeight:500, display:"flex", alignItems:"center" }}>
                                  {val||"—"}{label==="📧 Email"&&val&&<CopyBtn text={val} />}
                                </div>
                              </div>
                            ))}
                          </div>

                          {r.status==="Approved" && (
                            <Btn onClick={() => confirmPickup(r)} variant="approve" small style={{ width:"100%", marginBottom:"0.5rem" }}>
                              🪪 Confirm Pickup — Bike Handed Over
                            </Btn>
                          )}
                          {r.status==="Active" && (
                            <Btn onClick={() => markReturned(r)} variant="blue" small style={{ width:"100%" }}>
                              📦 Mark as Returned
                            </Btn>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── RETURNED BIKES ── */}
            {tab==="returned" && (
              <div style={{ flex:1, padding:"1.5rem", overflowY:"auto" }}>
                <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex, marginBottom:"0.5rem" }}>📦 Returned Bikes</div>
                <p style={{ fontSize:"0.82rem", color:MUTED, marginBottom:"1.2rem" }}>Review each returned bike and decide its next status.</p>
                {rentalsLoading ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>Loading…</div>
                ) : returnedRentals.length===0 ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>
                    <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>📦</div>
                    <p style={{ fontSize:"0.82rem" }}>No returned bikes yet</p>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
                    {returnedRentals.map(r => (
                      <div key={r.id} style={{ background:cardBg, borderRadius:14, padding:"1.4rem",
                        border:"1px solid "+(r.resolvedStatus?BORDER:"#2c5fb3"),
                        boxShadow:"0 3px 14px rgba(0,0,0,0.06)" }}>
                        <div style={{ display:"flex", gap:"1rem", alignItems:"flex-start", marginBottom:"1rem" }}>
                          {r.bikeImageUrl && <img src={r.bikeImageUrl} alt={r.bikeBrand} style={{ width:64, height:64, borderRadius:8, objectFit:"cover" }} />}
                          <div style={{ flex:1 }}>
                            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.15rem", color:darkMode?"#fff":BLACK }}>{r.bikeBrand} {r.bikeModel}</div>
                            {r.bikeCode && <div style={{ fontSize:"0.68rem", color:RHex, fontFamily:"monospace" }}>#{r.bikeCode}</div>}
                            <div style={{ fontSize:"0.72rem", color:MUTED, marginTop:"0.2rem" }}>Returned {timeAgo(r.returnedAt)}</div>
                          </div>
                          {r.resolvedStatus ? (
                            <span style={{ background:r.resolvedStatus==="Available"?"#d8f3dc":"#dce8ff", color:r.resolvedStatus==="Available"?GREEN:"#2c5fb3", fontSize:"0.72rem", fontWeight:700, padding:"0.28rem 0.75rem", borderRadius:20 }}>
                              {r.resolvedStatus==="Available"?"✅ Set Available":"🔧 Sent to Service"}
                            </span>
                          ) : (
                            <span style={{ background:"#dce8ff", color:"#2c5fb3", fontSize:"0.72rem", fontWeight:700, padding:"0.28rem 0.75rem", borderRadius:20 }}>AWAITING REVIEW</span>
                          )}
                        </div>

                        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.8rem", padding:"0.8rem", background:bgColor, borderRadius:8, marginBottom:"0.8rem" }}>
                          {[["👤 Renter",r.fullName],["🪪 UofL ID",r.uoflId],["📧 Email",r.email]].map(([label,val]) => (
                            <div key={label}>
                              <div style={{ fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.12em", color:MUTED }}>{label}</div>
                              <div style={{ fontSize:"0.8rem", color:darkMode?"#ddd":BLACK, fontWeight:500, display:"flex", alignItems:"center" }}>
                                {val||"—"}{label==="📧 Email"&&val&&<CopyBtn text={val} />}
                              </div>
                            </div>
                          ))}
                        </div>

                        {!r.resolvedStatus && (
                          <div style={{ display:"flex", gap:"0.8rem" }}>
                            <Btn onClick={() => resolveReturned(r,"available")} variant="approve" style={{ flex:1 }}>✅ Mark as Available</Btn>
                            <Btn onClick={() => resolveReturned(r,"service")} variant="blue" style={{ flex:1 }}>🔧 Send to Service</Btn>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── MESSAGES ── */}
            {tab==="messages" && (
              <div style={{ flex:1, display:"flex", padding:"1.5rem", gap:"1.5rem", overflowY:"auto" }}>
                <div style={{ width:320, flexShrink:0 }}>
                  <div style={{ fontFamily:"Georgia,serif", fontSize:"1.1rem", color:RHex, marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid "+BORDER }}>
                    📬 Messages <span style={{ fontSize:"0.7rem", color:MUTED, fontWeight:400 }}>({messages.filter(m=>!m.read).length} unread)</span>
                  </div>
                  {msgsLoading ? (
                    <div style={{ textAlign:"center", padding:"3rem", color:MUTED }}>Loading…</div>
                  ) : messages.length===0 ? (
                    <div style={{ textAlign:"center", padding:"3rem", color:MUTED }}>
                      <div style={{ fontSize:"2.5rem", opacity:0.2, marginBottom:"0.8rem" }}>📭</div>
                      <p style={{ fontSize:"0.8rem" }}>No messages yet</p>
                    </div>
                  ) : messages.map(msg => (
                    <div key={msg.id} onClick={() => { setSelectedMsg(msg); if (!msg.read) markAsRead(msg.id); }}
                      style={{ padding:"0.9rem 1rem", marginBottom:"0.5rem", cursor:"pointer",
                        background:selectedMsg?.id===msg.id?"#fde8e8":msg.read?cardBg:"#fff8f8",
                        border:"1px solid "+(selectedMsg?.id===msg.id?RHex:BORDER),
                        borderRadius:10, borderLeft:"4px solid "+(msg.read?"transparent":RHex) }}
                      onMouseEnter={e => { if (selectedMsg?.id!==msg.id) e.currentTarget.style.background="#fdf0f0"; }}
                      onMouseLeave={e => { if (selectedMsg?.id!==msg.id) e.currentTarget.style.background=msg.read?cardBg:"#fff8f8"; }}>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <div style={{ fontWeight:msg.read?400:700, fontSize:"0.88rem", color:darkMode?"#ddd":BLACK }}>{msg.name}</div>
                        {!msg.read && <span style={{ background:RHex, color:"#fff", fontSize:"0.58rem", padding:"0.1rem 0.4rem", borderRadius:10, fontWeight:700 }}>NEW</span>}
                      </div>
                      <div style={{ fontSize:"0.72rem", color:MUTED, marginTop:"0.2rem" }}>{msg.email}</div>
                      {msg.subject && <div style={{ fontSize:"0.76rem", color:"#666", marginTop:"0.25rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{msg.subject}</div>}
                      <div style={{ fontSize:"0.7rem", color:MUTED, marginTop:"0.25rem" }}>{timeAgo(msg.sentAt)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ flex:1 }}>
                  {selectedMsg ? (
                    <div style={{ background:cardBg, borderRadius:14, border:"1px solid "+BORDER, padding:"1.8rem", boxShadow:"0 4px 20px rgba(173,0,0,0.06)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.5rem", paddingBottom:"1rem", borderBottom:"1px solid "+BORDER }}>
                        <div>
                          <div style={{ fontFamily:"Georgia,serif", fontSize:"1.3rem", color:darkMode?"#fff":BLACK }}>{selectedMsg.subject||"No Subject"}</div>
                          <div style={{ fontSize:"0.78rem", color:MUTED, marginTop:"0.3rem", display:"flex", alignItems:"center" }}>
                            From: <strong style={{ marginLeft:"0.3rem" }}>{selectedMsg.name}</strong>
                            <span style={{ margin:"0 0.3rem" }}>·</span>
                            {selectedMsg.email}<CopyBtn text={selectedMsg.email} />
                          </div>
                          <div style={{ fontSize:"0.72rem", color:MUTED, marginTop:"0.2rem" }}>{timeAgo(selectedMsg.sentAt)}</div>
                        </div>
                        <a href={"mailto:"+selectedMsg.email+"?subject=Re: "+(selectedMsg.subject||"Your message")}
                          style={{ background:RHex, color:"#fff", padding:"0.5rem 1rem", borderRadius:7, fontSize:"0.78rem", textDecoration:"none", fontWeight:600 }}>
                          📧 Reply
                        </a>
                      </div>
                      <div style={{ fontSize:"0.9rem", color:darkMode?"#ddd":"#444", lineHeight:1.9, whiteSpace:"pre-wrap" }}>{selectedMsg.message}</div>
                    </div>
                  ) : (
                    <div style={{ textAlign:"center", padding:"5rem 2rem", color:MUTED }}>
                      <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>📨</div>
                      <p style={{ fontSize:"0.82rem" }}>Select a message to read it</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── USERS ── */}
            {tab==="users" && (
              <div style={{ flex:1, padding:"1.5rem", overflowY:"auto" }}>
                <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex, marginBottom:"1.2rem" }}>
                  👥 Registered Users <span style={{ fontSize:"0.75rem", color:MUTED, fontWeight:400 }}>({users.length} total)</span>
                </div>
                {usersLoading ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>Loading users…</div>
                ) : users.length===0 ? (
                  <div style={{ textAlign:"center", padding:"4rem", color:MUTED }}>
                    <div style={{ fontSize:"3rem", opacity:0.2, marginBottom:"1rem" }}>👥</div>
                    <p style={{ fontSize:"0.82rem" }}>No registered users yet</p>
                  </div>
                ) : (
                  <div style={{ background:cardBg, borderRadius:12, border:"1px solid "+BORDER, overflow:"hidden" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 100px 100px 80px 80px", gap:"0.5rem", padding:"0.6rem 1rem", fontSize:"0.58rem", textTransform:"uppercase", letterSpacing:"0.12em", color:MUTED, borderBottom:"2px solid "+BORDER, background:bgColor }}>
                      {["Name","Email","User Type","Joined","Rentals","Role"].map(h => <span key={h}>{h}</span>)}
                    </div>
                    {users.map(u => {
                      const badge = getRentalBadge(u.rentalCount);
                      return (
                        <div key={u.id} style={{ display:"grid", gridTemplateColumns:"2fr 1.5fr 100px 100px 80px 80px", gap:"0.5rem", padding:"0.7rem 1rem", alignItems:"center", fontSize:"0.78rem", borderBottom:"1px solid "+BORDER, color:darkMode?"#ddd":BLACK }}
                          onMouseEnter={e => (e.currentTarget.style.background=bgColor)} onMouseLeave={e => (e.currentTarget.style.background="transparent")}>
                          <div>
                            <div style={{ fontWeight:600 }}>{u.firstName} {u.lastName}</div>
                            {badge && <div style={{ fontSize:"0.65rem", color:RHex }}>{badge.icon} {badge.label}</div>}
                          </div>
                          <div style={{ fontSize:"0.72rem", color:MUTED, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"flex", alignItems:"center" }}>
                            {u.email}<CopyBtn text={u.email} />
                          </div>
                          <span>{u.userType||"—"}</span>
                          <span style={{ fontSize:"0.7rem" }}>{fmtDate(u.createdAt)}</span>
                          <span style={{ fontFamily:"Georgia,serif", fontSize:"1rem", color:RHex, fontWeight:700, textAlign:"center" }}>{u.rentalCount}</span>
                          <span style={{ background:u.role==="admin"?RHex:"#e8e8e8", color:u.role==="admin"?"#fff":"#555", fontSize:"0.62rem", padding:"0.15rem 0.5rem", borderRadius:10, fontWeight:600, textTransform:"uppercase", textAlign:"center" }}>{u.role}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}

      {/* Edit Bike Modal */}
      {editId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}
          onClick={e => { if (e.target===e.currentTarget) setEditId(null); }}>
          <div style={{ background:SURF, borderRadius:14, border:"1px solid "+BORDER, padding:"1.5rem", width:520, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex, display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid "+BORDER }}>
              Edit Bicycle
              <button onClick={() => setEditId(null)} style={{ background:"none", border:"none", fontSize:"1rem", color:MUTED, cursor:"pointer" }}>✕</button>
            </div>
            <BikeForm form={editForm} setForm={setEditForm} onSubmit={saveEdit} submitLabel={saving?"Saving…":"Save Changes"} onCancel={() => setEditId(null)} imageFile={editImg} setImageFile={setEditImg} existingImageUrl={editForm.imageUrl} />
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approveModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}
          onClick={e => { if (e.target===e.currentTarget) setApproveModal(null); }}>
          <div style={{ background:SURF, borderRadius:14, border:"1px solid "+BORDER, padding:"2rem", width:440, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:GREEN, marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid "+BORDER }}>✅ Approve Rental</div>
            <p style={{ fontSize:"0.88rem", color:"#555", lineHeight:1.8, marginBottom:"1.2rem" }}>
              Approving for <strong>{approveModal.fullName}</strong> — <strong>{approveModal.bikeBrand} {approveModal.bikeModel}</strong>
            </p>
            <Field label="Set Return Date">
              <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{ width:"100%", background:BG, border:"1px solid "+BORDER, color:BLACK, fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none" }} />
            </Field>
            <p style={{ fontSize:"0.75rem", color:MUTED, marginBottom:"1rem" }}>Optional — set the expected return date.</p>
            <div style={{ display:"flex", gap:"0.8rem" }}>
              <Btn onClick={() => setApproveModal(null)} variant="ghost">Cancel</Btn>
              <Btn onClick={approveRental} variant="approve" style={{ flex:1 }}>✅ Confirm Approval</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}
          onClick={e => { if (e.target===e.currentTarget) setRejectModal(null); }}>
          <div style={{ background:SURF, borderRadius:14, border:"1px solid "+BORDER, padding:"2rem", width:440, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:"#c0392b", marginBottom:"1rem", paddingBottom:"0.6rem", borderBottom:"2px solid "+BORDER }}>✕ Reject Rental</div>
            <p style={{ fontSize:"0.88rem", color:"#555", lineHeight:1.8, marginBottom:"1.2rem" }}>
              Rejecting for <strong>{rejectModal.fullName}</strong> — <strong>{rejectModal.bikeBrand} {rejectModal.bikeModel}</strong>
            </p>
            <Field label="Reason for Rejection">
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional — provide a reason for the user…"
                style={{ width:"100%", background:BG, border:"1px solid "+BORDER, color:BLACK, fontFamily:"inherit", fontSize:"0.85rem", padding:"0.5rem 0.7rem", borderRadius:6, outline:"none", resize:"vertical", minHeight:80 }} />
            </Field>
            <div style={{ display:"flex", gap:"0.8rem" }}>
              <Btn onClick={() => setRejectModal(null)} variant="ghost">Cancel</Btn>
              <Btn onClick={rejectRental} variant="reject" style={{ flex:1 }}>✕ Confirm Rejection</Btn>
            </div>
          </div>
        </div>
      )}

      <Footer setPage={setPage} />
      <Toast msg={toast} />
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState]     = useState("loading");
  const [user, setUser]               = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [page, setPage]               = useState("login");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async firebaseUser => {
      if (!firebaseUser) { setAuthState("unauthenticated"); setUser(null); setUserProfile(null); return; }
      setUser(firebaseUser);
      try {
        const snap = await getDoc(doc(db,"users",firebaseUser.uid));
        const profileData = snap.exists() ? snap.data() : null;
        if (profileData?.role==="admin" || firebaseUser.emailVerified) {
          if (profileData) setUserProfile({ ...profileData, uid:firebaseUser.uid });
          setAuthState("authenticated");
        } else {
          setAuthState("unverified");
        }
      } catch (e) {
        console.error(e);
        if (firebaseUser.emailVerified) setAuthState("authenticated");
        else setAuthState("unverified");
      }
    });
    return unsub;
  }, []);

  if (authState==="loading") {
    return (
      <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <style>{GLOBAL_STYLES}</style>
        <div style={{ textAlign:"center", color:MUTED }}>
          <div style={{ fontSize:"3.5rem", marginBottom:"1rem" }}>🚲</div>
          <div style={{ fontFamily:"Georgia,serif", fontSize:"1.2rem", color:RHex }}>UofL Bikeshare</div>
          <div style={{ fontSize:"0.8rem", marginTop:"0.5rem" }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (authState==="unauthenticated") {
    return page==="login"
      ? <LoginPage  onSignup={() => setPage("signup")} />
      : <SignupPage onLogin={() => setPage("login")} />;
  }

  if (authState==="unverified") return <VerifyEmailPage user={user} />;

  const role = userProfile?.role;
  if (role==="admin") return <AdminDashboard userProfile={userProfile} setUserProfile={setUserProfile} />;
  return <PublicDashboard userProfile={userProfile} setUserProfile={setUserProfile} />;
}
