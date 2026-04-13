import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value || value === "Not found" || value === "") return null;
  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      style={{
        display:"inline-flex", alignItems:"center", justifyContent:"center",
        width:18, height:18, borderRadius:4, border:"1px solid var(--bd)",
        background: copied ? "var(--ok)" : "var(--s2)",
        color: copied ? "#fff" : "var(--t3)",
        cursor:"pointer", flexShrink:0, transition:"all 150ms", padding:0,
        marginLeft:5,
      }}
    >
      {copied ? <Check size={10}/> : <Copy size={10}/>}
    </button>
  );
}
