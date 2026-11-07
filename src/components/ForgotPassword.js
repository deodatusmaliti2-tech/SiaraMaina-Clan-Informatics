import React, { useState } from 'react';
import { resetPassword } from '../auth.js';

export default function ForgotPasswordComponent({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email);
      setMessage(`A password reset link has been sent to ${email}. Please check your inbox and spam folder.`);
    } catch (err) {
      console.error('Password reset error:', err);
      let friendlyError = 'Failed to send password reset email.';
      if (err.code === 'auth/user-not-found') {
        friendlyError = 'No user account found with this email address.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyError = 'Please enter a valid email address.';
      } else if (err.code === 'auth/too-many-requests') {
        friendlyError = 'Too many requests. Please wait a few minutes before trying again.';
      }
      setError(friendlyError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-card" style={{
      maxWidth: '420px',
      margin: '40px auto',
      padding: '32px',
      borderRadius: '16px',
      background: '#ffffff',
      boxShadow: '0 12px 36px rgba(4,31,20,0.12)',
      border: '1px solid #d5dfd7',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          margin: '0 auto 12px',
          borderRadius: '12px',
          background: '#103d2b',
          color: '#e9bf52',
          display: 'grid',
          placeItems: 'center',
          fontWeight: '900',
          fontSize: '1.25rem'
        }}>
          🔑
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.3rem', color: '#103d2b', fontWeight: '800' }}>
          Reset Your Password
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64746a', lineHeight: '1.4' }}>
          Enter your registered email address and we'll send you instructions to reset your password.
        </p>
      </div>

      {error && (
        <div style={{
          padding: '12px 14px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          borderRadius: '8px',
          fontSize: '0.825rem',
          marginBottom: '18px',
          lineHeight: '1.4'
        }}>
          ⚠️ {error}
        </div>
      )}

      {message && (
        <div style={{
          padding: '12px 14px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
          borderRadius: '8px',
          fontSize: '0.825rem',
          marginBottom: '18px',
          lineHeight: '1.4'
        }}>
          ✅ {message}
        </div>
      )}

      <form onSubmit={handleResetSubmit}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
            Registered Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="member@siaramaina.org"
            required
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              boxSizing: 'border-box',
              fontSize: '0.9rem',
              outline: 'none'
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            background: '#1e754c',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '0.925rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            marginBottom: '16px',
            transition: 'all 0.2s ease'
          }}
        >
          {loading ? 'Sending Reset Link...' : 'Send Password Reset Link'}
        </button>

        {onBackToLogin && (
          <button
            type="button"
            onClick={onBackToLogin}
            style={{
              width: '100%',
              padding: '10px',
              background: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            ← Back to Sign In
          </button>
        )}
      </form>
    </div>
  );
}
