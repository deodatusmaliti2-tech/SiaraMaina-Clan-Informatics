import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit,
  where,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../firebase.js';

export default function AdminActivityDashboard({ currentUser }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRangeDays, setTimeRangeDays] = useState(30);
  const [selectedEventTypeFilter, setSelectedEventTypeFilter] = useState('ALL');

  const MASTER_ADMIN = 'deodatusmaliti2@gmail.com';
  const isAdmin = currentUser?.email === MASTER_ADMIN || currentUser?.role === 'admin';

  useEffect(() => {
    if (isAdmin) {
      fetchLogs();
    } else {
      setLoading(false);
    }
  }, [isAdmin, timeRangeDays]);

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const logsRef = collection(db, 'ActivityLogs');
      // Fetch recent logs up to 300 records to compute analytics
      const q = query(logsRef, orderBy('timestamp', 'desc'), limit(300));
      const snapshot = await getDocs(q);

      const parsedLogs = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        let logDate = new Date();
        if (data.timestamp?.toDate) {
          logDate = data.timestamp.toDate();
        } else if (typeof data.timestamp === 'string') {
          logDate = new Date(data.timestamp);
        } else if (data.createdAt?.toDate) {
          logDate = data.createdAt.toDate();
        }

        let parsedDetails = {};
        if (typeof data.details === 'string') {
          try {
            parsedDetails = JSON.parse(data.details);
          } catch (e) {
            parsedDetails = { raw: data.details };
          }
        } else if (typeof data.details === 'object' && data.details !== null) {
          parsedDetails = data.details;
        }

        return {
          id: docSnap.id,
          ...data,
          dateObj: isNaN(logDate.getTime()) ? new Date() : logDate,
          parsedDetails
        };
      });

      setLogs(parsedLogs);
    } catch (err) {
      console.error('Failed to fetch ActivityLogs for analytics:', err);
      setError('Failed to fetch ActivityLogs from Firestore. Ensure administrative credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Compute 30-day analytics window
  const analyticsData = useMemo(() => {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - timeRangeDays * 24 * 60 * 60 * 1000);

    // Filter logs within range
    const filteredLogs = logs.filter(l => l.dateObj >= cutoffDate);

    // Generate daily buckets
    const dailyMap = {};
    for (let i = timeRangeDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const shortLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      dailyMap[key] = {
        dateKey: key,
        label: shortLabel,
        logins: 0,
        roleChanges: 0,
        dataMutations: 0,
        other: 0,
        total: 0
      };
    }

    let totalLogins = 0;
    let totalRoleChanges = 0;
    let totalDataMutations = 0;
    let uniqueActors = new Set();
    const roleTransitionMap = { admin: 0, editor: 0, viewer: 0 };
    const actorActivityMap = {};

    filteredLogs.forEach(log => {
      const dayKey = log.dateObj.toISOString().slice(0, 10);
      const evt = (log.eventType || '').toUpperCase();
      const actor = log.actorEmail || log.actorUid || 'Unknown';
      uniqueActors.add(actor);
      actorActivityMap[actor] = (actorActivityMap[actor] || 0) + 1;

      const isLogin = evt.includes('LOGIN') || evt.includes('SIGNUP') || evt.includes('AUTH');
      const isRole = evt.includes('ROLE');
      const isData = evt.includes('GENEALOGY') || evt.includes('DOC_') || evt.includes('MEMBER');

      if (isLogin) totalLogins++;
      if (isRole) {
        totalRoleChanges++;
        const assigned = (log.parsedDetails?.assignedRole || log.parsedDetails?.newRole || '').toLowerCase();
        if (assigned && roleTransitionMap[assigned] !== undefined) {
          roleTransitionMap[assigned]++;
        }
      }
      if (isData) totalDataMutations++;

      if (dailyMap[dayKey]) {
        if (isLogin) dailyMap[dayKey].logins++;
        else if (isRole) dailyMap[dayKey].roleChanges++;
        else if (isData) dailyMap[dayKey].dataMutations++;
        else dailyMap[dayKey].other++;
        dailyMap[dayKey].total++;
      }
    });

    const dailyTrends = Object.values(dailyMap);
    const maxDailyLogins = Math.max(...dailyTrends.map(d => d.logins), 5);
    const maxDailyRoles = Math.max(...dailyTrends.map(d => d.roleChanges), 3);

    // Top active actor
    let topActor = 'None';
    let topActorCount = 0;
    Object.entries(actorActivityMap).forEach(([email, count]) => {
      if (count > topActorCount) {
        topActor = email;
        topActorCount = count;
      }
    });

    return {
      totalLogsInRange: filteredLogs.length,
      totalLogins,
      totalRoleChanges,
      totalDataMutations,
      uniqueActorsCount: uniqueActors.size,
      topActor,
      topActorCount,
      roleTransitionMap,
      dailyTrends,
      maxDailyLogins,
      maxDailyRoles,
      recentRoleChanges: filteredLogs.filter(l => (l.eventType || '').includes('ROLE')).slice(0, 8),
      recentLogins: filteredLogs.filter(l => (l.eventType || '').includes('LOGIN')).slice(0, 8)
    };
  }, [logs, timeRangeDays]);

  if (!isAdmin) {
    return (
      <div style={{
        maxWidth: '520px',
        margin: '50px auto',
        padding: '32px',
        borderRadius: '16px',
        background: '#ffffff',
        border: '1px solid #fecaca',
        boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔒</div>
        <h2 style={{ color: '#991b1b', margin: '0 0 10px' }}>Administrator Clearance Required</h2>
        <p style={{ color: '#64746a', fontSize: '0.875rem', lineHeight: '1.5' }}>
          The Activity Analytics Dashboard is restricted to Clan Administrators to monitor security posture and user access trends.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-activity-dashboard" style={{
      maxWidth: '1150px',
      margin: '30px auto',
      padding: '28px',
      background: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #d5dfd7',
      boxShadow: '0 12px 36px rgba(4,31,20,0.08)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Header & Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        borderBottom: '2px solid #e2e8f0',
        paddingBottom: '20px',
        marginBottom: '24px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>📊</span>
            <h2 style={{ margin: 0, color: '#103d2b', fontSize: '1.5rem', fontWeight: '800' }}>
              Admin Activity &amp; Audit Dashboard
            </h2>
          </div>
          <p style={{ margin: '4px 0 0', color: '#64746a', fontSize: '0.85rem' }}>
            Summarized visual telemetry of authentication frequency, administrative role trends, and ledger mutations.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '0.825rem', fontWeight: '700', color: '#334155' }}>
            Timeframe:
          </label>
          <select
            value={timeRangeDays}
            onChange={(e) => setTimeRangeDays(Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontWeight: '700',
              fontSize: '0.85rem',
              background: '#ffffff',
              cursor: 'pointer'
            }}
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days (Default)</option>
            <option value={60}>Last 60 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>

          <button
            type="button"
            onClick={fetchLogs}
            style={{
              padding: '8px 14px',
              background: '#103d2b',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '800',
              fontSize: '0.825rem',
              cursor: 'pointer'
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '0.85rem',
          fontWeight: 'bold'
        }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64746a' }}>
          <div style={{ fontSize: '2rem', marginBottom: '10px' }}>⏳</div>
          Analyzing security audit events and building visual charts...
        </div>
      ) : (
        <>
          {/* Summary KPI Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '28px'
          }}>
            <div style={{
              padding: '18px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
              border: '1px solid #bbf7d0'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🔑 Total Logins ({timeRangeDays}d)
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: '900', color: '#14532d', marginTop: '6px' }}>
                {analyticsData.totalLogins}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: '4px' }}>
                Avg. {(analyticsData.totalLogins / timeRangeDays).toFixed(1)} sign-ins/day
              </div>
            </div>

            <div style={{
              padding: '18px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
              border: '1px solid #fde68a'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🛡️ Role Changes ({timeRangeDays}d)
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: '900', color: '#78350f', marginTop: '6px' }}>
                {analyticsData.totalRoleChanges}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '4px' }}>
                Privilege reassignments
              </div>
            </div>

            <div style={{
              padding: '18px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
              border: '1px solid #bae6fd'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                📝 Data Modifications
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: '900', color: '#075985', marginTop: '6px' }}>
                {analyticsData.totalDataMutations}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#0284c7', marginTop: '4px' }}>
                Genealogy &amp; profile writes
              </div>
            </div>

            <div style={{
              padding: '18px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
              border: '1px solid #e9d5ff'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                👥 Active Users
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: '900', color: '#581c87', marginTop: '6px' }}>
                {analyticsData.uniqueActorsCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#7e22ce', marginTop: '4px' }}>
                Unique authenticated actors
              </div>
            </div>
          </div>

          {/* Visual Charts Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
            gap: '24px',
            marginBottom: '32px'
          }}>
            {/* Chart 1: Login Frequency Trends (30 Days) */}
            <div style={{
              padding: '20px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#103d2b', fontWeight: '800' }}>
                    📈 Login Frequency Trend ({timeRangeDays} Days)
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64746a' }}>
                    Daily authenticated sign-in and registration distribution
                  </span>
                </div>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: '#f0fdf4',
                  color: '#166534',
                  fontSize: '0.725rem',
                  fontWeight: '800'
                }}>
                  {analyticsData.totalLogins} Total Logins
                </span>
              </div>

              {/* Interactive Bar Chart Visualization */}
              <div style={{
                height: '180px',
                display: 'flex',
                alignItems: 'flex-end',
                gap: '4px',
                padding: '10px 0',
                borderBottom: '1px solid #cbd5e1',
                overflowX: 'auto'
              }}>
                {analyticsData.dailyTrends.map((d) => {
                  const heightPercent = analyticsData.maxDailyLogins > 0 
                    ? Math.round((d.logins / analyticsData.maxDailyLogins) * 100) 
                    : 0;

                  return (
                    <div
                      key={d.dateKey}
                      title={`${d.label} (${d.dateKey}): ${d.logins} login(s)`}
                      style={{
                        flex: 1,
                        minWidth: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        height: '100%',
                        justifyContent: 'flex-end',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{
                        width: '100%',
                        maxWidth: '18px',
                        height: `${Math.max(heightPercent, d.logins > 0 ? 12 : 2)}%`,
                        background: d.logins > 0 ? 'linear-gradient(180deg, #1e754c 0%, #103d2b 100%)' : '#e2e8f0',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.3s ease'
                      }} />
                    </div>
                  );
                })}
              </div>

              {/* Chart X-Axis Labels */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '8px',
                fontSize: '0.7rem',
                color: '#64746a'
              }}>
                <span>{analyticsData.dailyTrends[0]?.label || '30 days ago'}</span>
                <span>{analyticsData.dailyTrends[Math.floor(analyticsData.dailyTrends.length / 2)]?.label || '15 days ago'}</span>
                <span>{analyticsData.dailyTrends[analyticsData.dailyTrends.length - 1]?.label || 'Today'}</span>
              </div>
            </div>

            {/* Chart 2: Role Modification & Privilege Trends (30 Days) */}
            <div style={{
              padding: '20px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#103d2b', fontWeight: '800' }}>
                    🛡️ Role Change Activity ({timeRangeDays} Days)
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64746a' }}>
                    Daily administrative role assignment operations
                  </span>
                </div>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: '#fffbeb',
                  color: '#92400e',
                  fontSize: '0.725rem',
                  fontWeight: '800'
                }}>
                  {analyticsData.totalRoleChanges} Role Updates
                </span>
              </div>

              {/* Interactive Role Bars */}
              <div style={{
                height: '180px',
                display: 'flex',
                alignItems: 'flex-end',
                gap: '4px',
                padding: '10px 0',
                borderBottom: '1px solid #cbd5e1',
                overflowX: 'auto'
              }}>
                {analyticsData.dailyTrends.map((d) => {
                  const heightPercent = analyticsData.maxDailyRoles > 0 
                    ? Math.round((d.roleChanges / analyticsData.maxDailyRoles) * 100) 
                    : 0;

                  return (
                    <div
                      key={d.dateKey}
                      title={`${d.label} (${d.dateKey}): ${d.roleChanges} role modification(s)`}
                      style={{
                        flex: 1,
                        minWidth: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        height: '100%',
                        justifyContent: 'flex-end',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{
                        width: '100%',
                        maxWidth: '18px',
                        height: `${Math.max(heightPercent, d.roleChanges > 0 ? 14 : 2)}%`,
                        background: d.roleChanges > 0 ? 'linear-gradient(180deg, #f59e0b 0%, #b45309 100%)' : '#e2e8f0',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.3s ease'
                      }} />
                    </div>
                  );
                })}
              </div>

              {/* Chart X-Axis Labels */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '8px',
                fontSize: '0.7rem',
                color: '#64746a'
              }}>
                <span>{analyticsData.dailyTrends[0]?.label || '30 days ago'}</span>
                <span>{analyticsData.dailyTrends[Math.floor(analyticsData.dailyTrends.length / 2)]?.label || '15 days ago'}</span>
                <span>{analyticsData.dailyTrends[analyticsData.dailyTrends.length - 1]?.label || 'Today'}</span>
              </div>
            </div>
          </div>

          {/* Role Breakdown Distribution & Recent Activity Feeds */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '24px'
          }}>
            {/* Role Breakdown */}
            <div style={{
              padding: '20px',
              borderRadius: '14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '1rem', color: '#103d2b', fontWeight: '800' }}>
                ⚖️ Assigned Role Distribution ({timeRangeDays}d)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '700', marginBottom: '4px' }}>
                    <span style={{ color: '#92400e' }}>Admin (Full Privileges)</span>
                    <span>{analyticsData.roleTransitionMap.admin}</span>
                  </div>
                  <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${analyticsData.totalRoleChanges > 0 ? (analyticsData.roleTransitionMap.admin / analyticsData.totalRoleChanges) * 100 : 0}%`,
                      background: '#f59e0b'
                    }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '700', marginBottom: '4px' }}>
                    <span style={{ color: '#1e40af' }}>Editor (Genealogy Contributor)</span>
                    <span>{analyticsData.roleTransitionMap.editor}</span>
                  </div>
                  <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${analyticsData.totalRoleChanges > 0 ? (analyticsData.roleTransitionMap.editor / analyticsData.totalRoleChanges) * 100 : 0}%`,
                      background: '#3b82f6'
                    }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '700', marginBottom: '4px' }}>
                    <span style={{ color: '#475569' }}>Viewer (Read-Only)</span>
                    <span>{analyticsData.roleTransitionMap.viewer}</span>
                  </div>
                  <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${analyticsData.totalRoleChanges > 0 ? (analyticsData.roleTransitionMap.viewer / analyticsData.totalRoleChanges) * 100 : 0}%`,
                      background: '#94a3b8'
                    }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Role Changes Feed */}
            <div style={{
              padding: '20px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '1rem', color: '#103d2b', fontWeight: '800' }}>
                📜 Recent Role Transitions
              </h3>
              {analyticsData.recentRoleChanges.length === 0 ? (
                <div style={{ fontSize: '0.825rem', color: '#64746a', fontStyle: 'italic', padding: '16px 0' }}>
                  No role modifications recorded in this timeframe.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {analyticsData.recentRoleChanges.map((rc) => (
                    <div
                      key={rc.id}
                      style={{
                        padding: '8px 10px',
                        background: '#f8fafc',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        borderLeft: '3px solid #f59e0b',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                        <strong>{rc.actorEmail || 'Admin'}</strong>: {rc.action}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#64746a', whiteSpace: 'nowrap' }}>
                        {rc.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
