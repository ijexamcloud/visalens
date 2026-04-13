import React from 'react';
import { Star, X } from 'lucide-react';

export default function OfferLettersSection({ data, setData, preferredIdx, setPreferredIdx }) {
  const offers = Array.isArray(data.offerLetters) ? data.offerLetters : [];

  function updateOffer(i, field, val) {
    setData(p => {
      const next = [...(p.offerLetters||[])];
      next[i] = { ...next[i], [field]: val };
      return { ...p, offerLetters: next };
    });
  }
  function addOffer() {
    setData(p => ({ ...p, offerLetters: [...(p.offerLetters||[]), { status:"Full", university:"", country:"", program:"", intakeSeason:"", conditions:"" }] }));
  }
  function removeOffer(i) {
    setData(p => {
      const next = (p.offerLetters||[]).filter((_,j) => j !== i);
      return { ...p, offerLetters: next };
    });
    if (preferredIdx >= i && preferredIdx > 0) setPreferredIdx(preferredIdx - 1);
  }

  return (
    <div className="pgroup">
      <div className="pgroup-label" style={{display:"flex",alignItems:"center",gap:8}}>
        Offer Letters
        <span className="badge b-neu" style={{fontSize:9,marginLeft:2}}>{offers.length} offer{offers.length!==1?"s":""}</span>
        <button className="offer-add-btn" onClick={addOffer} title="Add offer letter manually">+ Add</button>
      </div>
      {offers.length === 0 ? (
        <div className="offer-empty">No offer letters extracted — add one manually or re-analyse.</div>
      ) : (
        <div className="offer-list">
          {offers.map((offer, i) => (
            <div key={i} className={`offer-card${i === preferredIdx ? " preferred" : ""}`}>
              <div className="offer-card-hdr">
                <button
                  className={`offer-star-btn${i === preferredIdx ? " on" : ""}`}
                  onClick={() => setPreferredIdx(i)}
                  title={i === preferredIdx ? "Preferred — drives University Checker & Checklists" : "Set as preferred"}
                >
                  <Star size={12} fill={i === preferredIdx ? "currentColor" : "none"}/>
                  {i === preferredIdx ? "Preferred" : "Set preferred"}
                </button>
                <select
                  className="offer-status-sel"
                  value={offer.status||"Full"}
                  onChange={e => updateOffer(i, "status", e.target.value)}
                >
                  <option value="Full">Full</option>
                  <option value="Conditional">Conditional</option>
                </select>
                <button className="offer-remove-btn" onClick={() => removeOffer(i)} title="Remove this offer"><X size={12}/></button>
              </div>
              <div className="offer-fields">
                <div className="offer-field s2">
                  <div className="plbl">University</div>
                  <input className="pval-input" value={offer.university||""} onChange={e=>updateOffer(i,"university",e.target.value)} placeholder="University name"/>
                </div>
                <div className="offer-field">
                  <div className="plbl">Country</div>
                  <input className="pval-input" value={offer.country||""} onChange={e=>updateOffer(i,"country",e.target.value)} placeholder="Country"/>
                </div>
                <div className="offer-field">
                  <div className="plbl">Intake</div>
                  <input className="pval-input" value={offer.intakeSeason||""} onChange={e=>updateOffer(i,"intakeSeason",e.target.value)} placeholder="e.g. Sep 2026"/>
                </div>
                <div className="offer-field s2">
                  <div className="plbl">Programme</div>
                  <input className="pval-input" value={offer.program||""} onChange={e=>updateOffer(i,"program",e.target.value)} placeholder="Programme name"/>
                </div>
                {offer.status === "Conditional" && (
                  <div className="offer-field s2">
                    <div className="plbl">Conditions</div>
                    <input className="pval-input" value={offer.conditions||""} onChange={e=>updateOffer(i,"conditions",e.target.value)} placeholder="e.g. IELTS 6.5 by August 2026"/>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
