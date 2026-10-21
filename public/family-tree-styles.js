/**
 * SiaraMaina Clan Platform - 6 Distinct Classical Family Tree Styles
 * ------------------------------------------------------------------------
 * All remaining 5 family tree styles now strictly follow the exact same card
 * contents and interactive collapsible system as Style 1 (Interactive Collapsible
 * Classical Tree - Original):
 *
 * 1. classical-collapsible: Interactive Collapsible Classical Tree (Original in index.html)
 * 2. classical-rounded:     Rounded-Node Classical Tree (Smooth curved pill nodes)
 * 3. classical-square:      Square/Rectangular-Node Classical Tree (Crisp cards & orthogonal elbows)
 * 4. classical-compact:     Compact Classical Tree (High-density multi-generation overview)
 * 5. classical-ltr:         Left-to-Right Classical Tree (Horizontal lineage ancestry flow)
 * 6. classical-radial:      Radial Classical Tree (Concentric generational ring tree with full upright cards)
 *
 * Card Contents System (Identical to Style 1):
 * - Pure white background card with 2px branch-colored border stroke
 * - Branch left accent bar / header indicator
 * - Round member picture (or empty placeholder with dashed border, initials, and 📷 camera badge)
 * - Line 1: Full Member Name (bold, 11.5px, #103d2b, truncated with … if long)
 * - Line 2: Generation ("Gen X") (9.5px, #64748b)
 * - Line 3: Dates (Born / Died / Age) ("Born: ... • Died: ... (X yrs)" or "Born: ... • Age Y")
 * - Line 4: Status ("🕊️ Deceased Ancestor" or "💍 Spouse • 🟢 Living" or "🟢 Living Member")
 * - Interactive Expand / Collapse Pill Button (+count when collapsed, − when expanded)
 * - Card Click opens member profile / detail modal
 * - Standard CSS classes (.d3-node-group, .d3-node-card-bg, .d3-tree-link, .d3-tree-svg)
 *   ensuring complete compatibility with Export Studio and High-Res print engines.
 */

(function(window) {
  'use strict';

  // Branch Color Palette Constants matching Style 1
  var BRANCH_COLORS = {
    heritage: {
      stroke: '#b45309',
      accent: '#d97706',
      ring: '#d97706',
      bg: '#fef3c7',
      css: '#d97706',
      label: 'Foundational Ancestry'
    },
    siara: {
      stroke: '#0369a1',
      accent: '#0284c7',
      ring: '#0284c7',
      bg: '#e0f2fe',
      css: '#0284c7',
      label: 'Siara Branch'
    },
    maina: {
      stroke: '#be123c',
      accent: '#e11d48',
      ring: '#e11d48',
      bg: '#ffe4e6',
      css: '#e11d48',
      label: 'Maina Branch'
    },
    maliti: {
      stroke: '#0f766e',
      accent: '#0d9488',
      ring: '#0d9488',
      bg: '#ccfbf1',
      css: '#0d9488',
      label: 'Maliti Family'
    },
    masaki: {
      stroke: '#6d28d9',
      accent: '#7c3aed',
      ring: '#7c3aed',
      bg: '#ede9fe',
      css: '#7c3aed',
      label: 'Masaki Branch'
    }
  };

  function getBranchColor(branchType) {
    var b = (branchType || '').toLowerCase();
    return BRANCH_COLORS[b] || BRANCH_COLORS.heritage;
  }
  window.getBranchColor = getBranchColor;

  // Cleanup helper to prepare canvas before rendering a new tree style
  function cleanupTreeCanvas() {
    if (window._tree3dAnimId) {
      cancelAnimationFrame(window._tree3dAnimId);
      window._tree3dAnimId = null;
    }
    if (window._tree3dRenderer && window._tree3dRenderer.dispose) {
      try { window._tree3dRenderer.dispose(); } catch (e) {}
      window._tree3dRenderer = null;
    }
    var canvas = document.getElementById("treeCanvas");
    if (canvas) canvas.innerHTML = "";
    window.d3TreeSvgInstance = null;
    window._treeD3Zoom = null;
    window._treeD3Svg = null;
  }
  window.cleanupCurrentTreeRenderer = cleanupTreeCanvas;

  // Safe helper to open profile or modal
  function triggerMemberProfile(d) {
    var id = (d && d.data && d.data.id) ? d.data.id : (d && d.id ? d.id : null);
    var record = (d && d.data && d.data.record) ? d.data.record : (d && d.record ? d.record : null);
    if (!record && id && typeof window.findRecord === "function") {
      record = window.findRecord(id);
    }
    if (typeof window.openMemberDetailModal === "function" && id) {
      window.openMemberDetailModal(id);
    } else if (typeof window.openProfile === "function" && record) {
      window.openProfile(record);
    }
  }

  // Safe helper to format member full name
  function getMemberFullName(rec, fallback) {
    if (!rec) return fallback || "Clan Member";
    if (typeof window.fullName === "function") return window.fullName(rec);
    var name = ((rec.firstName || "") + " " + (rec.lastName || "")).trim();
    return name || rec.name || fallback || "Clan Member";
  }

  // Safe helper to format member initials
  function getMemberInitials(rec, fallbackName) {
    if (rec && typeof window.initials === "function") {
      var init = window.initials(rec);
      if (init) return init;
    }
    var name = getMemberFullName(rec, fallbackName);
    var parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return (name[0] || "👤").toUpperCase();
  }

  // Safe helper to compute age
  function getMemberAge(rec, endDate) {
    if (typeof window.calculateAge === "function") {
      return window.calculateAge(rec, endDate);
    }
    return null;
  }

  // Extract comprehensive card data following Style 1's system
  function getCardData(d) {
    var rec = (d && d.data && d.data.record) ? d.data.record : {};
    var rawName = d.data.name || getMemberFullName(rec, "Clan Member");
    var displayName = rawName.length > 36 ? rawName.substring(0, 34) + "…" : rawName;

    // Generation
    var genNum = d.data.generation !== undefined ? d.data.generation : (rec.generation || 1);
    var genText = "Gen " + genNum;

    // Dates (Born / Died / Age)
    var dobStr = rec.dob || rec.birthPeriod || d.data.birthPeriod || "";
    var dodStr = rec.dod || d.data.deathPeriod || "";
    var datesText = "";
    if (rec.deceased || d.data.isDeceased || dodStr) {
      var ageDeath = getMemberAge(rec, rec.dod || dodStr);
      datesText = "Born: " + (dobStr || "Unknown") + " • Died: " + (dodStr || "Unknown") + (ageDeath !== null ? " (" + ageDeath + " yrs)" : "");
    } else {
      var ageLiving = getMemberAge(rec, "");
      datesText = "Born: " + (dobStr || "Unknown") + (ageLiving !== null ? " • Age " + ageLiving : "");
    }

    // Status Line
    var isDeceased = !!(rec.deceased || d.data.isDeceased || dodStr);
    var statusText = "";
    var statusColor = isDeceased ? "#94a3b8" : "#059669";
    if (isDeceased) {
      statusText = "🕊️ Deceased Ancestor";
    } else if (d.data.spouse) {
      var spName = d.data.spouse.firstName || getMemberFullName(d.data.spouse, "Spouse");
      statusText = "💍 " + spName + " • 🟢 Living";
    } else {
      statusText = "🟢 Living Member";
    }

    // Branch configuration
    var bKey = (d.data.branch || rec.branchType || "heritage").toLowerCase();
    var branchCfg = BRANCH_COLORS[bKey] || BRANCH_COLORS.heritage;

    // Photo & Initials
    var photoUrl = (rec.photo || rec.storedPhoto || rec.photoFile || d.data.photo || "").trim();
    var initials = getMemberInitials(rec, rawName);

    // Collapsible Children Info
    var childrenCount = d._children ? d._children.length : (d.children ? d.children.length : (d.data.childrenCount || 0));
    var hasChildren = childrenCount > 0 || (d.children && d.children.length > 0) || (d._children && d._children.length > 0);

    return {
      rawName: rawName,
      displayName: displayName,
      genText: genText,
      datesText: datesText,
      statusText: statusText,
      statusColor: statusColor,
      isDeceased: isDeceased,
      photoUrl: photoUrl,
      initials: initials,
      branch: branchCfg,
      branchKey: bKey,
      hasChildren: hasChildren,
      childrenCount: childrenCount
    };
  }

  /**
   * Universal Classical Card Content Appender
   * Injects the exact card contents and interactive toggle button from Style 1
   */
  function buildClassicalCard(nodeEnter, defs, options) {
    var nodeWidth = options.width || 280;
    var nodeHeight = options.height || 98;
    var rx = options.rx !== undefined ? options.rx : 10;
    var ry = options.ry !== undefined ? options.ry : 10;
    var togglePos = options.togglePosition || "bottom"; // "bottom" | "right"
    var clipPrefix = options.clipPrefix || "style";

    // 1. Card Background - Pure white fill with 2px branch-colored border stroke
    nodeEnter.append("rect")
      .attr("class", "d3-node-card-bg")
      .attr("x", -nodeWidth / 2)
      .attr("y", -nodeHeight / 2)
      .attr("width", nodeWidth)
      .attr("height", nodeHeight)
      .attr("rx", rx)
      .attr("ry", ry)
      .attr("fill", function(d) {
        return getCardData(d).branch.bg;
      })
      .attr("stroke", function(d) {
        return getCardData(d).branch.stroke;
      })
      .attr("stroke-width", "2px")
      .style("filter", "drop-shadow(0 3px 8px rgba(0,0,0,0.06))");

    // 2. Branch Left Accent Bar
    nodeEnter.append("path")
      .attr("d", function(d) {
        var r = Math.min(rx, 10);
        return "M " + (-nodeWidth/2) + " " + (-nodeHeight/2 + r) + 
               " A " + r + " " + r + " 0 0 1 " + (-nodeWidth/2 + r) + " " + (-nodeHeight/2) + 
               " L " + (-nodeWidth/2 + 8) + " " + (-nodeHeight/2) + 
               " L " + (-nodeWidth/2 + 8) + " " + (nodeHeight/2) + 
               " L " + (-nodeWidth/2 + r) + " " + (nodeHeight/2) + 
               " A " + r + " " + r + " 0 0 1 " + (-nodeWidth/2) + " " + (nodeHeight/2 - r) + " Z";
      })
      .attr("fill", function(d) {
        return getCardData(d).branch.accent;
      });

    // Optional top header strip for square style
    if (options.hasSquareHeaderStrip) {
      nodeEnter.append("path")
        .attr("d", function(d) {
          return "M " + (-nodeWidth/2) + " " + (-nodeHeight/2 + 4) +
                 " A 4 4 0 0 1 " + (-nodeWidth/2 + 4) + " " + (-nodeHeight/2) +
                 " L " + (nodeWidth/2 - 4) + " " + (-nodeHeight/2) +
                 " A 4 4 0 0 1 " + (nodeWidth/2) + " " + (-nodeHeight/2 + 4) +
                 " L " + (nodeWidth/2) + " " + (-nodeHeight/2 + 18) +
                 " L " + (-nodeWidth/2) + " " + (-nodeHeight/2 + 18) + " Z";
        })
        .attr("fill", function(d) {
          return getCardData(d).branch.accent;
        });

      nodeEnter.append("text")
        .attr("x", -nodeWidth/2 + 12)
        .attr("y", -nodeHeight/2 + 13)
        .attr("fill", "#ffffff")
        .attr("font-size", "9.5px")
        .attr("font-weight", "800")
        .text(function(d) {
          var data = getCardData(d);
          return data.branch.label + " • " + data.genText;
        });
    }

    // 3. Round Member Picture / Empty Photo Placeholder
    var avatarG = nodeEnter.append("g")
      .attr("transform", "translate(" + (-nodeWidth/2 + 32) + ", " + (options.hasSquareHeaderStrip ? 10 : 0) + ")");

    avatarG.each(function(d) {
      var el = d3.select(this);
      var data = getCardData(d);

      if (data.photoUrl) {
        // Member HAS photo -> SVG image clipped in round frame
        var cleanId = String(d.data.id).replace(/[^a-zA-Z0-9_-]/g, "_");
        var clipId = "clip_" + clipPrefix + "_" + cleanId;
        defs.append("clipPath")
          .attr("id", clipId)
          .append("circle")
          .attr("cx", 0)
          .attr("cy", 0)
          .attr("r", 20);

        el.append("image")
          .attr("href", data.photoUrl)
          .attr("x", -20)
          .attr("y", -20)
          .attr("width", 40)
          .attr("height", 40)
          .attr("preserveAspectRatio", "xMidYMid slice")
          .attr("clip-path", "url(#" + clipId + ")");

        el.append("circle")
          .attr("r", 20)
          .attr("fill", "none")
          .attr("stroke", data.branch.ring)
          .attr("stroke-width", 2);
      } else {
        // Member HAS NO photo -> Empty round placeholder ready for photo
        el.append("circle")
          .attr("r", 20)
          .attr("fill", data.branch.bg)
          .attr("stroke", data.branch.ring)
          .attr("stroke-width", 1.8)
          .attr("stroke-dasharray", "3,2");

        el.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", "11px")
          .attr("font-weight", "900")
          .attr("fill", "#103d2b")
          .text(data.initials);

        // Small camera icon badge indicating photo placeholder
        var badgeG = el.append("g").attr("transform", "translate(13, 13)");
        badgeG.append("circle")
          .attr("r", 6.5)
          .attr("fill", "#ffffff")
          .attr("stroke", data.branch.ring)
          .attr("stroke-width", 1);

        badgeG.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", "7px")
          .text("📷");
      }
    });

    var textLeft = -nodeWidth/2 + 60;
    var yBase = options.hasSquareHeaderStrip ? (-nodeHeight/2 + 34) : (-nodeHeight/2 + 20);

    // 4. Line 1: Member Name
    nodeEnter.append("text")
      .attr("x", textLeft)
      .attr("y", yBase)
      .attr("font-size", "11.5px")
      .attr("font-weight", "900")
      .attr("fill", "#103d2b")
      .text(function(d) {
        return getCardData(d).displayName;
      });

    // 5. Line 2: Generation Subtitle
    nodeEnter.append("text")
      .attr("x", textLeft)
      .attr("y", yBase + 16)
      .attr("font-size", "9.5px")
      .attr("font-weight", "700")
      .attr("fill", "#64748b")
      .text(function(d) {
        return getCardData(d).genText;
      });

    // 6. Line 3: Dates (Born / Died / Age)
    nodeEnter.append("text")
      .attr("x", textLeft)
      .attr("y", yBase + 32)
      .attr("font-size", "9px")
      .attr("font-weight", "700")
      .attr("fill", "#475569")
      .text(function(d) {
        return getCardData(d).datesText;
      });

    // 7. Line 4: Status Line (🕊️ Deceased / 💍 Spouse • 🟢 Living / 🟢 Living)
    nodeEnter.append("text")
      .attr("x", textLeft)
      .attr("y", yBase + 48)
      .attr("font-size", "9px")
      .attr("font-weight", "800")
      .attr("fill", function(d) {
        return getCardData(d).statusColor;
      })
      .text(function(d) {
        return getCardData(d).statusText;
      });

    // 8. Expand / Collapse Pill Button (+count / −)
    var toggleG = nodeEnter.append("g")
      .attr("class", "d3-node-toggle-btn")
      .attr("transform", function() {
        if (togglePos === "right") {
          return "translate(" + (nodeWidth/2 - 12) + ", 0)";
        }
        return "translate(0, " + (nodeHeight/2) + ")";
      })
      .style("cursor", "pointer")
      .style("display", function(d) {
        var data = getCardData(d);
        return data.hasChildren ? "inline" : "none";
      });

    toggleG.append("circle")
      .attr("r", 10)
      .attr("fill", "#103d2b")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 2);

    toggleG.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("font-weight", "900")
      .attr("fill", "#ffffff")
      .text(function(d) {
        return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
      });
  }

  // Common Search & Spotlight bar for all classical trees
  function createTreeSearchPanel(wrapper, d3Root, onSelectMember, currentRootRecord) {
    var searchPanel = wrapper.append("div")
      .attr("class", "d3-tree-search-panel")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "10px")
      .style("padding", "8px 12px")
      .style("background", "rgba(255,255,255,0.95)")
      .style("backdrop-filter", "blur(8px)")
      .style("border-bottom", "1px solid var(--line)")
      .style("flex-wrap", "wrap")
      .style("position", "relative")
      .style("z-index", "10");

    searchPanel.append("span").style("font-size", "1rem").text("🔍");

    searchPanel.append("input")
      .attr("type", "search")
      .attr("class", "d3-tree-search-input")
      .attr("placeholder", "Search member in tree (e.g. Siara)...")
      .attr("id", "d3TreeSearchInput")
      .style("padding", "6px 12px")
      .style("border", "1px solid var(--line)")
      .style("border-radius", "6px")
      .style("font-size", "0.8rem")
      .style("min-width", "220px")
      .style("flex", "1")
      .on("input", function() {
        var val = this.value.trim().toLowerCase();
        if (!val) {
          d3.selectAll(".d3-node-group").classed("node-selected", false);
          d3.selectAll(".d3-tree-link").classed("link-highlight", false);
          return;
        }
        var matchNode = null;
        d3Root.each(function(d) {
          var name = (d.data.name || "").toLowerCase();
          var clanNum = (d.data.clanNumber || "").toLowerCase();
          var phone = (d.data.record && d.data.record.phone) ? String(d.data.record.phone).toLowerCase() : "";
          if ((name.indexOf(val) !== -1 || clanNum.indexOf(val) !== -1 || phone.indexOf(val) !== -1) && !matchNode) {
            matchNode = d;
          }
        });
        if (matchNode && typeof onSelectMember === "function") {
          onSelectMember(matchNode);
        }
      });

    // Root switcher dropdown
    var rootSelect = searchPanel.append("select")
      .style("padding", "6px 10px")
      .style("border", "1px solid var(--line)")
      .style("border-radius", "6px")
      .style("font-size", "0.75rem")
      .style("font-weight", "800")
      .style("background", "#fff")
      .on("change", function() {
        if (typeof window.showTree === "function") {
          window.showTree("custom", this.value, window.currentFamilyTreeStyle);
        }
      });

    var roots = [
      { id: "ngowi1", label: "👑 Clan Root (Ngowi I)" },
      { id: "siara", label: "🌿 Siara Branch" },
      { id: "maina", label: "🌹 Maina Branch" },
      { id: "josephMaliti", label: "🏛️ Maliti Family" },
      { id: "member-1788457645229", label: "🟣 Masaki Branch" }
    ];

    roots.forEach(function(r) {
      rootSelect.append("option")
        .attr("value", r.id)
        .attr("selected", (currentRootRecord && currentRootRecord.id === r.id) ? true : null)
        .text(r.label);
    });

    return searchPanel;
  }

  // Safe helper to obtain hierarchy data
  function getTreeHierarchyData(rootRecord, filterBranch) {
    if (typeof window.buildD3HierarchyData === "function") {
      return window.buildD3HierarchyData(rootRecord, filterBranch);
    }
    return null;
  }

  // Helper to toggle node collapse/expand
  function toggleSubtree(d) {
    if (d.children) {
      d._children = d.children;
      d.children = null;
    } else if (d._children) {
      d.children = d._children;
      d._children = null;
    }
  }

  // =========================================================================
  // 2. ROUNDED-NODE CLASSICAL TREE (Pill Nodes & Smooth Curved Connectors)
  // =========================================================================
  window.renderClassicalRoundedTree = function(rootRecord, filterBranch, targetHighlightId) {
    cleanupTreeCanvas();
    var container = document.getElementById("treeCanvas");
    if (!container) return;

    if (typeof d3 === "undefined") {
      container.innerHTML = '<div class="empty">Loading visualization library...</div>';
      return;
    }

    var hierarchyData = getTreeHierarchyData(rootRecord, filterBranch);
    if (!hierarchyData) {
      container.innerHTML = '<div class="empty">No genealogical records found for the selected branch.</div>';
      return;
    }

    var wrapper = d3.select(container).append("div")
      .attr("class", "d3-tree-container")
      .attr("id", "d3TreeWrapper")
      .style("width", "100%")
      .style("height", "100%")
      .style("min-height", "680px")
      .style("position", "relative")
      .style("overflow", "hidden")
      .style("background", "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)");

    var d3Root = d3.hierarchy(hierarchyData, function(d) { return d.children; });
    window.d3TreeDataRoot = d3Root;
    var nodeWidth = 280;
    var nodeHeight = 98;
    var rx = 18;
    var ry = 18;

    d3Root.x0 = (container.clientWidth || 1000) / 2;
    d3Root.y0 = 60;

    var treeLayout = d3.tree().nodeSize([nodeWidth + 40, nodeHeight + 80]);

    var svg = wrapper.append("svg")
      .attr("class", "d3-tree-svg")
      .attr("id", "d3TreeSvg")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("display", "block")
      .style("cursor", "grab");

    var defs = svg.append("defs");
    var g = svg.append("g").attr("class", "d3-main-group");
    var gLink = g.append("g").attr("class", "d3-links-layer");
    var gNode = g.append("g").attr("class", "d3-nodes-layer");

    var zoom = d3.zoom()
      .scaleExtent([0.15, 3])
      .on("zoom", function(event) {
        g.attr("transform", event.transform);
        var label = document.getElementById("treeZoomLabel");
        if (label) label.textContent = Math.round(event.transform.k * 100) + "%";
      });

    svg.call(zoom);
    window.d3TreeSvgInstance = { svg: svg, zoom: zoom, g: g };
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    createTreeSearchPanel(wrapper, d3Root, function(matchNode) {
      d3.selectAll(".d3-node-group").classed("node-selected", false);
      var sel = d3.select("#d3Node_" + matchNode.data.id);
      sel.classed("node-selected", true);
      var scale = 1.1;
      var w = container.clientWidth || 900;
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(w/2 - matchNode.x * scale, 120 - matchNode.y * scale).scale(scale));
    }, rootRecord);

    function updateTree(source, duration) {
      duration = duration !== undefined ? duration : 400;
      treeLayout(d3Root);

      var nodes = d3Root.descendants();
      var links = d3Root.links();

      // --- Links ---
      var link = gLink.selectAll(".d3-tree-link")
        .data(links, function(d) { return d.target.data.id; });

      var linkEnter = link.enter().append("path")
        .attr("class", function(d) {
          return "d3-tree-link branch-" + (d.target.data.branch || "heritage");
        })
        .attr("fill", "none")
        .attr("stroke", function(d) {
          return getBranchColor(d.target.data.branch).stroke;
        })
        .attr("stroke-width", "2.5px")
        .attr("stroke-opacity", "0.75")
        .attr("d", function() {
          var o = { x: source.x0 || 0, y: source.y0 || 0 };
          return d3.linkVertical()({ source: o, target: o });
        });

      link.merge(linkEnter).transition().duration(duration)
        .attr("d", d3.linkVertical().x(function(d) { return d.x; }).y(function(d) { return d.y; }))
        .attr("stroke", function(d) { return getBranchColor(d.target.data.branch).stroke; });

      link.exit().transition().duration(duration)
        .attr("d", function() {
          var o = { x: source.x || 0, y: source.y || 0 };
          return d3.linkVertical()({ source: o, target: o });
        })
        .remove();

      // --- Nodes ---
      var node = gNode.selectAll(".d3-node-group")
        .data(nodes, function(d) { return d.data.id; });

      var nodeEnter = node.enter().append("g")
        .attr("class", function(d) {
          return "d3-node-group branch-" + (d.data.branch || "heritage");
        })
        .attr("id", function(d) { return "d3Node_" + d.data.id; })
        .attr("transform", function() {
          return "translate(" + (source.x0 || 0) + "," + (source.y0 || 0) + ")";
        })
        .style("cursor", "pointer")
        .on("click", function(event, d) {
          if (event.target && event.target.closest && event.target.closest(".d3-node-toggle-btn")) {
            toggleSubtree(d);
            updateTree(d, 400);
            return;
          }
          triggerMemberProfile(d);
        });

      buildClassicalCard(nodeEnter, defs, {
        width: nodeWidth,
        height: nodeHeight,
        rx: rx,
        ry: ry,
        togglePosition: "bottom",
        clipPrefix: "rnd"
      });

      var nodeUpdate = node.merge(nodeEnter).transition().duration(duration)
        .attr("transform", function(d) {
          return "translate(" + d.x + "," + d.y + ")";
        });

      nodeUpdate.select(".d3-node-card-bg")
        .attr("fill", function(d) {
          return getCardData(d).branch.bg;
        })
        .attr("stroke", function(d) {
          if (d.selected) return "var(--gold)";
          return getCardData(d).branch.stroke;
        });

      nodeUpdate.select(".d3-node-toggle-btn text")
        .text(function(d) {
          return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
        });

      node.exit().transition().duration(duration)
        .attr("transform", function() {
          return "translate(" + (source.x || 0) + "," + (source.y || 0) + ")";
        })
        .remove();

      d3Root.each(function(d) {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    updateTree(d3Root, 0);

    setTimeout(function() {
      if (typeof window.fitTreeToWidth === "function") window.fitTreeToWidth();
    }, 60);
  };

  // =========================================================================
  // 3. SQUARE/RECTANGULAR-NODE CLASSICAL TREE (Crisp Cards & Orthogonal Elbows)
  // =========================================================================
  window.renderClassicalSquareTree = function(rootRecord, filterBranch, targetHighlightId) {
    cleanupTreeCanvas();
    var container = document.getElementById("treeCanvas");
    if (!container) return;

    if (typeof d3 === "undefined") {
      container.innerHTML = '<div class="empty">Loading visualization library...</div>';
      return;
    }

    var hierarchyData = getTreeHierarchyData(rootRecord, filterBranch);
    if (!hierarchyData) {
      container.innerHTML = '<div class="empty">No genealogical records found for the selected branch.</div>';
      return;
    }

    var wrapper = d3.select(container).append("div")
      .attr("class", "d3-tree-container")
      .attr("id", "d3TreeWrapper")
      .style("width", "100%")
      .style("height", "100%")
      .style("min-height", "680px")
      .style("position", "relative")
      .style("overflow", "hidden")
      .style("background", "#fafaf9");

    var d3Root = d3.hierarchy(hierarchyData, function(d) { return d.children; });
    window.d3TreeDataRoot = d3Root;
    var nodeWidth = 280;
    var nodeHeight = 104;
    var rx = 4;
    var ry = 4;

    d3Root.x0 = (container.clientWidth || 1000) / 2;
    d3Root.y0 = 60;

    var treeLayout = d3.tree().nodeSize([nodeWidth + 40, nodeHeight + 84]);

    var svg = wrapper.append("svg")
      .attr("class", "d3-tree-svg")
      .attr("id", "d3TreeSvg")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("display", "block")
      .style("cursor", "grab");

    var defs = svg.append("defs");
    var g = svg.append("g").attr("class", "d3-main-group");
    var gLink = g.append("g").attr("class", "d3-links-layer");
    var gNode = g.append("g").attr("class", "d3-nodes-layer");

    var zoom = d3.zoom()
      .scaleExtent([0.15, 3])
      .on("zoom", function(event) {
        g.attr("transform", event.transform);
        var label = document.getElementById("treeZoomLabel");
        if (label) label.textContent = Math.round(event.transform.k * 100) + "%";
      });

    svg.call(zoom);
    window.d3TreeSvgInstance = { svg: svg, zoom: zoom, g: g };
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    createTreeSearchPanel(wrapper, d3Root, function(matchNode) {
      d3.selectAll(".d3-node-group").classed("node-selected", false);
      var sel = d3.select("#d3Node_" + matchNode.data.id);
      sel.classed("node-selected", true);
      var scale = 1.1;
      var w = container.clientWidth || 900;
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(w/2 - matchNode.x * scale, 120 - matchNode.y * scale).scale(scale));
    }, rootRecord);

    function elbowConnector(s, t) {
      var sx = s.x;
      var sy = s.y + nodeHeight / 2;
      var tx = t.x;
      var ty = t.y - nodeHeight / 2;
      var midY = (sy + ty) / 2;
      return "M " + sx + " " + sy +
             " L " + sx + " " + midY +
             " L " + tx + " " + midY +
             " L " + tx + " " + ty;
    }

    function updateTree(source, duration) {
      duration = duration !== undefined ? duration : 400;
      treeLayout(d3Root);

      var nodes = d3Root.descendants();
      var links = d3Root.links();

      // --- Links ---
      var link = gLink.selectAll(".d3-tree-link")
        .data(links, function(d) { return d.target.data.id; });

      var linkEnter = link.enter().append("path")
        .attr("class", function(d) {
          return "d3-tree-link branch-" + (d.target.data.branch || "heritage");
        })
        .attr("fill", "none")
        .attr("stroke", function(d) {
          return getBranchColor(d.target.data.branch).stroke;
        })
        .attr("stroke-width", "2.2px")
        .attr("stroke-opacity", "0.75")
        .attr("d", function() {
          var o = { x: source.x0 || 0, y: source.y0 || 0 };
          return elbowConnector(o, o);
        });

      link.merge(linkEnter).transition().duration(duration)
        .attr("d", function(d) { return elbowConnector(d.source, d.target); })
        .attr("stroke", function(d) { return getBranchColor(d.target.data.branch).stroke; });

      link.exit().transition().duration(duration)
        .attr("d", function() {
          var o = { x: source.x || 0, y: source.y || 0 };
          return elbowConnector(o, o);
        })
        .remove();

      // --- Nodes ---
      var node = gNode.selectAll(".d3-node-group")
        .data(nodes, function(d) { return d.data.id; });

      var nodeEnter = node.enter().append("g")
        .attr("class", function(d) {
          return "d3-node-group branch-" + (d.data.branch || "heritage");
        })
        .attr("id", function(d) { return "d3Node_" + d.data.id; })
        .attr("transform", function() {
          return "translate(" + (source.x0 || 0) + "," + (source.y0 || 0) + ")";
        })
        .style("cursor", "pointer")
        .on("click", function(event, d) {
          if (event.target && event.target.closest && event.target.closest(".d3-node-toggle-btn")) {
            toggleSubtree(d);
            updateTree(d, 400);
            return;
          }
          triggerMemberProfile(d);
        });

      buildClassicalCard(nodeEnter, defs, {
        width: nodeWidth,
        height: nodeHeight,
        rx: rx,
        ry: ry,
        togglePosition: "bottom",
        clipPrefix: "sq",
        hasSquareHeaderStrip: true
      });

      var nodeUpdate = node.merge(nodeEnter).transition().duration(duration)
        .attr("transform", function(d) {
          return "translate(" + d.x + "," + d.y + ")";
        });

      nodeUpdate.select(".d3-node-card-bg")
        .attr("fill", function(d) {
          return getCardData(d).branch.bg;
        })
        .attr("stroke", function(d) {
          if (d.selected) return "var(--gold)";
          return getCardData(d).branch.stroke;
        });

      nodeUpdate.select(".d3-node-toggle-btn text")
        .text(function(d) {
          return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
        });

      node.exit().transition().duration(duration)
        .attr("transform", function() {
          return "translate(" + (source.x || 0) + "," + (source.y || 0) + ")";
        })
        .remove();

      d3Root.each(function(d) {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    updateTree(d3Root, 0);

    setTimeout(function() {
      if (typeof window.fitTreeToWidth === "function") window.fitTreeToWidth();
    }, 60);
  };

  // =========================================================================
  // 4. COMPACT CLASSICAL TREE (High-Density Multi-Generation Overview)
  // =========================================================================
  window.renderClassicalCompactTree = function(rootRecord, filterBranch, targetHighlightId) {
    cleanupTreeCanvas();
    var container = document.getElementById("treeCanvas");
    if (!container) return;

    if (typeof d3 === "undefined") {
      container.innerHTML = '<div class="empty">Loading visualization library...</div>';
      return;
    }

    var hierarchyData = getTreeHierarchyData(rootRecord, filterBranch);
    if (!hierarchyData) {
      container.innerHTML = '<div class="empty">No genealogical records found for the selected branch.</div>';
      return;
    }

    var wrapper = d3.select(container).append("div")
      .attr("class", "d3-tree-container")
      .attr("id", "d3TreeWrapper")
      .style("width", "100%")
      .style("height", "100%")
      .style("min-height", "680px")
      .style("position", "relative")
      .style("overflow", "hidden")
      .style("background", "#ffffff");

    var d3Root = d3.hierarchy(hierarchyData, function(d) { return d.children; });
    window.d3TreeDataRoot = d3Root;
    var nodeWidth = 270;
    var nodeHeight = 94;
    var rx = 8;
    var ry = 8;

    d3Root.x0 = (container.clientWidth || 1000) / 2;
    d3Root.y0 = 60;

    var treeLayout = d3.tree().nodeSize([nodeWidth + 24, nodeHeight + 60]);

    var svg = wrapper.append("svg")
      .attr("class", "d3-tree-svg")
      .attr("id", "d3TreeSvg")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("display", "block")
      .style("cursor", "grab");

    var defs = svg.append("defs");
    var g = svg.append("g").attr("class", "d3-main-group");
    var gLink = g.append("g").attr("class", "d3-links-layer");
    var gNode = g.append("g").attr("class", "d3-nodes-layer");

    var zoom = d3.zoom()
      .scaleExtent([0.15, 3])
      .on("zoom", function(event) {
        g.attr("transform", event.transform);
        var label = document.getElementById("treeZoomLabel");
        if (label) label.textContent = Math.round(event.transform.k * 100) + "%";
      });

    svg.call(zoom);
    window.d3TreeSvgInstance = { svg: svg, zoom: zoom, g: g };
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    createTreeSearchPanel(wrapper, d3Root, function(matchNode) {
      d3.selectAll(".d3-node-group").classed("node-selected", false);
      var sel = d3.select("#d3Node_" + matchNode.data.id);
      sel.classed("node-selected", true);
      var scale = 1.1;
      var w = container.clientWidth || 900;
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(w/2 - matchNode.x * scale, 120 - matchNode.y * scale).scale(scale));
    }, rootRecord);

    function updateTree(source, duration) {
      duration = duration !== undefined ? duration : 400;
      treeLayout(d3Root);

      var nodes = d3Root.descendants();
      var links = d3Root.links();

      // --- Links ---
      var link = gLink.selectAll(".d3-tree-link")
        .data(links, function(d) { return d.target.data.id; });

      var linkEnter = link.enter().append("path")
        .attr("class", function(d) {
          return "d3-tree-link branch-" + (d.target.data.branch || "heritage");
        })
        .attr("fill", "none")
        .attr("stroke", function(d) {
          return getBranchColor(d.target.data.branch).stroke;
        })
        .attr("stroke-width", "2px")
        .attr("stroke-opacity", "0.7")
        .attr("d", function() {
          var o = { x: source.x0 || 0, y: source.y0 || 0 };
          return d3.linkVertical()({ source: o, target: o });
        });

      link.merge(linkEnter).transition().duration(duration)
        .attr("d", d3.linkVertical().x(function(d) { return d.x; }).y(function(d) { return d.y; }))
        .attr("stroke", function(d) { return getBranchColor(d.target.data.branch).stroke; });

      link.exit().transition().duration(duration)
        .attr("d", function() {
          var o = { x: source.x || 0, y: source.y || 0 };
          return d3.linkVertical()({ source: o, target: o });
        })
        .remove();

      // --- Nodes ---
      var node = gNode.selectAll(".d3-node-group")
        .data(nodes, function(d) { return d.data.id; });

      var nodeEnter = node.enter().append("g")
        .attr("class", function(d) {
          return "d3-node-group branch-" + (d.data.branch || "heritage");
        })
        .attr("id", function(d) { return "d3Node_" + d.data.id; })
        .attr("transform", function() {
          return "translate(" + (source.x0 || 0) + "," + (source.y0 || 0) + ")";
        })
        .style("cursor", "pointer")
        .on("click", function(event, d) {
          if (event.target && event.target.closest && event.target.closest(".d3-node-toggle-btn")) {
            toggleSubtree(d);
            updateTree(d, 400);
            return;
          }
          triggerMemberProfile(d);
        });

      buildClassicalCard(nodeEnter, defs, {
        width: nodeWidth,
        height: nodeHeight,
        rx: rx,
        ry: ry,
        togglePosition: "bottom",
        clipPrefix: "cmp"
      });

      var nodeUpdate = node.merge(nodeEnter).transition().duration(duration)
        .attr("transform", function(d) {
          return "translate(" + d.x + "," + d.y + ")";
        });

      nodeUpdate.select(".d3-node-card-bg")
        .attr("fill", function(d) {
          return getCardData(d).branch.bg;
        })
        .attr("stroke", function(d) {
          if (d.selected) return "var(--gold)";
          return getCardData(d).branch.stroke;
        });

      nodeUpdate.select(".d3-node-toggle-btn text")
        .text(function(d) {
          return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
        });

      node.exit().transition().duration(duration)
        .attr("transform", function() {
          return "translate(" + (source.x || 0) + "," + (source.y || 0) + ")";
        })
        .remove();

      d3Root.each(function(d) {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    updateTree(d3Root, 0);

    setTimeout(function() {
      if (typeof window.fitTreeToWidth === "function") window.fitTreeToWidth();
    }, 60);
  };

  // =========================================================================
  // 5. LEFT-TO-RIGHT CLASSICAL TREE (Horizontal Ancestry Lineage Flow)
  // =========================================================================
  window.renderClassicalLtrTree = function(rootRecord, filterBranch, targetHighlightId) {
    cleanupTreeCanvas();
    var container = document.getElementById("treeCanvas");
    if (!container) return;

    if (typeof d3 === "undefined") {
      container.innerHTML = '<div class="empty">Loading visualization library...</div>';
      return;
    }

    var hierarchyData = getTreeHierarchyData(rootRecord, filterBranch);
    if (!hierarchyData) {
      container.innerHTML = '<div class="empty">No genealogical records found for the selected branch.</div>';
      return;
    }

    var wrapper = d3.select(container).append("div")
      .attr("class", "d3-tree-container")
      .attr("id", "d3TreeWrapper")
      .style("width", "100%")
      .style("height", "100%")
      .style("min-height", "680px")
      .style("position", "relative")
      .style("overflow", "hidden")
      .style("background", "linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%)");

    var d3Root = d3.hierarchy(hierarchyData, function(d) { return d.children; });
    window.d3TreeDataRoot = d3Root;
    var nodeWidth = 280;
    var nodeHeight = 96;
    var rx = 10;
    var ry = 10;

    d3Root.x0 = (container.clientHeight || 650) / 2;
    d3Root.y0 = 60;

    var treeLayout = d3.tree().nodeSize([nodeHeight + 36, nodeWidth + 90]);

    var svg = wrapper.append("svg")
      .attr("class", "d3-tree-svg")
      .attr("id", "d3TreeSvg")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("display", "block")
      .style("cursor", "grab");

    var defs = svg.append("defs");
    var g = svg.append("g").attr("class", "d3-main-group");
    var gLink = g.append("g").attr("class", "d3-links-layer");
    var gNode = g.append("g").attr("class", "d3-nodes-layer");

    var zoom = d3.zoom()
      .scaleExtent([0.15, 3])
      .on("zoom", function(event) {
        g.attr("transform", event.transform);
        var label = document.getElementById("treeZoomLabel");
        if (label) label.textContent = Math.round(event.transform.k * 100) + "%";
      });

    svg.call(zoom);
    window.d3TreeSvgInstance = { svg: svg, zoom: zoom, g: g };
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    createTreeSearchPanel(wrapper, d3Root, function(matchNode) {
      d3.selectAll(".d3-node-group").classed("node-selected", false);
      var sel = d3.select("#d3Node_" + matchNode.data.id);
      sel.classed("node-selected", true);
      var scale = 1.1;
      var h = container.clientHeight || 680;
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(140 - matchNode.y * scale, h/2 - matchNode.x * scale).scale(scale));
    }, rootRecord);

    function updateTree(source, duration) {
      duration = duration !== undefined ? duration : 400;
      treeLayout(d3Root);

      var nodes = d3Root.descendants();
      var links = d3Root.links();

      // --- Links ---
      var link = gLink.selectAll(".d3-tree-link")
        .data(links, function(d) { return d.target.data.id; });

      var linkEnter = link.enter().append("path")
        .attr("class", function(d) {
          return "d3-tree-link branch-" + (d.target.data.branch || "heritage");
        })
        .attr("fill", "none")
        .attr("stroke", function(d) {
          return getBranchColor(d.target.data.branch).stroke;
        })
        .attr("stroke-width", "2.5px")
        .attr("stroke-opacity", "0.75")
        .attr("d", function() {
          var o = { x: source.x0 || 0, y: source.y0 || 0 };
          return d3.linkHorizontal().x(function(d) { return d.y; }).y(function(d) { return d.x; })({ source: o, target: o });
        });

      link.merge(linkEnter).transition().duration(duration)
        .attr("d", d3.linkHorizontal().x(function(d) { return d.y; }).y(function(d) { return d.x; }))
        .attr("stroke", function(d) { return getBranchColor(d.target.data.branch).stroke; });

      link.exit().transition().duration(duration)
        .attr("d", function() {
          var o = { x: source.x || 0, y: source.y || 0 };
          return d3.linkHorizontal().x(function(d) { return d.y; }).y(function(d) { return d.x; })({ source: o, target: o });
        })
        .remove();

      // --- Nodes ---
      var node = gNode.selectAll(".d3-node-group")
        .data(nodes, function(d) { return d.data.id; });

      var nodeEnter = node.enter().append("g")
        .attr("class", function(d) {
          return "d3-node-group branch-" + (d.data.branch || "heritage");
        })
        .attr("id", function(d) { return "d3Node_" + d.data.id; })
        .attr("transform", function() {
          return "translate(" + (source.y0 || 0) + "," + (source.x0 || 0) + ")";
        })
        .style("cursor", "pointer")
        .on("click", function(event, d) {
          if (event.target && event.target.closest && event.target.closest(".d3-node-toggle-btn")) {
            toggleSubtree(d);
            updateTree(d, 400);
            return;
          }
          triggerMemberProfile(d);
        });

      buildClassicalCard(nodeEnter, defs, {
        width: nodeWidth,
        height: nodeHeight,
        rx: rx,
        ry: ry,
        togglePosition: "right",
        clipPrefix: "ltr"
      });

      var nodeUpdate = node.merge(nodeEnter).transition().duration(duration)
        .attr("transform", function(d) {
          return "translate(" + d.y + "," + d.x + ")";
        });

      nodeUpdate.select(".d3-node-card-bg")
        .attr("fill", function(d) {
          return getCardData(d).branch.bg;
        })
        .attr("stroke", function(d) {
          if (d.selected) return "var(--gold)";
          return getCardData(d).branch.stroke;
        });

      nodeUpdate.select(".d3-node-toggle-btn text")
        .text(function(d) {
          return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
        });

      node.exit().transition().duration(duration)
        .attr("transform", function() {
          return "translate(" + (source.y || 0) + "," + (source.x || 0) + ")";
        })
        .remove();

      d3Root.each(function(d) {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    updateTree(d3Root, 0);

    setTimeout(function() {
      if (typeof window.fitTreeToWidth === "function") window.fitTreeToWidth();
    }, 60);
  };

  // =========================================================================
  // 6. RADIAL CLASSICAL TREE (Concentric Radiating Generational Rings)
  // =========================================================================
  window.renderClassicalRadialTree = function(rootRecord, filterBranch, targetHighlightId) {
    cleanupTreeCanvas();
    var container = document.getElementById("treeCanvas");
    if (!container) return;

    if (typeof d3 === "undefined") {
      container.innerHTML = '<div class="empty">Loading visualization library...</div>';
      return;
    }

    var hierarchyData = getTreeHierarchyData(rootRecord, filterBranch);
    if (!hierarchyData) {
      container.innerHTML = '<div class="empty">No genealogical records found for the selected branch.</div>';
      return;
    }

    var d3Root = d3.hierarchy(hierarchyData, function(d) { return d.children; });
    window.d3TreeDataRoot = d3Root;

    // Calculate maximum generational depth
    var maxDepth = 1;
    d3Root.each(function(d) { if (d.depth > maxDepth) maxDepth = d.depth; });

    // Generous radial step per level so cards spread naturally without overlapping
    var radialStep = Math.max(190, Math.min(260, 1200 / Math.max(1, maxDepth)));
    var totalRadius = radialStep * maxDepth;

    var nodeWidth = 260;
    var nodeHeight = 92;
    var rx = 12;
    var ry = 12;

    d3Root.x0 = 0;
    d3Root.y0 = 0;

    var treeLayout = d3.tree()
      .size([2 * Math.PI, totalRadius])
      .separation(function(a, b) {
        var baseSep = (a.parent === b.parent ? 3.4 : 6.2);
        return baseSep / Math.max(1, Math.sqrt(a.depth));
      });

    var wrapper = d3.select(container).append("div")
      .attr("class", "d3-tree-container")
      .attr("id", "d3TreeWrapper")
      .style("width", "100%")
      .style("height", "100%")
      .style("min-height", "720px")
      .style("position", "relative")
      .style("overflow", "hidden")
      .style("background", "radial-gradient(circle at center, #ffffff 0%, #f1f5f9 100%)");

    var width = container.clientWidth || 1000;
    var height = 720;

    var svg = wrapper.append("svg")
      .attr("class", "d3-tree-svg")
      .attr("id", "d3TreeSvg")
      .attr("width", "100%")
      .attr("height", "100%")
      .style("display", "block")
      .style("cursor", "grab");

    var defs = svg.append("defs");
    var g = svg.append("g")
      .attr("class", "d3-main-group")
      .attr("transform", "translate(" + (width / 2) + "," + (height / 2) + ")");

    var guideGroup = g.append("g").attr("class", "radial-guide-rings");
    var gLink = g.append("g").attr("class", "d3-links-layer");
    var gNode = g.append("g").attr("class", "d3-nodes-layer");

    var zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", function(event) {
        g.attr("transform", event.transform);
        var label = document.getElementById("treeZoomLabel");
        if (label) label.textContent = Math.round(event.transform.k * 100) + "%";
      });

    svg.call(zoom);

    // Initial scale & center
    var initialScale = Math.min(0.85, (Math.min(width, height) - 60) / (totalRadius * 2));
    if (isNaN(initialScale) || initialScale <= 0) initialScale = 0.55;
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(initialScale));

    window.d3TreeSvgInstance = { svg: svg, zoom: zoom, g: g };
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    createTreeSearchPanel(wrapper, d3Root, function(matchNode) {
      d3.selectAll(".d3-node-group").classed("node-selected", false);
      var sel = d3.select("#d3Node_" + matchNode.data.id);
      sel.classed("node-selected", true);
      var scale = 1.1;
      var point = d3.pointRadial(matchNode.x, matchNode.y);
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(width/2 - point[0] * scale, height/2 - point[1] * scale).scale(scale));
    }, rootRecord);

    function updateTree(source, duration) {
      duration = duration !== undefined ? duration : 400;
      treeLayout(d3Root);

      var nodes = d3Root.descendants();
      var links = d3Root.links();

      // Generational guide rings
      guideGroup.selectAll("*").remove();
      for (var r = 1; r <= maxDepth; r++) {
        var ringRadius = radialStep * r;
        guideGroup.append("circle")
          .attr("r", ringRadius)
          .attr("fill", "none")
          .attr("stroke", "#cbd5e1")
          .attr("stroke-dasharray", "4,4")
          .attr("stroke-width", 1.2);

        guideGroup.append("text")
          .attr("y", -ringRadius + 14)
          .attr("x", 0)
          .attr("text-anchor", "middle")
          .attr("fill", "#64748b")
          .style("font-size", "10px")
          .style("font-weight", "800")
          .text("Gen " + r);
      }

      // --- Links ---
      var link = gLink.selectAll(".d3-tree-link")
        .data(links, function(d) { return d.target.data.id; });

      var linkEnter = link.enter().append("path")
        .attr("class", function(d) {
          return "d3-tree-link branch-" + (d.target.data.branch || "heritage");
        })
        .attr("fill", "none")
        .attr("stroke", function(d) {
          return getBranchColor(d.target.data.branch).stroke;
        })
        .attr("stroke-width", "2.2px")
        .attr("stroke-opacity", "0.65")
        .attr("d", function() {
          var o = { x: source.x0 || 0, y: source.y0 || 0 };
          return d3.linkRadial().angle(function(d) { return d.x; }).radius(function(d) { return d.y; })({ source: o, target: o });
        });

      link.merge(linkEnter).transition().duration(duration)
        .attr("d", d3.linkRadial().angle(function(d) { return d.x; }).radius(function(d) { return d.y; }))
        .attr("stroke", function(d) { return getBranchColor(d.target.data.branch).stroke; });

      link.exit().transition().duration(duration)
        .attr("d", function() {
          var o = { x: source.x || 0, y: source.y || 0 };
          return d3.linkRadial().angle(function(d) { return d.x; }).radius(function(d) { return d.y; })({ source: o, target: o });
        })
        .remove();

      // --- Nodes ---
      var node = gNode.selectAll(".d3-node-group")
        .data(nodes, function(d) { return d.data.id; });

      var nodeEnter = node.enter().append("g")
        .attr("class", function(d) {
          return "d3-node-group branch-" + (d.data.branch || "heritage");
        })
        .attr("id", function(d) { return "d3Node_" + d.data.id; })
        .attr("transform", function() {
          var pt = d3.pointRadial(source.x0 || 0, source.y0 || 0);
          return "translate(" + pt[0] + "," + pt[1] + ")";
        })
        .style("cursor", "pointer")
        .on("click", function(event, d) {
          if (event.target && event.target.closest && event.target.closest(".d3-node-toggle-btn")) {
            toggleSubtree(d);
            updateTree(d, 400);
            return;
          }
          triggerMemberProfile(d);
        });

      // Cards in radial tree are rendered upright for 100% horizontal readability
      buildClassicalCard(nodeEnter, defs, {
        width: nodeWidth,
        height: nodeHeight,
        rx: rx,
        ry: ry,
        togglePosition: "bottom",
        clipPrefix: "rad"
      });

      var nodeUpdate = node.merge(nodeEnter).transition().duration(duration)
        .attr("transform", function(d) {
          var pt = d3.pointRadial(d.x, d.y);
          return "translate(" + pt[0] + "," + pt[1] + ")";
        });

      nodeUpdate.select(".d3-node-card-bg")
        .attr("fill", function(d) {
          return getCardData(d).branch.bg;
        })
        .attr("stroke", function(d) {
          if (d.selected) return "var(--gold)";
          return getCardData(d).branch.stroke;
        });

      nodeUpdate.select(".d3-node-toggle-btn text")
        .text(function(d) {
          return d._children ? "+" + (d._children.length || d.data.childrenCount) : (d.children ? "−" : "");
        });

      node.exit().transition().duration(duration)
        .attr("transform", function() {
          var pt = d3.pointRadial(source.x || 0, source.y || 0);
          return "translate(" + pt[0] + "," + pt[1] + ")";
        })
        .remove();

      d3Root.each(function(d) {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    updateTree(d3Root, 0);

    setTimeout(function() {
      if (typeof window.fitTreeToWidth === "function") window.fitTreeToWidth();
    }, 60);
  };

})(window);
