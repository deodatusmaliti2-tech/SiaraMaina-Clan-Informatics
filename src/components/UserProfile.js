import React, { useState, useEffect } from 'react';
import { updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase.js';
import { logActivity, EVENT_TYPES } from '../services/activityLogger.js';

export default function UserProfile({ currentUser, onProfileUpdated }) {
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const uid = currentUser?.uid;

  useEffect(() => {
    if (uid) {
      fetchUserProfile();
    } else {
      setLoading(false);
    }
  }, [uid]);

  const fetchUserProfile = async () => {
    setLoading(true);
    setError('');
    try {
      // Pre-fill from Auth profile
      if (currentUser) {
        setDisplayName(currentUser.displayName || '');
        setPhotoURL(currentUser.photoURL || '');
        setPreviewImage(currentUser.photoURL || '');
      }

      // Fetch extended details from Firestore 'users' collection
      const userDocRef = doc(db, 'users', uid);
      const docSnap = await getDoc(userDocRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.displayName) setDisplayName(data.displayName);
        if (data.phone) setPhone(data.phone);
        if (data.location) setLocation(data.location);
        if (data.bio) setBio(data.bio);
        if (data.photoURL) {
          setPhotoURL(data.photoURL);
          setPreviewImage(data.photoURL);
        }
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError('Failed to load profile details from Firestore.');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Image file size should be less than 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewImage(reader.result);
      setPhotoURL(reader.result); // Base64 data URL store
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    if (!uid) return;

    setSaving(true);
    setMessage('');
    setError('');

    try {
      // 1. Update Firebase Auth Profile
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: displayName,
          photoURL: photoURL
        });
      }

      // 2. Sync to Firestore 'users' document
      const userDocRef = doc(db, 'users', uid);
      const profileData = {
        uid: uid,
        email: currentUser.email,
        displayName: displayName,
        phone: phone,
        location: location,
        bio: bio,
        photoURL: photoURL,
        updatedAt: serverTimestamp()
      };

      await setDoc(userDocRef, profileData, { merge: true });

      // 3. Log activity to ActivityLogs
      await logActivity(
        EVENT_TYPES.GENEALOGY_UPDATE,
        `User profile updated for ${currentUser.email}`,
        { displayName, phone, location, bioLength: bio.length },
        uid
      );

      setMessage('Your profile details have been saved successfully!');
      if (onProfileUpdated) onProfileUpdated(profileData);
    } catch (err) {
      console.error('Failed to update profile:', err);
      setError('Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#64746a' }}>
        Loading member profile...
      </div>
    );
  }

  return (
    <div className="user-profile-card" style={{
      maxWidth: '650px',
      margin: '30px auto',
      padding: '32px',
      background: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #d5dfd7',
      boxShadow: '0 12px 36px rgba(4,31,20,0.08)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Profile Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        marginBottom: '24px',
        borderBottom: '2px solid #f1f5f9',
        paddingBottom: '20px'
      }}>
        {/* Avatar Display & Upload Overlay */}
        <div style={{ position: 'relative' }}>
          <div style={{
            width: '84px',
            height: '84px',
            borderRadius: '50%',
            background: '#103d2b',
            color: '#ffffff',
            display: 'grid',
            placeItems: 'center',
            fontSize: '2rem',
            fontWeight: '900',
            overflow: 'hidden',
            border: '3px solid #1e754c'
          }}>
            {previewImage ? (
              <img src={previewImage} alt="Profile Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (displayName || currentUser?.email || 'U').charAt(0).toUpperCase()
            )}
          </div>
        </div>

        <div>
          <h2 style={{ margin: 0, color: '#103d2b', fontSize: '1.4rem', fontWeight: '800' }}>
            {displayName || 'Member Profile'}
          </h2>
          <p style={{ margin: '4px 0 0', color: '#64746a', fontSize: '0.875rem' }}>
            {currentUser?.email}
          </p>
          <span style={{
            display: 'inline-block',
            marginTop: '6px',
            padding: '2px 8px',
            background: '#e0f2fe',
            color: '#0369a1',
            borderRadius: '10px',
            fontWeight: '800',
            fontSize: '0.725rem',
            textTransform: 'uppercase'
          }}>
            Registered Member
          </span>
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
          marginBottom: '20px',
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
          marginBottom: '20px',
          fontSize: '0.85rem',
          fontWeight: 'bold'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Profile Form */}
      <form onSubmit={handleProfileSave}>
        {/* Photo Upload Input */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
            Profile Photo (Upload Image)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem'
            }}
          />
          <span style={{ fontSize: '0.75rem', color: '#64746a', marginTop: '4px', display: 'block' }}>
            Select a picture from your device (PNG/JPEG under 2MB).
          </span>
        </div>

        {/* Full Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
            Full Name / Member Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Siara Maina Jr."
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

        {/* Phone & Location Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254 700 000000"
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

          <div>
            <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
              Primary Location / Residence
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Nairobi, Kenya"
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
        </div>

        {/* Clan Lineage / Biography */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: '700', fontSize: '0.825rem', color: '#103d2b', marginBottom: '6px' }}>
            Clan Biography &amp; Lineage Notes
          </label>
          <textarea
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Share details about your family lineage branch, personal history, or clan involvement..."
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              boxSizing: 'border-box',
              fontSize: '0.9rem',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={saving}
          style={{
            width: '100%',
            padding: '12px',
            background: '#103d2b',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '0.925rem',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            transition: 'all 0.2s ease'
          }}
        >
          {saving ? 'Saving Profile Changes...' : 'Save Profile Changes'}
        </button>
      </form>
    </div>
  );
}
