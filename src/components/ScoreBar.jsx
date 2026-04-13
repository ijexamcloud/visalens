import React from 'react';
import { scoreCol } from '../utils/format';

export default function ScoreBar({ label, score }) {
  return (
    <div className="sbar">
      <div className="sbar-lbl"><span className="sbar-nm">{label}</span><span className="sbar-num" style={{color:scoreCol(score)}}>{score}/100</span></div>
      <div className="sbar-tr"><div className="sbar-fl" style={{width:`${score}%`,background:scoreCol(score)}}/></div>
    </div>
  );
}
