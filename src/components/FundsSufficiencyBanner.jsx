import React, { useState } from 'react';
import { AlertCircle, CheckCircle, DollarSign, Info } from 'lucide-react';
import { parseCurrencyAmount } from '../utils/parsers';

export default function FundsSufficiencyBanner({ balance, required }) {
  const [convertedInput, setConvertedInput] = useState("");

  if (!balance || !required || balance.trim() === "" || required.trim() === "") return null;

  const parsed    = parseCurrencyAmount(balance);
  const reqParsed = parseCurrencyAmount(required);

  if (parsed.amount === null && reqParsed.amount === null) {
    return (
      <div className="fsb fsb-unclear">
        <Info size={13} style={{flexShrink:0,marginTop:1}}/>
        <div className="fsb-body">
          <div className="fsb-title">Cannot determine sufficiency</div>
          <div className="fsb-detail">Could not parse either amount — verify manually before submission.</div>
        </div>
      </div>
    );
  }

  const currenciesMatch =
    parsed.currency && reqParsed.currency &&
    parsed.currency === reqParsed.currency;

  if (!currenciesMatch) {
    const converted = parseFloat(convertedInput.replace(/[^0-9.]/g,""));
    const hasConverted = !isNaN(converted) && converted > 0;
    const req = reqParsed.amount;
    const sym = reqParsed.currency || parsed.currency || "";

    if (hasConverted && req !== null) {
      const diff = converted - req;
      const sufficient = diff >= 0;
      const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return (
        <div className={`fsb ${sufficient ? "fsb-ok" : "fsb-fail"}`}>
          {sufficient ? <CheckCircle size={13} style={{flexShrink:0,marginTop:1}}/> : <AlertCircle size={13} style={{flexShrink:0,marginTop:1}}/>}
          <div className="fsb-body">
            <div className="fsb-title">
              {sufficient
                ? `Appears sufficient — ${sym} ${fmt(converted)} equivalent vs ${sym} ${fmt(req)} required (+${sym} ${fmt(diff)})`
                : `Apparent shortfall — ${sym} ${fmt(Math.abs(diff))} below requirement`
              }
            </div>
            <div className="fsb-detail" style={{display:"flex",alignItems:"center",gap:8,marginTop:4,flexWrap:"wrap"}}>
              <span>Based on your conversion. Verify live exchange rate before submission.</span>
              <button className="fsb-clear-btn" onClick={()=>setConvertedInput("")}>Change amount</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fsb fsb-convert">
        <DollarSign size={13} style={{flexShrink:0,marginTop:1,color:"var(--info)"}}/>
        <div className="fsb-body">
          <div className="fsb-title" style={{color:"var(--info)"}}>
            Currencies differ ({parsed.currency||"?"} available · {reqParsed.currency||"?"} required)
          </div>
          <div className="fsb-convert-row">
            <label className="fsb-convert-lbl">
              Enter {parsed.currency||"available"} equivalent in {reqParsed.currency||"required currency"}:
            </label>
            <div className="fsb-convert-input-wrap">
              <span className="fsb-convert-sym">{reqParsed.currency||""}</span>
              <input
                className="fsb-convert-input"
                type="number"
                min="0"
                placeholder="e.g. 18000"
                value={convertedInput}
                onChange={e => setConvertedInput(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Same currency
  const avail = parsed.amount;
  const req   = reqParsed.amount;
  const diff  = avail - req;
  const pct   = req > 0 ? ((avail / req) * 100).toFixed(0) : null;
  const sufficient = diff >= 0;
  const fmt   = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const sym   = parsed.currency;

  return (
    <div className={`fsb ${sufficient ? "fsb-ok" : "fsb-fail"}`}>
      {sufficient
        ? <CheckCircle size={13} style={{flexShrink:0,marginTop:1}}/>
        : <AlertCircle size={13} style={{flexShrink:0,marginTop:1}}/>
      }
      <div className="fsb-body">
        <div className="fsb-title">
          {sufficient
            ? `Appears sufficient — ${sym} ${fmt(avail)} available vs ${sym} ${fmt(req)} required (+${sym} ${fmt(diff)})`
            : `Apparent shortfall — ${sym} ${fmt(Math.abs(diff))} below requirement`
          }
        </div>
        <div className="fsb-detail">
          {sufficient
            ? `${pct}% of requirement met. Verify figure reflects current visa rules before submission.`
            : `Available ${sym} ${fmt(avail)} · Required ${sym} ${fmt(req)}. Additional funds or sponsor docs may be needed.`
          }
        </div>
      </div>
    </div>
  );
}
