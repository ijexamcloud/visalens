import React from 'react';
import { Bell } from 'lucide-react';
import { daysUntilExpiry } from '../utils/format';

export default function ExpiryAlerts({ profile }) {
  const alerts = [];
  const days = daysUntilExpiry(profile.passportExpiry);
  if (days !== null) {
    if (days < 0)   alerts.push({type:"danger",label:"Passport Expired",detail:`Passport expired ${Math.abs(days)} days ago. A new passport is required immediately.`});
    else if (days < 90)  alerts.push({type:"danger",label:"Passport Expiring Soon",detail:`Passport expires in ${days} days. Most visas require 6 months validity beyond course end.`});
    else if (days < 180) alerts.push({type:"warn",label:"Passport Validity Warning",detail:`Passport expires in ${days} days. Check if this covers your full study period + 6 months.`});
  }
  if (!alerts.length) return null;
  return (
    <div style={{marginBottom:10}}>
      {alerts.map((a,i) => (
        <div key={i} className={`expiry-alert ${a.type}`}>
          <div className={`expiry-alert-icon ${a.type}`}><Bell size={14}/></div>
          <div><div className="expiry-title">{a.label}</div><div className="expiry-detail">{a.detail}</div></div>
        </div>
      ))}
    </div>
  );
}
