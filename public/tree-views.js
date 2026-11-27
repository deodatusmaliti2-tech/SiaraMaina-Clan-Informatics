/**
 * SiaraMaina Clan Platform - 10 Distinct Family Tree Visualization Engines
 * ------------------------------------------------------------------------
 * 4 Interactive 3D WebGL Views:
 *   1. 3D Spatial Hierarchical Tree (3d-spatial)
 *   2. 3D Radial Spherical Clan Tree (3d-radial)
 *   3. 3D Layered-Generation Tier Tree (3d-layered)
 *   4. 3D Family Constellation & Kinship Network (3d-network)
 *
 * 6 Classic 2D Views:
 *   5. Interactive Collapsible D3 Tree (2d-d3-collapsible)
 *   6. Classical Couple-Led Pedigree Tree (2d-classical)
 *   7. Genealogical Treemap Explorer (2d-treemap)
 *   8. Concentric Generational Fan Chart (2d-fan-chart)
 *   9. Horizontal Pedigree Flow (Left-to-Right) (2d-pedigree-ltr)
 *   10. Generational Stream & Multi-Column Matrix (2d-gen-stream)
 */

(function() {
  'use strict';

  // --- Branch Color Palette ---
  var BRANCH_COLORS = {
    heritage: 0xe9bf52, // Gold
    siara:    0x176d8c, // Deep Ocean Teal
    maina:    0x98591f, // Rich Amber Brown
    maliti:   0x713b20, // Dark Bronze
    default:  0x1e754c  // Forest Green
  };

  var BRANCH_HEX = {
    heritage: "#e9bf52",
    siara:    "#176d8c",
    maina:    "#98591f",
    maliti:   "#713b20",
    default:  "#1e754c"
  };

  function getRecordBranchColor(record) {
    if (!record) return BRANCH_COLORS.default;
    var b = (record.branchType || '').toLowerCase();
    return BRANCH_COLORS[b] || BRANCH_COLORS.default;
  }

  function getRecordBranchHex(record) {
    if (!record) return BRANCH_HEX.default;
    var b = (record.branchType || '').toLowerCase();
    return BRANCH_HEX[b] || BRANCH_HEX.default;
  }

  // --- Helper: Safe Member Children Traversal with Cycle Detection ---
  function getSafeChildren(memberId, visitedSet, filterBranch) {
    if (!memberId) return [];
    if (!visitedSet) visitedSet = new Set();
    if (visitedSet.has(memberId)) return [];
    visitedSet.add(memberId);

    var rawChildren = typeof childrenOf === 'function' ? childrenOf(memberId) : [];
    if (!Array.isArray(rawChildren)) return [];

    return rawChildren.filter(function(child) {
      if (!child || visitedSet.has(child.id)) return false;
      if (!filterBranch) return true;
      if (filterBranch === 'siara') {
        return (typeof isSiaraBranchMember === 'function' && isSiaraBranchMember(child)) || child.branchType === 'maliti';
      }
      return child.branchType === filterBranch;
    });
  }

  // --- Helper: Build In-Memory Genealogical Graph for Active Root ---
  function buildClanGraph(rootRecord, filterBranch) {
    if (!rootRecord) return { nodes: [], links: [], maxGen: 1 };
    var nodes = [];
    var links = [];
    var visited = new Set();
    var nodeMap = new Map();

    function traverse(rec, depth, parentNode) {
      if (!rec || visited.has(rec.id)) return;
      visited.add(rec.id);

      var gen = rec.generation || depth;
      var node = {
        id: rec.id,
        record: rec,
        name: typeof fullName === 'function' ? fullName(rec) : (rec.firstName + ' ' + rec.lastName),
        generation: gen,
        depth: depth,
        branch: rec.branchType || 'heritage',
        isDeceased: !!rec.deceased,
        color: getRecordBranchColor(rec),
        hex: getRecordBranchHex(rec),
        children: []
      };

      nodes.push(node);
      nodeMap.set(rec.id, node);

      if (parentNode) {
        links.push({ source: parentNode, target: node });
        parentNode.children.push(node);
      }

      var kids = getSafeChildren(rec.id, visited, filterBranch);
      kids.forEach(function(kid) {
        traverse(kid, depth + 1, node);
      });
    }

    traverse(rootRecord, 1, null);

    var maxGen = 1;
    nodes.forEach(function(n) { if (n.depth > maxGen) maxGen = n.depth; });

    return { nodes: nodes, links: links, maxGen: maxGen, nodeMap: nodeMap, rootNode: nodeMap.get(rootRecord.id) };
  }

  // --- WebGL Capability Detector ---
  function isWebGLAvailable() {
    try {
      var canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  function renderWebGLFallbackNotice(container, styleName) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:32px;text-align:center;background:#fffaf0;color:#78350f;">
        <div style="font-size:2.8rem;margin-bottom:12px;">⚠️</div>
        <h3 style="font-size:1.25rem;font-weight:900;margin-bottom:8px;color:#92400e;">3D Hardware Acceleration Unavailable</h3>
        <p style="max-width:540px;line-height:1.6;font-size:0.9rem;color:#b45309;margin-bottom:20px;">
          Your current device or browser environment does not support WebGL hardware rendering required for <strong>${styleName}</strong>.
          You can seamlessly view this family tree branch using any of our 6 rich Classic 2D views!
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="button primary" onclick="changeTreeStyle('2d-d3-collapsible')" style="padding:10px 18px;font-weight:800;">
            🌳 Switch to Collapsible D3 Tree
          </button>
          <button type="button" class="button secondary" onclick="changeTreeStyle('2d-fan-chart')" style="padding:10px 18px;font-weight:800;">
            🪭 Switch to Concentric Fan Chart
          </button>
        </div>
      </div>
    `;
  }

  // --- Global 3D State Management & Clean Resource Disposal ---
  window._tree3dState = {
    renderer: null,
    scene: null,
    camera: null,
    animId: null,
    controls: null,
    raycaster: null,
    mouse: null,
    interactiveMeshes: [],
    nodeRecordMap: new Map(),
    tooltipEl: null,
    cleanupFns: []
  };

  function cleanupCurrentTreeRenderer() {
    // 1. Cancel animation frame
    if (window._tree3dState.animId) {
      cancelAnimationFrame(window._tree3dState.animId);
      window._tree3dState.animId = null;
    }

    // 2. Run custom cleanup functions (listeners, timers)
    if (Array.isArray(window._tree3dState.cleanupFns)) {
      window._tree3dState.cleanupFns.forEach(function(fn) {
        try { fn(); } catch(e) { console.warn("Cleanup err:", e); }
      });
      window._tree3dState.cleanupFns = [];
    }

    // 3. Remove tooltip
    if (window._tree3dState.tooltipEl && window._tree3dState.tooltipEl.parentNode) {
      window._tree3dState.tooltipEl.parentNode.removeChild(window._tree3dState.tooltipEl);
      window._tree3dState.tooltipEl = null;
    }

    // 4. Dispose Three.js objects
    if (window._tree3dState.scene) {
      window._tree3dState.scene.traverse(function(obj) {
        if (obj.geometry) {
          try { obj.geometry.dispose(); } catch(e){}
        }
        if (obj.material) {
          try {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(function(m) { if (m.map) m.map.dispose(); m.dispose(); });
            } else {
              if (obj.material.map) obj.material.map.dispose();
              obj.material.dispose();
            }
          } catch(e){}
        }
      });
      window._tree3dState.scene = null;
    }

    // 5. Dispose renderer and remove canvas
    if (window._tree3dState.renderer) {
      try {
        window._tree3dState.renderer.dispose();
        if (window._tree3dState.renderer.domElement && window._tree3dState.renderer.domElement.parentNode) {
          window._tree3dState.renderer.domElement.parentNode.removeChild(window._tree3dState.renderer.domElement);
        }
      } catch(e){}
      window._tree3dState.renderer = null;
    }

    window._tree3dState.camera = null;
    window._tree3dState.interactiveMeshes = [];
    window._tree3dState.nodeRecordMap.clear();

    // 6. Reset D3 SVG cached instances if switching away
    window._treeD3Zoom = null;
    window._treeD3Svg = null;
    window.d3TreeSvgInstance = null;
  }
  window.cleanupCurrentTreeRenderer = cleanupCurrentTreeRenderer;

  // --- Helper: Create Sharp Billboard Sprite for 3D Node Labels ---
  function createTextSprite(text, subtext, colorHex, isDeceased) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 160;

    // Background Card
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = colorHex || '#e9bf52';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 140, 24);
    ctx.fill();
    ctx.stroke();

    // Text Name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Truncate name if too long
    var displayName = text;
    if (displayName.length > 22) displayName = displayName.substring(0, 20) + '...';
    ctx.fillText(displayName, 256, 60);

    // Subtext (Generation + Branch + Life status)
    ctx.fillStyle = colorHex || '#a7f3d0';
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    var fullSub = (subtext || '') + (isDeceased ? ' (Deceased)' : '');
    ctx.fillText(fullSub, 256, 110);

    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    var material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    var sprite = new THREE.Sprite(material);
    sprite.scale.set(70, 22, 1);
    return sprite;
  }

  // --- Standard Zero-Dependency Interactive Orbit & Touch Controller for 3D Trees ---
  function setupInteractive3DController(canvasEl, camera, scene, renderFn) {
    var isDragging = false;
    var isPanning = false;
    var previousMousePosition = { x: 0, y: 0 };
    var touchStartDist = 0;
    var target = new THREE.Vector3(0, 0, 0);
    var spherical = {
      radius: camera.position.length() || 650,
      theta: Math.atan2(camera.position.x, camera.position.z),
      phi: Math.acos(Math.max(-1, Math.min(1, camera.position.y / (camera.position.length() || 1))))
    };

    function updateCamera() {
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
      spherical.radius = Math.max(100, Math.min(3000, spherical.radius));

      camera.position.x = target.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z = target.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.lookAt(target);

      // Update zoom label in UI
      var zoomLabel = document.getElementById('treeZoomLabel');
      if (zoomLabel) {
        var pct = Math.round((700 / spherical.radius) * 100);
        zoomLabel.textContent = pct + '%';
      }
    }

    // Expose camera manipulation to toolbar buttons
    window.zoom3dCamera = function(delta) {
      var factor = delta > 0 ? 0.8 : 1.25;
      spherical.radius *= factor;
      updateCamera();
      if (renderFn) renderFn();
    };

    window.reset3dCamera = function() {
      spherical.radius = 650;
      spherical.theta = 0;
      spherical.phi = Math.PI / 3;
      target.set(0, 0, 0);
      updateCamera();
      if (renderFn) renderFn();
    };

    window.fit3dCamera = function() {
      if (window._tree3dState.interactiveMeshes.length > 0) {
        var box = new THREE.Box3();
        window._tree3dState.interactiveMeshes.forEach(function(m) { box.expandByObject(m); });
        box.getCenter(target);
        var size = box.getSize(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z);
        spherical.radius = Math.max(350, maxDim * 1.5);
        spherical.theta = 0.2;
        spherical.phi = Math.PI / 3.2;
        updateCamera();
        if (renderFn) renderFn();
      }
    };

    // Tooltip Element
    var tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;background:rgba(4,31,20,0.92);color:#fff;padding:8px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,0.3);border:1px solid #e9bf52;z-index:200;white-space:nowrap;transition:opacity 0.15s;';
    canvasEl.appendChild(tooltip);
    window._tree3dState.tooltipEl = tooltip;

    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();

    // Mouse Listeners
    function onMouseDown(e) {
      if (e.button === 2 || e.shiftKey) {
        isPanning = true;
      } else if (e.button === 0) {
        isDragging = true;
      }
      previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    function onMouseMove(e) {
      var rect = canvasEl.getBoundingClientRect();
      var clientX = e.clientX;
      var clientY = e.clientY;

      if (isDragging) {
        var deltaX = clientX - previousMousePosition.x;
        var deltaY = clientY - previousMousePosition.y;

        spherical.theta -= deltaX * 0.005;
        spherical.phi -= deltaY * 0.005;
        updateCamera();
        if (renderFn) renderFn();
      } else if (isPanning) {
        var panDeltaX = clientX - previousMousePosition.x;
        var panDeltaY = clientY - previousMousePosition.y;

        var panSpeed = spherical.radius * 0.001;
        var forward = new THREE.Vector3().subVectors(target, camera.position).normalize();
        var right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        var up = camera.up.clone().normalize();

        target.addScaledVector(right, -panDeltaX * panSpeed);
        target.addScaledVector(up, panDeltaY * panSpeed);
        updateCamera();
        if (renderFn) renderFn();
      } else {
        // Raycast for hover tooltip
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        var intersects = raycaster.intersectObjects(window._tree3dState.interactiveMeshes, false);

        if (intersects.length > 0) {
          var mesh = intersects[0].object;
          var rec = window._tree3dState.nodeRecordMap.get(mesh.id);
          if (rec) {
            canvasEl.style.cursor = 'pointer';
            tooltip.style.display = 'block';
            tooltip.style.left = (clientX - rect.left + 14) + 'px';
            tooltip.style.top = (clientY - rect.top + 14) + 'px';
            tooltip.innerHTML = `
              <div style="color:#e9bf52;font-size:0.8rem;font-weight:900;">${rec.firstName} ${rec.lastName}</div>
              <div style="font-size:0.68rem;color:#a7f3d0;">Gen ${rec.generation || 1} • ${rec.branchType || 'Clan'} ${rec.deceased ? '(Deceased)' : '• Living'}</div>
              <div style="font-size:0.65rem;color:#cbd5e1;margin-top:2px;">Click to view full clan profile</div>
            `;
          }
        } else {
          canvasEl.style.cursor = 'grab';
          tooltip.style.display = 'none';
        }
      }

      previousMousePosition = { x: clientX, y: clientY };
    }

    function onMouseUp(e) {
      if (isDragging && !isPanning && Math.abs(e.clientX - previousMousePosition.x) < 4 && Math.abs(e.clientY - previousMousePosition.y) < 4) {
        // Click raycast
        var rect = canvasEl.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        var intersects = raycaster.intersectObjects(window._tree3dState.interactiveMeshes, false);
        if (intersects.length > 0) {
          var mesh = intersects[0].object;
          var rec = window._tree3dState.nodeRecordMap.get(mesh.id);
          if (rec && typeof openProfile === 'function') {
            openProfile(rec);
          }
        }
      }
      isDragging = false;
      isPanning = false;
    }

    function onWheel(e) {
      e.preventDefault();
      spherical.radius *= (e.deltaY > 0 ? 1.1 : 0.9);
      updateCamera();
      if (renderFn) renderFn();
    }

    function onContextMenu(e) {
      e.preventDefault();
    }

    // Touch Listeners for Mobile & Tablets
    var touchStartX = 0, touchStartY = 0;
    var touchMoved = false;

    function onTouchStart(e) {
      if (e.touches.length === 1) {
        isDragging = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        previousMousePosition = { x: touchStartX, y: touchStartY };
        touchMoved = false;
      } else if (e.touches.length === 2) {
        isDragging = false;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.hypot(dx, dy);
      }
    }

    function onTouchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        var clientX = e.touches[0].clientX;
        var clientY = e.touches[0].clientY;
        var deltaX = clientX - previousMousePosition.x;
        var deltaY = clientY - previousMousePosition.y;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) touchMoved = true;

        spherical.theta -= deltaX * 0.007;
        spherical.phi -= deltaY * 0.007;
        updateCamera();
        if (renderFn) renderFn();
        previousMousePosition = { x: clientX, y: clientY };
      } else if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.hypot(dx, dy);
        if (touchStartDist > 0) {
          var factor = touchStartDist / dist;
          spherical.radius *= factor;
          updateCamera();
          if (renderFn) renderFn();
        }
        touchStartDist = dist;
      }
    }

    function onTouchEnd(e) {
      if (!touchMoved && e.changedTouches.length === 1) {
        // Tap selection on phone
        var touch = e.changedTouches[0];
        var rect = canvasEl.getBoundingClientRect();
        mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        var intersects = raycaster.intersectObjects(window._tree3dState.interactiveMeshes, false);
        if (intersects.length > 0) {
          var mesh = intersects[0].object;
          var rec = window._tree3dState.nodeRecordMap.get(mesh.id);
          if (rec && typeof openProfile === 'function') {
            openProfile(rec);
          }
        }
      }
      isDragging = false;
      touchStartDist = 0;
    }

    // Attach Event Handlers
    canvasEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('contextmenu', onContextMenu);
    canvasEl.addEventListener('touchstart', onTouchStart, { passive: true });
    canvasEl.addEventListener('touchmove', onTouchMove, { passive: false });
    canvasEl.addEventListener('touchend', onTouchEnd, { passive: true });

    // Register cleanup callback
    window._tree3dState.cleanupFns.push(function() {
      canvasEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('contextmenu', onContextMenu);
      canvasEl.removeEventListener('touchstart', onTouchStart);
      canvasEl.removeEventListener('touchmove', onTouchMove);
      canvasEl.removeEventListener('touchend', onTouchEnd);
    });

    updateCamera();
  }

  // =========================================================================
  // 1. STYLE 1: 3D SPATIAL HIERARCHICAL TREE
  // =========================================================================
  function render3dSpatialTree(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    if (!isWebGLAvailable() || typeof THREE === 'undefined') {
      renderWebGLFallbackNotice(container, '3D Spatial Hierarchical Tree');
      return;
    }

    var width = container.clientWidth || 900;
    var height = container.clientHeight || 600;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x041f14); // Deep Clan Forest Green
    scene.fog = new THREE.FogExp2(0x041f14, 0.0006);

    var camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 150, 750);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    window._tree3dState.renderer = renderer;
    window._tree3dState.scene = scene;
    window._tree3dState.camera = camera;

    // Lighting
    var ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    var dirLight = new THREE.DirectionalLight(0xffecd2, 1.2);
    dirLight.position.set(200, 500, 300);
    scene.add(dirLight);

    // Build Graph
    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No clan members found for this root/branch.</div>';
      return;
    }

    // Spatial Layout Calculation: Arrange generations vertically and spread along XZ ellipses
    var yLevelHeight = 150;
    var nodePositions = new Map();

    // Group nodes by depth
    var levels = [];
    graph.nodes.forEach(function(n) {
      if (!levels[n.depth]) levels[n.depth] = [];
      levels[n.depth].push(n);
    });

    levels.forEach(function(lvlNodes, d) {
      if (!lvlNodes) return;
      var count = lvlNodes.length;
      var radius = (d === 1) ? 0 : Math.max(120, (count * 45) / Math.PI);
      lvlNodes.forEach(function(n, idx) {
        var angle = (idx / count) * Math.PI * 2;
        var x = radius * Math.cos(angle);
        var y = 200 - (d - 1) * yLevelHeight;
        var z = radius * Math.sin(angle);
        nodePositions.set(n.id, new THREE.Vector3(x, y, z));
      });
    });

    // Render Connection Curves
    var lineMaterial = new THREE.LineBasicMaterial({
      color: 0xe9bf52,
      transparent: true,
      opacity: 0.65,
      linewidth: 2
    });

    graph.links.forEach(function(link) {
      var p1 = nodePositions.get(link.source.id);
      var p2 = nodePositions.get(link.target.id);
      if (p1 && p2) {
        var midY = (p1.y + p2.y) / 2;
        var ctrl = new THREE.Vector3((p1.x + p2.x) / 2, midY, (p1.z + p2.z) / 2);
        var curve = new THREE.QuadraticBezierCurve3(p1, ctrl, p2);
        var points = curve.getPoints(24);
        var geom = new THREE.BufferGeometry().setFromPoints(points);
        var line = new THREE.Line(geom, lineMaterial);
        scene.add(line);
      }
    });

    // Node Meshes & Billboard Sprites
    var sphereGeom = new THREE.SphereGeometry(12, 24, 24);
    var haloGeom = new THREE.RingGeometry(14, 18, 32);

    graph.nodes.forEach(function(node) {
      var pos = nodePositions.get(node.id) || new THREE.Vector3(0, 0, 0);

      var mat = new THREE.MeshStandardMaterial({
        color: node.color,
        roughness: 0.3,
        metalness: 0.2,
        emissive: node.color,
        emissiveIntensity: 0.25
      });

      var mesh = new THREE.Mesh(sphereGeom, mat);
      mesh.position.copy(pos);
      scene.add(mesh);

      // Glowing Halo Ring
      var haloMat = new THREE.MeshBasicMaterial({
        color: node.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7
      });
      var halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.copy(pos);
      halo.rotation.x = Math.PI / 2;
      scene.add(halo);

      // Billboard Text Label
      var label = createTextSprite(
        node.name,
        'Gen ' + node.generation + ' • ' + (node.record.branchType || 'Clan'),
        node.hex,
        node.isDeceased
      );
      label.position.set(pos.x, pos.y + 26, pos.z);
      scene.add(label);

      window._tree3dState.interactiveMeshes.push(mesh);
      window._tree3dState.nodeRecordMap.set(mesh.id, node.record);
    });

    // Ambient floating star-particles
    var particleCount = 200;
    var pGeom = new THREE.BufferGeometry();
    var pPositions = new Float32Array(particleCount * 3);
    for (var i = 0; i < particleCount * 3; i += 3) {
      pPositions[i] = (Math.random() - 0.5) * 1200;
      pPositions[i + 1] = (Math.random() - 0.5) * 800;
      pPositions[i + 2] = (Math.random() - 0.5) * 1200;
    }
    pGeom.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    var pMat = new THREE.PointsMaterial({ color: 0xe9bf52, size: 3, transparent: true, opacity: 0.4 });
    var particles = new THREE.Points(pGeom, pMat);
    scene.add(particles);

    // Setup Interactive Controls
    setupInteractive3DController(container, camera, scene, function() {
      renderer.render(scene, camera);
    });

    // Animation Loop
    function animate() {
      window._tree3dState.animId = requestAnimationFrame(animate);
      particles.rotation.y += 0.0005;
      renderer.render(scene, camera);
    }
    animate();

    // Initial Auto-Fit
    setTimeout(function() {
      if (typeof window.fit3dCamera === 'function') window.fit3dCamera();
    }, 60);

    // Responsive Resize Listener
    function onResize() {
      if (!container || !renderer || !camera) return;
      var w = container.clientWidth || 900;
      var h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    window._tree3dState.cleanupFns.push(function() {
      window.removeEventListener('resize', onResize);
    });
  }
  window.render3dSpatialTree = render3dSpatialTree;

  // =========================================================================
  // 2. STYLE 2: 3D RADIAL SPHERICAL CLAN TREE
  // =========================================================================
  function render3dRadialSphereTree(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    if (!isWebGLAvailable() || typeof THREE === 'undefined') {
      renderWebGLFallbackNotice(container, '3D Radial Spherical Clan Tree');
      return;
    }

    var width = container.clientWidth || 900;
    var height = container.clientHeight || 600;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x061826); // Deep Cosmic Navy
    scene.fog = new THREE.FogExp2(0x061826, 0.0005);

    var camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 200, 850);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    window._tree3dState.renderer = renderer;
    window._tree3dState.scene = scene;
    window._tree3dState.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    var light = new THREE.PointLight(0xe9bf52, 2, 1200);
    light.position.set(0, 0, 0);
    scene.add(light);

    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No clan members found for this root/branch.</div>';
      return;
    }

    // Radial Coordinates on Concentric Spherical Shells
    var baseRadiusStep = 130;
    var nodePositions = new Map();

    // Group by generation depth
    var genBuckets = [];
    graph.nodes.forEach(function(n) {
      if (!genBuckets[n.depth]) genBuckets[n.depth] = [];
      genBuckets[n.depth].push(n);
    });

    genBuckets.forEach(function(bucket, depth) {
      if (!bucket) return;
      var r = (depth - 1) * baseRadiusStep;

      // Draw Orbit Wireframe Ring on XZ plane
      if (r > 0) {
        var ringGeom = new THREE.RingGeometry(r - 1, r + 1, 64);
        var ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.25 });
        var ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
      }

      var count = bucket.length;
      bucket.forEach(function(node, idx) {
        if (depth === 1) {
          nodePositions.set(node.id, new THREE.Vector3(0, 0, 0));
        } else {
          var theta = (idx / count) * Math.PI * 2;
          // Vary phi slightly based on branch to create a 3D globe effect
          var branchOffset = (node.branch === 'siara') ? 0.3 : ((node.branch === 'maina') ? -0.3 : 0);
          var phi = Math.PI / 2 + branchOffset;
          var x = r * Math.sin(phi) * Math.cos(theta);
          var y = r * Math.cos(phi);
          var z = r * Math.sin(phi) * Math.sin(theta);
          nodePositions.set(node.id, new THREE.Vector3(x, y, z));
        }
      });
    });

    // Radial Links
    var linkMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6, linewidth: 2 });
    graph.links.forEach(function(link) {
      var p1 = nodePositions.get(link.source.id);
      var p2 = nodePositions.get(link.target.id);
      if (p1 && p2) {
        var geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        var line = new THREE.Line(geom, linkMat);
        scene.add(line);
      }
    });

    // Nodes
    var sphereGeom = new THREE.SphereGeometry(11, 20, 20);
    graph.nodes.forEach(function(node) {
      var pos = nodePositions.get(node.id) || new THREE.Vector3(0, 0, 0);
      var mat = new THREE.MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.35,
        roughness: 0.2
      });

      var mesh = new THREE.Mesh(sphereGeom, mat);
      mesh.position.copy(pos);
      scene.add(mesh);

      var label = createTextSprite(
        node.name,
        'Gen ' + node.generation + ' • ' + (node.record.branchType || 'Clan'),
        node.hex,
        node.isDeceased
      );
      label.position.set(pos.x, pos.y + 22, pos.z);
      scene.add(label);

      window._tree3dState.interactiveMeshes.push(mesh);
      window._tree3dState.nodeRecordMap.set(mesh.id, node.record);
    });

    setupInteractive3DController(container, camera, scene, function() {
      renderer.render(scene, camera);
    });

    function animate() {
      window._tree3dState.animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    setTimeout(function() {
      if (typeof window.fit3dCamera === 'function') window.fit3dCamera();
    }, 60);

    function onResize() {
      if (!container || !renderer || !camera) return;
      var w = container.clientWidth || 900;
      var h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    window._tree3dState.cleanupFns.push(function() {
      window.removeEventListener('resize', onResize);
    });
  }
  window.render3dRadialSphereTree = render3dRadialSphereTree;

  // =========================================================================
  // 3. STYLE 3: 3D LAYERED-GENERATION TIER TREE
  // =========================================================================
  function render3dLayeredTierTree(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    if (!isWebGLAvailable() || typeof THREE === 'undefined') {
      renderWebGLFallbackNotice(container, '3D Layered-Generation Tier Tree');
      return;
    }

    var width = container.clientWidth || 900;
    var height = container.clientHeight || 600;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // Slate Midnight Architecture
    scene.fog = new THREE.FogExp2(0x0f172a, 0.0004);

    var camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 300, 900);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    window._tree3dState.renderer = renderer;
    window._tree3dState.scene = scene;
    window._tree3dState.camera = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    var dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(300, 600, 400);
    scene.add(dir);

    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No clan members found for this root/branch.</div>';
      return;
    }

    var tierHeight = 160;
    var nodePositions = new Map();

    var tierBuckets = [];
    graph.nodes.forEach(function(n) {
      if (!tierBuckets[n.depth]) tierBuckets[n.depth] = [];
      tierBuckets[n.depth].push(n);
    });

    var maxDepth = graph.maxGen || 5;

    // Render Frosted Glass Tier Disc Platforms
    tierBuckets.forEach(function(nodesInTier, depth) {
      if (!nodesInTier) return;
      var y = (maxDepth / 2 - depth + 1) * tierHeight;
      var count = nodesInTier.length;
      var platformRadius = Math.max(160, count * 35);

      // Frosted Disc
      var discGeom = new THREE.CylinderGeometry(platformRadius, platformRadius, 4, 48);
      var discMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0.65
      });
      var disc = new THREE.Mesh(discGeom, discMat);
      disc.position.set(0, y, 0);
      scene.add(disc);

      // Glowing Neon Perimeter Border
      var rimGeom = new THREE.TorusGeometry(platformRadius, 2, 8, 48);
      var rimMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 });
      var rim = new THREE.Mesh(rimGeom, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, y + 2, 0);
      scene.add(rim);

      // Distribute nodes along circle on this platform
      nodesInTier.forEach(function(node, idx) {
        var r = (count === 1) ? 0 : platformRadius * 0.75;
        var angle = (idx / count) * Math.PI * 2;
        var x = r * Math.cos(angle);
        var z = r * Math.sin(angle);
        nodePositions.set(node.id, new THREE.Vector3(x, y + 16, z));
      });
    });

    // Vertical Fiber-Optic Connecting Beams
    var beamMat = new THREE.LineBasicMaterial({ color: 0xe9bf52, transparent: true, opacity: 0.7, linewidth: 2 });
    graph.links.forEach(function(link) {
      var p1 = nodePositions.get(link.source.id);
      var p2 = nodePositions.get(link.target.id);
      if (p1 && p2) {
        var midY = (p1.y + p2.y) / 2;
        var pMid1 = new THREE.Vector3(p1.x, midY, p1.z);
        var pMid2 = new THREE.Vector3(p2.x, midY, p2.z);
        var geom = new THREE.BufferGeometry().setFromPoints([p1, pMid1, pMid2, p2]);
        var line = new THREE.Line(geom, beamMat);
        scene.add(line);
      }
    });

    // Pedestal Boxes for Members
    var boxGeom = new THREE.BoxGeometry(18, 18, 18);
    graph.nodes.forEach(function(node) {
      var pos = nodePositions.get(node.id) || new THREE.Vector3(0, 0, 0);
      var mat = new THREE.MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.3,
        roughness: 0.3
      });

      var mesh = new THREE.Mesh(boxGeom, mat);
      mesh.position.copy(pos);
      scene.add(mesh);

      var label = createTextSprite(
        node.name,
        'Tier ' + node.generation + ' • ' + (node.record.branchType || 'Clan'),
        node.hex,
        node.isDeceased
      );
      label.position.set(pos.x, pos.y + 24, pos.z);
      scene.add(label);

      window._tree3dState.interactiveMeshes.push(mesh);
      window._tree3dState.nodeRecordMap.set(mesh.id, node.record);
    });

    setupInteractive3DController(container, camera, scene, function() {
      renderer.render(scene, camera);
    });

    function animate() {
      window._tree3dState.animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    setTimeout(function() {
      if (typeof window.fit3dCamera === 'function') window.fit3dCamera();
    }, 60);

    function onResize() {
      if (!container || !renderer || !camera) return;
      var w = container.clientWidth || 900;
      var h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    window._tree3dState.cleanupFns.push(function() {
      window.removeEventListener('resize', onResize);
    });
  }
  window.render3dLayeredTierTree = render3dLayeredTierTree;

  // =========================================================================
  // 4. STYLE 4: 3D FAMILY CONSTELLATION & KINSHIP NETWORK
  // =========================================================================
  function render3dConstellationNetwork(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    if (!isWebGLAvailable() || typeof THREE === 'undefined') {
      renderWebGLFallbackNotice(container, '3D Family Constellation Network');
      return;
    }

    var width = container.clientWidth || 900;
    var height = container.clientHeight || 600;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617); // Deep Deep Space Black
    scene.fog = new THREE.FogExp2(0x020617, 0.0003);

    var camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 150, 800);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    window._tree3dState.renderer = renderer;
    window._tree3dState.scene = scene;
    window._tree3dState.camera = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No clan members found for this root/branch.</div>';
      return;
    }

    // Branch Galactic Clusters Centers
    var clusterCenters = {
      heritage: new THREE.Vector3(0, 0, 0),
      siara:    new THREE.Vector3(-240, 60, -80),
      maina:    new THREE.Vector3(240, -40, 80),
      maliti:   new THREE.Vector3(0, -180, 200),
      default:  new THREE.Vector3(0, 120, -120)
    };

    var nodePositions = new Map();
    var branchCounts = {};

    graph.nodes.forEach(function(node) {
      var b = (node.branch || 'default').toLowerCase();
      if (!branchCounts[b]) branchCounts[b] = 0;
      var idx = branchCounts[b]++;
      var center = clusterCenters[b] || clusterCenters.default;

      // Golden ratio spiral distribution around branch nebula center
      var phi = idx * 2.39996;
      var dist = Math.sqrt(idx + 1) * 45 + (node.generation * 20);
      var x = center.x + dist * Math.cos(phi);
      var y = center.y + (Math.sin(idx * 1.5) * 40);
      var z = center.z + dist * Math.sin(phi);

      nodePositions.set(node.id, new THREE.Vector3(x, y, z));
    });

    // Glowing Starlight Filaments
    var filamentMat = new THREE.LineBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.65,
      linewidth: 2
    });

    graph.links.forEach(function(link) {
      var p1 = nodePositions.get(link.source.id);
      var p2 = nodePositions.get(link.target.id);
      if (p1 && p2) {
        var geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        var line = new THREE.Line(geom, filamentMat);
        scene.add(line);
      }
    });

    // Cosmic Dust Cloud Particles
    var dustCount = 400;
    var dustGeom = new THREE.BufferGeometry();
    var dustPos = new Float32Array(dustCount * 3);
    for (var i = 0; i < dustCount * 3; i += 3) {
      dustPos[i] = (Math.random() - 0.5) * 1600;
      dustPos[i + 1] = (Math.random() - 0.5) * 1000;
      dustPos[i + 2] = (Math.random() - 0.5) * 1600;
    }
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    var dustMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 2.5, transparent: true, opacity: 0.5 });
    var dust = new THREE.Points(dustGeom, dustMat);
    scene.add(dust);

    // Star Nodes (Icosahedron gems with point lights on elders)
    var starGeom = new THREE.IcosahedronGeometry(13, 1);
    graph.nodes.forEach(function(node) {
      var pos = nodePositions.get(node.id) || new THREE.Vector3(0, 0, 0);
      var mat = new THREE.MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.6,
        roughness: 0.1,
        metalness: 0.8
      });

      var mesh = new THREE.Mesh(starGeom, mat);
      mesh.position.copy(pos);
      scene.add(mesh);

      // Star Halo
      var haloGeom = new THREE.RingGeometry(15, 20, 24);
      var haloMat = new THREE.MeshBasicMaterial({ color: node.color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
      var halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.copy(pos);
      scene.add(halo);

      var label = createTextSprite(
        node.name,
        '⭐ Gen ' + node.generation + ' • ' + (node.record.branchType || 'Clan'),
        node.hex,
        node.isDeceased
      );
      label.position.set(pos.x, pos.y + 26, pos.z);
      scene.add(label);

      window._tree3dState.interactiveMeshes.push(mesh);
      window._tree3dState.nodeRecordMap.set(mesh.id, node.record);
    });

    setupInteractive3DController(container, camera, scene, function() {
      renderer.render(scene, camera);
    });

    function animate() {
      window._tree3dState.animId = requestAnimationFrame(animate);
      dust.rotation.y += 0.0003;
      renderer.render(scene, camera);
    }
    animate();

    setTimeout(function() {
      if (typeof window.fit3dCamera === 'function') window.fit3dCamera();
    }, 60);

    function onResize() {
      if (!container || !renderer || !camera) return;
      var w = container.clientWidth || 900;
      var h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    window._tree3dState.cleanupFns.push(function() {
      window.removeEventListener('resize', onResize);
    });
  }
  window.render3dConstellationNetwork = render3dConstellationNetwork;

  // =========================================================================
  // 8. STYLE 8: CONCENTRIC GENERATIONAL FAN CHART (2d-fan-chart)
  // =========================================================================
  function render2dFanChart(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No members found for this root/branch.</div>';
      return;
    }

    var width = container.clientWidth || 960;
    var height = container.clientHeight || 650;
    var maxGen = Math.min(graph.maxGen || 5, 6);

    // Setup responsive SVG wrapper
    container.innerHTML = `
      <div id="fanChartWrapper" style="width:100%;height:100%;position:relative;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <svg id="fanChartSvg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="touch-action:none;user-select:none;">
          <defs>
            <filter id="fanShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.12"/>
            </filter>
          </defs>
          <g id="fanChartZoomG" transform="translate(${width / 2}, ${height * 0.88})">
            <!-- Arcs injected here -->
          </g>
        </svg>
      </div>
    `;

    var svg = d3.select('#fanChartSvg');
    var zoomG = d3.select('#fanChartZoomG');

    // Pan & Zoom support
    var zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', function(event) {
        zoomG.attr('transform', event.transform);
        var label = document.getElementById('treeZoomLabel');
        if (label) label.textContent = Math.round(event.transform.k * 100) + '%';
      });

    svg.call(zoom);
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    // D3 Hierarchy for Radial Partition
    function makeHierarchy(node) {
      return {
        name: node.name,
        record: node.record,
        branch: node.branch,
        generation: node.generation,
        color: node.hex,
        children: node.children.map(makeHierarchy)
      };
    }

    var rootData = makeHierarchy(graph.rootNode);
    var d3Root = d3.hierarchy(rootData)
      .sum(function(d) { return (!d.children || d.children.length === 0) ? 1 : 0; })
      .sort(function(a, b) { return (a.data.record.order || 0) - (b.data.record.order || 0); });

    // Fan Chart Spans 180 Degrees (-PI/2 to PI/2)
    var maxRadius = Math.min(width, height * 1.5) * 0.75;
    var partition = d3.partition()
      .size([Math.PI, maxRadius]);

    partition(d3Root);

    var arc = d3.arc()
      .startAngle(function(d) { return d.x0 - Math.PI / 2; })
      .endAngle(function(d) { return d.x1 - Math.PI / 2; })
      .padAngle(0.005)
      .padRadius(maxRadius / 2)
      .innerRadius(function(d) { return Math.max(30, d.y0); })
      .outerRadius(function(d) { return Math.max(d.y0 + 20, d.y1 - 1); });

    var gArcs = zoomG.selectAll('g.fan-slice')
      .data(d3Root.descendants())
      .enter()
      .append('g')
      .attr('class', 'fan-slice')
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        if (d.data.record && typeof openProfile === 'function') {
          openProfile(d.data.record);
        }
      });

    // Slices
    gArcs.append('path')
      .attr('d', arc)
      .attr('fill', function(d) {
        if (d.depth === 0) return '#e9bf52';
        return d.data.color || '#1e754c';
      })
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#fanShadow)')
      .append('title')
      .text(function(d) {
        return d.data.name + ' (Gen ' + d.data.generation + ')';
      });

    // Text along Arc
    gArcs.append('text')
      .attr('transform', function(d) {
        var angle = (d.x0 + d.x1) / 2 - Math.PI / 2;
        var r = (d.y0 + d.y1) / 2;
        var deg = (angle * 180 / Math.PI);
        return 'rotate(' + deg + ') translate(' + r + ',0)' + (deg > 90 || deg < -90 ? ' rotate(180)' : '');
      })
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', '#ffffff')
      .attr('font-size', function(d) { return d.depth <= 2 ? '11px' : '9px'; })
      .attr('font-weight', 'bold')
      .text(function(d) {
        var arcLen = (d.x1 - d.x0) * ((d.y0 + d.y1) / 2);
        if (arcLen < 28) return '';
        var name = d.data.name || '';
        if (name.length > 14 && arcLen < 70) return name.split(' ')[0];
        return name;
      });

    // Center Hub Label
    zoomG.append('circle')
      .attr('r', 28)
      .attr('fill', '#103d2b')
      .attr('stroke', '#e9bf52')
      .attr('stroke-width', 3);

    zoomG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#e9bf52')
      .attr('font-size', '10px')
      .attr('font-weight', '900')
      .text('ORIGIN');
  }
  window.render2dFanChart = render2dFanChart;

  // =========================================================================
  // 9. STYLE 9: HORIZONTAL PEDIGREE FLOW (LEFT-TO-RIGHT) (2d-pedigree-ltr)
  // =========================================================================
  function render2dPedigreeLeftToRight(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    var graph = buildClanGraph(rootRecord, filterBranch);
    if (graph.nodes.length === 0) {
      container.innerHTML = '<div class="empty">No members found for this root/branch.</div>';
      return;
    }

    var width = container.clientWidth || 960;
    var height = container.clientHeight || 650;

    container.innerHTML = `
      <div id="ltrTreeWrapper" style="width:100%;height:100%;position:relative;background:#f8faf8;overflow:hidden;">
        <svg id="ltrTreeSvg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="touch-action:none;user-select:none;">
          <g id="ltrTreeZoomG">
            <g id="ltrTreeLinksG"></g>
            <g id="ltrTreeNodesG"></g>
          </g>
        </svg>
      </div>
    `;

    var svg = d3.select('#ltrTreeSvg');
    var zoomG = d3.select('#ltrTreeZoomG');
    var linksG = d3.select('#ltrTreeLinksG');
    var nodesG = d3.select('#ltrTreeNodesG');

    var zoom = d3.zoom()
      .scaleExtent([0.2, 2.5])
      .on('zoom', function(event) {
        zoomG.attr('transform', event.transform);
        var label = document.getElementById('treeZoomLabel');
        if (label) label.textContent = Math.round(event.transform.k * 100) + '%';
      });

    svg.call(zoom);
    window._treeD3Zoom = zoom;
    window._treeD3Svg = svg;

    // D3 Tree Layout Oriented Horizontally
    function makeHierarchy(node) {
      return {
        name: node.name,
        record: node.record,
        branch: node.branch,
        generation: node.generation,
        color: node.hex,
        children: node.children.map(makeHierarchy)
      };
    }

    var rootData = makeHierarchy(graph.rootNode);
    var d3Root = d3.hierarchy(rootData);

    // Compute dynamic sizing based on node counts
    var totalLeaves = d3Root.leaves().length;
    var treeH = Math.max(height - 100, totalLeaves * 60);
    var treeW = Math.max(width - 200, (graph.maxGen || 5) * 220);

    var treeLayout = d3.tree()
      .size([treeH, treeW])
      .separation(function(a, b) { return (a.parent === b.parent ? 1 : 1.25); });

    treeLayout(d3Root);

    // Swap X and Y coordinates for Left-to-Right orientation
    d3Root.descendants().forEach(function(d) {
      var tmp = d.x;
      d.x = d.y + 60;
      d.y = tmp + 40;
    });

    // Links
    var linkGen = d3.linkHorizontal()
      .x(function(d) { return d.x; })
      .y(function(d) { return d.y; });

    linksG.selectAll('path.ltr-link')
      .data(d3Root.links())
      .enter()
      .append('path')
      .attr('class', 'ltr-link')
      .attr('d', linkGen)
      .attr('fill', 'none')
      .attr('stroke', function(d) { return d.target.data.color || '#cbd5e1'; })
      .attr('stroke-width', 2.5)
      .attr('stroke-opacity', 0.7);

    // Nodes (Cards)
    var nodeGroups = nodesG.selectAll('g.ltr-node')
      .data(d3Root.descendants())
      .enter()
      .append('g')
      .attr('class', 'ltr-node')
      .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; })
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        if (d.data.record && typeof openProfile === 'function') {
          openProfile(d.data.record);
        }
      });

    // Node Card Rectangles
    nodeGroups.append('rect')
      .attr('x', -10)
      .attr('y', -24)
      .attr('width', 160)
      .attr('height', 48)
      .attr('rx', 8)
      .attr('fill', '#ffffff')
      .attr('stroke', function(d) { return d.data.color || '#1e754c'; })
      .attr('stroke-width', 2)
      .attr('filter', 'drop-shadow(0 2px 4px rgba(4,31,20,0.08))');

    // Branch Color Pill
    nodeGroups.append('rect')
      .attr('x', -10)
      .attr('y', -24)
      .attr('width', 6)
      .attr('height', 48)
      .attr('rx', 2)
      .attr('fill', function(d) { return d.data.color || '#1e754c'; });

    // Name Text
    nodeGroups.append('text')
      .attr('x', 6)
      .attr('y', -6)
      .attr('fill', '#0f172a')
      .attr('font-size', '10px')
      .attr('font-weight', '800')
      .text(function(d) {
        var n = d.data.name || '';
        return n.length > 20 ? n.substring(0, 18) + '...' : n;
      });

    // Subtext (Generation + Lifespan)
    nodeGroups.append('text')
      .attr('x', 6)
      .attr('y', 12)
      .attr('fill', '#64748b')
      .attr('font-size', '8.5px')
      .attr('font-weight', '700')
      .text(function(d) {
        var rec = d.data.record;
        var life = (rec && rec.dob) ? (rec.dob + ' - ' + (rec.dod || (rec.deceased ? 'Deceased' : 'Present'))) : ('Gen ' + d.data.generation);
        return life;
      });

    // Initial centering
    svg.call(zoom.transform, d3.zoomIdentity.translate(40, 20).scale(0.85));
  }
  window.render2dPedigreeLeftToRight = render2dPedigreeLeftToRight;

  // =========================================================================
  // 10. STYLE 10: GENERATIONAL STREAM & MULTI-COLUMN MATRIX (2d-gen-stream)
  // =========================================================================
  function render2dGenerationStreamMatrix(rootRecord, filterBranch) {
    var container = document.getElementById('treeCanvas');
    if (!container) return;
    cleanupCurrentTreeRenderer();

    var allRecords = typeof records !== 'undefined' ? records : [];
    if (!Array.isArray(allRecords) || allRecords.length === 0) {
      container.innerHTML = '<div class="empty">No clan records found.</div>';
      return;
    }

    // Filter by branch if requested
    var filtered = allRecords.filter(function(r) {
      if (!filterBranch) return true;
      if (filterBranch === 'siara') {
        return (typeof isSiaraBranchMember === 'function' && isSiaraBranchMember(r)) || r.branchType === 'maliti';
      }
      return r.branchType === filterBranch;
    });

    // Group into generations (1 to 5+)
    var genMap = new Map();
    filtered.forEach(function(r) {
      var g = r.generation || 1;
      if (!genMap.has(g)) genMap.set(g, []);
      genMap.get(g).push(r);
    });

    var sortedGens = Array.from(genMap.keys()).sort(function(a, b) { return a - b; });

    var genTitles = {
      1: "Gen 1 • Founding Ancestors",
      2: "Gen 2 • Clan Elders",
      3: "Gen 3 • Family Pillars",
      4: "Gen 4 • Contemporary Generation",
      5: "Gen 5 • Descendants & Youth",
      6: "Gen 6 • New Generations"
    };

    var html = `
      <div id="genStreamWrapper" style="width:100%;height:100%;overflow:auto;padding:16px;background:#f8faf8;box-sizing:border-box;">
        <div style="display:flex;gap:16px;min-width:max-content;align-items:flex-start;">
    `;

    sortedGens.forEach(function(g) {
      var members = genMap.get(g) || [];
      var title = genTitles[g] || ('Generation ' + g);

      html += `
        <div style="width:280px;flex:0 0 280px;background:#ffffff;border:1.5px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 3px 12px rgba(4,31,20,0.05);display:flex;flex-direction:column;">
          <div style="background:var(--forest);color:#ffffff;padding:10px 14px;border-bottom:2px solid var(--gold);display:flex;align-items:center;justify-content:space-between;">
            <strong style="font-size:0.82rem;">${title}</strong>
            <span style="background:var(--gold);color:var(--forest);font-size:0.7rem;font-weight:900;padding:2px 8px;border-radius:99px;">${members.length}</span>
          </div>
          <div style="padding:10px;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 340px);overflow-y:auto;">
      `;

      members.forEach(function(m) {
        var bHex = getRecordBranchHex(m);
        var fName = typeof fullName === 'function' ? fullName(m) : (m.firstName + ' ' + m.lastName);
        var life = (m.dob ? m.dob : '?') + ' - ' + (m.dod ? m.dod : (m.deceased ? 'Deceased' : 'Present'));

        html += `
          <div onclick="if(typeof openProfile==='function') openProfile(findRecord('${m.id}'))" style="border:1px solid #e2e8f0;border-left:4px solid ${bHex};border-radius:8px;padding:8px 10px;background:#ffffff;cursor:pointer;transition:transform 0.12s, box-shadow 0.12s;box-shadow:0 1px 4px rgba(0,0,0,0.03);" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(4,31,20,0.1)';" onmouseout="this.style.transform='none';this.style.boxShadow='0 1px 4px rgba(0,0,0,0.03)';">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
              <strong style="font-size:0.78rem;color:var(--forest);">${fName}</strong>
              <span style="font-size:0.62rem;font-weight:900;color:${bHex};text-transform:uppercase;">${m.branchType || 'Clan'}</span>
            </div>
            <div style="font-size:0.68rem;color:#64748b;">${life}</div>
            ${m.occupation ? `<div style="font-size:0.65rem;color:#475569;margin-top:2px;">💼 ${m.occupation}</div>` : ''}
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
  }
  window.render2dGenerationStreamMatrix = render2dGenerationStreamMatrix;

  console.log("✅ SiaraMaina 10 Family Tree Visualization Engines loaded successfully.");
})();
