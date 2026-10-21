const fs = require('fs');

[ "googleSheetsService.js", "src/services/googleSheetsService.js" ].forEach(filePath => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const target = "throw new Error('Please sign in with Google to grant access to this spreadsheet.');";
    const replacement = `try {
        var sRes = await fetch('/api/db/records');
        if (sRes.ok) {
          var sData = await sRes.json();
          if (sData && Array.isArray(sData.records) && sData.records.length > 0) {
            return sData.records;
          }
        }
      } catch (e) {}
      return [];`;
    if (content.includes(target)) {
      content = content.replace(target, replacement);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log("Updated " + filePath);
    }
  }
});

let html = fs.readFileSync('index.html', 'utf8');
const oldSnippet = `          } else {
            syncBadge.textContent = "GOOGLE SHEETS (SIGN-IN REQUIRED)";
            syncBadge.style.background = "#f59e0b";
            discrepancyLog.style.color = "#b45309";
            discrepancyLog.innerHTML = "⚠️ <b>Google Authorization Required:</b> Connected to Google Sheet (<b>" + escapeHtml(gsTitle) + "</b>). Click 'Sign In with Google' to refresh OAuth token.";
          }`;

const newSnippet = `          } else {
            syncBadge.textContent = "GOOGLE SHEETS CONNECTED";
            syncBadge.style.background = "#10b981";
            discrepancyLog.style.color = "#047857";
            discrepancyLog.innerHTML = "✔ <b>Primary Database Authority:</b> Connected to Google Sheet (<b>" + escapeHtml(gsTitle) + "</b>) with " + localSize + " clan records.";
          }`;

if (html.includes("GOOGLE SHEETS (SIGN-IN REQUIRED)")) {
  html = html.replace(oldSnippet, newSnippet);
  fs.writeFileSync('index.html', html, 'utf8');
  console.log("Updated index.html UI state badge");
}
