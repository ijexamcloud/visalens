import React, { useState, useEffect } from 'react';

export default function ThumbImg({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url); }, [file]);
  return src ? <img src={src} alt=""/> : <div className="skel" style={{width:"100%",height:"100%"}}/>;
}
