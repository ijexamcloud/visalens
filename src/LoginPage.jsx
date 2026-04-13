import React, { useState, useRef, useEffect } from 'react';
import './LoginPage.css';
import { AlertCircle, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';

const PROXY_URL = "https://visalens-proxy.ijecloud.workers.dev";
const ORG_SESSION_KEY = "visalens_org_session";

function setOrgSession(data) {
  try { sessionStorage.setItem(ORG_SESSION_KEY, JSON.stringify(data)); } catch {}
}

export default function LoginPage({ onUnlock }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [shake,    setShake]    = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [showPw,   setShowPw]   = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function triggerShake(msg) {
    setError(msg); setShake(true);
    setTimeout(() => setShake(false), 450);
  }

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true); setError("");
    try {
      const resp = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: email.trim().toLowerCase(), password }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) { triggerShake(data.error || "Invalid email or password."); setLoading(false); return; }
      setOrgSession(data);
      onUnlock(data);
    } catch { triggerShake("Connection error. Please try again."); setLoading(false); }
  }

  function handleKey(e) { if (e.key === "Enter") handleLogin(); }

  return (
    <div className="login-container">
      <div className={`login-card${shake ? " shake" : ""}`}>
        <div className="login-header">
          <div className="login-logo">
            <ShieldCheck size={32} className="logo-icon"/>
            <span className="logo-text">VisaLens</span>
          </div>
          <h1 className="login-title">Sign in to VisaLens</h1>
          <p className="login-subtitle">AI-Powered Student Visa Analysis Platform</p>
        </div>

        <div className="login-form">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              ref={inputRef}
              className="form-input"
              type="email"
              placeholder="you@agency.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              onKeyDown={handleKey}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="input-wrapper">
              <input
                className="form-input"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={handleKey}
                autoComplete="current-password"
              />
              <button className="toggle-password" onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>
          <button
            className="login-button"
            onClick={handleLogin}
            disabled={!email.trim() || !password || loading}
          >
            {loading ? <><Loader2 size={18} className="spinner"/>Signing in…</> : "Sign In"}
          </button>
          <p className="login-footer">
            Don't have an account? <a href="#" className="link">Ask your agency admin to invite you.</a>
          </p>
        </div>

        {error && (
          <div className="error-message">
            <AlertCircle size={16}/>
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
