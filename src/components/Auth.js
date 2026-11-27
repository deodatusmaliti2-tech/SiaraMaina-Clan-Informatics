import React, { useState, useEffect } from 'react';
import { 
  loginWithEmail, 
  registerWithEmail, 
  signInWithGoogle, 
  onAuthStateChanged,
  logoutUser 
} from '../auth.js';
import ForgotPasswordComponent from './ForgotPassword.js';

export default function CentralizedAuth({ onAuthSuccess, onAuthChange }) {
  const [viewMode, setViewMode] = useState('login'); // 'login', 'signup', 'forgot_password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((user) => {
      setCurrentUser(user);
      if (onAuthChange) onAuthChange(user);
    });
    return () => unsubscribe();
  }, [onAuthChange]);

  const resetFormState = () => {
    setError('');
    setSuccessMessage('');
  };

  const handleModeSwitch = (newMode) => {
    resetFormState();
    setViewMode(newMode);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    resetFormState();

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      if (viewMode === 'login') {
        const user = await loginWithEmail(email, password);
        setSuccessMessage('Successfully signed in!');
        if (onAuthSuccess) onAuthSuccess(user);
      } else if (viewMode === 'signup') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        const user = await registerWithEmail(email, password);
        setSuccessMessage('Account created successfully!');
        if (onAuthSuccess) onAuthSuccess(user);
      }
    } catch (err) {
      console.error('Centralized Auth error:', err);
      let friendlyError = err.message || 'An authentication error occurred.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        friendlyError = 'Invalid email address or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        friendlyError = 'An account with this email address already exists. Please sign in.';
      } else if (err.code === 'auth/weak-password') {
        friendlyError = 'Password should be at least 6 characters.';
      }
      setError(friendlyError);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    resetFormState();
    setLoading(true);
    try {
      const user = await signInWithGoogle();
      if (user) {
        setSuccessMessage('Google authentication successful!');
        if (onAuthSuccess) onAuthSuccess(user);
      }
    } catch (err) {
      if (err.code === 'auth/unauthorized-domain' || (err.message && err.message.includes('unauthorized-domain'))) {
        const domain = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
        setError(`Domain Authorization Required: '${domain}' needs to be added to Authorized Domains in the Firebase Console (Authentication > Settings). Alternatively, sign in using Email & Password.`);
      } else {
        setError(err.message || 'Failed to authenticate with Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logoutUser();
      setSuccessMessage('You have been signed out.');
      setCurrentUser(null);
    } catch (err) {
      setError('Failed to sign out.');
    }
  };

  // If user is already authenticated, show logged-in state badge
  if (currentUser) {
    return (
      <div className="auth-user-badge" style={{
        maxWidth: '420px',
        margin: '30px auto',
        padding: '24px',
        borderRadius: '16px',
        background: '#ffffff',
        border: '1px solid #bbf7d0',
        boxShadow: '0 8px 24px rgba(4,31,20,0.08)',
        textAlign: 'center',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: '#103d2b',
          color: '#ffffff',
          display: 'grid',
          placeItems: 'center',
          fontWeight: '900',
          fontSize: '1.2rem',
          margin: '0 auto 12px'
        }}>
          {currentUser.photoURL ? (
            <img src={currentUser.photoURL} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
          ) : (
            (currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase()
          )}
        </div>
        <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: '#103d2b', fontWeight: '800' }}>
          {currentUser.displayName || 'Authenticated Member'}
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: '#64746a' }}>
          {currentUser.email}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            padding: '10px 20px',
            background: '#fef2f2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          Sign Out Session
        </button>
      </div>
    );
  }

  // Render Forgot Password mode
  if (viewMode === 'forgot_password') {
    return <ForgotPasswordComponent onBackToLogin={() => handleModeSwitch('login')} />;
  }

  return (
    <div className="centralized-auth-card" style={{
      maxWidth: '440px',
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
          width: '52px',
          height: '52px',
          margin: '0 auto 10px',
          borderRadius: '14px',
          background: '#103d2b',
          color: '#e9bf52',
          display: 'grid',
          placeItems: 'center',
          fontWeight: '900',
          fontSize: '1.25rem'
        }}>
          SM
        </div>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.3rem', color: '#103d2b', fontWeight: '800' }}>
          SiaraMaina Clan Informatics
        </h2>
        <p style={{ margin: 0, fontSize: '0.825rem', color: '#64746a' }}>
          Genealogical Ledger &amp; Member Portal
        </p>
      </div>

      {/* Mode Switcher Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '2px solid #e2e8f0',
        marginBottom: '20px',
        background: '#f8fafc',
        borderRadius: '8px 8px 0 0',
        padding: '4px'
      }}>
        <button
          type="button"
          onClick={() => handleModeSwitch('login')}
          style={{
            flex: 1,
            padding: '10px',
            border: 'none',
            background: 'none',
            fontWeight: '800',
            fontSize: '0.875rem',
            cursor: 'pointer',
            borderBottom: viewMode === 'login' ? '3px solid #1e754c' : '3px solid transparent',
            color: viewMode === 'login' ? '#1e754c' : '#64746a'
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch('signup')}
          style={{
            flex: 1,
            padding: '10px',
            border: 'none',
            background: 'none',
            fontWeight: '800',
            fontSize: '0.875rem',
            cursor: 'pointer',
            borderBottom: viewMode === 'signup' ? '3px solid #1e754c' : '3px solid transparent',
            color: viewMode === 'signup' ? '#1e754c' : '#64746a'
          }}
        >
          Sign Up
        </button>
      </div>

      {/* Alert Messages */}
      {error && (
        <div style={{
          padding: '12px 14px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          borderRadius: '8px',
          fontSize: '0.825rem',
          marginBottom: '16px'
        }}>
          ⚠️ {error}
        </div>
      )}

      {successMessage && (
        <div style={{
          padding: '12px 14px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
          borderRadius: '8px',
          fontSize: '0.825rem',
          marginBottom: '16px'
        }}>
          ✅ {successMessage}
        </div>
      )}

      {/* Form Body */}
      <form onSubmit={handleFormSubmit}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
            Email Address
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
              fontSize: '0.9rem'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontWeight: '700', fontSize: '0.825rem', color: '#103d2b' }}>
              Password
            </label>
            {viewMode === 'login' && (
              <button
                type="button"
                onClick={() => handleModeSwitch('forgot_password')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1e754c',
                  fontSize: '0.775rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Forgot Password?
              </button>
            )}
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              boxSizing: 'border-box',
              fontSize: '0.9rem'
            }}
          />
        </div>

        {viewMode === 'signup' && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                boxSizing: 'border-box',
                fontSize: '0.9rem'
              }}
            />
          </div>
        )}

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
            marginTop: '8px'
          }}
        >
          {loading ? 'Processing...' : (viewMode === 'login' ? 'Sign In' : 'Create Account')}
        </button>
      </form>

      {/* Google SSO Divider & Button */}
      <div style={{ display: 'flex', alignItems: 'center', margin: '22px 0 18px' }}>
        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        <span style={{ padding: '0 12px', fontSize: '0.75rem', color: '#64746a', textTransform: 'uppercase', fontWeight: 'bold' }}>
          OR
        </span>
        <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
      </div>

      <button
        type="button"
        onClick={handleGoogleAuth}
        disabled={loading}
        style={{
          width: '100%',
          padding: '11px',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '8px',
          fontWeight: '700',
          fontSize: '0.875rem',
          color: '#334155',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        Continue with Google
      </button>
    </div>
  );
}
