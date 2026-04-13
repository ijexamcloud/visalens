import React, { useState, useEffect } from 'react';
import { File, X } from 'lucide-react';

export default function PreviewModal({ doc, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [text, setText] = useState(null);
  useEffect(() => {
    const isImg = doc.file.type.startsWith("image/");
    const isPDF = doc.file.type === "application/pdf";
    if (isImg || isPDF) { const url = URL.createObjectURL(doc.file); setBlobUrl(url); return () => URL.revokeObjectURL(url); }
    else { doc.file.text().then(t => setText(t.slice(0,3000))); }
  }, [doc]);
  useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const isImg = doc.file.type.startsWith("image/"), isPDF = doc.file.type === "application/pdf";
  const name = doc.renamed || doc.file.name;
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="modal-hdr"><div className="rc-ico"><File size={14}/></div><span className="modal-title">{name}</span><button className="btn-ico" onClick={onClose}><X size={14}/></button></div>
        <div className="modal-body">
          {isImg && blobUrl && <img src={blobUrl} alt={name} className="modal-img"/>}
          {isPDF && blobUrl && <iframe src={blobUrl} title={name} className="modal-pdf"/>}
          {!isImg && !isPDF && text !== null && <div className="modal-txt">{text || "(empty)"}</div>}
          {!isImg && !isPDF && text === null && <div className="skel" style={{width:"100%",height:200}}/>}
        </div>
      </div>
    </div>
  );
}
