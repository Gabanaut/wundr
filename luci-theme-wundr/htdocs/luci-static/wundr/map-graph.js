'use strict';

(function (window, document) {
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var graphSerial = 0;
	var DEFAULT_ZONES = [
		{ id: 'lan', name: 'Main LAN', cidr: '192.168.0.0/24', network: 'Main', isolation: false, trust: 'Trusted' },
		{ id: 'guest', name: 'Guest Wi-Fi', cidr: '192.168.20.0/24', network: 'Guest', isolation: true, trust: 'Untrusted' },
		{ id: 'iot', name: 'IoT Devices', cidr: '192.168.30.0/24', network: 'IoT', isolation: true, trust: 'Restricted' },
		{ id: 'cameras', name: 'Security Cameras', cidr: '192.168.40.0/24', network: 'Cameras', isolation: true, trust: 'Restricted' }
	];

	function svg(name, attrs) {
		var node = document.createElementNS(SVG_NS, name);
		Object.keys(attrs || {}).forEach(function (key) {
			if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
		});
		return node;
	}

	function addText(parent, x, y, value, className, attrs) {
		var node = svg('text', Object.assign({ x: x, y: y, 'class': className || '' }, attrs || {}));
		node.textContent = String(value == null ? '' : value);
		parent.appendChild(node);
		return node;
	}

	function clear(node) {
		while (node.firstChild) node.removeChild(node.firstChild);
	}

	function padded(value) {
		return ('00' + value).slice(-3);
	}

	function clock() {
		return window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();
	}

	function findZone(device, zones) {
		var zoneId = String(device && (device.zone || '')).toLowerCase();
		var network = String(device && (device.network || device.interface || '')).toLowerCase();
		return zones.filter(function (zone) {
			return String(zone.id || '').toLowerCase() === zoneId || String(zone.network || '').toLowerCase() === network;
		})[0] || null;
	}

	function esc(value) {
		return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
		});
	}

	/* Rendered special endpoints: only real packet destinations. 'internal'
	   and 'private' aggregates are resolved onto zones instead of drawn. */
	var SPECIAL_TYPES = { internet: true, router: true };
	function isSpecialType(type) { return !!SPECIAL_TYPES[String(type || '')]; }

	function zoneHostOf(hostId, devices, zones) {
		if (String(hostId).indexOf('host:') !== 0) return '';
		var device = devices.filter(function (device) { return ('host:' + device.id) === hostId; })[0];
		if (!device) return '';
		var zone = findZone(device, zones);
		return zone ? zone.id : '';
	}

	function pairService(entry) {
		var raw = entry.policy ? String(entry.policy.service || '') : (entry.flow ? String(entry.flow.service || '') : '');
		var value = raw.toLowerCase();
		return value === 'any' || value === '' ? '' : value;
	}

	function aggregatePairs(entries) {
		var map = {};
		entries.forEach(function (entry) {
			var key = entry.from + '\u0000' + entry.to + '\u0000' + entry.action;
			if (!map[key]) map[key] = { from: entry.from, to: entry.to, action: entry.action, count: 0, services: [], names: [] };
			var pair = map[key];
			pair.count += 1;
			var service = pairService(entry);
			if (service && pair.services.indexOf(service) < 0) pair.services.push(service);
			var name = entry.policy ? (entry.policy.name || entry.policy.id) : (entry.flow ? entry.flow.detail : '');
			if (name) pair.names.push(name);
		});
		return Object.keys(map).map(function (key) { return map[key]; });
	}

	function edgeLine(from, to) {
		var dx = to.x - from.x, dy = to.y - from.y;
		var distance = Math.sqrt(dx * dx + dy * dy) || 1;
		var ux = dx / distance, uy = dy / distance;
		var midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
		/* Deterministic bow side: A→B and B→A curve apart instead of overlapping. */
		var side = String(from.id || '') < String(to.id || '') ? 1 : -1;
		var curve = Math.min(56, Math.max(0, distance * 0.13)) * side;
		var cx = midX - uy * curve, cy = midY + ux * curve;
		var fr = from.r || 6, tr = to.r || 6;
		var fx = from.x + ux * fr, fy = from.y + uy * fr;
		var tx = to.x - ux * tr, ty = to.y - uy * tr;
		return 'M' + fx.toFixed(1) + ' ' + fy.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1);
	}

	function stressDevices(zones, count) {
		var result = [];
		for (var i = 0; i < count; i++) {
			var zone = zones[i % zones.length];
			var third = String(zone.cidr || '').split('.')[2] || '0';
			var host = 10 + Math.floor(i / zones.length);
			result.push({
				id: 'stress-' + (i + 1),
				name: 'Client ' + padded(i + 1),
				ip: '192.168.' + third + '.' + host,
				mac: '02:00:0a' + padded(i + 1) + ':11:22:33',
				network: zone.network,
				zone: zone.id,
				stress: true
			});
		}
		return result;
	}

	function endpointNode(endpoint, nodesById, ensureSpecial) {
		if (!endpoint) return null;
		if (typeof endpoint === 'string') return nodesById[endpoint] ? endpoint : null;
		if (endpoint.type === 'zone') return nodesById['zone:' + endpoint.id] ? 'zone:' + endpoint.id : null;
		if (endpoint.type === 'device') return nodesById['host:' + endpoint.id] ? 'host:' + endpoint.id : null;
		if (isSpecialType(endpoint.type)) return ensureSpecial(endpoint.type);
		return null;
	}

	function build(options) {
		options = options || {};
		var stress = options.stress === true;
		var rawZones = Array.isArray(options.zones) ? options.zones.slice() : [];
		var zones = rawZones.length ? rawZones : (stress ? DEFAULT_ZONES.slice() : []);
		var reportedDevices = Array.isArray(options.devices) ? options.devices.slice() : [];
		var requestedCount = Number(options.stressCount);
		var stressCount = isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 512;
		var devices = stress ? stressDevices(zones, stressCount) : reportedDevices;
		var hasUnassigned = devices.some(function (device) { return !findZone(device, zones); });
		if (hasUnassigned) zones.push({ id: 'unassigned', name: 'Unassigned', cidr: 'No segment', network: '', isolation: true, trust: 'Unknown' });

		var nodes = [];
		var nodesById = {};
		function addNode(node) {
			if (!nodesById[node.id]) {
				nodesById[node.id] = node;
				nodes.push(node);
			}
			return nodesById[node.id];
		}

		var GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
		var zoneHosts = {};
		devices.forEach(function (device) {
			var zone = findZone(device, zones) || zones.filter(function (item) { return item.id === 'unassigned'; })[0];
			if (!zone) return;
			zoneHosts[zone.id] = zoneHosts[zone.id] || [];
			zoneHosts[zone.id].push(device);
		});
		var zonePositions = [
			{ x: 280, y: 195 }, { x: 720, y: 195 },
			{ x: 280, y: 465 }, { x: 720, y: 465 }
		];
		zones.forEach(function (zone, index) {
			var position = zonePositions[index];
			if (!position) {
				var angle = -Math.PI / 2 + (index * Math.PI * 2 / zones.length);
				position = { x: 500 + Math.cos(angle) * 230, y: 330 + Math.sin(angle) * 160 };
			}
			addNode({ id: 'zone:' + zone.id, kind: 'zone', zone: zone, x: position.x, y: position.y, r: 64, hostCount: (zoneHosts[zone.id] || []).length });
		});
		Object.keys(zoneHosts).forEach(function (zoneId) {
			var zoneNode = nodesById['zone:' + zoneId];
			var hosts = zoneHosts[zoneId];
			if (!zoneNode) return;
			var minSpacing = stress ? 5.2 : 11;
			var maxR = stress ? 54 : 50;
			/* Adaptive spread: few hosts stretch to fill the circle; dense zones
			   keep the safe minimum spacing so dots never overlap. */
			var spacing = Math.max(minSpacing, maxR / Math.sqrt(Math.max(1, hosts.length - 1) || 1));
			hosts.forEach(function (device, index) {
				var r = index === 0 ? 0 : Math.min(maxR, spacing * Math.sqrt(index));
				var angle = index * GOLDEN_ANGLE;
				addNode({
					id: 'host:' + device.id,
					kind: 'host',
					device: device,
					r: stress ? 3.5 : 5,
					x: zoneNode.x + Math.cos(angle) * r,
					y: zoneNode.y + Math.sin(angle) * r
				});
			});
		});

		var specialPosition = {
			internet: { x: 500, y: 50, label: 'Internet / WAN' },
			router: { x: 500, y: 315, label: 'Router services' }
		};
		function ensureSpecial(kind) {
			var position = specialPosition[kind] || { x: 500, y: 315, label: kind };
			return addNode({ id: kind, kind: 'special', special: kind, label: position.label, x: position.x, y: position.y, r: 24 }).id;
		}
			/* Aggregate endpoints expand onto concrete zones so the map shows real
			   places instead of abstract bubbles. 'private' -> every zone except the
			   source (isolation semantics). 'internal' -> [] (implied infrastructure). */
			function expandEndpoint(endpoint, sourceEndpoint) {
				if (!endpoint) return [];
				if (endpoint.type === 'private') {
					var srcId = sourceEndpoint && sourceEndpoint.type === 'zone' ? sourceEndpoint.id : null;
					return zones.filter(function (z) { return z.id !== srcId && z.id !== 'unassigned'; })
						.map(function (z) { return 'zone:' + z.id; })
						.filter(function (id) { return nodesById[id]; });
				}
				if (endpoint.type === 'internal') return [];
				var one = endpointNode(endpoint, nodesById, ensureSpecial);
				return one ? [one] : [];
			}

		/* Edge model: segment-level arrows for zone/special-to-zone/special policy,
		 * device lines only for rules that target a specific device (exceptions),
		 * plus observed flows that are not already implied by a segment arrow. */
		var zoneEdges = [];
		var zoneEdgeSeen = {};
		var exceptionEntries = [];
		var observedEntries = [];
		(Array.isArray(options.policies) ? options.policies : []).forEach(function (policy) {
			var action = String(policy.action || '').toLowerCase();
			if (action !== 'allow' && action !== 'deny') return;
				var froms = expandEndpoint(policy.source, null);
				var tos = expandEndpoint(policy.destination, policy.source);
				froms.forEach(function (from) {
					tos.forEach(function (to) {
						if (!from || !to || from === to) return;
						var fromLevel = String(from).indexOf('host:') !== 0;
						var toLevel = String(to).indexOf('host:') !== 0;
						if (fromLevel && toLevel) {
							var key = from + '\u0000' + to + '\u0000' + action;
							if (!zoneEdgeSeen[key]) {
								zoneEdgeSeen[key] = true;
								zoneEdges.push({ from: from, to: to, action: action, policy: policy });
							}
						} else {
							exceptionEntries.push({ from: from, to: to, action: action, policy: policy });
						}
					});
				});
		});
		(Array.isArray(options.observed) ? options.observed : []).forEach(function (flow) {
			var from = endpointNode({ type: 'device', id: flow.source }, nodesById, ensureSpecial);
			var destination = flow.destination === 'internet' ? { type: 'internet' } : { type: 'device', id: flow.destination };
			var to = endpointNode(destination, nodesById, ensureSpecial);
			var status = String(flow.status || '').toLowerCase();
			var action = status === 'allowed' || status === 'allow' ? 'allow' : (status === 'blocked' || status === 'deny' ? 'deny' : 'unknown');
			if (!from || !to || from === to || action === 'unknown') return;
			/* Suppress observed flows already implied by a segment-level rule so the
			 * map stays quiet; keep cross-segment evidence and intra-segment flows. */
			var fromSeg = from, toSeg = to;
			if (String(from).indexOf('host:') === 0) {
				var fromZoneId = zoneHostOf(from, devices, zones);
				if (fromZoneId) fromSeg = 'zone:' + fromZoneId;
			}
			if (String(to).indexOf('host:') === 0) {
				var toZoneId = zoneHostOf(to, devices, zones);
				if (toZoneId) toSeg = 'zone:' + toZoneId;
			}
			if (fromSeg !== toSeg && zoneEdgeSeen[fromSeg + '\u0000' + toSeg + '\u0000' + action]) return;
			observedEntries.push({ from: from, to: to, action: action, flow: flow });
		});
		var edges = aggregatePairs(exceptionEntries);
		var observedEdges = aggregatePairs(observedEntries);

		return {
			width: 1000,
			height: 660,
			zones: zones,
			devices: devices,
			nodes: nodes,
			zoneEdges: zoneEdges,
			edges: edges,
			observedEdges: observedEdges,
			clientCount: devices.length,
			stress: stress
		};
	}

	function render(container, options) {
		options = options || {};
		var started = clock();
		var graph = build(options);
		var labels = options.labels || {};
		var root = svg('svg', {
			'class': 'map-graph-svg',
			viewBox: '0 0 ' + graph.width + ' ' + graph.height,
			preserveAspectRatio: 'xMidYMid meet',
			role: 'img',
			'aria-label': labels.graph || 'Network topology graph'
		});
		var defs = svg('defs');
		defs.appendChild(svg('style', { type: 'text/css' })).textContent =
			'.map-graph-node-zone .map-graph-circle { fill: var(--wb-accent-soft); stroke: var(--wb-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; opacity: .55; }' +
			'.map-graph-node-zone.isolated .map-graph-circle { stroke: var(--wb-warn); }' +
			'.map-graph-node-special .map-graph-circle { fill: var(--wb-surface); stroke: var(--wb-text-soft); stroke-width: 1.5; vector-effect: non-scaling-stroke; }' +
			'.map-graph-node-host .map-graph-circle { fill: var(--wb-good); stroke: none; }' +
			'.map-graph-node-host.stress .map-graph-circle { fill: var(--wb-good); opacity: .55; }' +
			'.map-graph-node-host:hover .map-graph-circle, .map-graph-node-host:focus .map-graph-circle { fill: var(--wb-text); }' +
			'.map-graph-zone-label, .map-graph-special-label, .map-graph-zone-meta { font-family: var(--wb-font); fill: var(--wb-text); pointer-events: none; }' +
			'.map-graph-zone-label { font-size: 13.5px; font-weight: 700; }' +
			'.map-graph-zone-meta { font-size: 9.5px; fill: var(--wb-text-soft); }' +
			'.map-graph-special-label { font-size: 11px; font-weight: 700; }' +
			'.map-graph-empty { font-family: var(--wb-font); font-size: 14px; fill: var(--wb-text-soft); }' +
			'.map-graph-tip { position: absolute; z-index: 6; display: none; max-width: 272px; padding: 10px 12px; border: 1px solid var(--wb-border); border-radius: 10px; background: var(--wb-surface); color: var(--wb-text); font-size: 12px; line-height: 1.4; box-shadow: 0 12px 32px rgba(0,0,0,.35); pointer-events: none; }' +
			'.map-graph-tip strong { display: block; font-size: 12.5px; margin-bottom: 3px; }' +
			'.map-graph-tip .muted { color: var(--wb-text-soft); font-size: 11px; }' +
			'.map-graph-tip ul { margin: 7px 0 0; padding-left: 15px; display: grid; gap: 3px; }' +
			'.map-graph-tip .tip-row { display: flex; justify-content: space-between; gap: 14px; color: var(--wb-text-soft); font-size: 11px; margin-top: 4px; }' +
			'.map-graph-tip .tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; vertical-align: 1px; }' +
			'.map-graph-tip .tag.allow { background: rgba(63,174,106,.18); color: var(--wb-good); }' +
			'.map-graph-tip .tag.deny { background: rgba(224,82,82,.18); color: var(--wb-bad); }' +
			'.map-graph-tip .tag.observed { background: rgba(240,160,32,.18); color: var(--wb-warn); }';
		var allowMarkerId = 'wb-map-arrow-allow-' + (++graphSerial);
		var denyMarkerId = 'wb-map-arrow-deny-' + graphSerial;
		/* Fixed-size arrowheads (userSpaceOnUse) so they do not scale with stroke width. */
		var allowMarker = svg('marker', { id: allowMarkerId, markerWidth: 9, markerHeight: 8, refX: 7.5, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
		allowMarker.appendChild(svg('path', { d: 'M0,0 L8,4 L0,8 z', 'class': 'map-graph-arrow allow' }));
		var denyMarker = svg('marker', { id: denyMarkerId, markerWidth: 9, markerHeight: 8, refX: 7.5, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
		denyMarker.appendChild(svg('path', { d: 'M0,0 L8,4 L0,8 z', 'class': 'map-graph-arrow deny' }));
		defs.appendChild(allowMarker);
		defs.appendChild(denyMarker);
		root.appendChild(defs);
		root.appendChild(svg('rect', { x: 0, y: 0, width: graph.width, height: graph.height, rx: 18, 'class': 'map-graph-bg' }));
		var edgeLayer = svg('g', { 'class': 'map-graph-edges' });
		var nodeLayer = svg('g', { 'class': 'map-graph-nodes' });
		/* Zoom/pan viewport: everything except the background scales together. */
		var viewport = svg('g', { 'class': 'map-graph-viewport' });
		viewport.appendChild(edgeLayer);
		viewport.appendChild(nodeLayer);
		root.appendChild(viewport);

		/* --- Zoom & pan ---------------------------------------------------
		 * Wheel zooms toward the cursor (1×–8×), pointer drag pans,
		 * double-click resets. Pan is clamped so the graph cannot be lost
		 * off-canvas. A real drag suppresses the next synthetic click so
		 * host nodes do not open the inspector after a pan. */
		var view = { x: 0, y: 0, k: 1 };
		function applyView() {
			viewport.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
		}
		function clampPan() {
			if (view.k <= 1) { view.x = 0; view.y = 0; return; }
			view.x = Math.min(0, Math.max(graph.width * (1 - view.k), view.x));
			view.y = Math.min(0, Math.max(graph.height * (1 - view.k), view.y));
		}
		function svgPoint(event) {
			var rect = root.getBoundingClientRect();
			return {
				x: (event.clientX - rect.left) * graph.width / Math.max(1, rect.width),
				y: (event.clientY - rect.top) * graph.height / Math.max(1, rect.height)
			};
		}
		root.addEventListener('wheel', function (event) {
			event.preventDefault();
			var point = svgPoint(event);
			var next = Math.min(8, Math.max(1, view.k * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
			var ratio = next / view.k;
			view.x = point.x - ratio * (point.x - view.x);
			view.y = point.y - ratio * (point.y - view.y);
			view.k = next;
			clampPan();
			applyView();
		}, { passive: false });
		var drag = null;
		root.addEventListener('pointerdown', function (event) {
			drag = { sx: event.clientX, sy: event.clientY, vx: view.x, vy: view.y, moved: false };
			root.style.cursor = 'grabbing';
			hideTip();
		});
		root.addEventListener('pointermove', function (event) {
			if (!drag) return;
			var rect = root.getBoundingClientRect();
			var dx = (event.clientX - drag.sx) * graph.width / Math.max(1, rect.width);
			var dy = (event.clientY - drag.sy) * graph.height / Math.max(1, rect.height);
				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
					drag.moved = true;
					/* Capture only once panning actually starts, so plain clicks keep
					   their original target and host nodes still receive them. */
					try { root.setPointerCapture(event.pointerId); } catch (e) { /* older engines */ }
				}
			if (!drag.moved || view.k <= 1) return;
			view.x = drag.vx + dx;
			view.y = drag.vy + dy;
			clampPan();
			applyView();
		});
		var suppressClick = false;
		function endDrag(event) {
			/* click fires after pointerup, so remember whether the gesture moved
			   before clearing drag state — otherwise panning would also open hosts. */
			suppressClick = !!(drag && drag.moved);
			drag = null;
			root.style.cursor = '';
			/* Release pointer capture so the browser retargets the follow-up click
			   to the actual element under the pointer (e.g. a host node) instead of
			   this SVG root, which would swallow host clicks entirely. */
			if (event && event.pointerId != null) {
				try { root.releasePointerCapture(event.pointerId); } catch (e) { /* not captured */ }
			}
		}
		root.addEventListener('pointerup', endDrag);
		root.addEventListener('pointercancel', endDrag);
		root.addEventListener('click', function (event) {
			if (suppressClick) { event.stopPropagation(); event.preventDefault(); suppressClick = false; }
		}, true);
		root.addEventListener('dblclick', function () {
			view.x = 0; view.y = 0; view.k = 1;
			applyView();
		});

		var nodesById = {};
		graph.nodes.forEach(function (item) { nodesById[item.id] = item; });
		function node(id) { return nodesById[id] || null; }

		var visibleZoneEdges = graph.zoneEdges.filter(function (edge) { return edge.action === 'allow' || options.showDenied === true; });
		var visibleEdges = graph.edges.filter(function (edge) { return edge.action === 'allow' || options.showDenied === true; });
		var visibleObservedEdges = graph.observedEdges.filter(function (edge) { return edge.action === 'allow' || options.showDenied === true; });
		function edgeTitle(edge, observed) {
			var from = node(edge.from), to = node(edge.to);
			var fromName = from.zone ? from.zone.name : (from.label || from.id);
			var toName = to.zone ? to.zone.name : (to.label || to.id);
			var parts = [ fromName + ' → ' + toName + (edge.action === 'allow' ? ' · allowed' : ' · denied') ];
			if (edge.services && edge.services.length) parts.push('services: ' + edge.services.join(', '));
			if (edge.names && edge.names.length) parts.push(edge.names.join(' | '));
			if (edge.count > 1) parts.push(edge.count + (observed ? ' observed flows' : ' rules'));
			return parts.join('\n');
		}
		function drawEdge(edge, observed, zoneEdge) {
			var from = node(edge.from), to = node(edge.to);
			if (!from || !to) return;
			/* Device-involved edges (host↔host or host↔zone) render as thin
			   dotted lines; segment-level zone arrows stay thick and solid. */
			var className = 'map-graph-edge' + (zoneEdge ? ' zone-edge' : '') + (observed ? ' observed' : (!zoneEdge ? ' device-edge' : '')) + ' ' + edge.action;
			var marker = edge.action === 'deny' ? denyMarkerId : allowMarkerId;
			var path = svg('path', { d: edgeLine(from, to), 'class': className, 'marker-end': 'url(#' + marker + ')' });
			path.appendChild(svg('title')).textContent = edgeTitle(edge, observed);
			edgeLayer.appendChild(path);
		}
		visibleObservedEdges.forEach(function (edge) { drawEdge(edge, true, false); });
		visibleEdges.forEach(function (edge) { drawEdge(edge, false, false); });
		visibleZoneEdges.forEach(function (edge) { drawEdge(edge, false, true); });

		var tooltip = null;
		var tipVisible = false;
		function showTip(event, html) {
			if (!tooltip) return;
			tooltip.innerHTML = html;
			var bounds = container.getBoundingClientRect();
			var left = event.clientX - bounds.left + 14;
			var top = event.clientY - bounds.top + 12;
			var tipW = tooltip.offsetWidth || 220;
			if (left + tipW > bounds.width - 8) left = Math.max(8, event.clientX - bounds.left - tipW - 12);
			if (top + (tooltip.offsetHeight || 60) > bounds.height - 8) top = Math.max(8, event.clientY - bounds.top - (tooltip.offsetHeight || 60) - 12);
			tooltip.style.left = left + 'px';
			tooltip.style.top = top + 'px';
			tooltip.style.display = 'block';
			tipVisible = true;
		}
		function hideTip() {
			if (tooltip && tipVisible) { tooltip.style.display = 'none'; tipVisible = false; }
		}
		function bindTip(group, html) {
			if (!tooltip) return;
			group.addEventListener('mouseenter', function (event) { showTip(event, html); });
			group.addEventListener('mousemove', function (event) { if (tipVisible) showTip(event, html); });
			group.addEventListener('mouseleave', hideTip);
		}
		function endpointName(id) {
			var item = node(id);
			if (item) return item.zone ? item.zone.name : (item.label || item.id);
			if (String(id).indexOf('host:') === 0) {
				var device = graph.devices.filter(function (d) { return ('host:' + d.id) === id; })[0];
				return device ? (device.name || device.mac || device.id) : id;
			}
			return id;
		}
		function deviceTipHtml(device) {
			var zone = findZone(device, graph.zones);
			var rows = [];
			rows.push('<strong>' + esc(device.name || device.mac || device.id) + '</strong>');
			rows.push('<div class="muted">' + esc([device.ip, device.mac].filter(Boolean).join(' · ')) + (zone ? ' · ' + esc(zone.name) : '') + '</div>');
			var own = graph.edges.filter(function (edge) {
				return String(edge.from) === 'host:' + device.id || String(edge.to) === 'host:' + device.id;
			});
			var flowObs = graph.observedEdges.filter(function (edge) {
				return String(edge.from) === 'host:' + device.id || String(edge.to) === 'host:' + device.id;
			});
			var lines = own.concat(flowObs);
			if (lines.length) {
				rows.push('<ul>');
				lines.forEach(function (edge) {
					var outgoing = String(edge.from) === 'host:' + device.id;
					var other = outgoing ? endpointName(edge.to) : endpointName(edge.from);
					var service = (edge.services && edge.services.length) ? ' · ' + esc(edge.services.join(', ')) : '';
					rows.push('<li>' + (outgoing ? '→' : '←') + ' ' + esc(other) + service + ' <span class="tag ' + (edge.action === 'allow' ? 'allow' : 'deny') + '">' + (edge.action === 'allow' ? 'allowed' : 'denied') + '</span></li>');
				});
				rows.push('</ul>');
			}
			return rows.join('');
		}
		function zoneTipHtml(zone, hostCount) {
			var rows = [];
			rows.push('<strong>' + esc(zone.name || zone.id) + '</strong>');
			rows.push('<div class="muted">' + esc(zone.cidr || 'No segment') + (zone.trust ? ' · ' + esc(zone.trust) : '') + '</div>');
			var allows = graph.zoneEdges.filter(function (edge) { return edge.action === 'allow' && (edge.from === 'zone:' + zone.id || edge.to === 'zone:' + zone.id); });
			var denies = graph.zoneEdges.filter(function (edge) { return edge.action === 'deny' && (edge.from === 'zone:' + zone.id || edge.to === 'zone:' + zone.id); });
			if (allows.length || denies.length) {
				rows.push('<ul>');
				allows.concat(denies).forEach(function (edge) {
					var outgoing = edge.from === 'zone:' + zone.id;
					var other = outgoing ? endpointName(edge.to) : endpointName(edge.from);
					rows.push('<li>' + (outgoing ? '→' : '←') + ' ' + esc(other) + ' <span class="tag ' + edge.action + '">' + (edge.action === 'allow' ? 'allowed' : 'denied') + '</span></li>');
				});
				rows.push('</ul>');
			} else {
				rows.push('<div class="muted">No segment-level policy rules reported.</div>');
			}
			var exceptions = graph.edges.filter(function (edge) { return (edge.from === 'zone:' + zone.id || edge.to === 'zone:' + zone.id); });
			var hostCountText = String(hostCount || 0) + (hostCount === 1 ? ' device attached' : ' devices attached');
			rows.push('<div class="tip-row"><span>' + hostCountText + '</span><span>' + exceptions.length + ' device exceptions</span></div>');
			return rows.join('');
		}
		if (!graph.stress) container.style.position = 'relative';
		if (!graph.stress) {
			tooltip = document.createElement('div');
			tooltip.className = 'map-graph-tip';
		}

		graph.nodes.forEach(function (item) {
			var group = svg('g', { 'class': 'map-graph-node map-graph-node-' + item.kind + (item.kind === 'zone' && item.zone && item.zone.isolation ? ' isolated' : '') + (item.device && item.device.stress ? ' stress' : ''), 'data-node-id': item.id });
			if (options.selectedId && options.selectedId === item.id) group.setAttribute('class', group.getAttribute('class') + ' selected');
			var circle = svg('circle', { cx: item.x, cy: item.y, r: item.r || 6, 'class': 'map-graph-circle' });
			group.appendChild(circle);
			if (item.kind === 'zone') {
				/* Name above the circle, CIDR + device count below — both outside
				   the rim so phyllotaxis host dots never cover them. */
				addText(group, item.x, item.y - item.r - 10, item.zone.name || item.zone.id, 'map-graph-zone-label', { 'text-anchor': 'middle' });
				addText(group, item.x, item.y + item.r + 14, item.zone.cidr || 'Segment', 'map-graph-zone-meta', { 'text-anchor': 'middle' });
				var hostCount = item.hostCount || 0;
				addText(group, item.x, item.y + item.r + 27, hostCount + (hostCount === 1 ? ' device' : ' devices'), 'map-graph-zone-meta', { 'text-anchor': 'middle' });
				if (!graph.stress) bindTip(group, zoneTipHtml(item.zone, hostCount));
			} else if (item.kind === 'special') {
				addText(group, item.x, item.y + 42, labels[item.special] || item.label, 'map-graph-special-label', { 'text-anchor': 'middle' });
			} else if (!graph.stress) {
				group.setAttribute('tabindex', '0');
				group.setAttribute('role', 'button');
				group.setAttribute('aria-label', item.device.name || item.device.mac || item.device.id);
				if (typeof options.onHostClick === 'function') {
					group.addEventListener('click', function () { options.onHostClick(item.device); });
					group.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); options.onHostClick(item.device); } });
				}
				bindTip(group, deviceTipHtml(item.device));
			}
			nodeLayer.appendChild(group);
		});
		if (!graph.nodes.length) addText(root, 500, 330, labels.empty || 'No verified topology data is available.', 'map-graph-empty', { 'text-anchor': 'middle' });
		clear(container);
		container.appendChild(root);
		if (tooltip) container.appendChild(tooltip);
		var zoneAllowCount = graph.zoneEdges.filter(function (edge) { return edge.action === 'allow'; }).length;
		var exceptionCount = graph.edges.filter(function (edge) { return edge.action === 'allow'; }).length;
		return {
			nodeCount: graph.nodes.length,
			clientCount: graph.clientCount,
			zoneAllowCount: zoneAllowCount,
			exceptionCount: exceptionCount,
			allowedCount: zoneAllowCount + exceptionCount,
			deniedCount: graph.zoneEdges.filter(function (edge) { return edge.action === 'deny'; }).length + graph.edges.filter(function (edge) { return edge.action === 'deny'; }).length,
			observedAllowedCount: graph.observedEdges.filter(function (edge) { return edge.action === 'allow'; }).length,
			observedDeniedCount: graph.observedEdges.filter(function (edge) { return edge.action === 'deny'; }).length,
			visibleEdgeCount: visibleZoneEdges.length + visibleEdges.length + visibleObservedEdges.length,
			renderMs: Math.max(0, clock() - started),
			stress: graph.stress
		};
	}

	window.WBMapGraph = { build: build, render: render };
})(window, document);
