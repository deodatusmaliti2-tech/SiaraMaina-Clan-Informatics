import re

with open("SiaraMainaInformatics.html", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Update CSS for line-heading and line-member to include checkbox column on the right (36px)
code = code.replace(
    ".line-heading{display:grid;grid-template-columns:2.2fr 1.2fr 1.5fr 1.5fr 1.5fr 1.1fr 90px;",
    ".line-heading{display:grid;grid-template-columns:2.1fr 1.2fr 1.5fr 1.5fr 1.5fr 1.1fr 90px 36px;"
)
code = code.replace(
    ".line-member{display:grid;grid-template-columns:2.2fr 1.2fr 1.5fr 1.5fr 1.5fr 1.1fr 90px;",
    ".line-member{display:grid;grid-template-columns:2.1fr 1.2fr 1.5fr 1.5fr 1.5fr 1.1fr 90px 36px;"
)

# 2. Update lineMember function HTML to include right-side checkbox
old_line_action = """          <!-- Column 7: Action -->
          <div style="text-align:right;">
            <button type="button" class="button primary" onclick="event.stopPropagation(); openMemberDetailModal('${record.id}');" style="font-size:0.72rem; padding:6px 10px; background:var(--forest); color:#fff; border-radius:6px; font-weight:bold; cursor:pointer;">📖 Details</button>
          </div>
        </div>"""

new_line_action_and_cb = """          <!-- Column 7: Action -->
          <div style="text-align:right;">
            <button type="button" class="button primary" onclick="event.stopPropagation(); openMemberDetailModal('${record.id}');" style="font-size:0.72rem; padding:6px 10px; background:var(--forest); color:#fff; border-radius:6px; font-weight:bold; cursor:pointer;">📖 Details</button>
          </div>

          <!-- Column 8: Checkbox (Right Side) -->
          <div style="text-align:center;">
            <input type="checkbox" class="line-member-checkbox" value="${record.id}" onclick="event.stopPropagation(); updateSelectedCount();" style="width:16px; height:16px; accent-color:var(--forest); cursor:pointer;" aria-label="Select member">
          </div>
        </div>"""

code = code.replace(old_line_action, new_line_action_and_cb)

# 3. Update renderCatalogue line view to include batch toolbar and header checkbox on right
old_render_cat = """      if (viewStyle === "line" && !forceCards) {
        return '<section class="line-view">' +
          '<div class="line-heading"><span>Member & Photo</span><span>Birth Date / Era</span><span>Branch & Gen</span><span>Role / Occupation</span><span>Location</span><span>Status</span><span style="text-align:right;">Action</span></div>' +
          recordsToRender.map(function(record) {
            var spouse = showSpouseRecords && findRecord(record.spouseId);
            return lineMember(record) + (spouse ? lineMember(spouse, "spouse-line") : "");
          }).join("") + '</section>';
      }"""

new_render_cat = """      if (viewStyle === "line" && !forceCards) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; background:#edf6ef; padding:10px 16px; border-radius:8px; margin-bottom:12px; border:1px solid #c2dec9; font-size:0.8rem; font-weight:800; color:var(--forest); flex-wrap:wrap; gap:10px;">' +
          '<div style="display:flex; gap:10px; align-items:center;">' +
            '<label style="cursor:pointer; display:flex; align-items:center; gap:6px;">' +
              '<input type="checkbox" id="selectAllLinesCheckbox" onclick="toggleSelectAllLines(this)" style="width:16px; height:16px; accent-color:var(--forest);"> Select All' +
            '</label>' +
            '<span id="selectedCountLabel" style="color:var(--muted); font-weight:700;">(0 selected)</span>' +
          '</div>' +
          '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button type="button" onclick="batchViewSelectedMembers()" class="button" style="background:#fff; color:var(--forest); border:1px solid #c2dec9; padding:6px 12px; border-radius:6px; font-size:0.75rem;">📖 View Selected</button>' +
            '<button type="button" onclick="batchExportSelectedCards()" class="button" style="background:#fff; color:var(--forest); border:1px solid #c2dec9; padding:6px 12px; border-radius:6px; font-size:0.75rem;">📄 Export Cards</button>' +
            '<button type="button" onclick="batchExportSelectedLines()" class="button" style="background:#fff; color:var(--forest); border:1px solid #c2dec9; padding:6px 12px; border-radius:6px; font-size:0.75rem;">📊 Export Lines</button>' +
            '<button type="button" onclick="batchDeleteSelectedMembers()" class="button" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; padding:6px 12px; border-radius:6px; font-size:0.75rem;">🗑️ Delete Selected</button>' +
            '<button type="button" onclick="batchClearSelection()" class="button" style="background:#fff; color:#475569; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; font-size:0.75rem;">🧹 Clear All</button>' +
          '</div>' +
        '</div>' +
        '<section class="line-view">' +
          '<div class="line-heading"><span>Member & Photo</span><span>Birth Date / Era</span><span>Branch & Gen</span><span>Role / Occupation</span><span>Location</span><span>Status</span><span style="text-align:right;">Action</span><span><input type="checkbox" onclick="toggleSelectAllLines(this)" aria-label="Select all"></span></div>' +
          recordsToRender.map(function(record) {
            var spouse = showSpouseRecords && findRecord(record.spouseId);
            return lineMember(record) + (spouse ? lineMember(spouse, "spouse-line") : "");
          }).join("") + '</section>';
      }"""

code = code.replace(old_render_cat, new_render_cat)

# 4. Add batch helper functions if not already present
batch_helpers = """
    function getSelectedMemberIds() {
      var checkboxes = document.querySelectorAll(".line-member-checkbox:checked");
      var ids = [];
      checkboxes.forEach(function(cb) {
        ids.push(cb.value);
      });
      return ids;
    }

    function toggleSelectAllLines(master) {
      var checkboxes = document.querySelectorAll(".line-member-checkbox");
      checkboxes.forEach(function(cb) {
        cb.checked = master.checked;
      });
      var masterTop = document.getElementById("selectAllLinesCheckbox");
      if (masterTop) masterTop.checked = master.checked;
      updateSelectedCount();
    }

    function updateSelectedCount() {
      var count = getSelectedMemberIds().length;
      var label = document.getElementById("selectedCountLabel");
      if (label) label.textContent = "(" + count + " selected)";
    }

    function batchViewSelectedMembers() {
      var ids = getSelectedMemberIds();
      if (ids.length === 0) {
        showToast("Please select at least one member to view.", "error");
        return;
      }
      openMemberDetailModal(ids[0]);
      showToast("Opened profile for " + fullName(findRecord(ids[0])), "success");
    }

    function batchExportSelectedCards() {
      var ids = getSelectedMemberIds();
      if (ids.length === 0) {
        showToast("Please select at least one member to export cards.", "error");
        return;
      }
      var selectedRecs = records.filter(function(r) { return ids.includes(r.id); });
      exportSelectedProfilesPdf(selectedRecs, "card");
    }

    function batchExportSelectedLines() {
      var ids = getSelectedMemberIds();
      if (ids.length === 0) {
        showToast("Please select at least one member to export lines.", "error");
        return;
      }
      var selectedRecs = records.filter(function(r) { return ids.includes(r.id); });
      exportSelectedProfilesPdf(selectedRecs, "line");
    }

    function batchClearSelection() {
      var checkboxes = document.querySelectorAll(".line-member-checkbox, #selectAllLinesCheckbox");
      checkboxes.forEach(function(cb) { cb.checked = false; });
      updateSelectedCount();
      showToast("Selection cleared.", "info");
    }

    async function batchDeleteSelectedMembers() {
      var ids = getSelectedMemberIds();
      if (ids.length === 0) {
        showToast("Please select at least one member to delete.", "error");
        return;
      }
      if (!confirm("Are you sure you want to delete " + ids.length + " selected member(s)?")) return;

      records = records.filter(function(r) { return !ids.includes(r.id); });
      if (typeof saveRecords === "function") {
        await saveRecords();
      }
      showCatalogue(currentCatalogueFilter || "all");
      showToast("Successfully deleted " + ids.length + " member(s).", "success");
    }

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

    window.toggleSelectAllLines = toggleSelectAllLines;
    window.updateSelectedCount = updateSelectedCount;
    window.getSelectedMemberIds = getSelectedMemberIds;
    window.batchViewSelectedMembers = batchViewSelectedMembers;
    window.batchExportSelectedCards = batchExportSelectedCards;
    window.batchExportSelectedLines = batchExportSelectedLines;
    window.batchDeleteSelectedMembers = batchDeleteSelectedMembers;
    window.batchClearSelection = batchClearSelection;
    window.exportSelectedProfilesPdf = exportSelectedProfilesPdf;
"""

if "getSelectedMemberIds" not in code:
    code = code.replace("window.addEventListener(\"DOMContentLoaded\"", batch_helpers + "\n    window.addEventListener(\"DOMContentLoaded\"")

with open("SiaraMainaInformatics.html", "w", encoding="utf-8") as f:
    f.write(code)

print("Applied checkboxes and batch action functions successfully.")
