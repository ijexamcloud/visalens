import React, { useState, useRef, useEffect } from 'react';
import { Bell, ChevronDown, CheckCircle, Eye, EyeOff, Flag, Info, TriangleAlert } from 'lucide-react';

// ── Country / intake helpers (used by caseMatchesAlert and PolicyRadar) ──────

export function normaliseCountry(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "uk" || s === "united kingdom" || s === "great britain" || s === "england") return "United Kingdom";
  if (s === "usa" || s === "us" || s === "united states" || s === "united states of america") return "United States";
  if (s === "uae" || s === "united arab emirates") return "United Arab Emirates";
  if (s === "canada") return "Canada";
  if (s === "australia") return "Australia";
  if (s === "new zealand" || s === "nz") return "New Zealand";
  if (s === "ireland" || s === "republic of ireland") return "Ireland";
  return raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

export function parseIntakeYear(profile) {
  const offers = Array.isArray(profile?.offerLetters) ? profile.offerLetters : [];
  for (const o of offers) {
    const m = (o.intakeSeason || "").match(/\b(20\d{2})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export function resolveProfileCountry(profile, preferredIndex = 0) {
  const offers = Array.isArray(profile?.offerLetters) ? profile.offerLetters : [];
  const preferred = offers[preferredIndex];
  if (preferred?.country && preferred.country !== "Not found" && preferred.country !== "") {
    return normaliseCountry(preferred.country);
  }
  for (const o of offers) {
    if (o.country && o.country !== "Not found" && o.country !== "") {
      return normaliseCountry(o.country);
    }
  }
  if (profile?.targetCountry && profile.targetCountry !== "Not found" && profile.targetCountry !== "") {
    return normaliseCountry(profile.targetCountry);
  }
  return null;
}

export function caseMatchesAlert(profile, alert, preferredIndex = 0) {
  const rules = alert.affected_if || {};
  if (!rules.countries && !rules.intakeYearMin && !rules.intakeYearMax) return true;
  if (rules.countries && Array.isArray(rules.countries)) {
    const country = resolveProfileCountry(profile, preferredIndex);
    const normRules = rules.countries.map(normaliseCountry);
    if (!country || !normRules.includes(country)) return false;
  }
  if (rules.intakeYearMin) {
    const year = parseIntakeYear(profile);
    if (!year || year < rules.intakeYearMin) return false;
  }
  if (rules.intakeYearMax) {
    const year = parseIntakeYear(profile);
    if (!year || year > rules.intakeYearMax) return false;
  }
  return true;
}

// ── PolicyAlertBanner ─────────────────────────────────────────────────────────

export function PolicyAlertBanner({ policyAlerts, profileData, preferredOfferIndex = 0 }) {
  const [expanded, setExpanded] = useState(null);
  if (!policyAlerts?.length || !profileData?.fullName) return null;
  const matched = policyAlerts.filter(a => caseMatchesAlert(profileData, a, preferredOfferIndex));
  if (!matched.length) return null;

  const sevColor = { high: "var(--err)", medium: "var(--warn)", low: "var(--ok)" };
  const sevBg    = { high: "rgba(220,38,38,.06)", medium: "rgba(245,158,11,.06)", low: "rgba(5,150,105,.06)" };
  const sevBd    = { high: "rgba(220,38,38,.25)", medium: "rgba(245,158,11,.25)", low: "rgba(5,150,105,.25)" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
        <Flag size={13} color="var(--err)" style={{flexShrink:0}}/>
        <span style={{fontFamily:"var(--fh)",fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--err)"}}>Policy Alerts</span>
      </div>
      {matched.map(a => (
        <div key={a.id} style={{
          background: sevBg[a.severity] || sevBg.medium,
          border: `1px solid ${sevBd[a.severity] || sevBd.medium}`,
          borderRadius: "var(--r2)", overflow: "hidden",
        }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}
            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
          >
            <Flag size={13} color={sevColor[a.severity] || sevColor.medium} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: sevColor[a.severity] || sevColor.medium }}>
                Policy Alert · {a.country}
              </span>
              <span style={{ fontSize: 12, color: "var(--t2)", marginLeft: 8 }}>{a.title}</span>
            </div>
            <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "var(--fm)", flexShrink: 0 }}>
              {expanded === a.id ? "▲ Hide" : "▼ Details"}
            </span>
          </div>
          {expanded === a.id && (
            <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${sevBd[a.severity] || sevBd.medium}` }}>
              <p style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.6, margin: "10px 0 8px" }}>{a.detail}</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--t3)", fontFamily: "var(--fm)" }}>
                {a.effective_date && <span>Effective: {a.effective_date}</span>}
                {a.verified_at && <span>Verified: {a.verified_at}</span>}
                {a.source_url && (
                  <a href={a.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--p)", textDecoration: "underline" }}>
                    Official source →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── QualityCard ───────────────────────────────────────────────────────────────

export function QualityCard({ docs, qualities }) {
  const issues = docs.filter(d => { const q = qualities[d.id]; return q && (q.status==="warn"||q.status==="error"); });
  if (!issues.length) return null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
        <TriangleAlert size={13} color="#B45309" style={{flexShrink:0}}/>
        <span style={{fontFamily:"var(--fh)",fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--warn)"}}>Document Quality Issues</span>
        <span className="badge b-warn" style={{fontSize:9}}>{issues.length} file{issues.length!==1?"s":""}</span>
      </div>
      {issues.map(d => {
        const q = qualities[d.id], isErr = q.status==="error";
        return (
          <div key={d.id} className={`qa-item ${isErr?"err":"warn"}`}>
            <div className={`qa-ico ${isErr?"err":"warn"}`}>{isErr?<EyeOff size={15}/>:<Eye size={15}/>}</div>
            <div><div className="qa-n">{d.renamed||d.file.name}</div><div className="qa-d">{isErr?`Unreadable — ${q.detail||"File could not be processed."}`:`Low quality — ${q.detail||"Some data may be inaccurate."}`}</div></div>
          </div>
        );
      })}
      <div className="qa-tip"><Info size={13} style={{flexShrink:0,marginTop:1}}/><span>Re-upload clearer scans at 300 DPI+. Fields marked "Not found" may be caused by poor image quality.</span></div>
    </div>
  );
}

// ── AlertsHub ─────────────────────────────────────────────────────────────────

export function AlertsHub({ policyAlerts, profileData, docs, qualities, embedded, preferredOfferIndex = 0 }) {
  const matchedPolicy = (policyAlerts?.length && profileData?.fullName)
    ? policyAlerts.filter(a => caseMatchesAlert(profileData, a, preferredOfferIndex))
    : [];
  const qualityIssues = docs.filter(d => { const q = qualities[d.id]; return q && (q.status==="warn"||q.status==="error"); });

  const totalAlerts = matchedPolicy.length + qualityIssues.length;
  if (totalAlerts === 0) return null;

  const hasError = qualityIssues.some(d => qualities[d.id]?.status === "error") || matchedPolicy.some(a => a.severity === "high");
  const mod = hasError ? "alerts-hub--err" : "alerts-hub--warn";
  const [open, setOpen] = useState(true);

  if (embedded) {
    return (
      <div className="alerts-hub-body" style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
        {matchedPolicy.length > 0 && <PolicyAlertBanner policyAlerts={policyAlerts} profileData={profileData} preferredOfferIndex={preferredOfferIndex}/>}
        {qualityIssues.length > 0 && <QualityCard docs={docs} qualities={qualities} />}
      </div>
    );
  }

  return (
    <div className={`alerts-hub ${mod}`}>
      <button className={`alerts-hub-hdr${open ? " has-border" : ""}`} onClick={() => setOpen(o => !o)}>
        <div className="rc-ico" style={{background: hasError ? "rgba(220,38,38,.1)" : "rgba(180,83,9,.1)", borderColor: hasError ? "rgba(220,38,38,.25)" : "rgba(180,83,9,.25)"}}>
          <TriangleAlert size={14} color={hasError ? "var(--err)" : "var(--warn)"}/>
        </div>
        <span className="alerts-hub-ttl">
          {hasError ? "Alerts" : "Notices"} · {totalAlerts} Item{totalAlerts !== 1 ? "s" : ""}
        </span>
        {qualityIssues.length > 0 && (
          <span className="badge b-warn" style={{fontSize:9}}><TriangleAlert size={9}/>{qualityIssues.length} Quality</span>
        )}
        {matchedPolicy.length > 0 && (
          <span className="badge b-err" style={{fontSize:9,marginLeft:4}}><Flag size={9}/>{matchedPolicy.length} Policy</span>
        )}
        <ChevronDown size={13} className={`alerts-hub-chevron${open ? " open" : ""}`}/>
      </button>
      {open && (
        <div className="alerts-hub-body">
          {matchedPolicy.length > 0 && <PolicyAlertBanner policyAlerts={policyAlerts} profileData={profileData} preferredOfferIndex={preferredOfferIndex}/>}
          {qualityIssues.length > 0 && <QualityCard docs={docs} qualities={qualities} />}
        </div>
      )}
    </div>
  );
}

// ── AlertsButton ──────────────────────────────────────────────────────────────

export function AlertsButton({ policyAlerts, profileData, docs, qualities, preferredOfferIndex = 0 }) {
  const matchedPolicy = (policyAlerts?.length && profileData?.fullName)
    ? policyAlerts.filter(a => caseMatchesAlert(profileData, a, preferredOfferIndex))
    : [];
  const qualityIssues = docs.filter(d => { const q = qualities[d.id]; return q && (q.status==="warn"||q.status==="error"); });
  const totalAlerts = matchedPolicy.length + qualityIssues.length;

  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const hasError = qualityIssues.some(d => qualities[d.id]?.status === "error") || matchedPolicy.some(a => a.severity === "high");
  const noAlerts = totalAlerts === 0;
  const badgeColor = noAlerts ? "var(--ok)"                : hasError ? "var(--err)" : "var(--warn)";
  const badgeBg    = noAlerts ? "rgba(5,150,105,.10)"      : hasError ? "rgba(220,38,38,.12)" : "rgba(180,83,9,.12)";
  const badgeBd    = noAlerts ? "rgba(5,150,105,.3)"       : hasError ? "rgba(220,38,38,.3)"  : "rgba(180,83,9,.3)";

  return (
    <div ref={ref} style={{position:"relative",flexShrink:0}}>
      <button
        className="btn-s"
        onClick={() => !noAlerts && setOpen(o => !o)}
        style={{
          borderColor: (open || noAlerts) ? badgeBd : undefined,
          color: (open || noAlerts) ? badgeColor : undefined,
          background: (open || noAlerts) ? badgeBg : undefined,
          whiteSpace:"nowrap",
          cursor: noAlerts ? "default" : "pointer",
        }}
      >
        {noAlerts
          ? <CheckCircle size={13} style={{color: badgeColor, flexShrink:0}}/>
          : <TriangleAlert size={13} style={{color: badgeColor, flexShrink:0}}/>
        }
        {noAlerts ? "All Clear" : "Alerts"}
        {!noAlerts && (
          <span style={{
            display:"inline-flex",alignItems:"center",justifyContent:"center",
            minWidth:18,height:18,borderRadius:9,padding:"0 5px",
            background:badgeBg,border:`1px solid ${badgeBd}`,
            color:badgeColor,fontSize:10,fontWeight:700,lineHeight:1,
            flexShrink:0,
          }}>
            {totalAlerts}
          </span>
        )}
        {!noAlerts && <ChevronDown size={12} style={{color:"var(--t3)",transition:"transform .2s",transform:open?"rotate(180deg)":"none",flexShrink:0}}/>}
      </button>

      {open && !noAlerts && (
        <div className="alerts-dropdown">
          <div className="alerts-dropdown-arrow"/>
          <AlertsHub policyAlerts={policyAlerts} profileData={profileData} docs={docs} qualities={qualities} embedded preferredOfferIndex={preferredOfferIndex}/>
        </div>
      )}
    </div>
  );
}
