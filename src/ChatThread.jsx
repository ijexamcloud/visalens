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
 * • Pin to Timeline (inserts doc_events row)
 * • Task mention detection (task: "title" renders as a purple pill)
 * • Read receipts (tiny avatar dots showing who has seen up to which message)
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import {
  Send, Search, X, Reply, Trash2, Printer, ChevronUp,
  Loader2, Hash, MessageSquare, ClipboardList, Check,
  Calendar, ChevronDown, User, Pin, PinOff, Sparkles, Copy,
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
export default function ChatThread({ caseId, studentName, session: propSession }) {
  // Read session once into a ref — prefer prop session, fall back to sessionStorage
  // getOrgSession() returns a new object every call (JSON.parse), so calling it
  // in the render body makes session?.org_id look like a new value on every render,
  // causing the realtime useEffect to tear down and recreate the channel on every
  // keystroke/hover/state update.
  const sessionRef = useRef(propSession || getOrgSession());
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
  // @mention state
  const [mentionQuery,  setMentionQuery]  = useState('');
  const [mentionOpen,   setMentionOpen]   = useState(false);
  const [mentionedIds,  setMentionedIds]  = useState([]);
  const [mentionIndex,  setMentionIndex]  = useState(0);
  // task popover state: { msg, anchorRect } | null
  const [taskTarget,    setTaskTarget]    = useState(null);

  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchText,  setSearchText]  = useState('');
  const [tagFilter,   setTagFilter]   = useState('');
  const [readReceipts, setReadReceipts] = useState([]);
  const [summarizing,  setSummarizing]  = useState(false);
  const [summaryCard,  setSummaryCard]  = useState(null); // { text } | null
  const [summaryOpen,  setSummaryOpen]  = useState(true);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [pinnedBarOpen,  setPinnedBarOpen]  = useState(true);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [pinReplaceModal, setPinReplaceModal] = useState(null); // { newMsg, currentPins } | null
  const inputRef   = useRef(null);
  const searchRef  = useRef(null);
  const bottomRef  = useRef(null);
  const mentionPopoverRef = useRef(null);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);

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
    setPinnedMessages([]);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionedIds([]);
    setMentionIndex(0);
    loadMessages(0, false);
    loadPinnedMessages();
    // Mark thread as read when opened
    markAsRead();
  }, [caseId, loadMessages]);

  /* ─── Fetch org members for @mention and task assignee picker ─────────────────── */
  useEffect(() => {
    if (!session?.org_id) return;
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('org_id', session.org_id)
      .eq('is_active', true)
      .neq('id', myId)  // exclude self — no point @mentioning yourself
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (data) setOrgMembers(data);
      });
  }, [session?.org_id, myId]);

  /* ─── Load pinned messages for this thread ──────────────────────── */
  async function loadPinnedMessages() {
    if (!caseId || !session?.org_id) return;
    try {
      console.log('[ChatThread] loadPinnedMessages - caseId:', caseId);
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('case_id', caseId)
        .eq('org_id', session.org_id)
        .eq('is_pinned', true)
        .eq('is_deleted', false)
        .order('pinned_at', { ascending: true });
      console.log('[ChatThread] loadPinnedMessages - DB returned:', data?.length || 0, 'pinned messages');
      if (data) {
        console.log('[ChatThread] loadPinnedMessages - pinned messages:', data.map(p => ({ id: p.id, content: p.content?.slice(0, 20) })));
        setPinnedMessages(data);
      }
    } catch (e) {
      console.error('[ChatThread] loadPinnedMessages error:', e);
    }
  }

  /* ─── Scroll to and highlight message ─────────────────────────────── */
  function scrollToMessage(msgId) {
    const msgElement = document.querySelector(`[data-message-id="${msgId}"]`);
    if (msgElement) {
      msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(msgId);
      setTimeout(() => setHighlightedMessageId(null), 1000);
    }
  }

  /* ─── Mark thread read (upsert chat_reads) ──────────────────────── */
  async function markAsRead() {
    if (!caseId || !myId || !session?.org_id) return;
    try {
      await supabase.from('chat_reads').upsert({
        case_id:      caseId,
        member_id:    myId,
        last_read_at: new Date().toISOString(),
      }, { onConflict: 'case_id,member_id' });
      // Refresh receipts so our own "seen" dot appears immediately
      loadReadReceipts();
    } catch { /* non-critical */ }
  }

  /* ─── Load read receipts for this thread ────────────────────────── */
  async function loadReadReceipts() {
    if (!caseId || !session?.org_id) return;
    try {
      const { data } = await supabase
        .from('chat_reads')
        .select('member_id, member_name, last_read_at')
        .eq('case_id', caseId)
        .eq('org_id', session.org_id);
      if (data) setReadReceipts(data);
    } catch { /* non-critical */ }
  }

  // Subscribe to chat_reads changes so receipts update in real-time
  useEffect(() => {
    if (!caseId || !session?.org_id) return;
    loadReadReceipts();
    const ch = supabase
      .channel(`reads-${caseId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_reads',
        filter: `case_id=eq.${caseId}`,
      }, () => loadReadReceipts())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [caseId, session?.org_id]);

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
    const MAX_RETRIES = 5;

    // Reset refs on mount
    isMountedRef.current = true;
    retryCountRef.current = 0;

    function subscribe() {
      if (!isMountedRef.current) return;
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
          // Sync pinned list when is_pinned changes
          if ('is_pinned' in updated) {
            setPinnedMessages(prev => {
              if (updated.is_pinned && !updated.is_deleted) {
                // Add if not already there
                if (prev.some(p => p.id === updated.id)) {
                  return prev.map(p => p.id === updated.id ? { ...p, ...updated } : p);
                }
                return [...prev, updated].sort((a, b) =>
                  new Date(a.pinned_at || a.created_at) - new Date(b.pinned_at || b.created_at)
                );
              } else {
                // Remove from pinned list
                return prev.filter(p => p.id !== updated.id);
              }
            });
          }
        })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (retryCountRef.current >= MAX_RETRIES) {
              console.warn('[ChatThread] Max retries reached, giving up');
              return;
            }
            const backoffMs = Math.min(2000 * Math.pow(2, retryCountRef.current), 30000);
            retryCountRef.current++;
            console.log(`[ChatThread] Retry attempt ${retryCountRef.current}/${MAX_RETRIES} in ${backoffMs}ms`);
            setTimeout(() => {
              if (isMountedRef.current) subscribe();
            }, backoffMs);
          } else if (status === 'SUBSCRIBED') {
            retryCountRef.current = 0;
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
      isMountedRef.current = false;
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

  const mentionSuggestions = React.useMemo(() => {
    if (!mentionQuery) return orgMembers.slice(0, 8);
    const q = mentionQuery.toLowerCase();
    return orgMembers.filter(m => m.full_name?.toLowerCase().startsWith(q)).slice(0, 8);
  }, [orgMembers, mentionQuery]);

  // Detect '@' trigger in draft text and open/close the popover
  function handleDraftChange(e) {
    const val = e.target.value;
    setDraft(val);
    // Find the last '@' in the text that isn't followed by a space yet
    const cursor = e.target.selectionStart;
    const textUpToCursor = val.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf('@');
    if (atIdx !== -1) {
      const fragment = textUpToCursor.slice(atIdx + 1);
      // Only open popover if fragment has no spaces (mid-word typing)
      if (!/\s/.test(fragment)) {
        setMentionQuery(fragment);
        setMentionOpen(true);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery('');
    setMentionIndex(0);
  }

  // Insert selected member into the draft at the '@' position
  function selectMention(member) {
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const textUpToCursor = draft.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf('@');
    const before = draft.slice(0, atIdx);
    const after = draft.slice(cursor);
    const inserted = `@${member.full_name} `;
    setDraft(before + inserted + after);
    setMentionedIds(prev => [...new Set([...prev, member.id])]);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionIndex(0);
    setTimeout(() => {
      const newPos = before.length + inserted.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  /* ─── Send message ────────────────────────────────────────────────── */
  async function handleSend() {
    const text = draft.trim();
    if (!text || !caseId || !session?.org_id || sending) return;
    setSending(true);
    try {
      setDraft('');
      setMentionedIds([]);
      const currentReplyTo = replyTo;
      setReplyTo(null);

      const tags        = extractTags(text);
      const finalMentionedIds = mentionedIds.length ? mentionedIds : null;

    // Optimistic insert — sender sees message immediately regardless of
    // realtime latency or RLS evaluation delay on the subscription payload
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticMsg = {
      id:           optimisticId,
      case_id:      caseId,
      org_id:       session.org_id,
      sender_id:    myId,
      sender_name:  myName,
      sender_color: senderColor(myName).color,
      content:      text,
      tags,
      mentioned_ids: finalMentionedIds,
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
      mentioned_ids: finalMentionedIds,
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
      if (finalMentionedIds && finalMentionedIds.length) {
        const mentionedMembers = orgMembers.filter(m => finalMentionedIds.includes(m.id));
        const notifRows = mentionedMembers
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
    }
    } catch (e) {
      console.error('[ChatThread] send error:', e);
    } finally {
      setSending(false);
      markAsRead();
      inputRef.current?.focus();
      // Scroll to bottom if replying to an earlier message
      if (currentReplyTo) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
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

  /* ─── Pin / Unpin message ────────────────────────────────────────── */
  async function handlePin(msg) {
    if (!session?.org_id || !caseId) return;
    const now = new Date().toISOString();

    console.log('[ChatThread] handlePin - msg.id:', msg.id);
    console.log('[ChatThread] current pinnedMessages count:', pinnedMessages.length);
    console.log('[ChatThread] pinnedMessages:', pinnedMessages.map(p => ({ id: p.id, content: p.content?.slice(0, 20) })));

    // Check 3-pin limit before proceeding
    const currentPinnedCount = pinnedMessages.filter(m => m.id !== msg.id).length;
    console.log('[ChatThread] currentPinnedCount (excluding this msg):', currentPinnedCount);

    if (currentPinnedCount >= 3) {
      // Show replacement modal
      console.log('[ChatThread] 3-pin limit reached, showing replacement modal');
      setPinReplaceModal({ newMsg: msg, currentPins: pinnedMessages });
      return;
    }

    // Optimistic update
    const updated = { ...msg, is_pinned: true, pinned_at: now, pinned_by_name: myName };
    setMessages(prev => prev.map(m => m.id === msg.id ? updated : m));
    setPinnedMessages(prev => {
      if (prev.some(p => p.id === msg.id)) return prev;
      return [...prev, updated].sort((a, b) =>
        new Date(a.pinned_at || a.created_at) - new Date(b.pinned_at || b.created_at)
      );
    });
    setPinnedBarOpen(true);

    console.log('[ChatThread] Updating DB for pin');
    const { data: pinData, error } = await supabase
      .from('chat_messages')
      .update({ is_pinned: true, pinned_at: now, pinned_by_name: myName })
      .eq('id', msg.id)
      .eq('org_id', session.org_id)
      .select('id, is_pinned, pinned_at')
      .single();

    if (error) {
      console.error('[ChatThread] pin error:', error);
      // Roll back
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      setPinnedMessages(prev => prev.filter(p => p.id !== msg.id));
    } else {
      console.log('[ChatThread] pin DB update successful - DB returned:', pinData);
    }
  }

  /* ─── Handle pin replacement modal selection ───────────────────────── */
  async function handleReplacePin(selectedPinId) {
    if (!pinReplaceModal || !session?.org_id || !caseId) return;
    const { newMsg, currentPins } = pinReplaceModal;
    const now = new Date().toISOString();

    console.log('[ChatThread] handleReplacePin - selectedPinId:', selectedPinId, 'newMsg.id:', newMsg.id);
    console.log('[ChatThread] currentPins count:', currentPins.length);

    // Close modal first
    setPinReplaceModal(null);

    // Perform DB operations atomically - unpin first, then pin
    console.log('[ChatThread] Unpinning message:', selectedPinId);
    const { data: unpinData, error: unpinError } = await supabase
      .from('chat_messages')
      .update({ is_pinned: false, pinned_at: null, pinned_by_name: null })
      .eq('id', selectedPinId)
      .eq('org_id', session.org_id)
      .select('id, is_pinned')
      .single();

    if (unpinError) {
      console.error('[ChatThread] unpin error:', unpinError);
      return;
    }
    console.log('[ChatThread] Unpin successful - DB returned:', unpinData);

    console.log('[ChatThread] Pinning message:', newMsg.id);
    const { data: pinData, error: pinError } = await supabase
      .from('chat_messages')
      .update({ is_pinned: true, pinned_at: now, pinned_by_name: myName })
      .eq('id', newMsg.id)
      .eq('org_id', session.org_id)
      .select('id, is_pinned, pinned_at')
      .single();

    if (pinError) {
      console.error('[ChatThread] pin error:', pinError);
      // Re-pin the original message since pin failed
      await supabase
        .from('chat_messages')
        .update({ is_pinned: true, pinned_at: now, pinned_by_name: myName })
        .eq('id', selectedPinId)
        .eq('org_id', session.org_id);
      return;
    }
    console.log('[ChatThread] Pin successful - DB returned:', pinData);

    // Only update optimistic state after DB operations succeed
    setMessages(prev => prev.map(m =>
      m.id === selectedPinId
        ? { ...m, is_pinned: false, pinned_at: null, pinned_by_name: null }
        : m.id === newMsg.id
          ? { ...m, is_pinned: true, pinned_at: now, pinned_by_name: myName }
          : m
    ));
    setPinnedMessages(prev => {
      const filtered = prev.filter(p => p.id !== selectedPinId);
      if (filtered.some(p => p.id === newMsg.id)) return filtered;
      return [...filtered, { ...newMsg, is_pinned: true, pinned_at: now, pinned_by_name: myName }]
        .sort((a, b) => new Date(a.pinned_at || a.created_at) - new Date(b.pinned_at || b.created_at));
    });

    // Reload pinned messages from DB to ensure consistency
    console.log('[ChatThread] Reloading pinned messages from DB');
    loadPinnedMessages();
  }

  function closePinReplaceModal() {
    setPinReplaceModal(null);
  }

  async function handleUnpin(msgId) {
    if (!session?.org_id) return;
    // Optimistic update
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: false, pinned_at: null, pinned_by_name: null } : m));
    setPinnedMessages(prev => prev.filter(p => p.id !== msgId));

    const { error } = await supabase
      .from('chat_messages')
      .update({ is_pinned: false, pinned_at: null, pinned_by_name: null })
      .eq('id', msgId)
      .eq('org_id', session.org_id);
    if (error) {
      console.error('[ChatThread] unpin error:', error);
      loadPinnedMessages(); // re-sync on failure
    }
  }

  /* ─── Summarize team chat via AI ─────────────────────────────────── */
  async function summarizeChat() {
    if (!caseId || !session?.org_id || summarizing) return;
    setSummarizing(true);
    try {
      // Fetch last 50 non-deleted, non-system messages
      const { data: chatMsgs, error } = await supabase
        .from('chat_messages')
        .select('sender_name, content, created_at')
        .eq('case_id', caseId)
        .eq('org_id', session.org_id)
        .eq('is_deleted', false)
        .eq('is_system', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);
      if (!chatMsgs || chatMsgs.length === 0) {
        setSummaryCard({ text: 'No messages found to summarize.' });
        setSummaryOpen(true);
        return;
      }

      const lines = [...chatMsgs].reverse()
        .map(m => `[${m.sender_name}]: ${m.content}`)
        .join('\n');

      const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://visalens-proxy.ijecloud.workers.dev';
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token || session.access_token || '';

      const resp = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          org_id:     session.org_id,
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system:     'You are summarizing a visa case team chat. Extract: key decisions made, pending actions, who is responsible for what, any deadlines mentioned. Be concise — max 150 words. Format with short bullet points grouped under bold headings: **Decisions**, **Pending Actions**, **Deadlines**. Omit any heading that has nothing to report.',
          messages:   [{ role: 'user', content: `Summarize this team chat:\n\n${lines}` }],
        }),
      });

      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || 'API error');
      const summaryText = data.content?.map(b => b.text || '').join('') || '(no summary)';

      setSummaryCard({ text: summaryText });
      setSummaryOpen(true);

      // Persist as system message so all team members see it in the thread
      await supabase.from('chat_messages').insert({
        case_id:      caseId,
        org_id:       session.org_id,
        sender_id:    myId,
        sender_name:  myName,
        sender_color: '#6B7280',
        content:      `📋 AI Chat Summary\n\n${summaryText}`,
        tags:         [],
        attachments:  [],
        is_deleted:   false,
        is_system:    true,
        type:         'ai_summary',
      });

    } catch (e) {
      setSummaryCard({ text: `⚠️ Could not summarize: ${e.message}` });
      setSummaryOpen(true);
      console.error('[ChatThread] summarize error:', e);
    } finally {
      setSummarizing(false);
    }
  }
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
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => Math.min(prev + 1, mentionSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (mentionSuggestions[mentionIndex]) {
          selectMention(mentionSuggestions[mentionIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        setMentionQuery('');
        setMentionIndex(0);
      }
      return;
    }
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
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
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

        <button
          onClick={summarizeChat}
          disabled={summarizing}
          title={summarizing ? 'Summarizing…' : 'AI Summary — summarize this team chat'}
          style={{
            display: 'flex', alignItems: 'center', gap: summarizing ? 4 : 0,
            padding: summarizing ? '0 9px' : '0',
            width: summarizing ? 'auto' : 28,
            height: 28, borderRadius: 6, border: 'none',
            background: summarizing ? 'var(--s3)' : 'rgba(124,58,237,.1)',
            color: summarizing ? 'var(--t3)' : '#7C3AED',
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--fu)',
            cursor: summarizing ? 'default' : 'pointer', transition: 'all .15s',
            whiteSpace: 'nowrap', flexShrink: 0,
            justifyContent: 'center',
          }}
          onMouseEnter={e => { if (!summarizing) { e.currentTarget.style.background = 'rgba(124,58,237,.18)'; e.currentTarget.style.width = 'auto'; e.currentTarget.style.padding = '0 9px'; e.currentTarget.style.gap = '4px'; e.currentTarget.querySelector('.ai-lbl') && (e.currentTarget.querySelector('.ai-lbl').style.display = 'inline'); } }}
          onMouseLeave={e => { if (!summarizing) { e.currentTarget.style.background = 'rgba(124,58,237,.1)'; e.currentTarget.style.width = '28px'; e.currentTarget.style.padding = '0'; e.currentTarget.style.gap = '0'; e.currentTarget.querySelector('.ai-lbl') && (e.currentTarget.querySelector('.ai-lbl').style.display = 'none'); } }}
        >
          {summarizing
            ? <><Loader2 size={11} style={{ animation: 'spin .7s linear infinite' }}/> Summarizing…</>
            : <><Sparkles size={13}/><span className="ai-lbl" style={{ display: 'none', fontSize: 11 }}>AI Summary</span></>
          }
        </button>
      </div>

      {/* ── AI Summary card (collapsible, appears after first summary) ── */}
      {summaryCard && (
        <div style={{
          flexShrink: 0, borderBottom: '1px solid var(--bd)',
          background: 'rgba(124,58,237,.03)', overflow: 'hidden',
        }}>
          <div
            onClick={() => setSummaryOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 14px', cursor: 'pointer',
              borderBottom: summaryOpen ? '1px solid rgba(124,58,237,.1)' : 'none',
            }}
          >
            <Sparkles size={11} color="#7C3AED"/>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', fontFamily: 'var(--fu)', flex: 1 }}>
              AI Chat Summary
            </span>
            <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', marginRight: 4 }}>
              saved to thread
            </span>
            {summaryOpen
              ? <ChevronDown size={11} color="var(--t3)"/>
              : <ChevronDown size={11} color="var(--t3)" style={{ transform: 'rotate(-90deg)' }}/>
            }
          </div>
          {summaryOpen && (
            <div style={{
              padding: '10px 14px', fontSize: 12, color: 'var(--t1)',
              fontFamily: 'var(--fu)', lineHeight: 1.6,
            }}>
              {summaryCard.text.split('\n').map((line, i) => {
                if (/^\*\*(.+)\*\*$/.test(line)) {
                  return <div key={i} style={{ fontWeight: 700, color: '#7C3AED', marginTop: i > 0 ? 8 : 0, fontSize: 11 }}>{line.replace(/\*\*/g, '')}</div>;
                }
                if (line.startsWith('• ') || line.startsWith('- ')) {
                  return <div key={i} style={{ display: 'flex', gap: 5, marginTop: 3 }}><span style={{ color: '#7C3AED', flexShrink: 0 }}>•</span><span>{line.slice(2)}</span></div>;
                }
                return line ? <div key={i} style={{ marginTop: 3 }}>{line}</div> : null;
              })}
            </div>
          )}
        </div>
      )}

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

      {/* ── Pinned messages bar ── */}
      {pinnedMessages.length > 0 && (
        <div style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--bd)',
          background: 'rgba(13,148,136,.04)',
          overflow: 'hidden',
        }}>
          {/* Header row — always visible */}
          <div
            onClick={() => setPinnedBarOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 14px', cursor: 'pointer',
              borderBottom: pinnedBarOpen ? '1px solid rgba(13,148,136,.15)' : 'none',
            }}
          >
            <Pin size={11} color="#0D9488"/>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#0D9488', fontFamily: 'var(--fu)', flex: 1 }}>
              {pinnedMessages.length} pinned {pinnedMessages.length === 1 ? 'message' : 'messages'}
            </span>
            {pinnedBarOpen
              ? <ChevronDown size={11} color="#0D9488"/>
              : <ChevronDown size={11} color="#0D9488" style={{ transform: 'rotate(-90deg)' }}/>
            }
          </div>
          {/* Expandable list */}
          {pinnedBarOpen && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {pinnedMessages.map((pm, i) => {
                const palette = senderColor(pm.sender_name || '');
                return (
                  <div
                    key={pm.id}
                    onClick={() => scrollToMessage(pm.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '7px 14px',
                      borderBottom: i < pinnedMessages.length - 1 ? '1px solid rgba(13,148,136,.08)' : 'none',
                      background: 'transparent',
                      transition: 'background .1s',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(13,148,136,.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Teal accent bar */}
                    <div style={{ width: 2, alignSelf: 'stretch', borderRadius: 2, background: '#0D9488', flexShrink: 0, marginTop: 2 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: palette.color, fontFamily: 'var(--fu)' }}>
                          {pm.sender_name}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
                          {fmtTime(pm.created_at)}
                        </span>
                        {pm.pinned_by_name && (
                          <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', marginLeft: 'auto' }}>
                            pinned by {pm.pinned_by_name}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--fu)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.4,
                      }}>
                        {pm.content}
                      </div>
                    </div>
                    {/* Unpin button */}
                    <button
                      onClick={e => { e.stopPropagation(); handleUnpin(pm.id); }}
                      title="Unpin"
                      style={{
                        width: 22, height: 22, borderRadius: 5, border: 'none',
                        background: 'transparent', color: 'var(--t3)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,.1)'; e.currentTarget.style.color = '#DC2626'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)'; }}
                    >
                      <X size={10}/>
                    </button>
                  </div>
                );
              })}
            </div>
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
                onPin={() => handlePin(msg)}
                onUnpin={() => handleUnpin(msg.id)}
                isPinned={!!msg.is_pinned}
                isHighlighted={highlightedMessageId === msg.id}
                onReplyJump={reply?.id ? () => scrollToMessage(reply.id) : null}
              />
            );
          })
        )}

        {/* ── Read receipts row ── */}
        {readReceipts.length > 0 && messages.length > 0 && (() => {
          // For each reader (excluding self), find the last message they've seen
          // by comparing last_read_at to message created_at timestamps
          const others = readReceipts.filter(r => r.member_id !== myId);
          if (!others.length) return null;

          // Group readers by the last message id they've seen
          const byMsg = {};
          others.forEach(r => {
            const lastSeen = [...messages]
              .filter(m => !m.is_deleted && m.created_at <= r.last_read_at)
              .pop();
            if (!lastSeen) return;
            if (!byMsg[lastSeen.id]) byMsg[lastSeen.id] = [];
            byMsg[lastSeen.id].push(r);
          });

          return Object.entries(byMsg).map(([msgId, readers]) => (
            <div key={`rcpt-${msgId}`} style={{
              display: 'flex', justifyContent: 'flex-end', gap: 3,
              paddingRight: 36, marginTop: 2,
            }}>
              {readers.map(r => {
                const { bg, color } = senderColor(r.member_name || '');
                const initials = (r.member_name || '?')
                  .split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
                return (
                  <div
                    key={r.member_id}
                    title={`Seen by ${r.member_name}`}
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: bg, color, fontSize: 7, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${color}44`, fontFamily: 'var(--fh)',
                    }}
                  >
                    {initials}
                  </div>
                );
              })}
            </div>
          ));
        })()}

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
        position: 'relative',
      }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={handleDraftChange}
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
        {/* ── @mention popover ── */}
        {mentionOpen && mentionSuggestions.length > 0 && (
          <div
            ref={mentionPopoverRef}
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              width: 240,
              maxHeight: 200,
              overflowY: 'auto',
              background: 'var(--s1)',
              border: '1px solid var(--bd)',
              borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              zIndex: 1000,
            }}
          >
            {mentionSuggestions.map((member, idx) => (
              <div
                key={member.id}
                onClick={() => selectMention(member)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: idx === mentionIndex ? 'var(--s2)' : 'transparent',
                }}
                onMouseEnter={() => setMentionIndex(idx)}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'rgba(29,107,232,.12)',
                    border: '1.5px solid rgba(29,107,232,.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 800,
                    color: '#1D6BE8',
                  }}
                >
                  {(member.full_name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')}
                </div>
                <span style={{ fontSize: 12, color: 'var(--t1)', fontFamily: 'var(--fu)' }}>
                  {member.full_name}
                </span>
              </div>
            ))}
          </div>
        )}
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

      {/* ── Pin replacement modal ── */}
      {pinReplaceModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{
            background: 'var(--s1)', borderRadius: 12, padding: 20,
            maxWidth: 400, width: '90%', border: '1px solid var(--bd)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', margin: '0 0 12px 0' }}>
              Replace a pinned message
            </h3>
            <p style={{ fontSize: 13, color: 'var(--t3)', fontFamily: 'var(--fu)', margin: '0 0 16px 0' }}>
              You've reached the 3-pin limit. Select a pinned message to replace:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {pinReplaceModal.currentPins.map(pin => (
                <label key={pin.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                  borderRadius: 8, border: '1px solid var(--bd)', cursor: 'pointer',
                  transition: 'background 150ms',
                }} onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input
                    type="radio"
                    name="pin-replace"
                    value={pin.id}
                    onChange={() => {}}
                    onClick={() => handleReplacePin(pin.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fu)', marginBottom: 2 }}>
                      {pin.sender_name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pin.content}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <button
              onClick={closePinReplaceModal}
              style={{
                width: '100%', padding: '8px 16px', borderRadius: 8, border: 'none',
                background: 'var(--s3)', color: 'var(--t2)', fontSize: 13, fontWeight: 600,
                fontFamily: 'var(--fu)', cursor: 'pointer', transition: 'background 150ms',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bd)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--s3)'}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Task creation popover (portal) ── */}
      {taskTarget && (
        <TaskPopover
          msg={taskTarget.msg}
          caseId={caseId}
          studentName={studentName}
          orgMembers={orgMembers}
          anchorRect={taskTarget.anchorRect}
          onClose={() => setTaskTarget(null)}
          onCreated={(payload) => {
            if (payload?.optimisticSysMsg) {
              setMessages(prev => {
                if (prev.some(m => m.id === payload.optimisticSysMsg.id)) return prev;
                return [...prev, payload.optimisticSysMsg];
              });
            }
            if (payload?.replaceOptimisticId && payload?.realId) {
              setMessages(prev => prev.map(m =>
                m.id === payload.replaceOptimisticId ? { ...m, id: payload.realId, _optimistic: false } : m
              ));
            }
            setTaskTarget(null);
          }}
        />
      )}
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

  const PANEL_HEIGHT = 340; // approximate height of the popover
  const PANEL_WIDTH  = 300;

  // Position: prefer below anchor; flip above if it would go off-screen bottom
  const spaceBelow = anchorRect ? window.innerHeight - anchorRect.bottom - 8 : 999;
  const spaceAbove = anchorRect ? anchorRect.top - 8 : 999;
  const openUpward = anchorRect && spaceBelow < PANEL_HEIGHT && spaceAbove > spaceBelow;

  const rawTop = anchorRect
    ? (openUpward ? anchorRect.top - PANEL_HEIGHT - 6 : anchorRect.bottom + 6)
    : 60;
  // Clamp: never above viewport top, never below viewport bottom
  const top = Math.max(8, Math.min(rawTop, window.innerHeight - PANEL_HEIGHT - 8));

  // Right-align to anchor, but clamp so popover doesn't overflow left edge
  const rawRight = anchorRect ? Math.round(window.innerWidth - anchorRect.right) : 16;
  const right = Math.max(8, Math.min(rawRight, window.innerWidth - PANEL_WIDTH - 8));

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
      const sysContent = `Task created: "${title.trim()}"${assigneeName ? ` → assigned to ${assigneeName}` : ''}${priority !== 'medium' ? ` · ${priority}` : ''}`;
      const optimisticSysId = `sys-optimistic-${Date.now()}`;
      // Push optimistically so it renders immediately (realtime will dedup via real id)
      onCreated?.({
        optimisticSysMsg: {
          id:          optimisticSysId,
          case_id:     caseId,
          org_id:      orgId,
          sender_id:   myId,
          sender_name: myName,
          content:     sysContent,
          tags:        [],
          attachments: [],
          is_deleted:  false,
          is_system:   true,
          type:        'task_created',
          task_id:     newTask?.id || null,
          created_at:  new Date().toISOString(),
          _optimistic: true,
        },
      });
      supabase.from('chat_messages').insert({
        case_id:     caseId,
        org_id:      orgId,
        sender_id:   myId,
        sender_name: myName,
        content:     sysContent,
        tags:        [],
        attachments: [],
        is_deleted:  false,
        is_system:   true,
        type:        'task_created',
        task_id:     newTask?.id || null,
      }).select('id').single().then(({ data: sysRow, error: e }) => {
        if (e) console.warn('[ChatThread] system msg error:', e);
        // Replace optimistic row with real id so realtime dedup works
        if (sysRow?.id) {
          onCreated?.({ replaceOptimisticId: optimisticSysId, realId: sysRow.id });
        }
      });

      // Signal 2 — doc_events row so it appears in the CaseFile Timeline tab
      supabase.from('doc_events').insert({
        case_id:        caseId,
        org_id:         orgId,
        event_category: 'task',
        doc_type:       'task_created',
        source:         'task',
        changed_fields: [],
        summary:        `"${title.trim()}" · ${priority} priority${assigneeName ? ` → ${assigneeName}` : ''}`,
        title:          title.trim(),
        university_name: myName,      // reused as actor/created_by
        actor_name:     myName,
        metadata: {
          created_by_name:  myName,
          assigned_to_name: assigneeName || null,
          priority,
          due_date:         dueDate || null,
          task_id:          newTask?.id || null,
        },
        confidence:     1.0,
        created_at:     new Date().toISOString(),
      }).then(({ error: e }) => { if (e) console.warn('[ChatThread] doc_events task insert error:', e); });
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
  );
}

/* ─── Individual message row ─────────────────────────────────────────── */
function MessageRow({ msg, isMe, palette, grouped, reply, onReply, onDelete, onMakeTask, onPin, onUnpin, isPinned, isHighlighted, onReplyJump }) {
  const [hover,       setHover]       = useState(false);
  const [pinFeedback, setPinFeedback] = useState(false); // brief confirmation state
  const [copyFeedback, setCopyFeedback] = useState(false); // brief copy confirmation
  const makeTaskRef   = useRef(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (e) {
      console.error('[MessageRow] copy error:', e);
    }
  };

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
          <div
            onClick={onReplyJump}
            style={{
              padding: '4px 8px', borderRadius: '6px 6px 0 0',
              background: 'var(--s3)', borderLeft: `2px solid ${palette.color}`,
              marginBottom: 1, maxWidth: '100%',
              cursor: onReplyJump ? 'pointer' : 'default',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: palette.color, fontFamily: 'var(--fu)', marginBottom: 1 }}>
              {reply.sender_name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--fu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {reply.content?.slice(0, 60)}{reply.content?.length > 60 ? '…' : ''}
            </div>
          </div>
        )}

        {/* Bubble */}
        <div
          data-message-id={msg.id}
          style={{
            padding: '7px 11px',
            borderRadius: reply
              ? '0 8px 8px 8px'
              : grouped
                ? (isMe ? '8px 4px 4px 8px' : '4px 8px 8px 4px')
                : (isMe ? '8px 4px 8px 8px' : '4px 8px 8px 8px'),
            background: isHighlighted
              ? 'rgba(250, 204, 21, 0.3)'
              : (isMe ? 'var(--p)' : 'var(--s2)'),
            border: isMe ? 'none' : `1px solid ${isPinned ? 'rgba(13,148,136,.35)' : 'var(--bd)'}`,
            borderLeft: isPinned && !isMe ? '3px solid #0D9488' : undefined,
            color: isMe ? '#fff' : 'var(--t1)',
            fontSize: 13, fontFamily: 'var(--fu)', lineHeight: 1.5,
            wordBreak: 'break-word', whiteSpace: 'pre-wrap',
            position: 'relative',
            transition: 'background 0.3s ease',
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
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'var(--s3)', color: 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Reply size={14}/>
        </button>
        <button
          onClick={handleCopy}
          title="Copy"
          style={{
            width: copyFeedback ? 68 : 28, height: 28, borderRadius: 6, border: 'none',
            background: copyFeedback ? 'rgba(5,150,105,.15)' : 'var(--s3)',
            color: copyFeedback ? '#059669' : 'var(--t3)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            transition: 'all .15s', overflow: 'hidden', whiteSpace: 'nowrap',
            fontSize: 9, fontWeight: 700, fontFamily: 'var(--fu)',
          }}
          onMouseEnter={e => { if (!copyFeedback) { e.currentTarget.style.background = 'rgba(29,107,232,.15)'; e.currentTarget.style.color = 'var(--p)'; } }}
          onMouseLeave={e => { if (!copyFeedback) { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.color = 'var(--t3)'; } }}
        >
          {copyFeedback
            ? <><Check size={10}/> Copied</>
            : <Copy size={14}/>
          }
        </button>
        <button
          ref={makeTaskRef}
          onClick={() => {
            const rect = makeTaskRef.current?.getBoundingClientRect();
            onMakeTask?.(rect);
          }}
          title="Create task from this message"
          style={{
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'var(--s3)', color: 'var(--t3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(29,107,232,.15)'; e.currentTarget.style.color = 'var(--p)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.color = 'var(--t3)'; }}
        >
          <ClipboardList size={14}/>
        </button>
        <button
          onClick={() => {
            if (isPinned) {
              onUnpin?.();
            } else {
              onPin?.();
              setPinFeedback(true);
              setTimeout(() => setPinFeedback(false), 1800);
            }
          }}
          title={isPinned ? 'Unpin message' : 'Pin message'}
          style={{
            width: (isPinned || pinFeedback) ? 68 : 28,
            height: 28, borderRadius: 6, border: 'none',
            background: isPinned
              ? 'rgba(13,148,136,.15)'
              : pinFeedback
                ? 'rgba(13,148,136,.15)'
                : 'var(--s3)',
            color: (isPinned || pinFeedback) ? '#0D9488' : 'var(--t3)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            transition: 'all .15s', overflow: 'hidden', whiteSpace: 'nowrap',
            fontSize: 9, fontWeight: 700, fontFamily: 'var(--fu)',
          }}
          onMouseEnter={e => {
            if (isPinned) {
              e.currentTarget.style.background = 'rgba(220,38,38,.1)';
              e.currentTarget.style.color = '#DC2626';
            } else if (!pinFeedback) {
              e.currentTarget.style.background = 'rgba(13,148,136,.15)';
              e.currentTarget.style.color = '#0D9488';
            }
          }}
          onMouseLeave={e => {
            if (isPinned) {
              e.currentTarget.style.background = 'rgba(13,148,136,.15)';
              e.currentTarget.style.color = '#0D9488';
            } else if (!pinFeedback) {
              e.currentTarget.style.background = 'var(--s3)';
              e.currentTarget.style.color = 'var(--t3)';
            }
          }}
        >
          {isPinned
            ? <><PinOff size={11}/> Unpin</>
            : pinFeedback
              ? <><Check size={10}/> Pinned</>
              : <Pin size={14}/>
          }
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete"
            style={{
              width: 28, height: 28, borderRadius: 6, border: 'none',
              background: 'var(--s3)', color: 'var(--t3)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Trash2 size={14}/>
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Render message body with highlighted #tags, @mentions, and task links ── */
// Detects: #tags, @mentions, and task references like "task:", "TODO:", or
// plain quoted task titles in backticks e.g. `Submit IELTS`
const TASK_LINK_RE = /\b(task|todo|action item):\s*["']?([^"'\n]{3,60})["']?/gi;

function renderMessageContent(text, isMe) {
  // First pass: replace task link patterns with a placeholder token so we can
  // split on tags/mentions without breaking multi-word task titles.
  const taskMatches = [];
  const withTokens = text.replace(TASK_LINK_RE, (match, _keyword, title) => {
    const token = `\x00TASK${taskMatches.length}\x00`;
    taskMatches.push({ token, title: title.trim(), match });
    return token;
  });

  const parts = withTokens.split(/(#\w+|@[A-Za-z]+(?:\s[A-Za-z]+)?|\x00TASK\d+\x00)/g);

  return parts.map((part, i) => {
    // Task link token
    const taskIdx = taskMatches.findIndex(t => t.token === part);
    if (taskIdx !== -1) {
      const { title } = taskMatches[taskIdx];
      return (
        <span
          key={i}
          title={`Task reference: "${title}"`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontWeight: 700,
            color: isMe ? 'rgba(255,255,255,.95)' : '#7C3AED',
            background: isMe ? 'rgba(255,255,255,.18)' : 'rgba(124,58,237,.1)',
            borderRadius: 4, padding: '0 5px',
            fontSize: '0.95em', cursor: 'default',
            border: isMe ? '1px solid rgba(255,255,255,.2)' : '1px solid rgba(124,58,237,.2)',
          }}
        >
          <ClipboardList size={10}/>{title}
        </span>
      );
    }
    // #tag
    if (/^#\w+/.test(part))
      return <span key={i} style={{ fontWeight: 700, opacity: .85 }}>{part}</span>;
    // @mention
    if (/^@/.test(part))
      return (
        <span key={i} style={{
          fontWeight: 700,
          color: isMe ? 'rgba(255,255,255,.9)' : 'var(--p)',
          background: isMe ? 'rgba(255,255,255,.15)' : 'rgba(29,107,232,.1)',
          borderRadius: 3, padding: '0 3px',
        }}>{part}</span>
      );
    return part;
  });
}
