import React, { useState, useEffect } from 'react';
import { User, Edit2, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import { supabase, getOrgSession } from './utils/visaUtils';

/* ─── COUNSELLOR MANAGER COMPONENT ───────────────────────────────────────────── */
export default function CounsellorManager({ 
  onClose, 
  onRename,
  onMerge,
  orgSession 
}) {
  const [counsellors, setCounsellors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mergeTarget, setMergeTarget] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    loadCounsellors();
  }, []);

  async function loadCounsellors() {
    setLoading(true);
    const session = orgSession || getOrgSession();
    if (!session?.org_id) {
      setLoading(false);
      return;
    }

    try {
      // Get all cases with counsellor names
      const { data, error } = await supabase
        .from("cases")
        .select("counsellor_name, overall_score")
        .eq("org_id", session.org_id);

      if (error) throw error;

      // Aggregate by counsellor name
      const stats = {};
      (data || []).forEach(c => {
        const name = c.counsellor_name || "Unassigned";
        if (!stats[name]) {
          stats[name] = { count: 0, totalScore: 0 };
        }
        stats[name].count++;
        stats[name].totalScore += c.overall_score || 0;
      });

      // Convert to array with averages
      const counsellorList = Object.entries(stats).map(([name, data]) => ({
        name,
        count: data.count,
        avgScore: data.count > 0 ? Math.round(data.totalScore / data.count) : 0,
      })).sort((a, b) => b.count - a.count);

      setCounsellors(counsellorList);
    } catch (e) {
      console.error("Failed to load counsellors:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRename(oldName) {
    if (!renameValue.trim() || renameValue.trim() === oldName) return;
    
    setPreview({
      action: "rename",
      oldName,
      newName: renameValue.trim(),
      affectedCount: counsellors.find(c => c.name === oldName)?.count || 0,
    });
  }

  async function confirmRename() {
    if (!preview) return;
    
    setLoading(true);
    try {
      await onRename(preview.oldName, preview.newName);
      await loadCounsellors();
      setPreview(null);
      setRenamingId(null);
      setRenameValue("");
    } catch (e) {
      console.error("Rename failed:", e);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id) {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    // Clear merge target if selection changes
    setMergeTarget("");
  }

  function getMergePreview() {
    if (selectedIds.size < 2) return null;
    
    const selectedCounsellors = counsellors.filter(c => selectedIds.has(c.name));
    const totalCount = selectedCounsellors.reduce((sum, c) => sum + c.count, 0);
    const totalScore = selectedCounsellors.reduce((sum, c) => sum + c.avgScore * c.count, 0);
    const avgScore = totalCount > 0 ? Math.round(totalScore / totalCount) : 0;

    return {
      totalCount,
      avgScore,
      counsellors: selectedCounsellors.map(c => c.name),
    };
  }

  async function handleMerge() {
    if (!mergeTarget || selectedIds.size < 2) return;
    
    const preview = getMergePreview();
    if (!preview) return;

    setLoading(true);
    try {
      // Merge all selected counsellors into the target
      for (const name of preview.counsellors) {
        if (name !== mergeTarget) {
          await onMerge(name, mergeTarget);
        }
      }
      await loadCounsellors();
      setSelectedIds(new Set());
      setMergeTarget("");
    } catch (e) {
      console.error("Merge failed:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading && counsellors.length === 0) {
    return (
      <div style={{padding:40,textAlign:"center"}}>
        <Loader2 size={24} style={{animation:"spin .7s linear infinite",margin:"0 auto 12"}}/>
        <div style={{fontSize:12,color:"var(--t3)",fontFamily:"var(--fm)"}}>Loading counsellors…</div>
      </div>
    );
  }

  return (
    <div style={{width:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h2 style={{fontSize:16,fontWeight:700,color:"var(--t1)",margin:0}}>Counsellor Management</h2>
          <p style={{fontSize:12,color:"var(--t3)",margin:"4px 0 0",fontFamily:"var(--fm)"}}>
            Rename or merge counsellor names across all cases
          </p>
        </div>
        <button 
          className="btn-s" 
          onClick={onClose}
          style={{padding:"6px 12px"}}
        >
          <X size={14}/>
        </button>
      </div>

      {/* Rename Preview Modal */}
      {preview && preview.action === "rename" && (
        <div style={{
          position:"fixed",
          top:0,left:0,right:0,bottom:0,
          background:"rgba(0,0,0,0.5)",
          display:"flex",alignItems:"center",justifyContent:"center",
          zIndex:1000
        }}>
          <div style={{
            background:"var(--s1)",
            border:"1px solid var(--bd)",
            borderRadius:"var(--r3)",
            padding:20,
            maxWidth:400,
            width:"90%"
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <AlertTriangle size={20} style={{color:"var(--warn)"}}/>
              <span style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>Confirm Rename</span>
            </div>
            <p style={{fontSize:13,color:"var(--t2)",marginBottom:16,lineHeight:1.5}}>
              This will rename <strong>{preview.affectedCount} case{preview.affectedCount !== 1 ? "s" : ""}</strong> from 
              "<strong>{preview.oldName}</strong>" to "<strong>{preview.newName}</strong>".
            </p>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button 
                className="btn-s" 
                onClick={() => setPreview(null)}
                disabled={loading}
              >
                Cancel
              </button>
              <button 
                className="btn-o" 
                onClick={confirmRename}
                disabled={loading}
              >
                {loading ? <Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/> : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Section */}
      {selectedIds.size >= 2 && (
        <div style={{
          background:"rgba(29,107,232,0.08)",
          border:"1px solid rgba(29,107,232,0.25)",
          borderRadius:"var(--r2)",
          padding:12,
          marginBottom:16
        }}>
          <div style={{fontSize:12,fontWeight:600,color:"var(--p)",marginBottom:8}}>
            Merge {selectedIds.size} Counsellors
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <select
              className="notes-input"
              style={{flex:1,minWidth:200,fontSize:13}}
              value={mergeTarget}
              onChange={e => setMergeTarget(e.target.value)}
            >
              <option value="">Select target counsellor…</option>
              {Array.from(selectedIds).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button 
              className="btn-o" 
              onClick={handleMerge}
              disabled={!mergeTarget || loading}
              style={{whiteSpace:"nowrap"}}
            >
              {loading ? <Loader2 size={14} style={{animation:"spin .7s linear infinite"}}/> : "Merge"}
            </button>
            <button 
              className="btn-s" 
              onClick={() => setSelectedIds(new Set())}
            >
              Cancel
            </button>
          </div>
          {getMergePreview() && (
            <div style={{fontSize:11,color:"var(--t3)",marginTop:8,fontFamily:"var(--fm)"}}>
              Will merge {getMergePreview().totalCount} cases with avg score {getMergePreview().avgScore}/100
            </div>
          )}
        </div>
      )}

      {/* Counsellor List */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {counsellors.map(c => (
          <div 
            key={c.name}
            style={{
              display:"flex",
              alignItems:"center",
              gap:12,
              padding:12,
              background: selectedIds.has(c.name) ? "rgba(29,107,232,0.08)" : "var(--s1)",
              border: selectedIds.has(c.name) ? "1px solid rgba(29,107,232,0.25)" : "1px solid var(--bd)",
              borderRadius:"var(--r2)",
              cursor:"pointer",
              transition:"all var(--fast)"
            }}
            onClick={() => toggleSelection(c.name)}
          >
            {/* Selection Checkbox */}
            <div style={{
              width:18,height:18,
              border:"2px solid var(--bd)",
              borderRadius:4,
              display:"flex",alignItems:"center",justifyContent:"center",
              background: selectedIds.has(c.name) ? "var(--p)" : "transparent",
              color: selectedIds.has(c.name) ? "white" : "transparent",
              flexShrink:0
            }}>
              {selectedIds.has(c.name) && <Check size={12}/>}
            </div>

            {/* Avatar */}
            <div style={{
              width:36,height:36,
              borderRadius:"50%",
              background:"var(--s3)",
              border:"1px solid var(--bd)",
              display:"flex",alignItems:"center",justifyContent:"center",
              color:"var(--t2)",
              fontSize:14,fontWeight:600,
              flexShrink:0
            }}>
              {c.name.charAt(0).toUpperCase()}
            </div>

            {/* Name and Stats */}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:2}}>
                {c.name}
              </div>
              <div style={{fontSize:11,color:"var(--t3)",fontFamily:"var(--fm)"}}>
                {c.count} case{c.count !== 1 ? "s" : ""} · avg {c.avgScore}/100
              </div>
            </div>

            {/* Rename Button */}
            {renamingId === c.name ? (
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <input
                  className="notes-input"
                  style={{width:140,fontSize:13}}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleRename(c.name);
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameValue("");
                    }
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
                <button 
                  className="btn-s" 
                  onClick={e => { e.stopPropagation(); handleRename(c.name); }}
                >
                  <Check size={14}/>
                </button>
                <button 
                  className="btn-s" 
                  onClick={e => { e.stopPropagation(); setRenamingId(null); setRenameValue(""); }}
                >
                  <X size={14}/>
                </button>
              </div>
            ) : (
              <button 
                className="btn-s"
                onClick={e => {
                  e.stopPropagation();
                  setRenamingId(c.name);
                  setRenameValue(c.name);
                }}
                style={{flexShrink:0}}
              >
                <Edit2 size={14}/>
              </button>
            )}
          </div>
        ))}
      </div>

      {counsellors.length === 0 && !loading && (
        <div style={{textAlign:"center",padding:40,color:"var(--t3)",fontFamily:"var(--fm)"}}>
          No counsellors found. Save some cases to see counsellor data.
        </div>
      )}
    </div>
  );
}
