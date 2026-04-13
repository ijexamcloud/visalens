import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, AlertCircle, Activity, AlertTriangle, RefreshCw, PhoneOff, Volume2, Pause, Play, SkipForward, Printer, Copy, Share2, XCircle } from 'lucide-react';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://visalens-proxy.ijecloud.workers.dev';

// ── Constants ─────────────────────────────────────────────────────────────────
const BRAND_PURPLE       = '#4C1D95';
const BRAND_PURPLE_LIGHT = 'rgba(76,29,149,0.08)';

// Minimum genuine answers required before we allow full scoring
const MIN_ANSWERS_FOR_FULL_SCORE = 5;
// Below this we suppress consistency flags entirely
const MIN_ANSWERS_FOR_FLAGS      = 3;

// ── Button helpers ────────────────────────────────────────────────────────────
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

// ── British voice selector ────────────────────────────────────────────────────
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

// =============================================================================
export const MockInterview = ({ caseId, mode: initialMode = 'university', onComplete, orgSession }) => {

  // ── Core state ───────────────────────────────────────────────────────────────
  const [mode,            setMode]            = useState(initialMode);
  const [session,         setSession]         = useState(null);
  const [status,          setStatus]          = useState('idle');
  // status: idle | starting | active | no_data | incomplete_warning | scoring | finished | error
  const [errorMsg,        setErrorMsg]        = useState(null);
  const [currentQ,        setCurrentQ]        = useState(null);
  const [isRecording,     setIsRecording]     = useState(false);
  const [isPaused,        setIsPaused]        = useState(false);
  const [isAISpeaking,    setIsAISpeaking]    = useState(false);

  const [questionBank,    setQuestionBank]    = useState([]);

  // ── Counters & logs ──────────────────────────────────────────────────────────
  const [progress,         setProgress]         = useState(0);
  const [answeredCount,    setAnsweredCount]     = useState(0);
  const [skippedCount,     setSkippedCount]      = useState(0);
  const [silentCount,      setSilentCount]       = useState(0);
  const [skippedQuestions, setSkippedQuestions]  = useState([]);
  const [silentQuestions,  setSilentQuestions]   = useState([]);

  // ── Report state ─────────────────────────────────────────────────────────────
  const [scores,      setScores]      = useState(null);
  const [transcript,  setTranscript]  = useState(null);
  const [shareMsg,    setShareMsg]    = useState('');
  const [sessionMeta, setSessionMeta] = useState({});  // student_name, university_name from /start
  const [showGreeting, setShowGreeting] = useState(false);
  const [publicLink, setPublicLink] = useState(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  const studentName    = sessionMeta.student_name    || orgSession?.student_name    || 'Student';
  const universityName = sessionMeta.university_name || scores?.university_name
    || (mode === 'university' ? 'University Interview' : 'Embassy Visa Interview');

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const backgroundRecorder = useRef(null);
  const backgroundChunks   = useRef([]);
  const chunkRecorder      = useRef(null);
  const chunkChunks        = useRef([]);
  const waveCanvasRef      = useRef(null);
  const analyserRef        = useRef(null);
  const animFrameRef       = useRef(null);
  const audioCtxRef        = useRef(null);
  const isRecordingRef     = useRef(false);
  const speakTimeoutRef    = useRef(null);
  // Snapshot refs for use inside async closures / functional updaters
  const answeredRef        = useRef(0);
  const skippedRef         = useRef(0);
  const silentRef          = useRef(0);
  const sessionRef         = useRef(null);
  const currentQRef        = useRef(null);

  useEffect(() => { isRecordingRef.current = isRecording;  }, [isRecording]);
  useEffect(() => { answeredRef.current    = answeredCount; }, [answeredCount]);
  useEffect(() => { skippedRef.current     = skippedCount;  }, [skippedCount]);
  useEffect(() => { silentRef.current      = silentCount;   }, [silentCount]);
  useEffect(() => { sessionRef.current     = session;       }, [session]);
  useEffect(() => { currentQRef.current    = currentQ;      }, [currentQ]);
  useEffect(() => { if (status === 'idle') setMode(initialMode); }, [initialMode, status]);

  // ── Auth headers ──────────────────────────────────────────────────────────────
  const getAuthHeaders = () => {
    const h = { 'Content-Type': 'application/json' };
    if (!orgSession) { console.error('MockInterview: orgSession is null'); return h; }
    if (orgSession?.access_token) h['Authorization'] = `Bearer ${orgSession.access_token}`;
    else if (orgSession?.org_id)  h['X-Org-Id']      = orgSession.org_id;
    return h;
  };

  const blobToBase64 = blob => new Promise(resolve => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(blob);
  });

  // ── Waveform ──────────────────────────────────────────────────────────────────
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

  // ── speak() with Gemini safety timeout ───────────────────────────────────────
  const speak = text => {
    if (!text) return;
    window.speechSynthesis.cancel();
    clearTimeout(speakTimeoutRef.current);
    const u = new SpeechSynthesisUtterance(text);
    u.rate  = 0.92;
    u.pitch = mode === 'university' ? 1.05 : 0.88;
    u.onstart = () => setIsAISpeaking(true);
    u.onend   = () => { setIsAISpeaking(false); clearTimeout(speakTimeoutRef.current); };
    u.onerror = () => { setIsAISpeaking(false); clearTimeout(speakTimeoutRef.current); };
    speakTimeoutRef.current = setTimeout(() => setIsAISpeaking(false), 60000);
    const go = () => { u.voice = getBritishVoice(); window.speechSynthesis.speak(u); };
    if (window.speechSynthesis.getVoices().length > 0) go();
    else window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; go(); };
  };

  // ── Full reset ────────────────────────────────────────────────────────────────
  const resetToIdle = () => {
    window.speechSynthesis.cancel();
    stopWaveform();
    clearTimeout(speakTimeoutRef.current);
    if (backgroundRecorder.current?.state === 'recording') backgroundRecorder.current.stop();
    backgroundChunks.current = []; chunkChunks.current = [];
    setSession(null); setCurrentQ(null); setProgress(0);
    setAnsweredCount(0); setSkippedCount(0); setSilentCount(0);
    setSkippedQuestions([]); setSilentQuestions([]);
    setScores(null); setErrorMsg(null); setStatus('idle');
    setIsPaused(false); setIsRecording(false);
    setQuestionBank([]); setSessionMeta({}); setShowGreeting(false);
  };

  // ── Pause / Resume ────────────────────────────────────────────────────────────
  const togglePause = () => {
    if (isPaused) { window.speechSynthesis.resume(); setIsPaused(false); }
    else          { window.speechSynthesis.pause();  setIsPaused(true);  }
  };

  // ── Skip question (fully local — no /skip endpoint needed) ───────────────────
  const skipQuestion = () => {
    if (isRecording) return;
    window.speechSynthesis.cancel();
    setIsAISpeaking(false);

    // Snapshot current question NOW — before any async/functional updater runs
    const skippedQIndex    = currentQRef.current?.index ?? 0;
    const skippedQText     = currentQRef.current?.question ?? '';
    const skippedSessionId = sessionRef.current;

    setSkippedQuestions(prev => [...prev, { index: skippedQIndex, question: skippedQText }]);

    setSkippedCount(prev => {
      const newSkipped = prev + 1;
      const totalDone  = answeredRef.current + newSkipped + silentRef.current;
      setProgress((totalDone / 10) * 100);

      if (totalDone >= 10) { setTimeout(() => finishInterview(), 0); return newSkipped; }

      const nextIndex = skippedQIndex + 1;

      // Read bank snapshot synchronously to decide immediately
      setQuestionBank(bank => {
        const nextQ = bank.find(q => q.index === nextIndex);
        if (nextQ?.question) {
          setCurrentQ(nextQ);
          // Speak on next tick so setCurrentQ has settled
          setTimeout(() => speak(nextQ.question), 0);
        } else {
          // Show loading state, then fetch via /answer with skipped flag
          const placeholder = { index: nextIndex, question: '…' };
          setCurrentQ(placeholder);
          fetch(`${PROXY_URL}/api/agency/interview/answer`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ session_id: skippedSessionId, question_index: skippedQIndex, audio_base64: '', was_silent: false, skipped: true })
          })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data) return;
              if (data.is_complete) { finishInterview(); return; }
              if (data.next_question) {
                setQuestionBank(pb => pb.some(q => q.index === data.next_question.index) ? pb : [...pb, data.next_question]);
                setCurrentQ(data.next_question);
                speak(data.next_question.question);
              }
            })
            .catch(() => {});
        }
        return bank;
      });

      return newSkipped;
    });
  };

  // ── Phase 1: Start ────────────────────────────────────────────────────────────
  const startInterview = async () => {
    setStatus('starting'); setErrorMsg(null);
    try {
      console.log('[MockInterview] Starting with caseId:', caseId, '| org_id:', orgSession?.org_id);
      const res = await fetch(`${PROXY_URL}/api/agency/interview/start`, {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ case_id: caseId, mode })
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `Server error ${res.status}`); }
      const data = await res.json();

      setSession(data.session_id);
      setCurrentQ(data.first_question);
      setSessionMeta({
        student_name:    data.student_name    || data.session?.student_name    || '',
        university_name: data.university_name || data.session?.university_name || '',
      });
      setShowGreeting(true);
      setTimeout(() => setShowGreeting(false), 4000);
      if (data.questions)          setQuestionBank(data.questions);
      else if (data.first_question) setQuestionBank([data.first_question]);

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

  // ── Phase 2: Record & Answer ──────────────────────────────────────────────────
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
      const isSilent  = audioBlob.size < 2000;
      if (isSilent) {
        setSilentQuestions(prev => [...prev, { index: currentQRef.current?.index, question: currentQRef.current?.question }]);
        setSilentCount(prev => prev + 1);
      }
      const base64 = await blobToBase64(audioBlob);
      try {
        const res = await fetch(`${PROXY_URL}/api/agency/interview/answer`, {
          method: 'POST', headers: getAuthHeaders(),
          body: JSON.stringify({ session_id: sessionRef.current, question_index: currentQRef.current.index, audio_base64: base64, was_silent: isSilent, mode })
        });
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `Server error ${res.status}`); }
        const data = await res.json();
        // Only count genuine answers — silent submissions are tracked separately
        const newCount = isSilent ? answeredRef.current : (answeredRef.current + 1);
        if (!isSilent) setAnsweredCount(newCount);
        const totalDone = newCount + skippedRef.current + silentRef.current;
        setProgress((totalDone / 10) * 100);
        if (data.is_complete) {
          finishInterview();
        } else {
          // tip comes from the API with the question object itself
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

  // ── Phase 3: Finish — with threshold gate (Strategy A+B) ────────────────────
  const MIN_ANSWERS_TO_SCORE = 2; // hard floor — below this we refuse to score at all
  const finishInterview = (force = false) => {
    window.speechSynthesis.cancel();
    setIsAISpeaking(false);
    // Hard block: zero or one real answers → no-data screen, never call AI scorer
    if (answeredRef.current < MIN_ANSWERS_TO_SCORE) {
      setStatus('no_data');
      return;
    }
    if (!force && answeredRef.current < MIN_ANSWERS_FOR_FULL_SCORE) {
      setStatus('incomplete_warning');
      return;
    }
    _doScore();
  };

  const _doScore = async () => {
    setStatus('scoring');
    window.speechSynthesis.cancel();
    stopWaveform();
    clearTimeout(speakTimeoutRef.current);

    const submit = async (blob) => {
      const fullBase64 = await blobToBase64(blob);
      try {
        const res = await fetch(`${PROXY_URL}/api/agency/interview/score`, {
          method: 'POST', headers: getAuthHeaders(),
          body: JSON.stringify({
            session_id: sessionRef.current,
            full_recording_base64: fullBase64,
            skipped_questions: skippedQuestions,
            silent_questions:  silentQuestions,
          })
        });
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `Server error ${res.status}`); }
        const data = await res.json();
        setScores(data.scores);
        setTranscript(data.transcript);
        setStatus('finished');
        if (onComplete) onComplete(data);
      } catch (e) {
        console.error('Failed to score session:', e);
        setErrorMsg(e.message || 'Scoring failed. Your answers were saved.');
        setStatus('error');
      }
    };

    if (backgroundRecorder.current?.state === 'recording') {
      backgroundRecorder.current.stop();
      backgroundRecorder.current.onstop = async () => {
        const blob = new Blob(backgroundChunks.current, { type: 'audio/webm' });
        await submit(blob);
      };
    } else {
      const blob = new Blob(backgroundChunks.current, { type: 'audio/webm' });
      await submit(blob);
    }
  };

  // ── Resume from incomplete warning screen ─────────────────────────────────────
  const resumeFromWarning = () => setStatus('active');

  // ── Report helpers ────────────────────────────────────────────────────────────
  const isIncomplete    = answeredCount < MIN_ANSWERS_FOR_FULL_SCORE;
  const showFlags       = (scores?.red_flags?.length > 0) && (answeredCount >= MIN_ANSWERS_FOR_FLAGS);
  const flagsSuppressed = (scores?.red_flags?.length > 0) && (answeredCount <  MIN_ANSWERS_FOR_FLAGS);
  const totalQuestions  = answeredCount + skippedCount + silentCount;

  const buildReportText = () => {
    const lines = [
      `MOCK INTERVIEW REPORT`,
      `═══════════════════════════════`,
      ...(isIncomplete ? [`⚠️  INCOMPLETE — only ${answeredCount} of 10 questions answered`] : []),
      `Student  : ${studentName}`,
      `Interview: ${universityName}`,
      `Mode     : ${mode === 'university' ? 'University Admissions' : 'Embassy Visa'}`,
      ``,
      `OVERALL SCORE: ${scores?.overall ?? '—'}/100${isIncomplete ? ' (low reliability)' : ''}`,
      ``,
      `SUBSCORES`,
      `  Confidence         : ${scores?.confidence ?? '—'}/100`,
      `  Consistency        : ${scores?.consistency ?? '—'}/100`,
      `  Purpose Clarity    : ${scores?.purpose_clarity ?? '—'}/100`,
      `  Financial Awareness: ${scores?.financial_awareness ?? '—'}/100`,
      ``,
      `QUESTION SUMMARY`,
      `  Total Attempted    : ${totalQuestions} of 10`,
      `  Answered           : ${answeredCount}`,
      `  Skipped            : ${skippedCount}`,
      `  Silent / No Answer : ${silentCount}`,
    ];
    if (skippedQuestions.length) {
      lines.push(``, `SKIPPED QUESTIONS`);
      skippedQuestions.forEach((q, i) => lines.push(`  ${i + 1}. ${q.question}`));
    }
    if (silentQuestions.length) {
      lines.push(``, `SILENT / NO ANSWER`);
      silentQuestions.forEach((q, i) => lines.push(`  ${i + 1}. ${q.question}`));
    }
    if (showFlags) {
      lines.push(``, `CONSISTENCY FLAGS`);
      scores.red_flags.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
    } else if (flagsSuppressed) {
      lines.push(``, `CONSISTENCY FLAGS`, `  Insufficient data — complete a full interview for consistency analysis.`);
    }
    if (scores?.strengths?.length) {
      lines.push(``, `STRENGTHS`);
      scores.strengths.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }
    if (scores?.improvement_tips?.length) {
      lines.push(``, `SPECIFIC IMPROVEMENTS`);
      scores.improvement_tips.forEach((t, i) => {
        lines.push(`  ${i + 1}. ${t.issue || `Tip ${i + 1}`}`);
        lines.push(`     What went wrong : ${t.what_went_wrong}`);
        lines.push(`     How to fix it   : ${t.how_to_fix}`);
        if (t.example) lines.push(`     Example answer  : "${t.example}"`);
      });
    }
    if (scores?.recommended_tasks?.length) {
      lines.push(``, `PRACTICE TASKS`);
      scores.recommended_tasks.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
    }
    return lines.join('\n');
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    win.document.write(`<pre style="font-family:monospace;padding:32px;font-size:14px;line-height:1.7">${buildReportText()}</pre>`);
    win.document.close(); win.print();
  };
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(buildReportText()); setShareMsg('Copied!'); }
    catch { setShareMsg('Copy failed'); }
    setTimeout(() => setShareMsg(''), 2000);
  };

  // Transcript functions
  const buildTranscriptText = () => {
    if (!transcript?.length) return 'No transcript available.';
    
    const lines = [
      `INTERVIEW TRANSCRIPT`,
      `===================`,
      `Student: ${studentName}`,
      `Interview Type: ${mode === 'university' ? 'University Admissions' : 'Embassy Visa'}`,
      `Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      ``,
    ];

    transcript.forEach((turn, i) => {
      lines.push(`Question ${turn.index + 1} [${turn.topic || 'General'}]`);
      lines.push(`Q: ${turn.question}`);
      lines.push(`A: ${turn.answer_text}`);
      if (turn.tone_notes && turn.tone_notes !== 'N/A') {
        lines.push(`Tone: ${turn.tone_notes}`);
      }
      if (turn.flagged && turn.flag_reason) {
        lines.push(`Note: ${turn.flag_reason}`);
      }
      lines.push(''); // Empty line between questions
    });

    return lines.join('\n');
  };

  const handleDownloadTranscript = () => {
    const transcriptText = buildTranscriptText();
    const blob = new Blob([transcriptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-transcript-${studentName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShareMsg('Transcript downloaded!');
    setTimeout(() => setShareMsg(''), 2000);
  };

  const handleCopyTranscript = async () => {
    try { 
      await navigator.clipboard.writeText(buildTranscriptText()); 
      setShareMsg('Transcript copied!'); 
    } catch { 
      setShareMsg('Copy failed'); 
    }
    setTimeout(() => setShareMsg(''), 2000);
  };
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Interview Report — ${studentName}`, text: buildReportText() }); } catch {}
    } else { handleCopy(); }
  };

  // Public interview link functions
  const handleGeneratePublicLink = async () => {
    console.log('=== PUBLIC LINK GENERATION START ===');
    console.log('Button clicked!');
    console.log('Current caseId:', caseId);
    console.log('PROXY_URL:', PROXY_URL);
    console.log('orgSession:', orgSession);
    
    if (!caseId) {
      console.error('No caseId available for public link generation');
      setShareMsg('No case selected');
      setTimeout(() => setShareMsg(''), 3000);
      return;
    }
    setGeneratingLink(true);
    try {
      console.log('Generating public link for caseId:', caseId);
      console.log('Using PROXY_URL:', PROXY_URL);
      
      const res = await fetch(`${PROXY_URL}/api/agency/interview/generate-public-link`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ 
          case_id: caseId, 
          expires_in_hours: 72 // 3 days default
        }),
      });
      
      console.log('Response status:', res.status);
      console.log('Response headers:', Object.fromEntries(res.headers.entries()));
      
      if (!res.ok) {
        const err = await res.json().catch(() => {
          console.error('Failed to parse error JSON');
          return {};
        });
        console.error('API Error:', err);
        throw new Error(err.error || `Failed to generate link: ${res.status}`);
      }
      
      const data = await res.json();
      console.log('Success response:', data);
      
      setPublicLink(data.public_url);
      setShareMsg('Public link generated!');
      setTimeout(() => setShareMsg(''), 3000);
    } catch (e) {
      console.error('Failed to generate public link:', e);
      setShareMsg(`Failed: ${e.message}`);
      setTimeout(() => setShareMsg(''), 5000);
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyPublicLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      setShareMsg('Link copied!');
      setTimeout(() => setShareMsg(''), 2000);
    } catch {
      setShareMsg('Copy failed');
      setTimeout(() => setShareMsg(''), 2000);
    }
  };

  // ── Derived UI ────────────────────────────────────────────────────────────────
  const isUniversity = mode === 'university';
  const accent       = isUniversity ? BRAND_PURPLE : '#0f172a';
  const accentLight  = isUniversity ? BRAND_PURPLE_LIGHT : '#f1f5f9';

  // =============================================================================
  return (
    <div style={{ fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes ripple { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(1.18);opacity:.12} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ══════════════════════════════ IDLE ══════════════════════════════════ */}
      {status === 'idle' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', padding: '40px 32px', maxWidth: 480, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
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
            {[{ id: 'university', label: '🎓 University' }, { id: 'embassy', label: '🏛️ Embassy Visa' }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{ flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none', cursor: 'pointer', background: mode === m.id ? '#fff' : 'transparent', color: mode === m.id ? '#0f172a' : '#94a3b8', fontWeight: 600, fontSize: 13, boxShadow: mode === m.id ? '0 1px 6px rgba(0,0,0,0.1)' : 'none', transition: 'all .15s' }}>{m.label}</button>
            ))}
          </div>
          <div style={{ background: accentLight, borderRadius: 10, padding: '12px 16px', marginBottom: 28, fontSize: 13, color: accent, fontWeight: 500 }}>
            {isUniversity ? '💬 Coaching tip after each answer · Supportive academic tone' : '⚡ No feedback · Fast-paced · Drilling follow-ups'}
          </div>
          
          {/* Public Link Section */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 8, textAlign: 'center' }}>
              Share with Student
            </div>
            {!publicLink ? (
              <button 
                onClick={handleGeneratePublicLink} 
                disabled={generatingLink}
                style={outlineBtn(accent, { width: '100%', padding: 11, fontSize: 13, borderRadius: 10, opacity: generatingLink ? 0.6 : 1 })}
              >
                {generatingLink ? (
                  <><div style={{ width: 13, height: 13, borderRadius: '50%', border: `2px solid ${accent}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite', marginRight: 6 }} />Generating Link...</>
                ) : (
                  <><Share2 size={14} style={{ marginRight: 6 }} />Generate Public Link</>
                )}
              </button>
            ) : (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px' }}>
                <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 6 }}>Public Interview Link Generated!</div>
                <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 8, wordBreak: 'break-all' }}>{publicLink}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleCopyPublicLink} style={primaryBtn({ flex: 1, padding: 8, fontSize: 12, borderRadius: 8 })}>
                    <Copy size={12} style={{ marginRight: 4 }} /> Copy Link
                  </button>
                  <button onClick={() => setPublicLink(null)} style={outlineBtn('#dc2626', { padding: 8, fontSize: 12, borderRadius: 8 })}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <button onClick={startInterview} style={primaryBtn({ width: '100%', padding: 14, fontSize: 15, borderRadius: 12, boxShadow: `0 4px 16px ${BRAND_PURPLE}40` })}>
            Begin Session →
          </button>
        </div>
      )}

      {/* ════════════════════════════ STARTING ═══════════════════════════════ */}
      {status === 'starting' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}>
            <Activity size={24} color={accent} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a', marginBottom: 8 }}>Preparing your session…</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Analysing case profile · Generating personalised questions</div>
        </div>
      )}

      {/* ══════════════════════════════ ERROR ════════════════════════════════ */}
      {status === 'error' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #fecaca', padding: 32, maxWidth: 480, margin: '0 auto' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <AlertCircle size={22} color="#ef4444" />
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#0f172a', textAlign: 'center', marginBottom: 8 }}>Something went wrong</div>
          <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', fontSize: 13, marginBottom: 24, textAlign: 'center' }}>{errorMsg}</div>
          <button onClick={resetToIdle} style={primaryBtn({ width: '100%', padding: 13, borderRadius: 12 })}>
            <RefreshCw size={15} /> Try Again
          </button>
        </div>
      )}

      {/* ══════════════ INCOMPLETE WARNING — Strategy A ═══════════════════════ */}
      {/* ══════════════════════════ NO DATA ══════════════════════════════════ */}
      {status === 'no_data' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #fecaca', padding: '36px 32px', maxWidth: 480, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', animation: 'fadeIn .25s ease' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <XCircle size={26} color="#dc2626" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a', textAlign: 'center', marginBottom: 10 }}>
            No Answers Recorded
          </div>
          <div style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.65, marginBottom: 20 }}>
            The session ended with fewer than <strong style={{ color: '#0f172a' }}>{MIN_ANSWERS_TO_SCORE} genuine answers</strong>. There is not enough data to generate a meaningful report.
          </div>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '16px 20px', marginBottom: 28 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'Answered', value: answeredCount, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'Skipped',  value: skippedCount,  color: '#d97706', bg: '#fffbeb' },
                { label: 'Silent',   value: silentCount,   color: '#dc2626', bg: '#fef2f2' },
              ].map(r => (
                <div key={r.label} style={{ background: r.bg, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: r.color }}>{r.value}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{r.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => setStatus('active')} style={primaryBtn({ padding: 14, borderRadius: 12, fontSize: 15 })}>
              ← Return &amp; Answer Questions
            </button>
            <button onClick={resetToIdle} style={outlineBtn('#94a3b8', { padding: 11, borderRadius: 12, fontSize: 13 })}>
              Discard &amp; Start Over
            </button>
          </div>
        </div>
      )}

      {status === 'incomplete_warning' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #fde68a', padding: '36px 32px', maxWidth: 480, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', animation: 'fadeIn .25s ease' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <AlertTriangle size={26} color="#d97706" />
          </div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a', textAlign: 'center', marginBottom: 10 }}>
            Interview Incomplete
          </div>
          <div style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.65, marginBottom: 20 }}>
            You've only answered <strong style={{ color: '#0f172a' }}>{answeredCount}</strong> out of 10 questions.
          </div>

          {/* Mini stats */}
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '16px 20px', marginBottom: 28 }}>
            <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.65, marginBottom: 12 }}>
              A reliable performance report requires at least <strong>{MIN_ANSWERS_FOR_FULL_SCORE} answered questions</strong>.
              Generating a report now may produce misleading scores and unfair consistency flags.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'Answered', value: answeredCount, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'Skipped',  value: skippedCount,  color: '#d97706', bg: '#fffbeb' },
                { label: 'Silent',   value: silentCount,   color: '#dc2626', bg: '#fef2f2' },
              ].map(r => (
                <div key={r.label} style={{ background: r.bg, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: r.color }}>{r.value}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{r.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={resumeFromWarning} style={primaryBtn({ padding: 14, borderRadius: 12, fontSize: 15 })}>
              ← Continue Interview
            </button>
            <button onClick={() => _doScore()} style={outlineBtn('#d97706', { padding: 13, borderRadius: 12, fontSize: 13 })}>
              <XCircle size={15} /> End Anyway &amp; Generate Partial Report
            </button>
            <button onClick={resetToIdle} style={outlineBtn('#94a3b8', { padding: 11, borderRadius: 12, fontSize: 13 })}>
              Discard &amp; Start Over
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════ ACTIVE ══════════════════════════════════ */}
      {status === 'active' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', overflow: 'hidden', maxWidth: 560, margin: '0 auto', boxShadow: '0 4px 32px rgba(0,0,0,0.08)' }}>

          {/* Header */}
          <div style={{ background: accent, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: isPaused ? '#f59e0b' : '#22c55e', boxShadow: `0 0 8px ${isPaused ? '#f59e0b' : '#22c55e'}` }} />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                {isUniversity ? '🎓 University Interview' : '🏛️ Embassy Visa Interview'}
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
              <button onClick={() => finishInterview(false)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <PhoneOff size={13} /> End
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ padding: '14px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 7 }}>
              <span>Question {totalQuestions + 1} of 10</span>
              <span>
                {Math.round(progress)}% complete
                {skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}
                {silentCount  > 0 ? ` · ${silentCount} silent`  : ''}
              </span>
            </div>
            <div style={{ height: 5, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, ${isUniversity ? '#818cf8' : '#475569'})`, borderRadius: 99, transition: 'width .5s ease' }} />
            </div>
          </div>

          {/* Paused banner */}
          {isPaused && (
            <div style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid #fde68a', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e', fontWeight: 600 }}>
              <Pause size={14} /> Interview paused — click Resume to continue
            </div>
          )}

          <div style={{ padding: '32px 28px', textAlign: 'center' }}>
            {/* Greeting banner */}
            {showGreeting && (
              <div style={{ marginBottom: 20, background: 'linear-gradient(135deg, #faf5ff, #ede9fe)', border: `1px solid ${BRAND_PURPLE}30`, borderRadius: 14, padding: '14px 20px', animation: 'fadeIn .4s ease', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>👋</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: BRAND_PURPLE }}>Hello, {studentName}!</div>
                  <div style={{ fontSize: 12, color: '#6d28d9', marginTop: 2 }}>Your interview is starting now. Good luck!</div>
                </div>
              </div>
            )}
            {/* Avatar */}
            <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 22px' }}>
              {isAISpeaking && !isPaused && (
                <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: `2px solid ${accent}`, animation: 'ripple 1.3s ease-in-out infinite' }} />
              )}
              <img
                src={isUniversity
                  ? 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80'
                  : 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80'}
                alt="Interviewer"
                style={{ width: 100, height: 100, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${isAISpeaking && !isPaused ? accent : '#e2e8f0'}`, transition: 'border-color .3s', position: 'relative', zIndex: 1 }}
              />
              {isAISpeaking && !isPaused && (
                <div style={{ position: 'absolute', bottom: 3, right: 3, zIndex: 2, width: 22, height: 22, borderRadius: '50%', background: accent, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Volume2 size={11} color="#fff" />
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: accent, marginBottom: 14 }}>
              {isUniversity ? 'Admissions Tutor' : 'Visa Officer'}
            </div>

            {/* Question text + optional coaching tip on a new line */}
            <div style={{ fontSize: 17, fontWeight: 600, color: '#0f172a', lineHeight: 1.55, minHeight: 84, marginBottom: 28, opacity: isAISpeaking && !isPaused ? 1 : 0.72, transition: 'opacity .3s', background: '#f8fafc', borderRadius: 14, padding: '18px 20px', border: '1px solid #e2e8f0', textAlign: 'left' }}>
              <span style={{ fontStyle: 'italic', color: '#475569' }}>"{currentQ?.question}"</span>
              {currentQ?.tip && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed rgba(76,29,149,0.2)', display: 'flex', gap: 9, alignItems: 'flex-start', animation: 'fadeIn .3s ease' }}>
                  <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1.4 }}>💡</span>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: BRAND_PURPLE, marginBottom: 3 }}>Tutor tip</div>
                    <div style={{ fontSize: 13, color: '#3b0764', fontWeight: 500, lineHeight: 1.5 }}>{currentQ.tip}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Waveform */}
            <div style={{ background: '#f8fafc', borderRadius: 14, padding: '14px 18px', marginBottom: 26, border: '1px solid #e2e8f0' }}>
              <canvas ref={waveCanvasRef} width={500} height={52} style={{ width: '100%', height: 52, display: 'block' }} />
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8, fontWeight: 500 }}>
                {isPaused ? '⏸️ Paused' : isRecording ? '🔴 Recording…' : isAISpeaking ? '🔊 Interviewer speaking…' : '🎙️ Click the button below to record your answer'}
              </div>
            </div>

            {/* Mic button */}
            <button
              onClick={isRecording ? stopTurnAndSend : startTurnRecording}
              disabled={isAISpeaking || isPaused}
              style={{
                width: 80, height: 80, borderRadius: '50%', border: 'none',
                cursor: (isAISpeaking || isPaused) ? 'not-allowed' : 'pointer',
                background: (isAISpeaking || isPaused) ? '#f1f5f9' : isRecording ? '#ef4444' : BRAND_PURPLE,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto', transform: isRecording ? 'scale(1.14)' : 'scale(1)',
                transition: 'all .15s',
                boxShadow: isRecording ? '0 0 0 10px #fecaca, 0 4px 20px #ef444440' : (isAISpeaking || isPaused) ? 'none' : `0 4px 20px ${BRAND_PURPLE}50`,
              }}
            >
              {isRecording ? <Square size={22} fill="#fff" color="#fff" /> : <Mic size={22} />}
            </button>

            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 14, fontWeight: 500 }}>
              {isPaused ? 'Paused — resume to continue' : isAISpeaking ? 'Listen carefully…' : isRecording ? 'Click to submit' : 'Click to start recording'}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════ SCORING ════════════════════════════════ */}
      {status === 'scoring' && (
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}>
            <Activity size={24} color={accent} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a', marginBottom: 8 }}>Analysing your performance…</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Cross-referencing answers with case profile</div>
        </div>
      )}

      {/* ═══════════════════════════ FINISHED ════════════════════════════════ */}
      {status === 'finished' && scores && (
        <div style={{ background: '#fff', borderRadius: 20, border: `1px solid ${isIncomplete ? '#fde68a' : '#e2e8f0'}`, overflow: 'hidden', maxWidth: 580, margin: '0 auto', boxShadow: '0 4px 32px rgba(0,0,0,0.08)' }}>

          {/* Strategy B: Incomplete banner */}
          {isIncomplete && (
            <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '13px 24px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>
                <strong>Interview ended early</strong> — only {answeredCount} of 10 questions were answered ({skippedCount > 0 ? `${skippedCount} skipped` : ''}{skippedCount > 0 && silentCount > 0 ? ', ' : ''}{silentCount > 0 ? `${silentCount} silent` : ''}).
                Scores below may not be reliable. <strong>Complete a full interview</strong> for an accurate assessment.
              </div>
            </div>
          )}

          {/* Report header */}
          <div style={{ background: BRAND_PURPLE, padding: '28px 32px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Performance Report{isIncomplete ? ' · Partial' : ''}
                </div>
                <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{studentName}</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 500 }}>{universityName}</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 4 }}>
                  {mode === 'university' ? 'University Admissions' : 'Embassy Visa'} · {totalQuestions}/10 questions attempted
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 52, fontWeight: 900, color: isIncomplete ? 'rgba(255,255,255,0.55)' : '#fff', lineHeight: 1 }}>{scores.overall}</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600 }}>/100</div>
                {isIncomplete && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>low reliability</div>}
              </div>
            </div>
          </div>

          <div style={{ padding: '28px 32px' }}>

            {/* Score grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24, opacity: isIncomplete ? 0.72 : 1 }}>
              {[
                { label: 'Confidence',          value: scores.confidence },
                { label: 'Consistency',         value: scores.consistency },
                { label: 'Purpose Clarity',     value: scores.purpose_clarity },
                { label: 'Financial Awareness', value: scores.financial_awareness },
              ].map(({ label, value }) => {
                const hi = value >= 80, mid = value >= 60;
                const col = hi ? '#16a34a' : mid ? '#d97706' : '#dc2626';
                const bg  = hi ? '#f0fdf4' : mid ? '#fffbeb' : '#fef2f2';
                return (
                  <div key={label} style={{ background: bg, borderRadius: 14, padding: '18px 20px', border: `1px solid ${col}25` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{label}</div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: col, lineHeight: 1 }}>
                      {value}<span style={{ fontSize: 14, fontWeight: 500, color: '#cbd5e1', marginLeft: 2 }}>/100</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Question summary */}
            <div style={{ background: '#f8fafc', borderRadius: 14, padding: '18px 20px', marginBottom: 24, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Question Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Answered', value: answeredCount, color: '#16a34a', bg: '#f0fdf4' },
                  { label: 'Skipped',  value: skippedCount,  color: '#d97706', bg: '#fffbeb' },
                  { label: 'Silent',   value: silentCount,   color: '#dc2626', bg: '#fef2f2' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} style={{ background: bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skipped detail */}
            {skippedQuestions.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  <SkipForward size={13} color="#d97706" /> Skipped Questions
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {skippedQuestions.map((q, i) => (
                    <div key={i} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e', fontWeight: 500 }}>
                      {i + 1}. {q.question}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Silent detail */}
            {silentQuestions.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  <AlertCircle size={13} color="#dc2626" /> Silent / No Answer
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {silentQuestions.map((q, i) => (
                    <div key={i} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#b91c1c', fontWeight: 500 }}>
                      {i + 1}. {q.question}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strategy C: Consistency flags with suppression */}
            {showFlags && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  <AlertTriangle size={13} color="#f59e0b" /> Consistency Flags
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {scores.red_flags.map((flag, i) => (
                    <div key={i} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <AlertCircle size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 13, color: '#92400e', fontWeight: 500 }}>{flag}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {flagsSuppressed && (
              <div style={{ marginBottom: 24, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} color="#94a3b8" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Consistency Analysis Unavailable</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
                    At least {MIN_ANSWERS_FOR_FLAGS} answered questions are needed for a reliable consistency analysis.
                    Complete a full interview to unlock this section.
                  </div>
                </div>
              </div>
            )}

            {/* Strengths */}
            {scores.strengths?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>✅ What You Did Well</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {scores.strengths.map((s, i) => (
                    <div key={i} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '11px 15px', fontSize: 13, color: '#15803d', fontWeight: 500, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0, marginTop: 1 }}>✓</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Improvement tips */}
            {scores.improvement_tips?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>🔧 Specific Improvements</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {scores.improvement_tips.map((tip, i) => (
                    <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: `4px solid ${BRAND_PURPLE}`, borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: BRAND_PURPLE, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tip.issue || `Tip ${i + 1}`}</div>
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>What went wrong: </span>
                        <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{tip.what_went_wrong}</span>
                      </div>
                      <div style={{ marginBottom: tip.example ? 6 : 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>How to fix it: </span>
                        <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{tip.how_to_fix}</span>
                      </div>
                      {tip.example && (
                        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '9px 12px', marginTop: 8, borderLeft: '3px solid #94a3b8' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strong answer example: </span>
                          <span style={{ fontSize: 12, color: '#475569', fontStyle: 'italic', lineHeight: 1.55 }}>"{tip.example}"</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended tasks */}
            {scores.recommended_tasks?.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>📋 Practice Tasks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {scores.recommended_tasks.map((task, i) => (
                    <div key={i} style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, padding: '11px 15px', fontSize: 13, color: '#6b21a8', fontWeight: 500, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0, fontWeight: 800, color: BRAND_PURPLE }}>{i + 1}.</span>
                      <span>{task}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Print / Copy / Share */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={handlePrint}  style={primaryBtn({ flex: 1, padding: 11, fontSize: 13, borderRadius: 10 })}><Printer size={14} /> Print</button>
              <button onClick={handleCopy}   style={primaryBtn({ flex: 1, padding: 11, fontSize: 13, borderRadius: 10 })}><Copy size={14} /> {shareMsg === 'Copied!' ? 'Copied!' : 'Copy'}</button>
              <button onClick={handleShare}  style={primaryBtn({ flex: 1, padding: 11, fontSize: 13, borderRadius: 10 })}><Share2 size={14} /> Share</button>
            </div>

            {/* Transcript Download / Copy */}
            {transcript?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={handleDownloadTranscript} style={outlineBtn(BRAND_PURPLE, { flex: 1, padding: 11, fontSize: 13, borderRadius: 10 })}>
                  <Copy size={14} /> Download Transcript
                </button>
                <button onClick={handleCopyTranscript} style={outlineBtn(BRAND_PURPLE, { flex: 1, padding: 11, fontSize: 13, borderRadius: 10 })}>
                  <Copy size={14} /> {shareMsg.includes('Transcript') ? shareMsg : 'Copy Transcript'}
                </button>
              </div>
            )}

            {/* Session actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={resetToIdle} style={outlineBtn(BRAND_PURPLE, { flex: 1, padding: 13 })}>New Session</button>
              <button onClick={resetToIdle} style={primaryBtn({ flex: 1, padding: 13 })}>Back to Case →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MockInterview;
