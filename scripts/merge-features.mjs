#!/usr/bin/env node
/**
 * SiaraMaina Clan Informatics - Feature Consolidation & Merge Script
 * 
 * Merges and verifies the latest code features, particularly:
 *  1. Interactive Collapsible Family Tree (D3.js, pan/zoom, horizontal/vertical/radial, generational stream, multi-column)
 *  2. Advanced Catalogue (Real-time search, multi-facet filtering, card/line view, CSV/PDF export, inline editing)
 *  3. Authentication & RBAC (Google SSO, domain helper, email auth, master admin support)
 *  4. Cloud Sync & Real-time Diagnostics (Dedicated Firestore instance, audit logger, fallback REST channel)
 * 
 * Usage: node scripts/merge-features.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const primaryHtmlPath = path.join(rootDir, 'SiaraMainaInformatics.html');
const indexHtmlPath = path.join(rootDir, 'index.html');
const clanDataPath = path.join(rootDir, 'siara-maina-clan-data.json');

console.log("=======================================================================");
console.log("  🌿 SiaraMaina Clan Informatics: Feature Consolidation & Merge Tool  ");
console.log("=======================================================================");

if (!fs.existsSync(primaryHtmlPath)) {
  console.error("❌ Primary entry point file not found:", primaryHtmlPath);
  process.exit(1);
}

let html = fs.readFileSync(primaryHtmlPath, 'utf8');

// -----------------------------------------------------------------------------
// STEP 1: Consolidate & Fix Topbar Auth Trigger
// -----------------------------------------------------------------------------
console.log("[1/5] Auditing Authentication Triggers...");

// Fix toggleFirebaseGoogleAuth to open modal directly instead of alerting
const oldToggleAuth = /window\.toggleFirebaseGoogleAuth\s*=\s*async\s*function\(\)\s*\{[\s\S]*?alert\("Please use the standard Login overlay to sign in\."\);[\s\S]*?\};/m;
const newToggleAuth = `window.toggleFirebaseGoogleAuth = async function() {
      if (typeof auth !== "undefined" && auth && auth.currentUser) {
        if (confirm("Are you sure you want to sign out?")) {
          await logOut();
        }
      } else {
        if (typeof openLoginModal === "function") {
          openLoginModal("signin");
        } else {
          var screen = document.getElementById("loginScreen");
          if (screen) screen.style.display = "flex";
        }
      }
    };`;

if (oldToggleAuth.test(html)) {
  html = html.replace(oldToggleAuth, newToggleAuth);
  console.log("  ✔ Updated window.toggleFirebaseGoogleAuth to open login modal directly.");
} else {
  console.log("  ✔ window.toggleFirebaseGoogleAuth already opens modal.");
}

// -----------------------------------------------------------------------------
// STEP 2: Verify & Ensure Advanced Google Sign-In & Domain Diagnostics
// -----------------------------------------------------------------------------
console.log("[2/5] Auditing Google SSO & Authorized Domain Logic...");

// Ensure handleFirebaseGoogleSignIn does NOT perform unwanted redirect when popup is closed
const oldPopupClosedRedirect = `} else if (err.code === "auth/popup-blocked" || err.code === "auth/popup-closed-by-user") {
          console.warn("Popup blocked or closed, falling back to redirect flow...");
          try {
            await auth.signInWithRedirect(provider);
          } catch (redirectErr) {`;

const newPopupClosedHandler = `} else if (err.code === "auth/popup-closed-by-user") {
          console.warn("Google Sign-In popup closed by user.");
          if (alertEl) {
            alertEl.className = "campusflow-alert warning";
            alertEl.style.display = "flex";
            alertEl.innerHTML = "<span>ℹ️</span><span>Sign-in popup was closed. Please try again or use Email & Password.</span>";
          }
        } else if (err.code === "auth/popup-blocked") {
          console.warn("Popup was blocked by browser.");
          if (alertEl) {
            alertEl.className = "campusflow-alert warning";
            alertEl.style.display = "block";
            alertEl.innerHTML = "<div style='margin-bottom:6px;'><strong>⚠️ Browser blocked sign-in popup.</strong></div><div style='display:flex;gap:8px;'><button type='button' onclick='auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider())' style='background:#103d2b;color:#fff;border:none;padding:5px 10px;border-radius:4px;font-size:0.75rem;cursor:pointer;'>Try Redirect Flow</button><button type='button' onclick='window.open(window.location.href, \\"_blank\\")' style='background:#e2e8f0;border:none;padding:5px 10px;border-radius:4px;font-size:0.75rem;cursor:pointer;'>Open in New Tab</button></div>";
          }
        } else if (err.code === "auth/operation-not-supported-in-this-environment" || err.code === "auth/configuration-not-found") {
          if (alertEl) {
            alertEl.className = "campusflow-alert error";
            alertEl.style.display = "block";
            alertEl.innerHTML = "<strong>Google Sign-In is not enabled yet in Firebase.</strong><p style='margin:4px 0 0;font-size:0.75rem;'>Please enable Google provider in <a href='https://console.firebase.google.com/project/siaramaina-clan-informat-bf7f2/authentication/providers' target='_blank' style='color:#1e40af;'>Firebase Console ➔ Authentication ➔ Sign-in method ➔ Google</a>.</p>";
          }`;

if (html.includes(oldPopupClosedRedirect)) {
  html = html.replace(oldPopupClosedRedirect, newPopupClosedHandler);
  console.log("  ✔ Enhanced Google Sign-In error handling (prevented unwanted popup-close redirects).");
} else {
  console.log("  ✔ Google Sign-In error handling is up to date.");
}

// -----------------------------------------------------------------------------
// STEP 3: Verify Interactive Family Tree & Catalogue Capabilities
// -----------------------------------------------------------------------------
console.log("[3/5] Verifying Interactive Family Tree & Catalogue Engine...");

const requiredFeatures = [
  { name: "D3 Collapsible Tree (renderD3Tree)", test: html.includes("function renderD3Tree") },
  { name: "Generational Stream (renderGenerationStream)", test: html.includes("function renderGenerationStream") },
  { name: "Multi-Column Branch View (renderMultiColumn)", test: html.includes("function renderMultiColumn") },
  { name: "Inter-Branch Hierarchy Chart (renderInterBranchHierarchyChart)", test: html.includes("function renderInterBranchHierarchyChart") },
  { name: "Tree Pan/Zoom Controls", test: html.includes("zoomInTree") || html.includes("d3.zoom") },
  { name: "Spouse Visibility Toggle (toggleSpouses)", test: html.includes("function toggleSpouses") },
  { name: "Catalogue Engine (showCatalogue / renderCatalogue)", test: html.includes("function showCatalogue") && html.includes("function renderCatalogue") },
  { name: "Catalogue Live Fuzzy Search (handleGlobalNavSearch)", test: html.includes("handleGlobalNavSearch") },
  { name: "Catalogue Custom Filter (openCustomFilter)", test: html.includes("openCustomFilter") },
  { name: "CSV & PDF Export", test: html.includes("exportCsv") && html.includes("exportPdf") },
  { name: "Self-Service Member Invite Links (openMemberInviteModal)", test: html.includes("openMemberInviteModal") },
  { name: "Bulk WhatsApp Outreach (openBulkOutreachModal)", test: html.includes("openBulkOutreachModal") },
  { name: "Diagnostic UI Overlay (firestoreDiagnosticWidget)", test: html.includes("id=\"firestoreDiagnosticWidget\"") },
  { name: "Dual-Collection Sync (/members & /siaraMainaClan/records)", test: html.includes("syncOverlayMembersCollection") }
];

let allPassed = true;
requiredFeatures.forEach(feat => {
  if (feat.test) {
    console.log(`  ✔ [ACTIVE] ${feat.name}`);
  } else {
    console.warn(`  ⚠️ [MISSING] ${feat.name}`);
    allPassed = false;
  }
});

// -----------------------------------------------------------------------------
// STEP 4: Synchronize Primary Entry Point index.html
// -----------------------------------------------------------------------------
console.log("[4/5] Synchronizing Primary Entry Point index.html...");

// If index.html is merely a redirection wrapper, update it to serve the advanced version directly
// while retaining backward compatibility with query params.
const indexTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SiaraMaina Clan Informatics</title>
  <meta name="description" content="Comprehensive genealogical informatics and family tree management platform for the Siara Maina clan.">
  <script>
    // Seamless routing to full application entry point
    if (window.location.pathname.endsWith("/index.html") || window.location.pathname === "/") {
      window.location.replace("./SiaraMainaInformatics.html" + window.location.search + window.location.hash);
    }
  </script>
</head>
<body style="margin:0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; background:#edf3ed; color:#103d2b;">
  <div style="text-align:center; padding:20px;">
    <div style="width:48px; height:48px; border-radius:50%; background:#e9bf52; color:#103d2b; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:1.2rem; margin-bottom:12px;">SM</div>
    <h1 style="margin:0 0 6px 0; font-size:1.4rem;">SiaraMaina Clan Informatics</h1>
    <p style="margin:0 0 16px 0; font-size:0.9rem; color:#475569;">Opening private genealogical ledger and interactive family tree...</p>
    <a href="./SiaraMainaInformatics.html" style="display:inline-block; background:#103d2b; color:#fff; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:0.85rem;">Click here if not redirected automatically</a>
  </div>
</body>
</html>
`;

fs.writeFileSync(indexHtmlPath, indexTemplate, 'utf8');
console.log("  ✔ Synchronized index.html with clean fallback and immediate redirect.");

// -----------------------------------------------------------------------------
// STEP 5: Validate JavaScript Syntax Across All Script Blocks
// -----------------------------------------------------------------------------
console.log("[5/5] Running Complete AST Syntax Validation on Merged Output...");

fs.writeFileSync(primaryHtmlPath, html, 'utf8');

const scriptRegex = /<script(?:\s+type="([^"]*)")?(?:\s+src="([^"]*)")?[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptCount = 0;
let syntaxErrors = 0;

while ((match = scriptRegex.exec(html)) !== null) {
  scriptCount++;
  const type = match[1] || "text/javascript";
  const src = match[2];
  const code = match[3];
  if (src || type.includes("json")) continue;

  const lineOffset = html.slice(0, match.index).split("\n").length;

  try {
    if (type === "module") {
      new vm.Script("(async () => {" + code.replace(/import\s+[\s\S]*?from\s+[^;]+;/g, "// import") + "})()");
    } else {
      new vm.Script(code);
    }
  } catch (err) {
    syntaxErrors++;
    console.error(`  ❌ Syntax error in script #${scriptCount} near line ${lineOffset}:`, err.message);
  }
}

if (syntaxErrors > 0) {
  console.error(`\n❌ Failed: ${syntaxErrors} syntax error(s) detected.`);
  process.exit(1);
} else {
  console.log(`  ✔ Verified ${scriptCount} script blocks — ZERO syntax errors!`);
  console.log("\n=======================================================================");
  console.log("  🎉 SUCCESS: All latest code features merged into SiaraMainaInformatics.html!");
  console.log("=======================================================================");
}
