/**
 * ChatThread.jsx — Real-time case message thread
 * ─────────────────────────────────────────────────────────────────────────
 * Features:
 * • Real-time Supabase subscription (INSERT / soft-delete events)
 * • Colour-coded sender avatars (stable hash → palette)
 * • Message search (text + sender + tag filter)
 * • Reply-to threading with quoted preview
 * • Soft-delete (is_deleted flag, never purges)
 * • Pagination: loads 50 at a time, "Load earlier" button
 * • Print view (Ctrl/Cmd+P aware, or dedicated print button)
 * • Tag pills (#tag extraction from message body)
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import {
  Send, Search, X, Reply, Trash2, Printer, ChevronUp,
  Loader2, Hash, MessageSquare, ClipboardList, Check,
  Calendar, ChevronDown, User,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/* ─── Supabase singleton (reuse App's instance if available) ─────────── */
if (!window._supabaseInstance) {
  window._supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
const supabase = window._supabaseInstance;

/* ─── Session helper ─────────────────────────────────────────────────── */
function getOrgSession() {
  try { return JSON.parse(sessionStorage.getItem('visalens_org_session') || 'null'); }
  catch { return null; }
}

/* ─── Stable sender colour palette ──────────────────────────────────── */
const SENDER_PALETTE = [
  { bg: 'rgba(29,107,232,.12)',  color: '#1D6BE8' },
  { bg: 'rgba(5,150,105,.12)',   color: '#059669' },
  { bg: 'rgba(139,92,246,.12)',  color: '#7C3AED' },
  { bg: 'rgba(252,71,28,.12)',   color: '#FC471C' },
  { bg: 'rgba(245,158,11,.12)',  color: '#D97706' },
  { bg: 'rgba(236,72,153,.12)',  color: '#DB2777' },
  { bg: 'rgba(20,184,166,.12)',  color: '#0D9488' },
  { bg: 'rgba(99,102,241,.12)',  color: '#4F46E5' },
];

function senderColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SENDER_PALETTE[h % SENDER_PALETTE.length];
}

function SenderAvatar({ name, size = 28 }) {
  const { bg, color } = senderColor(name);
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color, fontWeight: 700,
      fontSize: size * 0.38, display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--fh)',
      border: `1.5px solid ${color}33`,
    }}>
      {initials || '?'}
    </div>
  );
}

/* ─── Tag extraction ─────────────────────────────────────────────────── */
function extractTags(text = '') {
  return [...new Set((text.match(/#\w+/g) || []).map(t => t.toLowerCase()))];
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 7)  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const PAGE_SIZE = 50;

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════ */
export default function ChatThread({ caseId, studentName }) {
  // Read session once into a ref — getOrgSession() returns a new object every
  // call (JSON.parse), so calling it in the render body makes session?.org_id
  // look like a new value on every render, causing the realtime useEffect to
  // tear down and recreate the channel on every keystroke/hover/state update.
  const sessionRef = useRef(getOrgSession());
  const session    = sessionRef.current;
  const myId       = session?.member_id || null;
  const myName     = session?.name || session?.email || 'You';

  const [messages,    setMessages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset,      setOffset]      = useState(0);

  const [draft,       setDraft]       = useState('');
  const [replyTo,     setReplyTo]     = useState(null); // { id, sender_name, content }

  // org members for task assignee picker
  const [orgMembers,    setOrgMembers]    = useState([]);
  // task popover state: { msg, anchorRect } | null
  const [taskTarget,    setTaskTarget]    = useState(null);

  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchText,  setSearchText]  = useState('');
  const [tagFilter,   setTagFilter]   = useState('');

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const searchRef  = useRef(null);

  /* ─── Load messages ───────────────────────────────────────────────── */
  const loadMessages = useCallback(async (fromOffset = 0, append = false) => {
    if (!caseId || !session?.org_id) return;
    if (fromOffset === 0) setLoading(true);
    else setLoadingMore(true);

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('case_id', caseId)
      .eq('org_id', session.org_id)
      .order('created_at', { ascending: false })
      .range(fromOffset, fromOffset + PAGE_SIZE - 1);

    if (!error && data) {
      const sorted = [...data].reverse(); // oldest first
      setMessages(prev => append ? [...sorted, ...prev] : sorted);
      setHasMore(data.length === PAGE_SIZE);
      setOffset(fromOffset + data.length);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [caseId, session?.org_id]);

  useEffect(() => {
    setMessages([]);
    setOffset(0);
    setHasMore(false);
    setDraft('');
    setReplyTo(null);
    setSearchText('');
    setTagFilter('');
    loadMessages(0, false);
    // Mark thread as read when opened
    markAsRead();
  }, [caseId, loadMessages]);

  /* ─── Fetch org members for task assignee picker ─────────────────── */
  useEffect(() => {
    if (!session?.org_id) return;
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('org_id', session.org_id)
      .eq('is_active', true)
      .order('full_name', { ascending: true })
      .then(({ data }) => { if (data) setOrgMembers(data); });
  }, [session?.org_id]);

  /* ─── Mark thread read (upsert chat_reads) ──────────────────────── */
  async function markAsRead() {
    if (!caseId || !myId || !session?.org_id) return;
    try {
      await supabase.from('chat_reads').upsert({
        case_id:      caseId,
        member_id:    myId,
        last_read_at: new Date().toISOString(),
      }, { onConflict: 'case_id,member_id' });
    } catch { /* non-critical */ }
  }

  /* ─── Scroll to bottom on new messages ───────────────────────────── */
  useEffect(() => {
    if (!searchOpen && !searchText) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, searchOpen, searchText]);

  /* ─── Realtime subscription ──────────────────────────────────────── */
  useEffect(() => {
    if (!caseId || !session?.org_id) return;

    let channel = null;

    function subscribe() {
      if (channel) supabase.removeChannel(channel);
      channel = supabase
        .channel(`chat-${caseId}-${Date.now()}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `case_id=eq.${caseId}`,
        }, payload => {
          const msg = payload.new;
          if (!msg?.id) return;
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `case_id=eq.${caseId}`,
        }, payload => {
          const updated = payload.new;
          if (!updated?.id) return;
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
        })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setTimeout(subscribe, 2000);
          }
        });
    }

    // Ensure supabase auth session is live before subscribing.
    // App.jsx sets the JWT asynchronously after mount — if not set yet, set it now.
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session && session?.access_token) {
        supabase.auth.setSession({
          access_token:  session.access_token,
          refresh_token: session.refresh_token,
        }).finally(subscribe);
      } else {
        subscribe();
      }
    });

    // Resubscribe on token refresh so the websocket stays authenticated
    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(() => {
      subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
      authListener?.unsubscribe();
    };
  }, [caseId, session?.org_id]);

  /* ─── @mention helpers ───────────────────────────────────────────── */
  function extractMentions(text) {
    // Match @FirstName or @First Last (two words). Case-insensitive.
    const raw = text.match(/@([A-Za-z]+(?:\s[A-Za-z]+)?)/g) || [];
    const results = [];
    raw.forEach(m => {
      const query = m.slice(1).toLowerCase();
      const member = orgMembers.find(om =>
        om.full_name?.toLowerCase().startsWith(query) ||
        om.full_name?.toLowerCase() === query
      );
      if (member && !results.find(r => r.id === member.id)) {
        results.push({ id: member.id, name: member.full_name });
      }
    });
    return results;
  }

  /* ─── Send message ────────────────────────────────────────────────── */
  async function handleSend() {
    const text = draft.trim();
    if (!text || !caseId || !session?.org_id || sending) return;
    setSending(true);
    setDraft('');
    const currentReplyTo = replyTo;
    setReplyTo(null);

    const tags        = extractTags(text);
    const mentions    = extractMentions(text);
    const mentionedIds = mentions.map(m => m.id);

    // Optimistic insert — sender sees message immediately regardless of
    // realtime latency or RLS evaluation delay on the subscription payload
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg = {
      id:           optimisticId,
      case_id:      caseId,
      org_id:       session.org_id,
      sender_id:    myId,
      sender_name:  myName,
      sender_color: senderColor(myName).color,
      content:      text,
      tags,
      mentioned_ids: mentionedIds,
      reply_to_id:  currentReplyTo?.id || null,
      attachments:  [],
      is_deleted:   false,
      created_at:   new Date().toISOString(),
      _optimistic:  true,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const { data: inserted, error } = await supabase.from('chat_messages').insert({
      case_id:       caseId,
      org_id:        session.org_id,
      sender_id:     myId,
      sender_name:   myName,
      sender_color:  senderColor(myName).color,
      content:       text,
      tags,
      mentioned_ids: mentionedIds,
      reply_to_id:   currentReplyTo?.id || null,
      attachments:   [],
      is_deleted:    false,
    }).select('id').single();

    if (error) {
      console.error('[ChatThread] send error:', error);
      // Roll back optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } else if (inserted?.id) {
      // Replace optimistic row with the real DB id so dedup works correctly
      setMessages(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, _optimistic: false } : m
      ));

      // Write notifications for every @mentioned person (skip self)
      const notifRows = mentions
        .filter(m => m.id !== myId)
        .map(m => ({
          recipient_id:   m.id,
          org_id:         session.org_id,
          type:           'mention',
          sender_name:     myName,
          case_id:        caseId,
          message_id:     inserted.id,
          message_preview: text.slice(0, 120),
          is_read:        false,
        }));
      if (notifRows.length) {
        const { error: notifErr } = await supabase.from('notifications').insert(notifRows);
        if (notifErr) console.warn('[ChatThread] notification insert failed:', notifErr);
      }
    }

    setSending(false);
    markAsRead();
    inputRef.current?.focus();
  }

  /* ─── Soft delete ─────────────────────────────────────────────────── */
  async function handleDelete(msgId) {
    if (!session?.org_id) return;
    await supabase
      .from('chat_messages')
      .update({ is_deleted: true })
      .eq('id', msgId)
      .eq('org_id', session.org_id);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true } : m));
  }

  /* ─── Filtered view ───────────────────────────────────────────────── */
  const displayMessages = useMemo(() => {
    let list = messages;
    if (searchText) {
      const lc = searchText.toLowerCase();
      list = list.filter(m =>
        m.content?.toLowerCase().includes(lc) ||
        m.sender_name?.toLowerCase().includes(lc)
      );
    }
    if (tagFilter) {
      list = list.filter(m => (m.tags || []).includes(tagFilter));
    }
    return list;
  }, [messages, searchText, tagFilter]);

  /* ─── All tags in thread ──────────────────────────────────────────── */
  const allTags = useMemo(() => {
    const set = new Set();
    messages.forEach(m => (m.tags || []).forEach(t => set.add(t)));
    return [...set].sort();
  }, [messages]);

  /* ─── Print ───────────────────────────────────────────────────────── */
  function handlePrint() {
    const win = window.open('', '_blank');
    const rows = messages
      .filter(m => !m.is_deleted)
      .map(m => `
        <div style="margin-bottom:14px;font-family:sans-serif">
          <div style="font-size:11px;color:#666;margin-bottom:3px">
            <strong>${m.sender_name}</strong> — ${new Date(m.created_at).toLocaleString('en-GB')}
          </div>
          <div style="font-size:13px;color:#111;line-height:1.5">${m.content?.replace(/\n/g, '<br>') || ''}</div>
        </div>
      `).join('<hr style="border:none;border-top:1px solid #eee;margin:10px 0">');

    win.document.write(`
      <html><head><title>Chat — ${studentName}</title></head>
      <body style="padding:24px;max-width:700px;margin:0 auto">
        <h2 style="font-family:sans-serif;margin-bottom:4px">Case Chat: ${studentName}</h2>
        <p style="font-family:sans-serif;font-size:12px;color:#666;margin-bottom:24px">
          Printed ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })} · ${messages.length} messages
        </p>
        ${rows}
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  /* ─── Keyboard shortcuts ──────────────────────────────────────────── */
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(null);
    }
  }

  /* ─── Reply preview ───────────────────────────────────────────────── */
  function getReplyPreview(msg) {
    if (!msg.reply_to_id) return null;
    return messages.find(m => m.id === msg.reply_to_id) || null;
  }

  const isFiltered = searchText || tagFilter;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--s1)',
    }}>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 14px', borderBottom: '1px solid var(--bd)',
        background: 'var(--s2)', flexShrink: 0,
      }}>
        <MessageSquare size={13} color="var(--p)"/>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', flex: 1 }}>
          Case Thread
          {messages.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              {messages.filter(m => !m.is_deleted).length} messages
            </span>
          )}
        </span>

        {/* Tag filter pills */}
        {allTags.slice(0, 4).map(tag => (
          <button
            key={tag}
            onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '3px 7px', borderRadius: 4,
              background: tagFilter === tag ? 'var(--p)' : 'var(--s3)',
              color: tagFilter === tag ? '#fff' : 'var(--t3)',
              border: 'none', cursor: 'pointer',
              fontSize: 10, fontFamily: 'var(--fu)', fontWeight: 600,
            }}
          >
            <Hash size={9}/>{tag.replace('#', '')}
          </button>
        ))}

        <button
          onClick={() => { setSearchOpen(o => !o); setTimeout(() => searchRef.current?.focus(), 50); }}
          style={{
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: searchOpen ? 'var(--p)' : 'var(--s3)',
            color: searchOpen ? '#fff' : 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Search messages"
        >
          <Search size={13}/>
        </button>

        <button
          onClick={handlePrint}
          style={{
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'var(--s3)', color: 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Print thread"
        >
          <Printer size={13}/>
        </button>
      </div>

      {/* ── Search bar ── */}
      {searchOpen && (
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid var(--bd)',
          background: 'var(--s2)', display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0, animation: 'sdb-fade-in .15s ease',
        }}>
          <Search size={12} color="var(--t3)"/>
          <input
            ref={searchRef}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search messages or sender…"
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 13, fontFamily: 'var(--fu)', color: 'var(--t1)',
              outline: 'none',
            }}
          />
          {searchText && (
            <button onClick={() => setSearchText('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 0 }}>
              <X size={12}/>
            </button>
          )}
        </div>
      )}

      {/* ── Message list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* Load earlier */}
        {hasMore && !isFiltered && (
          <button
            onClick={async () => {
              const newOffset = offset;
              await loadMessages(newOffset, true);
            }}
            disabled={loadingMore}
            style={{
              alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 6,
              background: 'var(--s2)', border: '1px solid var(--bd)',
              color: 'var(--t3)', fontSize: 11, fontFamily: 'var(--fu)',
              cursor: loadingMore ? 'default' : 'pointer', marginBottom: 8,
            }}
          >
            {loadingMore
              ? <Loader2 size={11} style={{ animation: 'spin .7s linear infinite' }}/>
              : <ChevronUp size={11}/>
            }
            Load earlier messages
          </button>
        )}

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={18} color="var(--t3)" style={{ animation: 'spin .7s linear infinite' }}/>
          </div>
        ) : displayMessages.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 8, padding: '32px 0',
          }}>
            <MessageSquare size={28} color="var(--s3)"/>
            <span style={{ fontSize: 13, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              {isFiltered ? 'No messages match your search' : 'No messages yet — start the conversation'}
            </span>
          </div>
        ) : (
          displayMessages.map((msg, idx) => {
            const isMe    = msg.sender_id === myId;
            const palette = senderColor(msg.sender_name || '');
            const prev    = displayMessages[idx - 1];
            const grouped = prev && prev.sender_id === msg.sender_id &&
              (new Date(msg.created_at) - new Date(prev.created_at)) < 120000;
            const reply   = getReplyPreview(msg);

            if (msg.is_deleted) {
              return (
                <div key={msg.id} style={{
                  fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)',
                  fontStyle: 'italic', padding: '2px 36px', marginTop: grouped ? 0 : 8,
                }}>
                  Message deleted
                </div>
              );
            }

            if (msg.is_system) {
              return (
                <div key={msg.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  margin: '8px 0', padding: '0 4px',
                }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--bd)' }}/>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 20,
                    background: 'var(--s2)', border: '1px solid var(--bd)',
                    fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)',
                    whiteSpace: 'nowrap',
                  }}>
                    <ClipboardList size={9} color="var(--p)"/>
                    <span>{msg.content}</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'var(--bd)' }}/>
                </div>
              );
            }

            return (
              <MessageRow
                key={msg.id}
                msg={msg}
                isMe={isMe}
                palette={palette}
                grouped={grouped}
                reply={reply}
                onReply={() => setReplyTo({ id: msg.id, sender_name: msg.sender_name, content: msg.content })}
                onDelete={msg.sender_id === myId ? () => handleDelete(msg.id) : null}
                onMakeTask={(anchorRect) => setTaskTarget({ msg, anchorRect })}
              />
            );
          })
        )}
        <div ref={bottomRef}/>
      </div>

      {/* ── Reply preview bar ── */}
      {replyTo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', background: 'rgba(29,107,232,.06)',
          borderTop: '1px solid rgba(29,107,232,.15)', flexShrink: 0,
          animation: 'sdb-fade-in .15s ease',
        }}>
          <Reply size={12} color="#1D6BE8"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#1D6BE8', fontFamily: 'var(--fu)', marginBottom: 1 }}>
              Replying to {replyTo.sender_name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyTo.content?.slice(0, 80)}{replyTo.content?.length > 80 ? '…' : ''}
            </div>
          </div>
          <button onClick={() => setReplyTo(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 2 }}>
            <X size={12}/>
          </button>
        </div>
      )}

      {/* ── Compose bar ── */}
      <div style={{
        padding: '10px 12px', borderTop: replyTo ? 'none' : '1px solid var(--bd)',
        background: 'var(--s2)', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message about ${studentName}…`}
          rows={1}
          style={{
            flex: 1, resize: 'none', padding: '8px 11px',
            borderRadius: 8, border: '1px solid var(--bd)',
            background: 'var(--s1)', color: 'var(--t1)',
            fontSize: 13, fontFamily: 'var(--fu)', lineHeight: 1.5,
            outline: 'none', maxHeight: 100, overflowY: 'auto',
            transition: 'border-color var(--fast)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--p)'}
          onBlur={e => e.target.style.borderColor = 'var(--bd)'}
          onInput={e => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            width: 34, height: 34, borderRadius: 8, border: 'none',
            background: draft.trim() ? 'var(--p)' : 'var(--s3)',
            color: draft.trim() ? '#fff' : 'var(--t3)',
            cursor: draft.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'all var(--fast)',
          }}
        >
          {sending
            ? <Loader2 size={14} style={{ animation: 'spin .7s linear infinite' }}/>
            : <Send size={14}/>
          }
        </button>
      </div>
    </div>
  );
}

/* ─── Task Popover — portal-anchored to "Make task" button ──────────── */
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low',    color: '#059669' },
  { value: 'medium', label: 'Medium', color: '#D97706' },
  { value: 'high',   label: 'High',   color: '#FC471C' },
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
];

function TaskPopover({ msg, caseId, studentName, orgMembers, anchorRect, onClose, onCreated }) {
  const session      = getOrgSession();
  const myId         = session?.member_id || null;
  const myName       = session?.full_name || session?.name || session?.email || 'Me';
  const orgId        = session?.org_id    || null;

  // Pre-fill assignee from first @mention in the message, else the sender if not me
  function guessAssignee() {
    const mentioned = (msg.mentioned_ids || []);
    if (mentioned.length) {
      const m = orgMembers.find(om => om.id === mentioned[0]);
      if (m) return { id: m.id, name: m.full_name };
    }
    if (msg.sender_id && msg.sender_id !== myId) {
      return { id: msg.sender_id, name: msg.sender_name };
    }
    return { id: myId, name: myName };
  }

  const guess = guessAssignee();

  const [title,      setTitle]      = useState(
    msg.content ? (msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content) : ''
  );
  const [priority,   setPriority]   = useState('medium');
  const [dueDate,    setDueDate]    = useState('');
  const [assigneeId, setAssigneeId] = useState(guess.id   || '');
  const [assigneeName,setAssigneeName] = useState(guess.name || '');
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [priorOpen,  setPriorOpen]  = useState(false);

  const panelRef = useRef(null);
  const titleRef = useRef(null);

  // Position: just below the anchor button, right-aligned
  const top   = anchorRect ? Math.round(anchorRect.bottom + 6) : 60;
  const right  = anchorRect ? Math.round(window.innerWidth - anchorRect.right) : 16;

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 10);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  // Focus title on mount
  useEffect(() => { setTimeout(() => titleRef.current?.focus(), 30); }, []);

  async function handleCreate() {
    if (!title.trim() || !orgId || saving) return;
    setSaving(true);
    const { data: newTask, error } = await supabase.from('case_tasks').insert({
      case_id:           caseId,
      org_id:            orgId,
      title:             title.trim(),
      priority,
      due_date:          dueDate || null,
      assigned_to_id:    assigneeId   || null,
      assigned_to_name:  assigneeName || null,
      created_by_id:     myId,
      created_by_name:   myName,
      status:            'open',
    }).select('id').single();
    setSaving(false);
    if (!error) {
      // Signal 1 — system message in chat thread so everyone sees it inline
      supabase.from('chat_messages').insert({
        case_id:     caseId,
        org_id:      orgId,
        sender_id:   myId,
        sender_name: myName,
        content:     `Task created: "${title.trim()}"${assigneeName ? ` → assigned to ${assigneeName}` : ''}${priority !== 'medium' ? ` · ${priority}` : ''}`,
        tags:        [],
        attachments: [],
        is_deleted:  false,
        is_system:   true,
        type:        'task_created',
        task_id:     newTask?.id || null,
      }).then(({ error: e }) => { if(e) console.warn('[ChatThread] system msg error:', e); });

      // Signal 3 — notification for assignee (skip if self-assigned)
      if (assigneeId && assigneeId !== myId) {
        supabase.from('notifications').insert({
          recipient_id:    assigneeId,
          org_id:          orgId,
          type:            'task_assigned',
          sender_name:     myName,
          case_id:         caseId,
          case_name:       studentName,
          message_id:      newTask?.id || null,
          body:            title.trim(),
          is_read:         false,
        }).then(({ error: e }) => { if(e) console.warn('[ChatThread] task notif error:', e); });
      }

      setSaved(true);
      onCreated?.();
      setTimeout(() => onClose(), 900);
    }
  }

  const priColor = PRIORITY_OPTIONS.find(p => p.value === priority)?.color || '#D97706';

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={{
        position:      'fixed',
        top,
        right,
        width:          300,
        borderRadius:   10,
        background:    'var(--s1)',
        border:        '1px solid var(--bd)',
        boxShadow:     '0 8px 32px rgba(10,20,50,.35)',
        zIndex:         99999,
        overflow:      'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 12px', borderBottom: '1px solid var(--bd)',
        background: 'var(--s2)',
      }}>
        <ClipboardList size={12} color="var(--p)"/>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>
          Create task — {studentName}
        </span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 2, display: 'flex', alignItems: 'center' }}>
          <X size={12}/>
        </button>
      </div>

      {saved ? (
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(5,150,105,.12)', border: '1.5px solid rgba(5,150,105,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 8px',
          }}>
            <Check size={16} color="#059669"/>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fu)' }}>Task created</div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)', marginTop: 3 }}>It will appear in the peek drawer</div>
        </div>
      ) : (
        <div style={{ padding: '12px' }}>

          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
              Task title
            </label>
            <textarea
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate(); if (e.key === 'Escape') onClose(); }}
              style={{
                width: '100%', resize: 'none', boxSizing: 'border-box',
                padding: '7px 9px', borderRadius: 6,
                border: '1px solid var(--bd)', background: 'var(--s2)',
                color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--fu)',
                lineHeight: 1.5, outline: 'none', maxHeight: 80,
              }}
              onFocus={e => e.target.style.borderColor = 'var(--p)'}
              onBlur={e => e.target.style.borderColor = 'var(--bd)'}
            />
          </div>

          {/* Assignee + Priority row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>

            {/* Assignee */}
            <div style={{ flex: 1, position: 'relative' }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
                Assign to
              </label>
              <button
                onClick={() => { setAssignOpen(o => !o); setPriorOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--bd)', background: 'var(--s2)',
                  color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--fu)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <User size={10} color="var(--t3)"/>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {assigneeName || 'Unassigned'}
                </span>
                <ChevronDown size={9} color="var(--t3)"/>
              </button>
              {assignOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: 'var(--s1)', border: '1px solid var(--bd)',
                  borderRadius: 7, boxShadow: '0 4px 16px rgba(10,20,50,.25)',
                  zIndex: 100001, overflow: 'hidden', maxHeight: 160, overflowY: 'auto',
                }}>
                  <button
                    onClick={() => { setAssigneeId(''); setAssigneeName(''); setAssignOpen(false); }}
                    style={{ width: '100%', padding: '7px 10px', border: 'none', background: 'transparent', color: 'var(--t3)', fontFamily: 'var(--fu)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Unassigned
                  </button>
                  {orgMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setAssigneeId(m.id); setAssigneeName(m.full_name); setAssignOpen(false); }}
                      style={{
                        width: '100%', padding: '7px 10px', border: 'none',
                        background: m.id === assigneeId ? 'var(--s3)' : 'transparent',
                        color: 'var(--t1)', fontFamily: 'var(--fu)', fontSize: 11,
                        cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = m.id === assigneeId ? 'var(--s3)' : 'transparent'}
                    >
                      {m.id === assigneeId && <Check size={9} color="var(--p)"/>}
                      {m.full_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority */}
            <div style={{ width: 90, position: 'relative' }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
                Priority
              </label>
              <button
                onClick={() => { setPriorOpen(o => !o); setAssignOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 8px', borderRadius: 6,
                  border: `1px solid ${priColor}44`, background: `${priColor}12`,
                  color: priColor, fontSize: 11, fontFamily: 'var(--fu)',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                <span style={{ flex: 1, textTransform: 'capitalize' }}>{priority}</span>
                <ChevronDown size={9}/>
              </button>
              {priorOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                  width: 110, background: 'var(--s1)', border: '1px solid var(--bd)',
                  borderRadius: 7, boxShadow: '0 4px 16px rgba(10,20,50,.25)',
                  zIndex: 100001, overflow: 'hidden',
                }}>
                  {PRIORITY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setPriority(opt.value); setPriorOpen(false); }}
                      style={{
                        width: '100%', padding: '7px 10px', border: 'none',
                        background: priority === opt.value ? 'var(--s3)' : 'transparent',
                        color: opt.color, fontFamily: 'var(--fu)', fontSize: 11,
                        cursor: 'pointer', textAlign: 'left', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = priority === opt.value ? 'var(--s3)' : 'transparent'}
                    >
                      {priority === opt.value && <Check size={9}/>}
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Due date */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--fu)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
              Due date <span style={{ fontWeight: 400, opacity: .6 }}>(optional)</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--s2)' }}>
              <Calendar size={10} color="var(--t3)"/>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  color: dueDate ? 'var(--t1)' : 'var(--t3)',
                  fontSize: 11, fontFamily: 'var(--fu)', outline: 'none', cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* Source message chip */}
          <div style={{
            padding: '5px 8px', borderRadius: 5,
            background: 'rgba(29,107,232,.06)', border: '1px solid rgba(29,107,232,.12)',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--p)', fontFamily: 'var(--fu)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              From chat
            </div>
            <div style={{ fontSize: 10, color: 'var(--t2)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.content?.slice(0, 70)}{(msg.content?.length || 0) > 70 ? '…' : ''}
            </div>
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!title.trim() || saving}
            style={{
              width: '100%', padding: '8px', borderRadius: 7, border: 'none',
              background: title.trim() ? 'var(--p)' : 'var(--s3)',
              color: title.trim() ? '#fff' : 'var(--t3)',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--fu)',
              cursor: title.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background .12s',
            }}
          >
            {saving
              ? <Loader2 size={12} style={{ animation: 'spin .7s linear infinite' }}/>
              : <ClipboardList size={12}/>
            }
            {saving ? 'Creating…' : 'Create task'}
          </button>
          <div style={{ marginTop: 5, textAlign: 'center', fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
            ⌘↵ to create
          </div>
        </div>
      )}
    </div>,
    document.body
  {/* ── Task popover — portal-rendered ── */}
      {taskTarget && (
        <TaskPopover
          msg={taskTarget.msg}
          caseId={caseId}
          studentName={studentName}
          orgMembers={orgMembers}
          anchorRect={taskTarget.anchorRect}
          onClose={() => setTaskTarget(null)}
          onCreated={() => setTaskTarget(null)}
        />
      )}
    </div>
  );
}

/* ─── Individual message row ─────────────────────────────────────────── */
function MessageRow({ msg, isMe, palette, grouped, reply, onReply, onDelete, onMakeTask }) {
  const [hover,       setHover]       = useState(false);
  const makeTaskRef   = useRef(null);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        marginTop: grouped ? 2 : 10,
        flexDirection: isMe ? 'row-reverse' : 'row',
      }}
    >
      {/* Avatar — hidden when grouped */}
      <div style={{ width: 28, flexShrink: 0, marginTop: 2 }}>
        {!grouped && <SenderAvatar name={msg.sender_name || ''} size={28}/>}
      </div>

      <div style={{ maxWidth: '75%', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>

        {/* Sender + time header — hidden when grouped */}
        {!grouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3, flexDirection: isMe ? 'row-reverse' : 'row' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: palette.color, fontFamily: 'var(--fh)' }}>
              {isMe ? 'You' : msg.sender_name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              {fmtTime(msg.created_at)}
            </span>
          </div>
        )}

        {/* Reply preview */}
        {reply && (
          <div style={{
            padding: '4px 8px', borderRadius: '6px 6px 0 0',
            background: 'var(--s3)', borderLeft: `2px solid ${palette.color}`,
            marginBottom: 1, maxWidth: '100%',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: palette.color, fontFamily: 'var(--fu)', marginBottom: 1 }}>
              {reply.sender_name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {reply.content?.slice(0, 60)}{reply.content?.length > 60 ? '…' : ''}
            </div>
          </div>
        )}

        {/* Bubble */}
        <div style={{
          padding: '7px 11px',
          borderRadius: reply
            ? '0 8px 8px 8px'
            : grouped
              ? (isMe ? '8px 4px 4px 8px' : '4px 8px 8px 4px')
              : (isMe ? '8px 4px 8px 8px' : '4px 8px 8px 8px'),
          background: isMe ? 'var(--p)' : 'var(--s2)',
          border: isMe ? 'none' : '1px solid var(--bd)',
          color: isMe ? '#fff' : 'var(--t1)',
          fontSize: 13, fontFamily: 'var(--fu)', lineHeight: 1.5,
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          position: 'relative',
        }}>
          {/* Render tags as coloured pills inside message */}
          {renderMessageContent(msg.content || '', isMe)}
        </div>

        {/* Tag pills */}
        {(msg.tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
            {(msg.tags || []).map(tag => (
              <span key={tag} style={{
                fontSize: 9, fontWeight: 700, fontFamily: 'var(--fu)',
                padding: '1px 5px', borderRadius: 3,
                background: 'rgba(29,107,232,.1)', color: '#1D6BE8',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons — appear on hover */}
      <div style={{
        display: 'flex', gap: 2, alignItems: 'center',
        opacity: hover ? 1 : 0, transition: 'opacity .15s',
        flexDirection: isMe ? 'row' : 'row-reverse',
        alignSelf: 'center',
      }}>
        <button
          onClick={onReply}
          title="Reply"
          style={{
            width: 24, height: 24, borderRadius: 5, border: 'none',
            background: 'var(--s3)', color: 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Reply size={11}/>
        </button>
        <button
          ref={makeTaskRef}
          onClick={() => {
            const rect = makeTaskRef.current?.getBoundingClientRect();
            onMakeTask?.(rect);
          }}
          title="Create task from this message"
          style={{
            width: 24, height: 24, borderRadius: 5, border: 'none',
            background: 'var(--s3)', color: 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(29,107,232,.15)'; e.currentTarget.style.color = 'var(--p)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.color = 'var(--t3)'; }}
        >
          <ClipboardList size={11}/>
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete"
            style={{
              width: 24, height: 24, borderRadius: 5, border: 'none',
              background: 'var(--s3)', color: 'var(--t3)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Trash2 size={11}/>
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Render message body with highlighted #tags and @mentions ───────── */
function renderMessageContent(text, isMe) {
  const parts = text.split(/(#\w+|@[A-Za-z]+(?:\s[A-Za-z]+)?)/g);
  return parts.map((part, i) => {
    if (/^#\w+/.test(part))
      return <span key={i} style={{ fontWeight: 700, opacity: .85 }}>{part}</span>;
    if (/^@/.test(part))
      return <span key={i} style={{ fontWeight: 700, color: isMe ? 'rgba(255,255,255,.9)' : 'var(--p)', background: isMe ? 'rgba(255,255,255,.15)' : 'rgba(29,107,232,.1)', borderRadius: 3, padding: '0 3px' }}>{part}</span>;
    return part;
  });
}
