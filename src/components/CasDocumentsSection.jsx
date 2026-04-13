import React from 'react';
import { X } from 'lucide-react';

export default function CasDocumentsSection({ data, setData }) {
  const casItems = Array.isArray(data.casDocuments) ? data.casDocuments : [];

  function updateCas(i, field, val) {
    setData(p => {
      const next = [...(p.casDocuments || [])];
      next[i] = { ...next[i], [field]: val };
      return { ...p, casDocuments: next };
    });
  }
  function addCas(type) {
    setData(p => ({
      ...p,
      casDocuments: [
        ...(p.casDocuments || []),
        { type, casNumber: "", university: "", course: "", intakeSeason: "", sponsorshipStatus: "", expiryDate: "", conditions: "", notes: "" }
      ]
    }));
  }
  function removeCas(i) {
    setData(p => ({ ...p, casDocuments: (p.casDocuments || []).filter((_, j) => j !== i) }));
  }

  const typeMeta = {
    "CAS":     { color: "#059669", bg: "#D1FAE5" },
    "Pre-CAS": { color: "#B45309", bg: "#FEF3C7" },
  };

  return (
    <div className="pgroup">
      <div className="pgroup-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        CAS &amp; Pre-CAS Documents
        <span className="badge b-neu" style={{ fontSize: 9 }}>
          {casItems.length} document{casItems.length !== 1 ? "s" : ""}
        </span>
        <button className="offer-add-btn" onClick={() => addCas("CAS")}>+ CAS</button>
        <button className="offer-add-btn" onClick={() => addCas("Pre-CAS")}>+ Pre-CAS</button>
      </div>

      {casItems.length === 0 ? (
        <div className="offer-empty">No CAS or Pre-CAS documents extracted — add manually or re-analyse with those documents uploaded.</div>
      ) : (
        <div className="offer-list">
          {casItems.map((cas, i) => {
            const meta = typeMeta[cas.type] || typeMeta["CAS"];
            return (
              <div key={i} className="offer-card">
                <div className="offer-card-hdr">
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 9px", borderRadius:8, background:meta.bg, color:meta.color, border:`1px solid ${meta.color}40`, letterSpacing:".05em", textTransform:"uppercase" }}>
                    {cas.type || "CAS"}
                  </span>
                  <select className="offer-status-sel" value={cas.type || "CAS"} onChange={e => updateCas(i, "type", e.target.value)}>
                    <option value="CAS">CAS</option>
                    <option value="Pre-CAS">Pre-CAS</option>
                  </select>
                  <button className="offer-remove-btn" onClick={() => removeCas(i)}><X size={12}/></button>
                </div>
                <div className="offer-fields">
                  {cas.type === "CAS" && (
                    <div className="offer-field s2">
                      <div className="plbl">CAS Number</div>
                      <input className="pval-input" value={cas.casNumber||""} onChange={e=>updateCas(i,"casNumber",e.target.value)} placeholder="e.g. X1A2B3C4D5E6F7G8"/>
                    </div>
                  )}
                  <div className="offer-field s2">
                    <div className="plbl">University / Sponsor</div>
                    <input className="pval-input" value={cas.university||""} onChange={e=>updateCas(i,"university",e.target.value)} placeholder="University name"/>
                  </div>
                  <div className="offer-field s2">
                    <div className="plbl">Course / Programme</div>
                    <input className="pval-input" value={cas.course||""} onChange={e=>updateCas(i,"course",e.target.value)} placeholder="e.g. MSc Computer Science"/>
                  </div>
                  <div className="offer-field">
                    <div className="plbl">Intake</div>
                    <input className="pval-input" value={cas.intakeSeason||""} onChange={e=>updateCas(i,"intakeSeason",e.target.value)} placeholder="e.g. Sep 2026"/>
                  </div>
                  {cas.type === "CAS" && (
                    <div className="offer-field">
                      <div className="plbl">CAS Expiry Date</div>
                      <input className="pval-input" value={cas.expiryDate||""} onChange={e=>updateCas(i,"expiryDate",e.target.value)} placeholder="e.g. 31 Aug 2026"/>
                    </div>
                  )}
                  {cas.type === "CAS" && (
                    <div className="offer-field s2">
                      <div className="plbl">Sponsorship Status</div>
                      <select className="doc-sel" value={cas.sponsorshipStatus||""} onChange={e=>updateCas(i,"sponsorshipStatus",e.target.value)} style={{marginTop:2}}>
                        <option value="">— select —</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Conditional">Conditional</option>
                        <option value="Withdrawn">Withdrawn</option>
                      </select>
                    </div>
                  )}
                  {cas.type === "Pre-CAS" && (
                    <div className="offer-field s2">
                      <div className="plbl">Conditions to receive CAS</div>
                      <input className="pval-input" value={cas.conditions||""} onChange={e=>updateCas(i,"conditions",e.target.value)} placeholder="e.g. Pay tuition deposit, submit IELTS"/>
                    </div>
                  )}
                  <div className="offer-field s2">
                    <div className="plbl">Notes</div>
                    <input className="pval-input" value={cas.notes||""} onChange={e=>updateCas(i,"notes",e.target.value)} placeholder="Any additional notes…"/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
