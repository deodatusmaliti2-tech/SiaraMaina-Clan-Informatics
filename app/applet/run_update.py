import re

with open("SiaraMainaInformatics.html", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Add batchClearSelection function before window bindings
batch_clear_code = """
    function batchClearSelection() {
      var checkboxes = document.querySelectorAll(".line-member-checkbox, #selectAllLinesCheckbox");
      checkboxes.forEach(function(cb) { cb.checked = false; });
      updateSelectedCount();
      showToast("Selection cleared.", "info");
    }
    window.batchClearSelection = batchClearSelection;
"""

if "batchClearSelection" not in code:
    code = code.replace("window.batchDeleteSelectedMembers = batchDeleteSelectedMembers;", "window.batchDeleteSelectedMembers = batchDeleteSelectedMembers;\n" + batch_clear_code)

# 2. Update exportSelectedProfilesPdf to use grid layout
new_export_pdf_fn = """
    function exportSelectedProfilesPdf(selectedRecs, viewType) {
      var html = '<!DOCTYPE html><html><head><title>Export Selected Clan Members | SiaraMaina Clan</title>';
      html += '<style>';
      html += 'body { font-family: Arial, sans-serif; padding: 30px; color: #14241b; background: #f8fafc; }';
      html += '.export-header { display: flex; justify-content: space-between; align-items:center; margin-bottom: 24px; border-bottom: 2px solid #103d2b; padding-bottom: 12px; }';
      html += 'h1 { color: #103d2b; margin: 0; font-size: 1.8rem; }';
      html += '.print-btn { background: #103d2b; color: #fff; border: 0; padding: 10px 20px; font-weight: bold; border-radius: 6px; cursor: pointer; }';
      html += '.grid-container { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; page-break-inside: auto; }';
      html += '.export-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; page-break-inside: avoid; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }';
      html += '.export-card h3 { margin-top: 0; color: #103d2b; font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center; }';
      html += '.badge { background: #e2e8f0; color: #1e293b; padding: 2px 8px; border-radius: 99px; font-size: 0.7rem; font-weight: bold; }';
      html += '.meta { font-size: 0.85rem; color: #475569; margin: 6px 0; line-height: 1.5; }';
      html += '@media print { body { background: #fff; padding: 0; } .print-btn { display: none; } .export-card { border: 1px solid #94a3b8; box-shadow: none; } }';
      html += '</style></head><body>';
      html += '<div class="export-header"><div><h1>SiaraMaina Clan - Selected ' + (viewType === "card" ? "Card" : "Line") + ' Export</h1><p style="margin:4px 0 0; color:#64746b; font-weight:bold;">Total Selected Members: ' + selectedRecs.length + '</p></div>';
      html += '<button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button></div>';
      html += '<div class="grid-container">';
      selectedRecs.forEach(function(r) {
        html += '<div class="export-card">';
        html += '<h3>' + escapeHtml(fullName(r)) + ' <span class="badge">' + clanMemberNumber(r) + '</span></h3>';
        html += '<div class="meta"><strong>Branch:</strong> ' + branchLabel(r) + ' | <strong>Generation:</strong> ' + generationLabel(r) + '</div>';
        html += '<div class="meta"><strong>Status:</strong> ' + (r.deceased ? 'Deceased' : 'Living') + ' | <strong>Birth:</strong> ' + (r.dob || r.birthPeriod || 'N/A') + '</div>';
        html += '<div class="meta"><strong>Profession:</strong> ' + (r.occupation || r.employment || 'N/A') + ' | <strong>Location:</strong> ' + (r.location || 'N/A') + '</div>';
        if (r.biography) html += '<div class="meta" style="margin-top:10px; padding-top:8px; border-top:1px solid #f1f5f9;"><strong>Biography:</strong> ' + escapeHtml(r.biography) + '</div>';
        html += '</div>';
      });
      html += '</div></body></html>';
      var w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    }
"""

code = re.sub(
    r"function exportSelectedProfilesPdf\(selectedRecs, viewType\)\s*\{[\s\S]*?\n\s*\}",
    new_export_pdf_fn.strip(),
    code
)

with open("SiaraMainaInformatics.html", "w", encoding="utf-8") as f:
    f.write(code)

print("Python update script completed successfully.")
