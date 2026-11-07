import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  where 
} from 'firebase/firestore';
import { db } from '../firebase.js';

export default function SecurityLogsView({ currentUser }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filtering states
  const [selectedEventType, setSelectedEventType] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [logLimit, setLogLimit] = useState(50);
  
  // Sorting states
  const [sortField, setSortField] = useState('timestamp'); // 'timestamp', 'actorEmail', 'eventType'
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc', 'desc'

  // Selected log for detailed view modal
  const [selectedLog, setSelectedLog] = useState(null);

  const MASTER_ADMIN = 'deodatusmaliti2@gmail.com';
  const isAdmin = currentUser?.email === MASTER_ADMIN || currentUser?.role === 'admin';

  useEffect(() => {
    if (isAdmin) {
      fetchSecurityLogs();
    } else {
      setLoading(false);
    }
  }, [isAdmin, logLimit]);

  const fetchSecurityLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const logsRef = collection(db, 'ActivityLogs');
      const q = query(logsRef, orderBy('timestamp', 'desc'), limit(logLimit));
      const snapshot = await getDocs(q);

      const fetchedLogs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      setLogs(fetchedLogs);
    } catch (err) {
      console.error('Failed to fetch security activity logs:', err);
      setError('Failed to load ActivityLogs from Firestore. Ensure administrative access permissions.');
    } finally {
      setLoading(false);
    }
  };

  // Filter logic
  const filteredLogs = logs.filter(log => {
    const matchesType = selectedEventType === 'ALL' || 
      (selectedEventType === 'AUTH' && (log.eventType || '').includes('AUTH')) ||
      (selectedEventType === 'ROLE' && (log.eventType || '').includes('ROLE')) ||
      (selectedEventType === 'DOC' && (log.eventType || '').includes('DOC'));

    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      (log.actorEmail || '').toLowerCase().includes(searchLower) ||
      (log.action || '').toLowerCase().includes(searchLower) ||
      (log.eventType || '').toLowerCase().includes(searchLower) ||
      (log.targetId || '').toLowerCase().includes(searchLower);

    return matchesType && matchesSearch;
  });

  // Sort logic
  const sortedLogs = [...filteredLogs].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (sortField === 'timestamp') {
      aVal = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
      bVal = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
    } else {
      aVal = (aVal || '').toString().toLowerCase();
      bVal = (bVal || '').toString().toLowerCase();
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (!isAdmin) {
    return (
      <div style={{
        maxWidth: '500px',
        margin: '50px auto',
        padding: '30px',
        borderRadius: '16px',
        background: '#ffffff',
        border: '1px solid #fecaca',
        boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔒</div>
        <h2 style={{ color: '#991b1b', margin: '0 0 10px' }}>Restricted Audit Log Access</h2>
        <p style={{ color: '#64746a', fontSize: '0.9rem' }}>
          Only Clan Administrators have security clearance to view real-time system ActivityLogs.
        </p>
      </div>
    );
  }

  return (
    <div className="security-logs-container" style={{
      maxWidth: '1100px',
      margin: '30px auto',
      padding: '24px',
      background: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #d5dfd7',
      boxShadow: '0 12px 36px rgba(4,31,20,0.08)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #e2e8f0',
        paddingBottom: '16px',
        marginBottom: '20px'
      }}>
        <div>
          <h2 style={{ margin: 0, color: '#103d2b', fontSize: '1.4rem', fontWeight: '800' }}>
            📜 Security &amp; Activity Audit Logs
          </h2>
          <p style={{ margin: '4px 0 0', color: '#64746a', fontSize: '0.85rem' }}>
            Real-time audit trail of authentication events, authorization updates, and genealogy mutations.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchSecurityLogs}
          style={{
            padding: '10px 18px',
            background: '#103d2b',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          🔄 Refresh Audit Feed
        </button>
      </div>

      {/* Filter and Control Bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        background: '#f8fafc',
        padding: '14px',
        borderRadius: '10px',
        border: '1px solid #e2e8f0'
      }}>
        {/* Search Field */}
        <input
          type="text"
          placeholder="Search by user email, action, or event type..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: '260px',
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '0.85rem'
          }}
        />

        {/* Category Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontWeight: '700', fontSize: '0.8rem', color: '#334155' }}>Category:</label>
          <select
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              fontWeight: '700',
              background: '#ffffff'
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="AUTH">Authentication Events</option>
            <option value="ROLE">Role &amp; Privilege Changes</option>
            <option value="DOC">Document Mutations</option>
          </select>
        </div>

        {/* Limit Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontWeight: '700', fontSize: '0.8rem', color: '#334155' }}>Fetch Limit:</label>
          <select
            value={logLimit}
            onChange={(e) => setLogLimit(Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              fontWeight: '700',
              background: '#ffffff'
            }}
          >
            <option value={25}>25 Records</option>
            <option value={50}>50 Records</option>
            <option value={100}>100 Records</option>
            <option value={250}>250 Records</option>
          </select>
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

      {/* Logs Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#64746a' }}>
          Loading ActivityLogs stream from Firestore...
        </div>
      ) : sortedLogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64746a', background: '#f8fafc', borderRadius: '8px' }}>
          No activity logs match your filter criteria.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', color: '#103d2b' }}>
                <th 
                  onClick={() => handleSortToggle('timestamp')}
                  style={{ padding: '12px 14px', fontWeight: '800', cursor: 'pointer', userSelect: 'none' }}
                >
                  Timestamp {sortField === 'timestamp' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th 
                  onClick={() => handleSortToggle('eventType')}
                  style={{ padding: '12px 14px', fontWeight: '800', cursor: 'pointer', userSelect: 'none' }}
                >
                  Event Type {sortField === 'eventType' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th 
                  onClick={() => handleSortToggle('actorEmail')}
                  style={{ padding: '12px 14px', fontWeight: '800', cursor: 'pointer', userSelect: 'none' }}
                >
                  Actor / User {sortField === 'actorEmail' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={{ padding: '12px 14px', fontWeight: '800' }}>Action Summary</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', textAlign: 'center' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {sortedLogs.map((log) => {
                const formattedTime = log.timestamp?.toDate 
                  ? log.timestamp.toDate().toLocaleString() 
                  : 'Just now';

                const isRoleEvent = (log.eventType || '').includes('ROLE');
                const isAuthEvent = (log.eventType || '').includes('AUTH');

                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', color: '#64746a', whiteSpace: 'nowrap' }}>
                      {formattedTime}
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <span style={{
                        padding: '3px 9px',
                        borderRadius: '12px',
                        fontWeight: '800',
                        fontSize: '0.725rem',
                        background: isRoleEvent ? '#fef3c7' : isAuthEvent ? '#e0f2fe' : '#f1f5f9',
                        color: isRoleEvent ? '#92400e' : isAuthEvent ? '#0369a1' : '#334155'
                      }}>
                        {log.eventType}
                      </span>
                    </td>

                    <td style={{ padding: '12px 14px', fontWeight: '700', color: '#1e293b' }}>
                      {log.actorEmail || log.actorUid || 'System'}
                    </td>

                    <td style={{ padding: '12px 14px', color: '#334155' }}>
                      {log.action}
                    </td>

                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        style={{
                          padding: '4px 10px',
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontWeight: '700',
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        🔍 Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* JSON Payload Inspector Modal */}
      {selectedLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '560px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            fontFamily: 'Arial, sans-serif'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#103d2b', fontSize: '1.1rem', fontWeight: '800' }}>
                🔍 Log Entry Metadata Payload
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  color: '#64746a'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '14px', fontSize: '0.85rem', color: '#334155' }}>
              <strong>Event:</strong> {selectedLog.eventType}<br />
              <strong>Actor:</strong> {selectedLog.actorEmail} ({selectedLog.actorUid})<br />
              <strong>Timestamp:</strong> {selectedLog.timestamp?.toDate ? selectedLog.timestamp.toDate().toString() : 'N/A'}
            </div>

            <pre style={{
              background: '#0f172a',
              color: '#38bdf8',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              overflowX: 'auto',
              maxHeight: '260px'
            }}>
              {JSON.stringify(selectedLog.details || {}, null, 2)}
            </pre>

            <button
              type="button"
              onClick={() => setSelectedLog(null)}
              style={{
                width: '100%',
                marginTop: '16px',
                padding: '10px',
                background: '#103d2b',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '800',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
