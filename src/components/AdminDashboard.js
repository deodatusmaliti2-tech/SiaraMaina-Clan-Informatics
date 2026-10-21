import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  serverTimestamp,
  query,
  orderBy 
} from 'firebase/firestore';
import { db, auth } from '../firebase.js';
import { logActivity, EVENT_TYPES, fetchRecentActivityLogs } from '../services/activityLogger.js';
import AdminActivityDashboard from './AdminActivityDashboard.js';

export default function AdminDashboard({ currentUser }) {
  const [usersList, setUsersList] = useState([]);
  const [logsList, setLogsList] = useState([]);
  const [activeTab, setActiveTab] = useState('users'); // 'users', 'analytics', 'logs'
  const [loading, setLoading] = useState(true);
  const [updatingUid, setUpdatingUid] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const MASTER_ADMIN = 'deodatusmaliti2@gmail.com';

  // Check if current user is admin
  const isAdmin = currentUser?.email === MASTER_ADMIN || currentUser?.role === 'admin';

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadAuditLogs();
    } else {
      setLoading(false);
    }
  }, [currentUser, isAdmin]);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const fetched = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      // Sort with master admin at top
      fetched.sort((a, b) => {
        if (a.email === MASTER_ADMIN) return -1;
        if (b.email === MASTER_ADMIN) return 1;
        return (a.email || '').localeCompare(b.email || '');
      });

      setUsersList(fetched);
    } catch (err) {
      console.error('Failed to load users:', err);
      setError('Failed to fetch user list from Firestore. Check your permissions.');
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const logs = await fetchRecentActivityLogs(50);
      setLogsList(logs);
    } catch (err) {
      console.error('Failed to load activity logs:', err);
    }
  };

  const handleRoleChange = async (targetUser, newRole) => {
    if (targetUser.email === MASTER_ADMIN) {
      setError('Master Admin role cannot be modified.');
      return;
    }

    setUpdatingUid(targetUser.id);
    setMessage('');
    setError('');

    try {
      const userDocRef = doc(db, 'users', targetUser.id);
      const oldRole = targetUser.role || 'viewer';

      await updateDoc(userDocRef, {
        role: newRole,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.email || 'admin'
      });

      // Update local state
      setUsersList(prev => prev.map(u => u.id === targetUser.id ? { ...u, role: newRole } : u));
      
      // Log role update to ActivityLogs
      await logActivity(
        EVENT_TYPES.ROLE_CHANGE,
        `Role changed for ${targetUser.email} from ${oldRole} to ${newRole}`,
        {
          targetUid: targetUser.id,
          targetEmail: targetUser.email,
          previousRole: oldRole,
          assignedRole: newRole
        },
        targetUser.id
      );

      setMessage(`Role for ${targetUser.email} updated to "${newRole}".`);
      loadAuditLogs(); // Refresh logs
    } catch (err) {
      console.error('Error updating user role:', err);
      setError(`Failed to update role for ${targetUser.email}.`);
    } finally {
      setUpdatingUid(null);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{
        maxWidth: '500px',
        margin: '50px auto',
        padding: '30px',
        borderRadius: '16px',
        background: '#fff',
        border: '1px solid #fecaca',
        boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔒</div>
        <h2 style={{ color: '#991b1b', margin: '0 0 10px' }}>Access Restricted</h2>
        <p style={{ color: '#64746a', fontSize: '0.9rem' }}>
          You do not have Administrator permissions to access the User Management Dashboard.
        </p>
      </div>
    );
  }

  const filteredUsers = usersList.filter(u => 
    (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="admin-dashboard-container" style={{
      maxWidth: '1000px',
      margin: '30px auto',
      padding: '24px',
      background: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #d5dfd7',
      boxShadow: '0 12px 36px rgba(4,31,20,0.08)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Dashboard Header */}
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
            ⚙️ Administrator Control Panel
          </h2>
          <p style={{ margin: '4px 0 0', color: '#64746a', fontSize: '0.85rem' }}>
            Manage user authorization roles and monitor security audit logs.
          </p>
        </div>

        {/* View Navigation Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: '800',
              fontSize: '0.85rem',
              cursor: 'pointer',
              background: activeTab === 'users' ? '#103d2b' : '#f1f5f9',
              color: activeTab === 'users' ? '#ffffff' : '#334155'
            }}
          >
            👥 User Management ({usersList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: '800',
              fontSize: '0.85rem',
              cursor: 'pointer',
              background: activeTab === 'analytics' ? '#103d2b' : '#f1f5f9',
              color: activeTab === 'analytics' ? '#ffffff' : '#334155'
            }}
          >
            📈 Activity Analytics (30d)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: '800',
              fontSize: '0.85rem',
              cursor: 'pointer',
              background: activeTab === 'logs' ? '#103d2b' : '#f1f5f9',
              color: activeTab === 'logs' ? '#ffffff' : '#334155'
            }}
          >
            📜 Activity Logs ({logsList.length})
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {message && (
        <div style={{
          padding: '12px 16px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '0.85rem',
          fontWeight: 'bold'
        }}>
          ✅ {message}
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '0.85rem',
          fontWeight: 'bold'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* TAB 1: User Role Management */}
      {activeTab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Search users by email or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '320px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem'
              }}
            />
            <button
              type="button"
              onClick={loadUsers}
              style={{
                padding: '10px 16px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontWeight: '700',
                fontSize: '0.825rem',
                cursor: 'pointer'
              }}
            >
              🔄 Refresh List
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64746a' }}>
              Loading user registry from Firestore...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64746a', background: '#f8fafc', borderRadius: '8px' }}>
              No registered users found matching your search.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#103d2b' }}>
                    <th style={{ padding: '12px 16px', fontWeight: '800' }}>User / Member</th>
                    <th style={{ padding: '12px 16px', fontWeight: '800' }}>Current Role</th>
                    <th style={{ padding: '12px 16px', fontWeight: '800' }}>Role Assignment</th>
                    <th style={{ padding: '12px 16px', fontWeight: '800' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const isMaster = u.email === MASTER_ADMIN;
                    const isSelf = u.email === currentUser?.email;
                    const userRole = isMaster ? 'admin' : (u.role || 'viewer');

                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontWeight: '700', color: '#1e293b' }}>
                            {u.displayName || u.email || 'Unknown User'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64746a' }}>{u.email}</div>
                        </td>

                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontWeight: '800',
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            background: userRole === 'admin' ? '#fef3c7' : userRole === 'editor' ? '#dbeafe' : '#f1f5f9',
                            color: userRole === 'admin' ? '#92400e' : userRole === 'editor' ? '#1e40af' : '#475569'
                          }}>
                            {isMaster ? 'Super Admin' : userRole}
                          </span>
                        </td>

                        <td style={{ padding: '14px 16px' }}>
                          {isMaster ? (
                            <span style={{ fontSize: '0.8rem', color: '#64746a', fontStyle: 'italic' }}>
                              Protected System Role
                            </span>
                          ) : (
                            <select
                              value={userRole}
                              disabled={updatingUid === u.id}
                              onChange={(e) => handleRoleChange(u, e.target.value)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                fontSize: '0.825rem',
                                fontWeight: '700',
                                cursor: 'pointer'
                              }}
                            >
                              <option value="viewer">Viewer (Read Only)</option>
                              <option value="editor">Editor (Can Add/Modify Records)</option>
                              <option value="admin">Admin (Full Control)</option>
                            </select>
                          )}
                        </td>

                        <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: '#64746a' }}>
                          {updatingUid === u.id ? (
                            <span style={{ color: '#d97706', fontWeight: 'bold' }}>Updating...</span>
                          ) : isSelf ? (
                            <span style={{ color: '#166534', fontWeight: 'bold' }}>Current User</span>
                          ) : (
                            <span style={{ color: '#16a34a' }}>Active</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Visual Activity Analytics */}
      {activeTab === 'analytics' && (
        <AdminActivityDashboard currentUser={currentUser} />
      )}

      {/* TAB 3: Activity Audit Logs */}
      {activeTab === 'logs' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#103d2b', fontWeight: '800' }}>
              Security Audit &amp; Event Logs
            </h3>
            <button
              type="button"
              onClick={loadAuditLogs}
              style={{
                padding: '8px 14px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontWeight: '700',
                fontSize: '0.825rem',
                cursor: 'pointer'
              }}
            >
              🔄 Refresh Logs
            </button>
          </div>

          {logsList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64746a', background: '#f8fafc', borderRadius: '8px' }}>
              No security audit logs recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#103d2b' }}>
                    <th style={{ padding: '10px 14px', fontWeight: '800' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px', fontWeight: '800' }}>Event</th>
                    <th style={{ padding: '10px 14px', fontWeight: '800' }}>User</th>
                    <th style={{ padding: '10px 14px', fontWeight: '800' }}>Action Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logsList.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', color: '#64746a', whiteSpace: 'nowrap' }}>
                        {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : new Date().toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: '800',
                          fontSize: '0.7rem',
                          background: log.eventType?.includes('ROLE') ? '#fef3c7' : log.eventType?.includes('AUTH') ? '#e0f2fe' : '#f1f5f9',
                          color: log.eventType?.includes('ROLE') ? '#92400e' : log.eventType?.includes('AUTH') ? '#0369a1' : '#334155'
                        }}>
                          {log.eventType}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: '700', color: '#1e293b' }}>
                        {log.actorEmail || 'System'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#334155' }}>
                        {log.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
