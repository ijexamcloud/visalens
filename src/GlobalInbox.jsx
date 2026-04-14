/**
 * GlobalInbox.jsx — Unified Chat Inbox
 * ─────────────────────────────────────────────────────────────────────────
 * WhatsApp-Web / Linear style layout.
 *
 * Architecture decisions:
 * • SEPARATE CONTEXT from the main Analyser — selecting a case here never
 *   disturbs the counsellor's deep-work state. Inbox holds its own local
 *   selectedCaseId with no global side-effects.
 * • "Open Full Case File" is the ONLY bridge — it calls onOpenCase(id) which
 *   sets activeCaseId + tab in the parent (VisaLensApp), then navigates there.
 * • Chat trays COEXIST — GlobalInbox renders ChatThread in its right panel;
 *   floating trays render the same component via chatBridge.open(). Both are
 *   live simultaneously on the same caseId. Realtime keeps them in sync.
 * • Single RPC call — get_inbox_summary() returns latest message + unread
 *   count per case in one round-trip, no N+1.
 * • Optimistic realtime — websocket INSERT bumps the conversation to top and
 *   increments unread count without re-fetching everything. A targeted re-fetch
 *   runs only when the user selects a conversation (to correct any drift).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, X, ChevronRight, MessageSquare, Loader2,
  Sparkles, Pin, AlertCircle, RefreshCw, BarChart3, GraduationCap,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import ChatThread from './ChatThread';

/* ─── Supabase singleton ─────────────────────────────────────────────── */
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}
const supabase = window._supabaseInstance;

/* ─── Session helper ─────────────────────────────────────────────────── */
function getOrgSession() {
  try { return JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null'); }
  catch { return null; }
}

/* ─── Relative time formatter ────────────────────────────────────────── */
function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ─── Stage colour pills ─────────────────────────────────────────────── */
const STAGE_COLORS = {
  'Visa Prep':      { bg: 'rgba(124,58,237,.1)',  color: '#7C3AED' },
  'Ready to Apply': { bg: 'rgba(5,150,105,.1)',   color: '#059669' },
  'Applied':        { bg: 'rgba(29,107,232,.1)',  color: '#1D6BE8' },
  'Docs Pending':   { bg: 'rgba(180,83,9,.1)',    color: '#B45309' },
  'Lead':           { bg: 'rgba(74,93,126,.1)',   color: '#4A5D7E' },
  'Prospect':       { bg: 'rgba(74,93,126,.1)',   color: '#4A5D7E' },
};
function stageStyle(stage) {
  return STAGE_COLORS[stage] || { bg: 'var(--s3)', color: 'var(--t3)' };
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════ */
export default function GlobalInbox({ session, onOpenCase, onOpenDashboard }) {
  // Use a stable ref so the realtime effect doesn't re-fire on every render
  const sessionRef = useRef(session || getOrgSession());
  const sess       = sessionRef.current;
  const myId       = sess?.member_id || null;

  /* ── State ──────────────────────────────────────────────────────────── */
  const [conversations,    setConversations]    = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [search,           setSearch]           = useState('');
  const [filterTab,        setFilterTab]        = useState('all'); // 'all' | 'unread' | 'pinned'
  const [selectedCaseId,   setSelectedCaseId]   = useState(null);
  const [selectedCaseName, setSelectedCaseName] = useState('');

  /* ── Fetch inbox via RPC ─────────────────────────────────────────────
   * get_inbox_summary() returns one row per case with:
   *   id, student_name, current_stage, target_country,
   *   latest_msg_id, latest_msg_content, latest_msg_time,
   *   latest_msg_sender, message_category, unread_count
   *
   * SQL for this function is in the project README / migrations folder.
   * Column names match chat_reads: (case_id, member_id, last_read_at)
   * ─────────────────────────────────────────────────────────────────── */
  const fetchInbox = useCallback(async () => {
    if (!sess?.org_id || !myId) return;
    setLoading(true);
    try {
      // Try RPC first
      const { data, error } = await supabase.rpc('get_inbox_summary', {
        p_org_id:  sess.org_id,
        p_user_id: myId,
        p_role:    sess.role || 'counsellor',
      });

      if (!error && data) {
        setConversations(data);
        setSelectedCaseId(prev => {
          if (prev) return prev;
          const first = data[0];
          if (first) setSelectedCaseName(first.student_name);
          return first?.id || null;
        });
        return;
      }

      // RPC failed — fall back to direct query
      console.warn('[GlobalInbox] RPC failed, using fallback query:', error?.message);
      const { data: cases, error: casesErr } = await supabase
        .from('cases')
        .select('id, student_name, pipeline_stage, target_country')
        .eq('org_id', sess.org_id)
        .order('updated_at', { ascending: false })
        .limit(60);

      if (casesErr) throw casesErr;

      const caseIds = (cases || []).map(c => c.id);
      const latestMsgs = {};
      const pinnedCaseIds = new Set();

      if (caseIds.length > 0) {
        // Latest messages
        const { data: msgs } = await supabase
          .from('chat_messages')
          .select('case_id, id, content, sender_name, created_at')
          .in('case_id', caseIds)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(caseIds.length * 3);
        (msgs || []).forEach(m => {
          if (!latestMsgs[m.case_id]) latestMsgs[m.case_id] = m;
        });

        // Pinned messages — find which cases have any pinned message
        const { data: pinned } = await supabase
          .from('chat_messages')
          .select('case_id')
          .in('case_id', caseIds)
          .eq('is_pinned', true)
          .eq('is_deleted', false);
        (pinned || []).forEach(p => pinnedCaseIds.add(p.case_id));
      }

      const built = (cases || []).map(c => {
        const lm = latestMsgs[c.id];
        return {
          id:                 c.id,
          student_name:       c.student_name,
          current_stage:      c.pipeline_stage,
          target_country:     c.target_country,
          latest_msg_id:      lm?.id || null,
          latest_msg_content: lm?.content || null,
          latest_msg_time:    lm?.created_at || null,
          latest_msg_sender:  lm?.sender_name || null,
          unread_count:       0,
          has_pin:            pinnedCaseIds.has(c.id),
        };
      }); // show all cases, even those with no messages yet

      built.sort((a, b) => new Date(b.latest_msg_time || 0) - new Date(a.latest_msg_time || 0));

      setConversations(built);
      setSelectedCaseId(prev => {
        if (prev) return prev;
        const first = built[0];
        if (first) setSelectedCaseName(first.student_name);
        return first?.id || null;
      });
    } catch (err) {
      console.error('[GlobalInbox] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [sess?.org_id, myId]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  /* ── Realtime: optimistic update on new INSERT ───────────────────────
   * When a message lands, we:
   *   1. Move the affected case to top of the list
   *   2. Update the snippet text + time
   *   3. Increment unread_count ONLY if not the active case
   * Re-fetching the full list happens when the user SELECTS a conversation,
   * which corrects any drift cheaply at the moment it matters most.
   * ─────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!sess?.org_id) return;

    // Debounce rapid-fire inserts (e.g. pasted bulk messages)
    let debounceTimer = null;

    const channel = supabase
      .channel('inbox_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new;
          if (!msg?.case_id || !msg?.org_id || msg.org_id !== sess.org_id) return;

          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            setConversations(prev => {
              const idx = prev.findIndex(c => c.id === msg.case_id);
              if (idx === -1) {
                // Unknown case — trigger a full re-fetch to add it
                fetchInbox();
                return prev;
              }

              const updated = { ...prev[idx] };
              updated.latest_msg_content = msg.content;
              updated.latest_msg_time    = msg.created_at;
              updated.latest_msg_sender  = msg.sender_name;
              updated.message_category   = msg.message_category || null;

              // Only increment unread if sender isn't us AND not the active thread
              const isActiveCase = msg.case_id === selectedCaseId;
              const isMyMessage  = msg.sender_id === myId;
              if (!isActiveCase && !isMyMessage) {
                updated.unread_count = (Number(updated.unread_count) || 0) + 1;
              }

              // Move to top
              const rest = prev.filter((_, i) => i !== idx);
              return [updated, ...rest];
            });
          }, 120);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new;
          if (!msg?.case_id || !msg?.org_id || msg.org_id !== sess.org_id) return;
          if (!('is_pinned' in msg)) return;

          // When is_pinned changes, update has_pin on the inbox conversation row
          setConversations(prev => {
            const idx = prev.findIndex(c => c.id === msg.case_id);
            if (idx === -1) return prev;
            const conv = prev[idx];
            // has_pin = true if this message was pinned, or if any other pinned msg exists
            // Simple: set true on pin, only set false if we know nothing else is pinned
            // (we don't track all pinned msgs here, so only clear has_pin when unpinning
            //  if there were no other pins — conservative: keep true, re-fetch will correct)
            if (msg.is_pinned) {
              if (conv.has_pin) return prev; // already set, no change needed
              const newConvs = [...prev];
              newConvs[idx] = { ...conv, has_pin: true };
              return newConvs;
            } else {
              // Unpinned — do a quick targeted re-fetch to get accurate has_pin
              supabase
                .from('chat_messages')
                .select('id')
                .eq('case_id', msg.case_id)
                .eq('is_pinned', true)
                .eq('is_deleted', false)
                .limit(1)
                .then(({ data }) => {
                  const stillHasPin = (data || []).length > 0;
                  setConversations(p => p.map(c =>
                    c.id === msg.case_id ? { ...c, has_pin: stillHasPin } : c
                  ));
                });
              return prev; // optimistic: leave as-is until the check resolves
            }
          });
        },
      )
      .subscribe();

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [sess?.org_id, myId, selectedCaseId, fetchInbox]);

  /* ── Select a conversation ───────────────────────────────────────────
   * Clears the unread badge optimistically and triggers a targeted re-fetch
   * so the unread count is correct (handles drift from optimistic updates).
   * ─────────────────────────────────────────────────────────────────── */
  function handleSelectCase(conv) {
    setSelectedCaseId(conv.id);
    setSelectedCaseName(conv.student_name);

    // Optimistically zero the badge
    setConversations(prev =>
      prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c)
    );

    // Targeted re-fetch to correct drift — runs in background, no loading state
    if (sess?.org_id && myId) {
      supabase
        .rpc('get_inbox_summary', { p_org_id: sess.org_id, p_user_id: myId, p_role: sess.role || 'counsellor' })
        .then(({ data, error }) => {
          if (!error && data) setConversations(data);
          // If RPC fails silently here, the optimistic state is good enough
        })
        .catch((e) => { console.warn('[GlobalInbox] Targeted re-fetch failed (drift may persist):', e); });
    }
  }

  /* ── Derived lists ───────────────────────────────────────────────────── */
  const totalUnread = conversations.reduce((s, c) => s + (Number(c.unread_count) || 0), 0);

  const filtered = conversations.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || c.student_name?.toLowerCase().includes(q)
      || c.latest_msg_content?.toLowerCase().includes(q)
      || c.latest_msg_sender?.toLowerCase().includes(q);
    const matchTab =
      filterTab === 'all'    ? true :
      filterTab === 'unread' ? Number(c.unread_count) > 0 :
      filterTab === 'pinned' ? c.has_pin :
      true;
    return matchSearch && matchTab;
  });

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── LEFT: Conversation List ─────────────────────────────────────── */}
      <div style={{
        width: 308,
        minWidth: 308,
        background: 'var(--s1)',
        borderRight: '1px solid var(--bd)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>

        {/* Header */}
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--fh)', color: 'var(--t1)', margin: 0 }}>
              Chat Inbox
            </h2>
            <button
              onClick={fetchInbox}
              title="Refresh"
              style={{
                width: 28, height: 28, borderRadius: 'var(--r1)',
                background: 'transparent', border: '1px solid var(--bd)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--t3)',
              }}
            >
              <RefreshCw size={13}/>
            </button>
          </div>

          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--s2)', border: '1px solid var(--bd)',
            borderRadius: 'var(--r1)', padding: '7px 10px',
          }}>
            <Search size={13} color="var(--t3)" style={{ flexShrink: 0 }}/>
            <input
              type="text"
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                border: 'none', background: 'transparent', outline: 'none',
                fontSize: 13, fontFamily: 'var(--fu)', color: 'var(--t1)', width: '100%',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', display: 'flex', padding: 0 }}
              >
                <X size={12}/>
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px 6px', flexShrink: 0 }}>
          {[
            { key: 'all',    label: 'All' },
            { key: 'unread', label: 'Unread', badge: totalUnread },
            { key: 'pinned', label: 'Pinned' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setFilterTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: filterTab === t.key ? 600 : 500,
                fontFamily: 'var(--fu)',
                background: filterTab === t.key ? 'var(--pg)' : 'transparent',
                color:      filterTab === t.key ? 'var(--p)'  : 'var(--t3)',
                outline: filterTab === t.key ? '1px solid rgba(29,107,232,.25)' : 'none',
                transition: 'all 150ms',
              }}
            >
              {t.label}
              {t.badge > 0 && (
                <span style={{
                  background: 'var(--p)', color: '#fff',
                  borderRadius: 8, padding: '0 5px',
                  fontSize: 10, fontWeight: 700, fontFamily: 'var(--fm)',
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <style>{`
            .gi-list::-webkit-scrollbar { width: 3px; }
            .gi-list::-webkit-scrollbar-thumb { background: var(--bd); border-radius: 2px; }
            .gi-conv-item { transition: background 150ms; }
            .gi-conv-item:hover { background: var(--s2) !important; }
          `}</style>
          <div className="gi-list" style={{ height: '100%', overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
                <Loader2 size={20} style={{ margin: '0 auto 10px', display: 'block', animation: 'spin .7s linear infinite' }}/>
                <div style={{ fontSize: 13 }}>Loading conversations…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
                <MessageSquare size={28} style={{ margin: '0 auto 10px', opacity: 0.4, display: 'block' }}/>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--t2)' }}>No conversations found</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {search ? 'Try a different search term.' : 'Cases with chat history appear here.'}
                </div>
              </div>
            ) : (
              filtered.map(c => {
                const isActive  = selectedCaseId === c.id;
                const isUrgent  = c.message_category === 'urgent';
                const unread    = Number(c.unread_count) || 0;
                const stage     = stageStyle(c.current_stage);

                return (
                  <div
                    key={c.id}
                    className="gi-conv-item"
                    onClick={() => handleSelectCase(c)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--bd)',
                      cursor: 'pointer',
                      background: isActive ? 'var(--s2)' : 'var(--s1)',
                      position: 'relative',
                    }}
                  >
                    {/* Active bar */}
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: 3, background: 'var(--p)', borderRadius: '0 2px 2px 0',
                      }}/>
                    )}

                    {/* Row 1: name + time */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'flex-start', marginBottom: 5,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, marginRight: 8 }}>
                        <span style={{
                          fontSize: 13, fontWeight: unread > 0 ? 700 : 600,
                          color: 'var(--t1)', fontFamily: 'var(--fh)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {c.student_name}
                        </span>
                        {c.has_pin && (
                          <Pin size={10} color="#0D9488" style={{ flexShrink: 0 }} title="Has pinned messages"/>
                        )}
                      </div>
                      <span style={{
                        fontSize: 11, color: isActive ? 'var(--p)' : 'var(--t3)',
                        fontFamily: 'var(--fm)', whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {fmtRelative(c.latest_msg_time)}
                      </span>
                    </div>

                    {/* Row 2: stage + country pills */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                      {c.current_stage && (
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 10,
                          fontFamily: 'var(--fm)', fontWeight: 600,
                          background: stage.bg, color: stage.color,
                        }}>
                          {c.current_stage}
                        </span>
                      )}
                      {c.target_country && (
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 10,
                          background: 'var(--s3)', color: 'var(--t2)',
                          fontFamily: 'var(--fm)', fontWeight: 500,
                        }}>
                          {c.target_country}
                        </span>
                      )}
                      {isUrgent && (
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 10,
                          background: 'rgba(220,38,38,.08)', color: 'var(--err)',
                          fontFamily: 'var(--fm)', fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 3,
                        }}>
                          <AlertCircle size={9}/> Urgent
                        </span>
                      )}
                    </div>

                    {/* Row 3: snippet */}
                    <div style={{
                      fontSize: 12, lineHeight: 1.4,
                      display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      paddingRight: unread > 0 ? 24 : 0,
                      color: c.latest_msg_content ? 'var(--t2)' : 'var(--t3)',
                      fontStyle: c.latest_msg_content ? 'normal' : 'italic',
                    }}>
                      {c.latest_msg_content ? (
                        <>
                          <span style={{ fontWeight: 600, color: 'var(--t1)' }}>
                            {c.latest_msg_sender}:
                          </span>{' '}
                          {c.latest_msg_content}
                        </>
                      ) : 'No messages yet — start the conversation'}
                    </div>

                    {/* Unread badge */}
                    {unread > 0 && (
                      <div style={{
                        position: 'absolute', right: 14, bottom: 14,
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: 'var(--p)', color: '#fff',
                        fontSize: 9, fontWeight: 700, fontFamily: 'var(--fm)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 4px',
                      }}>
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Thread Viewer ────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>
        {selectedCaseId ? (
          <>
            {/* Thread header */}
            <div style={{
              padding: '12px 24px',
              borderBottom: '1px solid var(--bd)',
              background: 'var(--s1)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
              boxShadow: 'var(--sh1)',
            }}>
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(76,29,149,.1)', border: '1.5px solid rgba(76,29,149,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: '#4C1D95', fontFamily: 'var(--fh)',
              }}>
                {selectedCaseName.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')}
              </div>

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 700,
                  color: 'var(--t1)', fontFamily: 'var(--fh)',
                }}>
                  {selectedCaseName}
                </div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 1 }}>
                  Internal team chat
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {onOpenDashboard && (
                  <button
                    onClick={() => onOpenDashboard(selectedCaseId, selectedCaseName)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 12px', borderRadius: 'var(--r1)',
                      background: 'transparent',
                      border: '1px solid var(--bd)', color: 'var(--t2)',
                      fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)',
                      cursor: 'pointer', transition: 'all 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--s2)'; e.currentTarget.style.color = 'var(--t1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)'; }}
                    title="Open in Student Dashboard"
                  >
                    <GraduationCap size={13}/>
                    Student Dashboard
                  </button>
                )}
                {/* "Open Full Case File" — the ONLY bridge to global state */}
                <button
                  onClick={() => onOpenCase?.(selectedCaseId, selectedCaseName)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 'var(--r1)',
                    background: 'var(--p)', border: 'none', color: '#fff',
                    fontSize: 13, fontWeight: 600, fontFamily: 'var(--fu)',
                    cursor: 'pointer', transition: 'background 150ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--pm)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--p)'}
                  title="Open in Analyser (sets global case)"
                >
                  Open Case File
                  <ChevronRight size={14}/>
                </button>
              </div>
            </div>

            {/* ChatThread — same component used by the trays, just embedded here */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ChatThread
                caseId={selectedCaseId}
                studentName={selectedCaseName}
                session={sess}
              />
            </div>
          </>
        ) : (
          /* Empty state */
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--t3)',
          }}>
            <MessageSquare size={40} style={{ opacity: 0.2, marginBottom: 14 }}/>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
              No conversation selected
            </div>
            <div style={{ fontSize: 13 }}>
              Select a case from the sidebar to view the team chat.
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
