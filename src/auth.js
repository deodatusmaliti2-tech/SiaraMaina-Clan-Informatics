import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  onAuthStateChanged 
} from 'firebase/auth';
import { auth } from './firebase.js';
import { logActivity, EVENT_TYPES } from './services/activityLogger.js';

// Google Auth Provider setup
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

/**
 * Sign in with Email and Password
 * @param {string} email 
 * @param {string} password 
 */
export async function loginWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    await logActivity(EVENT_TYPES.AUTH_LOGIN, `User logged in via email: ${user.email}`, { method: 'email' }, user.uid);
    return user;
  } catch (error) {
    console.error('Email sign-in error:', error);
    await logActivity(EVENT_TYPES.SECURITY_ALERT, `Failed login attempt for email: ${email}`, { error: error.message });
    throw error;
  }
}

/**
 * Register a new user with Email and Password
 * @param {string} email 
 * @param {string} password 
 */
export async function registerWithEmail(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    await logActivity(EVENT_TYPES.AUTH_SIGNUP, `New account registered: ${user.email}`, { method: 'email' }, user.uid);
    return user;
  } catch (error) {
    console.error('Email registration error:', error);
    await logActivity(EVENT_TYPES.SECURITY_ALERT, `Failed registration attempt for email: ${email}`, { error: error.message });
    throw error;
  }
}

/**
 * Sign in with Google Auth Provider
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await logActivity(EVENT_TYPES.AUTH_LOGIN, `User logged in via Google SSO: ${user.email}`, { method: 'google' }, user.uid);
    return user;
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      console.warn('Popup blocked or closed, falling back to redirect flow...');
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        console.error('Google redirect sign-in error:', redirectErr);
        throw redirectErr;
      }
    } else if (error.code === 'auth/unauthorized-domain') {
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'your app domain';
      const friendlyMsg = `Google OAuth Domain Authorization Required: The domain '${currentHost}' must be added to Authorized Domains in the Firebase Console (Authentication > Settings > Authorized domains). Alternatively, please use Email & Password Sign In.`;
      console.warn(friendlyMsg, error);
      const enhancedError = new Error(friendlyMsg);
      enhancedError.code = error.code;
      enhancedError.originalError = error;
      throw enhancedError;
    } else {
      console.error('Google sign-in error:', error);
      await logActivity(EVENT_TYPES.SECURITY_ALERT, `Failed Google SSO attempt`, { error: error.message });
      throw error;
    }
  }
}

/**
 * Sign out current user
 */
export async function logoutUser() {
  try {
    const user = auth.currentUser;
    const userEmail = user ? user.email : 'unknown';
    const userUid = user ? user.uid : '';
    await signOut(auth);
    await logActivity(EVENT_TYPES.AUTH_LOGOUT, `User logged out: ${userEmail}`, {}, userUid);
  } catch (error) {
    console.error('Sign-out error:', error);
    throw error;
  }
}

/**
 * Send Password Reset Email
 * @param {string} email 
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    await logActivity(EVENT_TYPES.AUTH_PASSWORD_RESET, `Password reset email requested for: ${email}`, { email });
  } catch (error) {
    console.error('Password reset error:', error);
    throw error;
  }
}

// Re-export standard modular Firebase authentication primitives
export {
  auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  onAuthStateChanged
};
