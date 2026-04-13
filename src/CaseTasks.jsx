/**
 * CaseTasks.jsx — Task management for a case
 * ─────────────────────────────────────────────────────────────────────────
 * Features:
 * • Create / complete / delete tasks
 * • Priority: low / medium / high / urgent
 * • Due date with overdue highlighting
 * • Assign to any org counsellor
 * • Optimistic UI updates
 * • Sorted: incomplete first (urgent→low→no priority), then complete
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Check, Trash2, ChevronDown, Loader2,
  Flag, User, Calendar, AlertCircle, ClipboardList,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/* ─── Supabase singleton ─────────────────────────────────────────────── */
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

/* ─── Priority config ────────────────────────────────────────────────── */
const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', color: '#DC2626', bg: 'rgba(220,38,38,.1)' },
  { value: 'high',   label: 'High',   color: '#FC471C', bg: 'rgba(252,71,28,.1)' },
  { value: 'medium', label: 'Medium', color: '#D97706', bg: 'rgba(217,119,6,.1)' },
  { value: 'low',    label: 'Low',    color: '#059669', bg: 'rgba(5,150,105,.1)' },
];
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, null: 4, undefined: 4 };

function priorityCfg(val) {
  return PRIORITIES.find(p => p.value === val) || { value: val, label: val || '—', color: 'var(--t3)', bg: 'var(--s3)' };
}

/* ─── Date helpers ───────────────────────────────────────────────────── */
function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const days = Math.ceil((d - now) / 86400000);
  if (days < 0)  return { label: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { label: 'Due today', urgent: true };
  if (days === 1) return { label: 'Due tomorrow', urgent: true };
  if (days <= 7)  return { label: `Due in ${days}d`, urgent: false };
  return { label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), urgent: false };
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════ */
export default function CaseTasks({ caseId, orgCounsellors = [] }) {
  const session  = getOrgSession();
  const myName   = session?.name || session?.email || 'Me';
  const myId     = session?.member_id || null;

  const [tasks,    setTasks]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [addOpen,  setAddOpen]  = useState(false);
  const [saving,   setSaving]   = useState(false);

  // New task form state
  const [newTitle,    setNewTitle]    = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDue,      setNewDue]      = useState('');
  const [newAssignee, setNewAssignee] = useState(myName);

  /* ─── Load tasks ──────────────────────────────────────────────────── */
  const loadTasks = useCallback(async () => {
    if (!caseId || !session?.org_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('case_tasks')
      .select('*')
      .eq('case_id', caseId)
      .eq('org_id', session.org_id)
      .order('created_at', { ascending: true });
    if (!error && data) setTasks(data);
    setLoading(false);
  }, [caseId, session?.org_id]);

  useEffect(() => {
    setTasks([]);
    loadTasks();
  }, [caseId, loadTasks]);

  /* ─── Create task ─────────────────────────────────────────────────── */
  async function handleCreate() {
    const title = newTitle.trim();
    if (!title || !caseId || !session?.org_id || saving) return;
    setSaving(true);

    const now = new Date().toISOString();
    const payload = {
      case_id:           caseId,
      org_id:            session.org_id,
      title:             title,
      priority:          newPriority,
      due_date:          newDue || null,
      status:            'open',
      assigned_to_id:    myId,
      assigned_to_name:  newAssignee,
      created_by_name:   myName,
      created_at:        now,
      completed_at:      null,
      completed_by_id:   null,
      completed_by_name: null,
    };

    const { data, error } = await supabase
      .from('case_tasks')
      .insert(payload)
      .select()
      .single();

    if (!error && data) {
      setTasks(prev => [...prev, data]);
      setNewTitle('');
      setNewPriority('medium');
      setNewDue('');
      setNewAssignee(myName);
      setAddOpen(false);
    } else {
      console.error('[CaseTasks] create error:', error);
    }
    setSaving(false);
  }

  /* ─── Complete task ───────────────────────────────────────────────── */
  async function handleComplete(task) {
    const now = new Date().toISOString();
    const newStatus = task.status === 'done' ? 'open' : 'done';

    // Optimistic
    setTasks(prev => prev.map(t => t.id === task.id ? {
      ...t,
      status:            newStatus,
      completed_at:      newStatus === 'done' ? now : null,
      completed_by_id:   newStatus === 'done' ? myId  : null,
      completed_by_name: newStatus === 'done' ? myName : null,
    } : t));

    const { error } = await supabase
      .from('case_tasks')
      .update({
        status:            newStatus,
        completed_at:      newStatus === 'done' ? now : null,
        completed_by_id:   newStatus === 'done' ? myId  : null,
        completed_by_name: newStatus === 'done' ? myName : null,
      })
      .eq('id', task.id)
      .eq('org_id', session.org_id);

    if (error) {
      console.error('[CaseTasks] complete error:', error);
      loadTasks(); // revert
    }
  }

  /* ─── Delete task ─────────────────────────────────────────────────── */
  async function handleDelete(taskId) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    const { error } = await supabase
      .from('case_tasks')
      .delete()
      .eq('id', taskId)
      .eq('org_id', session.org_id);
    if (error) {
      console.error('[CaseTasks] delete error:', error);
      loadTasks();
    }
  }

  /* ─── Sorted display ──────────────────────────────────────────────── */
  const sortedTasks = useMemo(() => {
    const open = tasks.filter(t => t.status !== 'done').sort((a, b) => {
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
      if (pDiff !== 0) return pDiff;
      if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    const done = tasks.filter(t => t.status === 'done').sort((a, b) =>
      new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)
    );
    return [...open, ...done];
  }, [tasks]);

  const openCount = tasks.filter(t => t.status !== 'done').length;
  const overdueCount = tasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date()).length;

  /* ─── Counsellor options for assignee dropdown ───────────────────── */
  const assigneeOptions = useMemo(() => {
    const set = new Set([myName]);
    orgCounsellors.forEach(n => { if (n && n !== 'All') set.add(n); });
    return [...set];
  }, [myName, orgCounsellors]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--s1)' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 14px', borderBottom: '1px solid var(--bd)',
        background: 'var(--s2)', flexShrink: 0,
      }}>
        <ClipboardList size={13} color="var(--p)"/>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--fh)', flex: 1 }}>
          Tasks
          {openCount > 0 && (
            <span style={{
              marginLeft: 6, fontSize: 11, fontWeight: 700,
              background: overdueCount > 0 ? 'rgba(220,38,38,.12)' : 'rgba(29,107,232,.12)',
              color: overdueCount > 0 ? '#DC2626' : '#1D6BE8',
              padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--fu)',
            }}>
              {openCount} open{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
            </span>
          )}
        </span>
        <button
          onClick={() => setAddOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 10px', borderRadius: 6, border: 'none',
            background: addOpen ? 'var(--s3)' : 'var(--p)',
            color: addOpen ? 'var(--t2)' : '#fff',
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--fu)', cursor: 'pointer',
          }}
        >
          <Plus size={12}/> Add task
        </button>
      </div>

      {/* ── Add task form ── */}
      {addOpen && (
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--bd)',
          background: 'rgba(29,107,232,.03)', flexShrink: 0,
          animation: 'sdb-fade-in .15s ease',
        }}>
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAddOpen(false); }}
            placeholder="Task title…"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 7,
              border: '1px solid var(--bd)', background: 'var(--s1)',
              color: 'var(--t1)', fontSize: 13, fontFamily: 'var(--fu)',
              outline: 'none', marginBottom: 8, boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--p)'}
            onBlur={e => e.target.style.borderColor = 'var(--bd)'}
          />

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {/* Priority selector */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                style={{
                  padding: '5px 24px 5px 8px', borderRadius: 6,
                  border: '1px solid var(--bd)', background: 'var(--s1)',
                  color: priorityCfg(newPriority).color,
                  fontSize: 11, fontFamily: 'var(--fu)', fontWeight: 700,
                  cursor: 'pointer', appearance: 'none', outline: 'none',
                  minWidth: 90,
                }}
              >
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <ChevronDown size={10} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--t3)' }}/>
            </div>

            {/* Due date */}
            <input
              type="date"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
              style={{
                padding: '5px 8px', borderRadius: 6,
                border: '1px solid var(--bd)', background: 'var(--s1)',
                color: newDue ? 'var(--t1)' : 'var(--t3)',
                fontSize: 11, fontFamily: 'var(--fu)', cursor: 'pointer', outline: 'none',
              }}
            />

            {/* Assignee */}
            {assigneeOptions.length > 1 && (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <select
                  value={newAssignee}
                  onChange={e => setNewAssignee(e.target.value)}
                  style={{
                    padding: '5px 24px 5px 8px', borderRadius: 6,
                    border: '1px solid var(--bd)', background: 'var(--s1)',
                    color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--fu)',
                    cursor: 'pointer', appearance: 'none', outline: 'none',
                    maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {assigneeOptions.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <ChevronDown size={10} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--t3)' }}/>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setAddOpen(false); setNewTitle(''); }}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6,
                border: '1px solid var(--bd)', background: 'var(--s2)',
                color: 'var(--t2)', fontSize: 12, fontWeight: 600,
                fontFamily: 'var(--fu)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim() || saving}
              style={{
                flex: 2, padding: '6px 0', borderRadius: 6,
                border: 'none',
                background: newTitle.trim() ? 'var(--p)' : 'var(--s3)',
                color: newTitle.trim() ? '#fff' : 'var(--t3)',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--fu)',
                cursor: newTitle.trim() ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}
            >
              {saving ? <Loader2 size={12} style={{ animation: 'spin .7s linear infinite' }}/> : <Plus size={12}/>}
              Add task
            </button>
          </div>
        </div>
      )}

      {/* ── Task list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
            <Loader2 size={18} color="var(--t3)" style={{ animation: 'spin .7s linear infinite' }}/>
          </div>
        ) : sortedTasks.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '40px 0', gap: 8,
          }}>
            <ClipboardList size={28} color="var(--s3)"/>
            <span style={{ fontSize: 13, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              No tasks yet
            </span>
            <button
              onClick={() => setAddOpen(true)}
              style={{
                marginTop: 4, padding: '6px 14px', borderRadius: 6,
                border: '1px dashed var(--bd)', background: 'transparent',
                color: 'var(--p)', fontSize: 12, fontFamily: 'var(--fu)',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Add the first task
            </button>
          </div>
        ) : (
          <>
            {/* Open tasks */}
            {sortedTasks.filter(t => t.status !== 'done').map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onComplete={() => handleComplete(task)}
                onDelete={() => handleDelete(task.id)}
              />
            ))}

            {/* Completed tasks */}
            {sortedTasks.filter(t => t.status === 'done').length > 0 && (
              <>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.07em', color: 'var(--t3)', fontFamily: 'var(--fu)',
                  padding: '10px 4px 4px',
                }}>
                  Completed ({sortedTasks.filter(t => t.status === 'done').length})
                </div>
                {sortedTasks.filter(t => t.status === 'done').map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onComplete={() => handleComplete(task)}
                    onDelete={() => handleDelete(task.id)}
                    done
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Task row ───────────────────────────────────────────────────────── */
function TaskRow({ task, onComplete, onDelete, done = false }) {
  const [hover, setHover] = useState(false);
  const pc  = priorityCfg(task.priority);
  const due = fmtDue(task.due_date);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '8px 6px', borderRadius: 8,
        background: hover ? 'var(--s2)' : 'transparent',
        transition: 'background var(--fast)',
        opacity: done ? .6 : 1,
      }}
    >
      {/* Checkbox */}
      <button
        onClick={onComplete}
        style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 2,
          border: done ? 'none' : `2px solid ${pc.color}`,
          background: done ? pc.color : 'transparent',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .15s',
        }}
      >
        {done && <Check size={11} color="#fff"/>}
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontFamily: 'var(--fu)', color: 'var(--t1)',
          lineHeight: 1.4, marginBottom: 3,
          textDecoration: done ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Priority pill */}
          {task.priority && (
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: 'var(--fu)',
              padding: '1px 5px', borderRadius: 3,
              background: pc.bg, color: pc.color,
              display: 'flex', alignItems: 'center', gap: 2,
            }}>
              <Flag size={8}/>{pc.label}
            </span>
          )}

          {/* Due date */}
          {due && (
            <span style={{
              fontSize: 10, fontFamily: 'var(--fu)', fontWeight: 600,
              color: due.overdue ? '#DC2626' : due.urgent ? '#D97706' : 'var(--t3)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              {due.overdue && <AlertCircle size={9} color="#DC2626"/>}
              {!due.overdue && <Calendar size={9}/>}
              {due.label}
            </span>
          )}

          {/* Assignee */}
          {task.assigned_to_name && (
            <span style={{
              fontSize: 10, fontFamily: 'var(--fu)', color: 'var(--t3)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <User size={9}/>{task.assigned_to_name}
            </span>
          )}

          {/* Completed by */}
          {done && task.completed_by_name && (
            <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--fu)' }}>
              ✓ {task.completed_by_name}
            </span>
          )}
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{
          width: 22, height: 22, borderRadius: 4,
          border: 'none', background: 'none',
          color: 'var(--t3)', cursor: 'pointer',
          opacity: hover ? .7 : 0, transition: 'opacity .15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Delete task"
      >
        <Trash2 size={12}/>
      </button>
    </div>
  );
}
