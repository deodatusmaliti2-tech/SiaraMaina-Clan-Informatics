    try {
      const { initializeApp: initMod, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth, GoogleAuthProvider, signInWithPopup, signOut } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      const { getFirestore, doc, getDoc, setDoc, getDocs, collection, onSnapshot, deleteDoc, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

      const firebaseConfig = {
        projectId: "siaramaina-clan-informat-bf7f2",
        appId: "1:900054800353:web:acf8982723941309e264a0",
        apiKey: "AIzaSyCVqmSgm2sDGbgzbfMqfCJib6aWP7ivO54",
        authDomain: "siaramaina-clan-informat-bf7f2.firebaseapp.com",
        storageBucket: "siaramaina-clan-informat-bf7f2.firebasestorage.app",
        messagingSenderId: "900054800353"
      };

      const customDbId = "ai-studio-remixsiaramainac-af949323-b6c8-4f5f-8a13-50c8e01c0fbf";
      const apps = getApps();
      const modApp = apps.length > 0 ? apps[0] : initMod(firebaseConfig, "SiaraMainaApp");
      const modDb = getFirestore(modApp, customDbId);

      window._firebaseModular = {
        initMod, getApps, getAuth, GoogleAuthProvider, signInWithPopup, signOut,
        modApp, modDb, getFirestore, doc, getDoc, setDoc, getDocs, collection, onSnapshot
      };

      // Global Helper: Fetch ALL members accurately directly from Cloud Firestore
      window.cloudFirestoreFetchAllMembers = async function() {
        try {
          const map = new Map();
          
          // 1. Always merge from master ledger if it exists
          try {
            const masterSnap = await getDoc(doc(modDb, "siaraMainaClan", "records"));
            if (masterSnap.exists() && masterSnap.data() && Array.isArray(masterSnap.data().records)) {
              masterSnap.data().records.forEach(r => {
                const id = r.id || r.recordId;
                if (id && id !== "test-connection-check" && !r.deleted && r.active !== false) {
                  r.id = id;
                  r.recordId = r.recordId || id;
                  map.set(id, r);
                }
              });
            }
          } catch(mErr) {}

          // 2. Merge with individual member documents (overwriting master ledger if newer)
          const colSnap = await getDocs(collection(modDb, "members"));
          if (!colSnap.empty) {
            colSnap.forEach(d => {
              const dat = d.data() || {};
              const id = dat.id || d.id;
              if (id && id !== "test-connection-check") {
                if (dat.deleted || dat.active === false) {
                  map.delete(id);
                } else {
                  dat.id = id;
                  dat.recordId = dat.recordId || id;
                  map.set(id, dat);
                }
              }
            });
          }

          const resultList = Array.from(map.values());
          return resultList;
        } catch(err) {
          console.warn("[cloudFirestoreFetchAllMembers] Notice:", err);
        }
        return [];
      };

      // Real-time Cloud Firestore Live Listener on members collection (0ms lag, zero CPU/polling overhead)
      try {
        onSnapshot(collection(modDb, "members"), async () => {
          if (typeof window.cloudFirestoreFetchAllMembers === "function") {
            const updatedList = await window.cloudFirestoreFetchAllMembers();
            if (Array.isArray(updatedList)) {
              if (typeof window.records === "undefined") window.records = [];
              const cur = (typeof records !== "undefined" && Array.isArray(records)) ? records : window.records;
              const hasDiff = updatedList.length !== cur.length || (typeof hasRecordsGenuinelyChanged === "function" && hasRecordsGenuinelyChanged(cur, updatedList));
              if (hasDiff) {
                window.records = updatedList;
                if (typeof records !== "undefined") records = updatedList;
                localStorage.setItem("siara_maina_records", JSON.stringify(updatedList));
                localStorage.setItem("siaraMainaClanRecordsUpdated", JSON.stringify(updatedList));
                if (typeof rebuildRecordIndexes === "function") rebuildRecordIndexes();
                if (typeof updateMetrics === "function") updateMetrics();
                if (typeof refreshActiveClanViews === "function") {
                  refreshActiveClanViews(false);
                } else if (typeof showCatalogue === "function") {
                  showCatalogue(typeof currentFilter !== "undefined" ? currentFilter : "all");
                }
              }
            }
          }
        }, (err) => {
          console.warn("[CloudFirestoreLiveSync] Live listener notice:", err);
        });
      } catch(liveErr) {}

      // Global Helper: Save member directly to Cloud Firestore
      window.cloudFirestoreSaveMember = async function(record, allRecords) {
        try {
          if (!record || !record.id) return false;
          await setDoc(doc(modDb, "members", record.id), record, { merge: true });
          if (Array.isArray(allRecords) && allRecords.length > 0) {
            const cleanRecords = allRecords.filter(r => r && !r.deleted && r.active !== false);
            await setDoc(doc(modDb, "siaraMainaClan", "records"), {
              project: "SiaraMaina Clan Informatics",
              records: cleanRecords,
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
          console.log("✓ Member committed directly to Cloud Firestore:", record.id);
          return true;
        } catch(err) {
          console.warn("[cloudFirestoreSaveMember] Notice:", err);
          return false;
        }
      };

      // Global Helper: Bulk save members directly to Cloud Firestore so all open remote browsers receive realtime update
      window.cloudFirestoreBatchSaveMembers = async function(membersList, allRecords) {
        try {
          if (!Array.isArray(membersList) || membersList.length === 0) return false;
          if (!modDb) {
            console.error("[cloudFirestoreBatchSaveMembers] modDb is not initialized!");
            return false;
          }
          const batchSize = 400;
          for (let i = 0; i < membersList.length; i += batchSize) {
            const chunk = membersList.slice(i, i + batchSize);
            const batch = writeBatch(modDb);
            chunk.forEach(m => {
              if (m && m.id) {
                const ref = doc(modDb, "members", m.id);
                batch.set(ref, m, { merge: true });
              }
            });
            await batch.commit();
          }
          if (Array.isArray(allRecords) && allRecords.length > 0) {
            const cleanRecords = allRecords.filter(r => r && !r.deleted && r.active !== false);
            await setDoc(doc(modDb, "siaraMainaClan", "records"), {
              project: "SiaraMaina Clan Informatics",
              records: cleanRecords,
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
          console.log("✓ Bulk CSV members committed directly to Cloud Firestore:", membersList.length);
          return true;
        } catch(err) {
          console.warn("[cloudFirestoreBatchSaveMembers] Notice:", err);
          return false;
        }
      };

      // Global Helper: Delete member directly from Cloud Firestore
      window.cloudFirestoreDeleteMember = async function(id, allRecords) {
        try {
          if (!id) return false;
          if (!modDb) {
            console.error("[cloudFirestoreDeleteMember] modDb is not initialized!");
            return false;
          }
          await setDoc(doc(modDb, "members", id), {
            deleted: true,
            active: false,
            deletedAt: new Date().toISOString()
          }, { merge: true });
          if (Array.isArray(allRecords)) {
            const cleanRecords = allRecords.filter(r => r && r.id !== id && r.recordId !== id && !r.deleted && r.active !== false);
            await setDoc(doc(modDb, "siaraMainaClan", "records"), {
              project: "SiaraMaina Clan Informatics",
              records: cleanRecords,
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
          console.log("✓ Member marked deleted in Cloud Firestore:", id);
          return true;
        } catch(err) {
          console.error("[cloudFirestoreDeleteMember] Error:", err);
          return false;
        }
      };

      // Global Helper: Batch delete members directly from Cloud Firestore
      window.cloudFirestoreBatchDeleteMembers = async function(ids, allRecords) {
        try {
          if (!Array.isArray(ids) || ids.length === 0) return false;
          if (!modDb) {
            console.error("[cloudFirestoreBatchDeleteMembers] modDb is not initialized!");
            return false;
          }
          const now = new Date().toISOString();
          const promises = ids.map(id => setDoc(doc(modDb, "members", id), {
            deleted: true,
            active: false,
            deletedAt: now
          }, { merge: true }));
          await Promise.all(promises);

          if (Array.isArray(allRecords)) {
            const idsSet = new Set(ids);
            const cleanRecords = allRecords.filter(r => r && !idsSet.has(r.id) && !idsSet.has(r.recordId) && !r.deleted && r.active !== false);
            await setDoc(doc(modDb, "siaraMainaClan", "records"), {
              project: "SiaraMaina Clan Informatics",
              records: cleanRecords,
              lastUpdated: now
            }, { merge: true });
          }
          console.log("✓ Batch members marked deleted in Cloud Firestore:", ids.length);
          return true;
        } catch(err) {
          console.error("[cloudFirestoreBatchDeleteMembers] Error:", err);
          return false;
        }
      };

      // Global Helper: Fetch Recycle Bin members directly from Cloud Firestore
      window.cloudFirestoreFetchRecycleBin = async function() {
        try {
          if (!modDb) return [];
          const colSnap = await getDocs(collection(modDb, "members"));
          const bin = [];
          colSnap.forEach(d => {
            const dat = d.data() || {};
            if (dat.deleted === true || dat.active === false) {
              dat.id = dat.id || d.id;
              dat.recordId = dat.recordId || d.id;
              bin.push(dat);
            }
          });
          return bin;
        } catch(err) {
          console.warn("[cloudFirestoreFetchRecycleBin] Notice:", err);
          return [];
        }
      };

      // Global Helper: Restore member directly from Cloud Firestore Recycle Bin
      window.cloudFirestoreRestoreMember = async function(id) {
        try {
          if (!id || !modDb) return false;
          const memberSnap = await getDoc(doc(modDb, "members", id));
          if (!memberSnap.exists()) return false;
          const record = memberSnap.data() || {};
          record.deleted = false;
          record.active = true;
          record.restoredAt = new Date().toISOString();
          await setDoc(doc(modDb, "members", id), {
            deleted: false,
            active: true,
            restoredAt: record.restoredAt
          }, { merge: true });

          // Also update master ledger siaraMainaClan/records
          const masterSnap = await getDoc(doc(modDb, "siaraMainaClan", "records"));
          let currentList = [];
          if (masterSnap.exists() && masterSnap.data() && Array.isArray(masterSnap.data().records)) {
            currentList = masterSnap.data().records.filter(r => r && r.id !== id && r.recordId !== id && !r.deleted && r.active !== false);
          }
          currentList.push(record);
          await setDoc(doc(modDb, "siaraMainaClan", "records"), {
            project: "SiaraMaina Clan Informatics",
            records: currentList,
            lastUpdated: new Date().toISOString()
          }, { merge: true });
          console.log("✓ Member restored in Cloud Firestore:", id);
          return true;
        } catch(err) {
          console.error("[cloudFirestoreRestoreMember] Error:", err);
          return false;
        }
      };

      // Global Helper: Permanently purge member from Cloud Firestore
      window.cloudFirestorePermanentDeleteMember = async function(id) {
        try {
          if (!id || !modDb) return false;
          await deleteDoc(doc(modDb, "members", id));
          // Also remove from master ledger
          const masterSnap = await getDoc(doc(modDb, "siaraMainaClan", "records"));
          if (masterSnap.exists() && masterSnap.data() && Array.isArray(masterSnap.data().records)) {
            const currentList = masterSnap.data().records.filter(r => r && r.id !== id && r.recordId !== id);
            await setDoc(doc(modDb, "siaraMainaClan", "records"), {
              project: "SiaraMaina Clan Informatics",
              records: currentList,
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
          console.log("✓ Member permanently purged from Cloud Firestore:", id);
          return true;
        } catch(err) {
          console.error("[cloudFirestorePermanentDeleteMember] Error:", err);
          return false;
        }
      };

      // Global Helper: Fetch ALL users accurately directly from Cloud Firestore
      window.cloudFirestoreFetchAllUsers = async function() {
        try {
          const colSnap = await getDocs(collection(modDb, "users"));
          const list = [];
          colSnap.forEach(d => {
            const dat = d.data() || {};
            dat.uid = d.id;
            list.push(dat);
          });
          if (list.length > 0) return list;
        } catch(err) {
          console.warn("[cloudFirestoreFetchAllUsers] Notice:", err);
        }
        return [];
      };

      // Global Helper: Save user profile permanently to Cloud Firestore
      window.cloudFirestoreSaveUser = async function(userData) {
        try {
          if (!userData || !userData.uid || !modDb) return false;
          await setDoc(doc(modDb, "users", userData.uid), userData, { merge: true });
          console.log("✓ User saved to Cloud Firestore:", userData.uid);
          return true;
        } catch(err) {
          console.warn("[cloudFirestoreSaveUser] Notice:", err);
          return false;
        }
      };

      // Global Helper: Delete user profile from Cloud Firestore
      window.cloudFirestoreDeleteUser = async function(uid) {
        try {
          if (!uid || !modDb) return false;
          await deleteDoc(doc(modDb, "users", uid));
          console.log("✓ User deleted from Cloud Firestore:", uid);
          return true;
        } catch(err) {
          console.warn("[cloudFirestoreDeleteUser] Notice:", err);
          return false;
        }
      };

      // Real-time Cloud Firestore Live Listener on users collection
      try {
        onSnapshot(collection(modDb, "users"), async () => {
          if (typeof window.cloudFirestoreFetchAllUsers === "function") {
            const updatedUsers = await window.cloudFirestoreFetchAllUsers();
            localStorage.setItem("siaramaina_users", JSON.stringify(updatedUsers));
            if (typeof currentUser !== "undefined" && currentUser && currentUser.email) {
              const myCleanEmail = currentUser.email.toLowerCase().trim();
              const fu = updatedUsers.find(u => (u.email && u.email.toLowerCase().trim() === myCleanEmail) || (u.uid && u.uid === currentUser.uid));
              if (fu && fu.role) {
                currentUser.role = fu.role;
                currentUser.approved = fu.approved !== false;
                try { localStorage.setItem("siara_user_session", JSON.stringify(currentUser)); } catch(e) {}
              }
            }
            if (typeof applyRolePermissions === "function") {
              applyRolePermissions();
            }
          }
        }, (err) => {
          console.warn("[CloudFirestoreUserLiveSync] Live listener notice:", err);
        });
      } catch(liveErr) {}

      window.dispatchEvent(new CustomEvent("firebase-modular-ready", { detail: { modDb, modApp } }));
    } catch (e) {
      console.warn("Modular Firebase bridge initialization notice:", e);
    }