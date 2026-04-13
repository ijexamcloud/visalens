import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, AlertCircle, Activity, AlertTriangle, RefreshCw, PhoneOff, Volume2, Pause, Play, SkipForward, XCircle, User, Clock } from 'lucide-react';

// Constants
const BRAND_PURPLE = '#4C1D95';
const BRAND_PURPLE_LIGHT = 'rgba(76,29,149,0.08)';

const primaryBtn = (extra = {}) => ({
  background: BRAND_PURPLE, color: '#fff', border: 'none', borderRadius: 12,
  fontWeight: 700, fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, transition: 'background .15s', ...extra,
});

const outlineBtn = (color, extra = {}) => ({
  background: 'transparent', color, border: `2px solid ${color}`, borderRadius: 12,
  fontWeight: 700, fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, transition: 'all .15s', ...extra,
});

// British voice selector
function getBritishVoice() {
  const voices = window.speechSynthesis.getVoices();
  const preferred = [
    'Google UK English Female', 'Google UK English Male',
    'Microsoft Libby Online (Natural) - English (United Kingdom)',
    'Microsoft Ryan Online (Natural) - English (United Kingdom)',
    'Microsoft Sonia Online (Natural) - English (United Kingdom)',
    'Karen', 'Daniel',
  ];
  for (const name of preferred) {
    const v = voices.find(v => v.name === name);
    if (v) return v;
  }
  return voices.find(v => v.lang === 'en-GB')
    || voices.find(v => v.lang?.startsWith('en'))
    || voices[0] || null;
}

export const PublicInterview = ({ token }) => {
  // Core state
  const [mode, setMode] = useState('university');
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | idle | starting | active | finished | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [currentQ, setCurrentQ] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [questionBank, setQuestionBank] = useState([]);
  const [progress, setProgress] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [silentCount, setSilentCount] = useState(0);
  const [skippedQuestions, setSkippedQuestions] = useState([]);
  const [silentQuestions, setSilentQuestions] = useState([]);
  const [showGreeting, setShowGreeting] = useState(false);
  const [studentName, setStudentName] = useState('Student');
  const [universityName, setUniversityName] = useState('University Interview');
  const [expiresAt, setExpiresAt] = useState(null);

  // Refs
  const backgroundRecorder = useRef(null);
  const backgroundChunks = useRef([]);
  const chunkRecorder = useRef(null);
  const chunkChunks = useRef([]);
  const waveCanvasRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioCtxRef = useRef(null);
  const isRecordingRef = useRef(false);
  const speakTimeoutRef = useRef(null);
  const answeredRef = useRef(0);
  const skippedRef = useRef(0);
  const silentRef = useRef(0);
  const sessionRef = useRef(null);
  const currentQRef = useRef(null);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { answeredRef.current = answeredCount; }, [answeredCount]);
  useEffect(() => { skippedRef.current = skippedCount; }, [skippedCount]);
  useEffect(() => { silentRef.current = silentCount; }, [silentCount]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { currentQRef.current = currentQ; }, [currentQ]);

  // Load interview data on mount
  useEffect(() => {
    loadInterviewData();
  }, [token]);

  const loadInterviewData = async () => {
    try {
      const res = await fetch(`/public/interview/${token}`);
      if (!res.ok) {
        if (res.status === 410) {
          setErrorMsg('This interview link has expired. Please contact your counselor for a new link.');
        } else if (res.status === 404) {
          setErrorMsg('Invalid interview link. Please check the URL or contact your counselor.');
        } else {
          setErrorMsg('Failed to load interview. Please try again later.');
        }
        setStatus('error');
        return;
      }
      const data = await res.json();
      setStudentName(data.student_name || 'Student');
      setUniversityName(data.university_name || 'University Interview');
      setExpiresAt(data.expires_at);
      setStatus('idle');
    } catch (e) {
      setErrorMsg('Failed to connect to interview server. Please check your internet connection.');
      setStatus('error');
    }
  };

  const blobToBase64 = blob => new Promise(resolve => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(blob);
  });

  // Waveform
  const startWaveform = stream => {
    try {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtxRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 128;
      src.connect(analyserRef.current);
      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);
        const canvas = waveCanvasRef.current;
        if (!canvas || !analyserRef.current) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(buf);
        ctx.clearRect(0, 0, W, H);
        const bw = (W / buf.length) * 1.8; let x = 0;
        const rec = isRecordingRef.current;
        for (let i = 0; i < buf.length; i++) {
          const bh = Math.max(3, (buf[i] / 255) * H * 0.85);
          ctx.fillStyle = rec ? '#ef4444' : BRAND_PURPLE;
          ctx.globalAlpha = rec ? 0.9 : 0.4;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, H - bh, Math.max(1, bw - 2), bh, 2);
          else ctx.rect(x, H - bh, Math.max(1, bw - 2), bh);
          ctx.fill(); x += bw + 1;
        }
        ctx.globalAlpha = 1;
      };
      draw();
    } catch (e) { console.warn('Waveform init failed:', e); }
  };

  const stopWaveform = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    analyserRef.current = null;
  };

  // speak() with timeout
  const speak = text => {
    if (!text) return;
    window.speechSynthesis.cancel();
    clearTimeout(speakTimeoutRef.current);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.pitch = mode === 'university' ? 1.05 : 0.88;
    u.onstart = () => setIsAISpeaking(true);
    u.onend = () => { setIsAISpeaking(false); clearTimeout(speakTimeoutRef.current); };
    u.onerror = () => { setIsAISpeaking(false); clearTimeout(speakTimeoutRef.current); };
    speakTimeoutRef.current = setTimeout(() => setIsAISpeaking(false), 60000);
    const go = () => { u.voice = getBritishVoice(); window.speechSynthesis.speak(u); };
    if (window.speechSynthesis.getVoices().length > 0) go();
    else window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; go(); };
  };

  // Reset
  const resetToIdle = () => {
    window.speechSynthesis.cancel();
    stopWaveform();
    clearTimeout(speakTimeoutRef.current);
    if (backgroundRecorder.current?.state === 'recording') backgroundRecorder.current.stop();
    backgroundChunks.current = []; chunkChunks.current = [];
    setSession(null); setCurrentQ(null); setProgress(0);
    setAnsweredCount(0); setSkippedCount(0); setSilentCount(0);
    setSkippedQuestions([]); setSilentQuestions([]);
    setErrorMsg(null); setStatus('idle');
    setIsPaused(false); setIsRecording(false);
    setQuestionBank([]); setShowGreeting(false);
  };

  // Start interview
  const startInterview = async () => {
    setStatus('starting'); setErrorMsg(null);
    try {
      const res = await fetch(`/public/interview/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setSession(data.session_id);
      setCurrentQ(data.first_question);
      setQuestionBank(data.questions || [data.first_question]);
      setShowGreeting(true);
      setTimeout(() => setShowGreeting(false), 4000);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      backgroundRecorder.current = new MediaRecorder(stream);
      backgroundRecorder.current.ondataavailable = e => backgroundChunks.current.push(e.data);
      backgroundRecorder.current.start();
      startWaveform(stream);
      setStatus('active');
      speak(data.first_question.question);
    } catch (e) {
      console.error('Failed to start session:', e);
      setErrorMsg(e.message || 'Could not start session. Please try again.');
      setStatus('error');
    }
  };

  // Skip question
  const skipQuestion = () => {
    if (isRecording) return;
    window.speechSynthesis.cancel();
    setIsAISpeaking(false);

    const skippedQIndex = currentQRef.current?.index ?? 0;
    const skippedQText = currentQRef.current?.question ?? '';
    const skippedSessionId = sessionRef.current;

    setSkippedQuestions(prev => [...prev, { index: skippedQIndex, question: skippedQText }]);
    setSkippedCount(prev => {
      const newSkipped = prev + 1;
      const totalDone = answeredRef.current + newSkipped + silentRef.current;
      setProgress((totalDone / 10) * 100);
      return newSkipped;
    });

    const nextIndex = skippedQIndex + 1;
    const nextQ = questionBank.find(q => q.index === nextIndex);
    if (nextQ?.question) {
      setCurrentQ(nextQ);
      setTimeout(() => speak(nextQ.question), 0);
    } else {
      finishInterview();
    }
  };

  // Recording functions
  const startTurnRecording = () => {
    if (isAISpeaking || isPaused) return;
    setIsRecording(true); chunkChunks.current = [];
    const stream = backgroundRecorder.current.stream;
    chunkRecorder.current = new MediaRecorder(stream);
    chunkRecorder.current.ondataavailable = e => chunkChunks.current.push(e.data);
    chunkRecorder.current.start();
  };

  const stopTurnAndSend = () => {
    if (!isRecording) return;
    setIsRecording(false);
    if (!chunkRecorder.current) return;
    chunkRecorder.current.stop();
    chunkRecorder.current.onstop = async () => {
      const audioBlob = new Blob(chunkChunks.current, { type: 'audio/webm' });
      const isSilent = audioBlob.size < 2000;
      if (isSilent) {
        setSilentQuestions(prev => [...prev, { index: currentQRef.current?.index, question: currentQRef.current?.question }]);
        setSilentCount(prev => prev + 1);
      }
      const base64 = await blobToBase64(audioBlob);
      try {
        const res = await fetch(`/public/interview/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'answer',
            session_id: sessionRef.current,
            question_index: currentQRef.current.index,
            audio_base64: base64,
            was_silent: isSilent,
            mode
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `Server error ${res.status}`);
        }
        const data = await res.json();
        const newCount = isSilent ? answeredRef.current : (answeredRef.current + 1);
        if (!isSilent) setAnsweredCount(newCount);
        const totalDone = newCount + skippedRef.current + silentRef.current;
        setProgress((totalDone / 10) * 100);
        if (data.is_complete) {
          finishInterview();
        } else {
          const nextQ = data.next_question || null;
          if (nextQ) {
            setQuestionBank(pb => pb.some(q => q.index === nextQ.index) ? pb : [...pb, nextQ]);
          }
          setCurrentQ(nextQ);
          speak(nextQ.question);
        }
      } catch (e) {
        console.error('Failed to process answer:', e);
        setErrorMsg(e.message);
        setStatus('error');
      }
    };
  };

  // Finish interview
  const finishInterview = () => {
    window.speechSynthesis.cancel();
    setIsAISpeaking(false);
    setStatus('finished');
  };

  const togglePause = () => {
    if (isPaused) { window.speechSynthesis.resume(); setIsPaused(false); }
    else { window.speechSynthesis.pause(); setIsPaused(true); }
  };

  // Derived UI
  const isUniversity = mode === 'university';
  const accent = isUniversity ? BRAND_PURPLE : '#0f172a';
  const accentLight = isUniversity ? BRAND_PURPLE_LIGHT : '#f1f5f9';
  const totalQuestions = answeredCount + skippedCount + silentCount;

  return (
    <div style={{ fontFamily: "'DM Sans', 'Inter', sans-serif", minHeight: '100vh', background: '#f8fafc', padding: '20px' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ripple { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(1.18);opacity:.12} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ maxWidth: 600, margin: '0 auto', marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={18} color={accent} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>Public Mock Interview</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Student: {studentName}</div>
            </div>
          </div>
          {expiresAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
              <Clock size={14} />
              Expires: {new Date(expiresAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* LOADING */}
        {status === 'loading' && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '60px 32px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}>
              <Activity size={24} color={accent} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a', marginBottom: 8 }}>Loading Interview...</div>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>Preparing your session</div>
          </div>
        )}

        {/* ERROR */}
        {status === 'error' && (
          <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #fecaca', padding: 32, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <AlertCircle size={22} color="#ef4444" />
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#0f172a', marginBottom: 8 }}>Interview Error</div>
            <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', fontSize: 13, marginBottom: 24 }}>{errorMsg}</div>
            <button onClick={resetToIdle} style={primaryBtn({ padding: 13, borderRadius: 12 })}>
              <RefreshCw size={15} /> Try Again
            </button>
          </div>
        )}

        {/* IDLE */}
        {status === 'idle' && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '40px 32px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mic size={20} color={accent} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>Mock Interview</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>Voice-to-voice AI practice · British accent</div>
              </div>
            </div>
            <div style={{ display: 'flex', background: '#f8fafc', borderRadius: 12, padding: 4, gap: 4, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              {[{ id: 'university', label: 'University' }, { id: 'embassy', label: 'Visa' }].map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{ flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none', cursor: 'pointer', background: mode === m.id ? '#fff' : 'transparent', color: mode === m.id ? '#0f172a' : '#94a3b8', fontWeight: 600, fontSize: 13, boxShadow: mode === m.id ? '0 1px 6px rgba(0,0,0,0.1)' : 'none', transition: 'all .15s' }}>{m.label}</button>
              ))}
            </div>
            <div style={{ background: accentLight, borderRadius: 10, padding: '12px 16px', marginBottom: 28, fontSize: 13, color: accent, fontWeight: 500 }}>
              {isUniversity ? 'University admissions interview practice' : 'Visa interview practice'}
            </div>
            <button onClick={startInterview} style={primaryBtn({ width: '100%', padding: 14, fontSize: 15, borderRadius: 12 })}>
              Begin Interview 
            </button>
          </div>
        )}

        {/* STARTING */}
        {status === 'starting' && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '60px 32px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}>
              <Activity size={24} color={accent} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a', marginBottom: 8 }}>Starting Interview...</div>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>Generating questions</div>
          </div>
        )}

        {/* ACTIVE */}
        {status === 'active' && (
          <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.08)' }}>
            {/* Header */}
            <div style={{ background: accent, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: isPaused ? '#f59e0b' : '#22c55e', boxShadow: `0 0 8px ${isPaused ? '#f59e0b' : '#22c55e'}` }} />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                  {isUniversity ? 'University Interview' : 'Visa Interview'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <button onClick={togglePause} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: isPaused ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {isPaused ? <Play size={13} /> : <Pause size={13} />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button onClick={skipQuestion} disabled={isRecording} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: isRecording ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: isRecording ? 0.5 : 1 }}>
                  <SkipForward size={13} /> Skip
                </button>
                <button onClick={finishInterview} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  <PhoneOff size={13} /> End
                </button>
              </div>
            </div>

            {/* Progress */}
            <div style={{ padding: '14px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 7 }}>
                <span>Question {totalQuestions + 1} of 10</span>
                <span>{Math.round(progress)}% complete</span>
              </div>
              <div style={{ height: 5, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, ${isUniversity ? '#818cf8' : '#475569'})`, borderRadius: 99, transition: 'width .5s ease' }} />
              </div>
            </div>

            <div style={{ padding: '32px 28px', textAlign: 'center' }}>
              {/* Greeting */}
              {showGreeting && (
                <div style={{ marginBottom: 20, background: 'linear-gradient(135deg, #faf5ff, #ede9fe)', border: `1px solid ${BRAND_PURPLE}30`, borderRadius: 14, padding: '14px 20px', animation: 'fadeIn .4s ease', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>ð</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: BRAND_PURPLE }}>Hello, {studentName}!</div>
                    <div style={{ fontSize: 12, color: '#6d28d9', marginTop: 2 }}>Your interview is starting now. Good luck!</div>
                  </div>
                </div>
              )}

              {/* Avatar */}
              <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 22px' }}>
                {isAISpeaking && !isPaused && (
                  <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: `2px solid ${accent}`, animation: 'ripple 1.3s ease-in-out infinite' }} />
                )}
                <div style={{ width: 80, height: 80, borderRadius: '50%', background: accent, border: `3px solid ${isAISpeaking && !isPaused ? accent : '#e2e8f0'}`, transition: 'border-color .3s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={32} color="#fff" />
                </div>
                {isAISpeaking && !isPaused && (
                  <div style={{ position: 'absolute', bottom: 3, right: 3, zIndex: 2, width: 20, height: 20, borderRadius: '50%', background: accent, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Volume2 size={10} color="#fff" />
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: accent, marginBottom: 14 }}>
                {isUniversity ? 'Admissions Tutor' : 'Visa Officer'}
              </div>

              {/* Question */}
              <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', lineHeight: 1.55, minHeight: 60, marginBottom: 28, opacity: isAISpeaking && !isPaused ? 1 : 0.72, transition: 'opacity .3s', background: '#f8fafc', borderRadius: 14, padding: '18px 20px', border: '1px solid #e2e8f0', textAlign: 'left' }}>
                <span style={{ fontStyle: 'italic', color: '#475569' }}>"{currentQ?.question}"</span>
              </div>

              {/* Recording controls */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20 }}>
                {!isRecording ? (
                  <button onClick={startTurnRecording} disabled={isAISpeaking || isPaused} style={primaryBtn({ padding: '16px 24px', fontSize: 15, borderRadius: 50, opacity: (isAISpeaking || isPaused) ? 0.5 : 1 })}>
                    <Mic size={18} /> Start Recording
                  </button>
                ) : (
                  <button onClick={stopTurnAndSend} style={outlineBtn('#ef4444', { padding: '16px 24px', fontSize: 15, borderRadius: 50 })}>
                    <Square size={18} /> Stop Recording
                  </button>
                )}
              </div>

              {/* Waveform */}
              <canvas ref={waveCanvasRef} width={300} height={60} style={{ width: '100%', height: 60, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }} />
            </div>
          </div>
        )}

        {/* FINISHED */}
        {status === 'finished' && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '40px 32px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <div style={{ fontSize: 28 }}>â</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a', marginBottom: 10 }}>
              Interview Complete!
            </div>
            <div style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.65, marginBottom: 20 }}>
              Thank you for completing your mock interview. Your responses have been recorded and will be available to your counselor.
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 28 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Answered', value: answeredCount, color: '#16a34a', bg: '#f0fdf4' },
                  { label: 'Skipped', value: skippedCount, color: '#d97706', bg: '#fffbeb' },
                  { label: 'Silent', value: silentCount, color: '#dc2626', bg: '#fef2f2' },
                ].map(r => (
                  <div key={r.label} style={{ background: r.bg, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: r.color }}>{r.value}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{r.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
              You can now close this window. Your counselor will review your interview and provide feedback.
            </div>
            <button onClick={resetToIdle} style={outlineBtn(BRAND_PURPLE, { padding: 13, borderRadius: 12 })}>
              Start New Interview
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicInterview;
