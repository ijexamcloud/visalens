/**
 * NotificationBell.jsx  — with diagnostic logging
 *
 * Portal-based dropdown. Bell button lives in sidebar header.
 * Panel is portalled to document.body to escape overflow:hidden.
 *
 * DIAGNOSTICS: Open browser console and look for [NotifBell] lines.
 * Remove the console.log calls once everything is confirmed working.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Bell, X, Check, CheckCheck, MessageSquare, UserCheck, AtSign, AlertCircle, ClipboardList } from 'lucide-react';
import { chatBridge } from './App';

// ── Constants ────────────────────────────────────────────────────────────────
const SESSION_KEY = 'visalens_org_session';
const PAGE_SIZE   = 40;

// ── Helpers ──────────────────────────────────────────────────────────────────
function getSupabase() {
  return window._supabaseInstance || null;
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const secs  = Math.floor(diff / 1000);
  if (secs < 60)     return 'now';
  if (secs < 3600)   return `${Math.floor(secs / 60)}m`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' });
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const PALETTE = [
  { bg: 'rgba(29,107,232,.15)',  color: '#1D6BE8' },
  { bg: 'rgba(5,150,105,.15)',   color: '#059669' },
  { bg: 'rgba(139,92,246,.15)',  color: '#7C3AED' },
  { bg: 'rgba(252,71,28,.15)',   color: '#FC471C' },
  { bg: 'rgba(245,158,11,.15)',  color: '#D97706' },
  { bg: 'rgba(236,72,153,.15)',  color: '#DB2777' },
  { bg: 'rgba(20,184,166,.15)',  color: '#0D9488' },
];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name = '') {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}
function TypeIcon({ type }) {
  const sz = 10;
  if (type === 'mention')       return <AtSign        size={sz} />;
  if (type === 'reply')         return <MessageSquare size={sz} />;
  if (type === 'reassign')      return <UserCheck     size={sz} />;
  if (type === 'task_assigned') return <ClipboardList size={sz} />;
  return <Bell size={sz} />;
}
function typeLabel(type, senderName, caseName) {
  const who    = senderName || 'Someone';
  const inCase = caseName   ? ` on ${caseName}` : '';
  if (type === 'mention')       return `${who} mentioned you${inCase}`;
  if (type === 'reply')         return `${who} replied to you${inCase}`;
  if (type === 'reassign')      return `${who} assigned a case to you`;
  if (type === 'task_assigned') return `${who} assigned you a task${inCase}`;
  return `${who} sent a notification`;
}

// ── Portal panel ─────────────────────────────────────────────────────────────
function NotificationPanel({
  anchorRect, notifications, loading, hasMore, hasUnread, diagError,
  onMarkRead, onMarkAllRead, onRowClick, onLoadMore, onClose,
}) {
  const panelRef = useRef(null);
  const top  = anchorRect ? Math.round(anchorRect.bottom + 8) : 60;
  const left = anchorRect ? Math.round(anchorRect.left)       : 16;

  useEffect(() => {
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 10);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top, left,
        width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: 480,
        borderRadius: 12, background: 'var(--s1)', border: '1px solid var(--bd)',
        boxShadow: '0 8px 40px rgba(10,20,50,.4)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 99999,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '10px 14px', borderBottom: '1px solid var(--bd)',
        flexShrink: 0, gap: 8,
      }}>
        <Bell size={13} color="var(--t2)" />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)' }}>
          Notifications
        </span>
        {hasUnread && (
          <button
            onClick={onMarkAllRead}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 5,
              border: '1px solid var(--bd)', background: 'transparent',
              color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--fu)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--s2)'; e.currentTarget.style.color = 'var(--t1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)'; }}
          >
            <CheckCheck size={10} />&nbsp;Mark all read
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: 5, border: 'none',
            background: 'transparent', color: 'var(--t3)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        ><X size={12} /></button>
      </div>

      {/* Diagnostic error strip — only shown when something is wrong */}
      {diagError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '8px 12px', background: 'rgba(239,68,68,.08)',
          borderBottom: '1px solid rgba(239,68,68,.2)', flexShrink: 0,
        }}>
          <AlertCircle size={12} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10, color: '#EF4444', fontFamily: 'var(--fu)', lineHeight: 1.5 }}>
            {diagError}
          </span>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && notifications.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--t3)', fontSize: 12, fontFamily: 'var(--fu)' }}>
            Loading…
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '44px 16px', textAlign: 'center' }}>
            <Bell size={28} color="var(--s3)" style={{ marginBottom: 10 }} />
            <div style={{ color: 'var(--t3)', fontSize: 12, fontFamily: 'var(--fu)' }}>No notifications yet</div>
            <div style={{ color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--fu)', marginTop: 4, opacity: .7 }}>
              You'll see @mentions and reassignments here
            </div>
          </div>
        ) : (
          <>
            {notifications.map(n => {
              const pal    = avatarColor(n.sender_name || '');
              const unread = !n.is_read;
              return (
                <div
                  key={n.id}
                  onClick={() => onRowClick(n)}
                  style={{
                    display: 'flex', gap: 10,
                    padding: '10px 14px 10px 20px',
                    cursor: n.case_id ? 'pointer' : 'default',
                    background: unread ? 'rgba(29,107,232,.06)' : 'transparent',
                    borderBottom: '1px solid var(--bd)',
                    transition: 'background .1s', position: 'relative',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                  onMouseLeave={e => e.currentTarget.style.background = unread ? 'rgba(29,107,232,.06)' : 'transparent'}
                >
                  {unread && (
                    <span style={{
                      position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)',
                      width: 5, height: 5, borderRadius: '50%', background: 'var(--p)',
                    }} />
                  )}
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: pal.bg, color: pal.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, fontFamily: 'var(--fh)',
                    flexShrink: 0, border: `1.5px solid ${pal.color}33`,
                  }}>
                    {initials(n.sender_name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <span style={{ color: 'var(--t3)', display: 'flex', alignItems: 'center' }}>
                        <TypeIcon type={n.type} />
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: unread ? 700 : 500,
                        color: 'var(--t1)', fontFamily: 'var(--fu)',
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {typeLabel(n.type, n.sender_name, n.case_name)}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)', flexShrink: 0 }}>
                        {relTime(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <div style={{
                        fontSize: 10, color: 'var(--t2)', fontFamily: 'var(--fu)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {n.body}
                      </div>
                    )}
                    {n.case_name && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <MessageSquare size={8} color="var(--t3)" />
                        <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>{n.case_name}</span>
                      </div>
                    )}
                  </div>
                  {unread && (
                    <button
                      onClick={e => { e.stopPropagation(); onMarkRead(n.id); }}
                      title="Mark as read"
                      style={{
                        flexShrink: 0, width: 20, height: 20, borderRadius: 5,
                        border: '1px solid var(--bd)', background: 'transparent',
                        color: 'var(--t3)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        alignSelf: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.color = 'var(--t1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)'; }}
                    ><Check size={10} /></button>
                  )}
                </div>
              );
            })}
            {hasMore && (
              <button
                onClick={onLoadMore}
                style={{
                  width: '100%', padding: '10px', background: 'transparent',
                  border: 'none', color: 'var(--t3)', fontSize: 11,
                  fontFamily: 'var(--fu)', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Load older notifications
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Main exported component ──────────────────────────────────────────────────
export default function NotificationBell({ session }) {
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [hasMore,       setHasMore]       = useState(false);
  const [page,          setPage]          = useState(0);
  const [anchorRect,    setAnchorRect]    = useState(null);
  const [diagError,     setDiagError]     = useState(null);

  const bellRef    = useRef(null);
  const supabaseRef = useRef(getSupabase());
  const retryTimerRef = useRef(null);
  // Stable ref — never changes reference, so useEffect deps don't thrash the channel
  if (!supabaseRef.current) supabaseRef.current = getSupabase();
  const supabase  = supabaseRef.current;
  const memberId  = session?.member_id;

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadNotifications = useCallback(async (fromPage = 0, append = false) => {
    if (!supabase) {
      const msg = 'window._supabaseInstance is null — supabase not ready yet';
      console.error('[NotifBell]', msg);
      setDiagError(msg);
      return;
    }
    if (!memberId) {
      const msg = `session.member_id is missing — session prop: ${JSON.stringify(session)}`;
      console.error('[NotifBell]', msg);
      setDiagError(msg);
      return;
    }

    console.log('[NotifBell] querying notifications for member_id:', memberId);
    if (fromPage === 0) setLoading(true);

    const from = fromPage * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', memberId)
      .order('created_at', { ascending: false })
      .range(from, to);

    console.log('[NotifBell] query done — rows:', data?.length ?? 'null', 'error:', error?.message ?? 'none', 'error code:', error?.code ?? 'none');

    if (error) {
      // Code 42P01 = table does not exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        const msg = 'notifications table not found — run the SQL from the handover doc in Supabase first';
        console.error('[NotifBell]', msg);
        setDiagError(msg);
      } else if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
        const msg = 'RLS auth error — setSession() may not have run before this query';
        console.error('[NotifBell]', msg);
        setDiagError(msg);
      } else {
        const msg = `Query error ${error.code}: ${error.message}`;
        console.error('[NotifBell]', msg);
        setDiagError(msg);
      }
    } else {
      setDiagError(null);
      setNotifications(prev => append ? [...prev, ...data] : data);
      setHasMore(data.length === PAGE_SIZE);
      setPage(fromPage);
      if (!append) setUnreadCount(data.filter(n => !n.is_read).length);
    }
    setLoading(false);
  // supabase intentionally excluded — it's a stable singleton ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  useEffect(() => {
    console.log('[NotifBell] mount — session:', session, 'memberId:', memberId, 'supabase ready:', !!supabase);
    if (memberId) loadNotifications(0, false);
  }, [memberId, loadNotifications]);

  // ── Real-time ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase || !memberId) return;
    // Unique channel name per mount prevents collision when component remounts
    const channelName = `notif-bell-${memberId}-${Date.now()}`;
    console.log('[NotifBell] subscribing realtime:', channelName);
    let channel = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${memberId}` },
        payload => {
          const n = payload.new;
          if (!n?.id) return;
          setNotifications(prev => [n, ...prev]);
          setUnreadCount(c => c + 1);
        }
      )
      .subscribe((status) => {
        console.log('[NotifBell] realtime channel status:', status);
        // On error, retry once after 3s with a fresh channel
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          supabase.removeChannel(channel);
          retryTimerRef.current = setTimeout(() => {
            if (!supabase || !memberId) return;
            channel = supabase
              .channel(`notif-bell-${memberId}-retry-${Date.now()}`)
              .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${memberId}` },
                payload => {
                  const n = payload.new;
                  if (!n?.id) return;
                  setNotifications(prev => [n, ...prev]);
                  setUnreadCount(c => c + 1);
                }
              )
              .subscribe((s) => console.log('[NotifBell] retry channel status:', s));
          }, 3000);
        }
      });
    return () => {
      supabase.removeChannel(channel);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  // memberId intentionally only dep — supabase is a stable singleton ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // ── Bell click ────────────────────────────────────────────────────────────
  function handleBellClick() {
    if (!open && bellRef.current) setAnchorRect(bellRef.current.getBoundingClientRect());
    setOpen(o => !o);
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function markRead(notifId) {
    if (!supabase) return;
    await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    if (!supabase || !memberId) return;
    await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', memberId).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  function handleRowClick(n) {
    if (!n.is_read) markRead(n.id);
    if (n.case_id && n.case_name) chatBridge.open(n.case_id, n.case_name);
    setOpen(false);
  }

  if (!memberId) return null;

  const hasUnread = unreadCount > 0;

  return (
    <>
      {/* Bell button — stays in sidebar header, normal DOM flow */}
      <button
        ref={bellRef}
        onClick={handleBellClick}
        title={hasUnread ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'Notifications'}
        style={{
          position: 'relative', width: 28, height: 28, borderRadius: 7,
          border: '1px solid var(--bd)',
          background: open ? 'var(--s3)' : 'transparent',
          color: hasUnread ? 'var(--p)' : (diagError ? '#EF4444' : 'var(--t3)'),
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', transition: 'background .12s, color .12s', flexShrink: 0,
        }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.background = 'var(--s2)'; e.currentTarget.style.borderColor = 'var(--bdem)'; } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--bd)'; } }}
      >
        <Bell size={14} />
        {hasUnread && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 14, height: 14, borderRadius: 7,
            background: '#EF4444', color: '#fff',
            fontSize: 9, fontWeight: 700, fontFamily: 'var(--fu)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
            border: '1.5px solid var(--s1)', pointerEvents: 'none',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {/* Orange dot when there's a config error so you know to look */}
        {diagError && !hasUnread && (
          <span style={{
            position: 'absolute', top: 3, right: 3,
            width: 6, height: 6, borderRadius: '50%',
            background: '#F97316', border: '1.5px solid var(--s1)',
            pointerEvents: 'none',
          }} />
        )}
      </button>

      {/* Panel — portalled to document.body */}
      {open && (
        <NotificationPanel
          anchorRect={anchorRect}
          notifications={notifications}
          loading={loading}
          hasMore={hasMore}
          hasUnread={hasUnread}
          diagError={diagError}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onRowClick={handleRowClick}
          onLoadMore={() => loadNotifications(page + 1, true)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
