'use strict';
(function (window, document) {
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var graphSerial = 0;
	var SPECIAL_TYPES = { internet: true, router: true };
	var DEFAULT_ZONES = [
		{ id: 'lan', name: 'Main LAN', cidr: '192.168.0.0/24', network: 'Main', isolation: false, trust: 'Trusted' },
		{ id: 'guest', name: 'Guest Wi-Fi', cidr: '192.168.20.0/24', network: 'Guest', isolation: true, trust: 'Untrusted' },
		{ id: 'iot', name: 'IoT Devices', cidr: '192.168.30.0/24', network: 'IoT', isolation: true, trust: 'Restricted' },
		{ id: 'cameras', name: 'Security Cameras', cidr: '192.168.40.0/24', network: 'Cameras', isolation: true, trust: 'Restricted' }
	];

	function svg(name, attrs) {
		var el = document.createElementNS(SVG_NS, name);
		Object.keys(attrs || {}).forEach(function (k) {
			if (attrs[k] != null) el.setAttribute(k, String(attrs[k]));
		});
		return el;
	}

	function addText(parent, x, y, value, cls, attrs) {
		var el = svg('text', Object.assign({ x: x, y: y, 'class': cls || '' }, attrs || {}));
		el.textContent = String(value == null ? '' : value);
		parent.appendChild(el);
		return el;
	}

	function clear(el) {
		while (el && el.firstChild) el.removeChild(el.firstChild);
	}

	function clock() {
		return window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();
	}

	function esc(v) {
		return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
		});
	}

	function findZone(device, zones) {
		if (!device) return null;
		var explicit = Object.prototype.hasOwnProperty.call(device, 'zone');
		var zid = String(device.zone || '');
		var net = String(device.network || device.interface || '').toLowerCase();
		var fallback = null;
		for (var i = 0; i < zones.length; i++) {
			var z = zones[i];
			if (z.unassigned) { fallback = z; continue; }
			if (explicit) { if (zid && z.id === zid) return z; continue; }
			var id = String(z.id || '').toLowerCase();
			var zn = String(z.network || '').toLowerCase();
			var tokens = zn ? zn.split(/\s+/) : [];
			if (net && (zn === net || id === net || tokens.indexOf(net) >= 0)) return z;
		}
		return fallback;
	}

	function zoneHostOf(hostId, devicesById, zones) {
		if (String(hostId).indexOf('host:') !== 0) return '';
		var dev = devicesById[String(hostId).slice(5)];
		var z = findZone(dev, zones);
		return z ? z.id : '';
	}

	function pairService(entry) {
		var raw = entry.policy ? String(entry.policy.service || '') : (entry.flow ? String(entry.flow.service || '') : '');
		var v = raw.toLowerCase();
		return (v === 'any' || !v) ? '' : v;
	}

	function aggregatePairs(entries) {
		var map = {};
		entries.forEach(function (entry) {
			var key = entry.from + '\u0000' + entry.to + '\u0000' + entry.action;
			var pair = map[key] || (map[key] = { from: entry.from, to: entry.to, action: entry.action, count: 0, services: [], names: [] });
			pair.count += 1;
			var svc = pairService(entry);
			if (svc && pair.services.indexOf(svc) < 0) pair.services.push(svc);
			var nm = entry.policy ? (entry.policy.name || entry.policy.id) : (entry.flow ? entry.flow.detail : '');
			if (nm && pair.names.indexOf(nm) < 0) pair.names.push(nm);
		});
		return Object.keys(map).map(function (k) { return map[k]; });
	}

	function edgeLine(from, to) {
		var dx = to.x - from.x, dy = to.y - from.y;
		var dist = Math.hypot(dx, dy) || 1;
		var side = String(from.id || '') < String(to.id || '') ? 1 : -1;
		var bow = Math.min(50, Math.max(14, dist * 0.12)) * side;
		var cx = (from.x + to.x) * 0.5 - (dy / dist) * bow;
		var cy = (from.y + to.y) * 0.5 + (dx / dist) * bow;
		var sd = Math.hypot(cx - from.x, cy - from.y) || 1, fr = (from.r || 6) + 2.5;
		var fx = from.x + ((cx - from.x) / sd) * fr, fy = from.y + ((cy - from.y) / sd) * fr;
		var td = Math.hypot(to.x - cx, to.y - cy) || 1, tr = (to.r || 6) + 3.5;
		var tx = to.x - ((to.x - cx) / td) * tr, ty = to.y - ((to.y - cy) / td) * tr;
		return 'M' + fx.toFixed(1) + ' ' + fy.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1);
	}

	function layoutZones(count) {
		if (count <= 1) return [{ x: 500, y: 365, r: 84 }];
		if (count === 2) return [{ x: 300, y: 345, r: 76 }, { x: 700, y: 345, r: 76 }];
		if (count === 3) return [{ x: 255, y: 248, r: 68 }, { x: 745, y: 248, r: 68 }, { x: 500, y: 452, r: 68 }];
		if (count === 4) return [
			{ x: 265, y: 232, r: 64 }, { x: 735, y: 232, r: 64 },
			{ x: 265, y: 452, r: 64 }, { x: 735, y: 452, r: 64 }
		];
		var out = [], r = Math.max(44, Math.min(58, Math.round(224 / Math.sqrt(count))));
		for (var i = 0; i < count; i++) {
			var a = -Math.PI / 2 + (i * Math.PI * 2 / count);
			out.push({ x: Math.round(500 + Math.cos(a) * 320), y: Math.round(350 + Math.sin(a) * 172), r: r });
		}
		return out;
	}

	function stressDevices(zones, count) {
		var out = [];
		for (var i = 0; i < count; i++) {
			var z = zones[i % zones.length];
			var third = String(z.cidr || '').split('.')[2] || '0';
			var pad = ('00' + (i + 1)).slice(-3);
			out.push({
				id: 'stress-' + (i + 1),
				name: 'Client ' + pad,
				ip: '192.168.' + third + '.' + (10 + Math.floor(i / zones.length)),
				mac: '02:00:0a:' + pad.slice(0, 2) + ':' + pad.slice(1) + ':33',
				network: z.network,
				zone: z.id,
				stress: true
			});
		}
		return out;
	}

	function endpointNode(ep, nodesById, ensureSpecial) {
		if (!ep) return null;
		if (typeof ep === 'string') return nodesById[ep] ? ep : null;
		if (ep.type === 'zone') return nodesById['zone:' + ep.id] ? 'zone:' + ep.id : null;
		if (ep.type === 'device') return nodesById['host:' + ep.id] ? 'host:' + ep.id : null;
		if (SPECIAL_TYPES[String(ep.type || '')]) return ensureSpecial(ep.type);
		return null;
	}

	function build(options) {
		options = options || {};
		var stress = options.stress === true;
		var rawZones = Array.isArray(options.zones) ? options.zones.slice() : [];
		var zones = rawZones.length ? rawZones : (stress ? DEFAULT_ZONES.slice() : []);
		var reqCount = Number(options.stressCount);
		var stressCount = isFinite(reqCount) && reqCount > 0 ? Math.floor(reqCount) : 512;
		var rawDevices = stress ? stressDevices(zones, stressCount) : (Array.isArray(options.devices) ? options.devices : []);

		var devices = [], devicesById = Object.create(null);
		rawDevices.forEach(function (d, idx) {
			if (!d) return;
			var id = String(d.id != null ? d.id : (d.mac || ('dev-' + idx)));
			if (devicesById[id]) return;
			var copy = Object.assign({}, d, { id: id });
			devicesById[id] = copy;
			devices.push(copy);
		});

		if (devices.some(function (d) { return !findZone(d, zones); })) {
			var fallbackId = 'unassigned';
			while (zones.some(function (zone) { return zone.id === fallbackId; })) fallbackId += '-';
			zones.push({ id: fallbackId, name: 'Unassigned', network: '', unassigned: true });
		}

		var nodes = [], nodesById = {};
		function addNode(n) {
			if (!nodesById[n.id]) { nodesById[n.id] = n; nodes.push(n); }
			return nodesById[n.id];
		}

		var zoneHosts = Object.create(null);
		devices.forEach(function (d) {
			var z = findZone(d, zones) || zones[zones.length - 1];
			if (!z) return;
			(zoneHosts[z.id] = zoneHosts[z.id] || []).push(d);
		});

		var slots = layoutZones(zones.length);
		zones.forEach(function (z, i) {
			var slot = slots[i];
			addNode({
				id: 'zone:' + z.id, kind: 'zone', zone: z,
				x: slot.x, y: slot.y, r: slot.r,
				hostCount: (zoneHosts[z.id] || []).length
			});
		});

		var GOLDEN = Math.PI * (3 - Math.sqrt(5));
		Object.keys(zoneHosts).forEach(function (zid) {
			var zn = nodesById['zone:' + zid];
			var hosts = zoneHosts[zid];
			if (!zn) return;
			var maxR = Math.max(12, zn.r - (stress ? 9 : 16));
			var minSp = stress ? 4.6 : 12.5;
			var spacing = Math.max(minSp, maxR / Math.sqrt(Math.max(1, hosts.length) + 0.6));
			hosts.forEach(function (dev, i) {
				var rad = hosts.length === 1 ? 0 : Math.min(maxR, spacing * Math.sqrt(i + 0.35));
				var ang = i * GOLDEN;
				addNode({
					id: 'host:' + dev.id, kind: 'host', device: dev, zoneId: zid,
					r: stress ? 3.3 : 5,
					x: zn.x + Math.cos(ang) * rad,
					y: zn.y + Math.sin(ang) * rad
				});
			});
		});

		var routerY = zones.length === 1 ? 212 : (zones.length === 3 ? 332 : 342);
		var specialMeta = {
			internet: { x: 500, y: 66, r: 24, label: 'Internet / WAN' },
			router:   { x: 500, y: routerY, r: 21, label: 'Router services' }
		};
		function ensureSpecial(kind) {
			var m = specialMeta[kind] || { x: 500, y: 332, r: 21, label: kind };
			return addNode({ id: kind, kind: 'special', special: kind, label: m.label, x: m.x, y: m.y, r: m.r }).id;
		}

		function expandEndpoint(ep, srcEp) {
			if (!ep) return [];
			if (ep.type === 'private') {
				var srcId = srcEp && srcEp.type === 'zone' ? srcEp.id : null;
				return zones.filter(function (z) { return z.id !== srcId && !z.unassigned; })
					.map(function (z) { return 'zone:' + z.id; })
					.filter(function (id) { return nodesById[id]; });
			}
			if (ep.type === 'internal') return [];
			var one = endpointNode(ep, nodesById, ensureSpecial);
			return one ? [one] : [];
		}

		var zoneEdges = [], zoneEdgeSeen = {}, exceptionEntries = [], observedEntries = [], intraPolicies = {};
		var blockedHosts = {};

		(Array.isArray(options.policies) ? options.policies : []).forEach(function (pol) {
			if (!pol) return;
			var action = String(pol.action || '').toLowerCase();
			if (action !== 'allow' && action !== 'deny') return;
			var froms = expandEndpoint(pol.source, null);
			var tos = expandEndpoint(pol.destination, pol.source);
			froms.forEach(function (from) {
				tos.forEach(function (to) {
					if (!from || !to) return;
					if (from === to) {
						(intraPolicies[from] = intraPolicies[from] || []).push({ action: action, name: pol.name || pol.service || action });
						return;
					}
					var fromSeg = String(from).indexOf('host:') !== 0;
					var toSeg = String(to).indexOf('host:') !== 0;
					if (fromSeg && toSeg) {
						var k = from + '\u0000' + to + '\u0000' + action;
						if (!zoneEdgeSeen[k]) {
							zoneEdgeSeen[k] = true;
							zoneEdges.push({ from: from, to: to, action: action, policy: pol });
						}
					} else {
						if (action === 'deny' && String(from).indexOf('host:') === 0) blockedHosts[from] = true;
						exceptionEntries.push({ from: from, to: to, action: action, policy: pol });
					}
				});
			});
		});

		(Array.isArray(options.observed) ? options.observed : []).forEach(function (flow) {
			if (!flow) return;
			var from = endpointNode({ type: 'device', id: flow.source }, nodesById, ensureSpecial);
			var dest = flow.destination === 'internet' ? { type: 'internet' } : { type: 'device', id: flow.destination };
			var to = endpointNode(dest, nodesById, ensureSpecial);
			var st = String(flow.status || '').toLowerCase();
			var action = (st === 'allowed' || st === 'allow') ? 'allow' : ((st === 'blocked' || st === 'deny') ? 'deny' : 'unknown');
			if (!from || !to || from === to || action === 'unknown') return;
			var fSeg = String(from).indexOf('host:') === 0 ? ('zone:' + zoneHostOf(from, devicesById, zones)) : from;
			var tSeg = String(to).indexOf('host:') === 0 ? ('zone:' + zoneHostOf(to, devicesById, zones)) : to;
			if (fSeg !== tSeg && zoneEdgeSeen[fSeg + '\u0000' + tSeg + '\u0000' + action]) return;
			observedEntries.push({ from: from, to: to, action: action, flow: flow });
		});

		return {
			width: 1000, height: 620,
			zones: zones, devices: devices, nodes: nodes,
			zoneEdges: zoneEdges,
			edges: aggregatePairs(exceptionEntries),
			observedEdges: aggregatePairs(observedEntries),
			intraPolicies: intraPolicies,
			blockedHosts: blockedHosts,
			clientCount: devices.length,
			stress: stress
		};
	}

	function drawHubGlyph(parent, kind, cx, cy) {
		var g = svg('g', {
			'class': 'map-graph-hub-ico',
			transform: 'translate(' + (cx - 9).toFixed(1) + ' ' + (cy - 9).toFixed(1) + ') scale(0.75)'
		});
		if (kind === 'internet') {
			g.appendChild(svg('circle', { cx: 12, cy: 12, r: 8.5 }));
			g.appendChild(svg('ellipse', { cx: 12, cy: 12, rx: 3.8, ry: 8.5 }));
			g.appendChild(svg('path', { d: 'M3.5 12h17' }));
		} else {
			g.appendChild(svg('rect', { x: 3, y: 9, width: 18, height: 8, rx: 2 }));
			g.appendChild(svg('path', { d: 'M8 9V5M16 9V5' }));
			g.appendChild(svg('circle', { cx: 7.5, cy: 13, r: 1.1, 'class': 'dot-fill' }));
			g.appendChild(svg('circle', { cx: 11.5, cy: 13, r: 1.1, 'class': 'dot-fill' }));
		}
		parent.appendChild(g);
	}

	function render(container, options) {
		if (!container) return null;
		if (container.style) container.style.containerType = 'inline-size';
		options = options || {};
		var started = clock();
		var graph = build(options);
		var labels = options.labels || {};
		var uid = ++graphSerial;

		var root = svg('svg', {
			'class': 'map-graph-svg',
			viewBox: '0 0 ' + graph.width + ' ' + graph.height,
			preserveAspectRatio: 'xMidYMid meet',
			role: 'group',
			'aria-label': labels.graph || 'Network topology graph'
		});

		var defs = svg('defs');
		var gridId = 'wb-map-grid-' + uid;
		var allowId = 'wb-map-allow-' + uid;
		var denyId = 'wb-map-deny-' + uid;

		defs.appendChild(svg('style', { type: 'text/css' })).textContent =
			'.map-graph-grid-dot{fill:var(--wb-text-mute,var(--wb-text-soft));opacity:.16}' +
			'.map-graph-node-zone .map-graph-circle{fill:var(--wb-accent-soft,rgba(128,128,128,.1));stroke:var(--wb-accent);stroke-width:1.5;vector-effect:non-scaling-stroke;fill-opacity:.72;transition:stroke-width .15s,fill-opacity .15s}' +
			'.map-graph-node-zone.trusted .map-graph-circle{stroke:var(--wb-good-fill,var(--wb-good));fill:var(--wb-good-soft,rgba(31,157,97,.09))}' +
			'.map-graph-node-zone.isolated .map-graph-circle{stroke:var(--wb-warn-fill,var(--wb-warn));fill:var(--wb-warn-soft,rgba(217,143,0,.08))}' +
			'.map-graph-zone-ring{fill:none;stroke:var(--wb-warn-fill,var(--wb-warn));stroke-dasharray:4 4;opacity:.55;vector-effect:non-scaling-stroke;pointer-events:none}' +
			'.map-graph-node-special .map-graph-halo{fill:var(--wb-surface);fill-opacity:.5;stroke:var(--wb-border-strong,var(--wb-border));vector-effect:non-scaling-stroke}' +
			'.map-graph-node-special .map-graph-circle{fill:var(--wb-surface);stroke:var(--wb-accent);stroke-width:1.6;vector-effect:non-scaling-stroke}' +
			'.map-graph-hub-ico{fill:none;stroke:var(--wb-accent-text,var(--wb-accent));stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}' +
			'.map-graph-hub-ico .dot-fill{fill:var(--wb-accent-text,var(--wb-accent));stroke:none}' +
			'.map-graph-node-host .map-graph-circle{fill:var(--wb-good-fill,var(--wb-good));stroke:var(--wb-surface);stroke-width:1.4}' +
			'.map-graph-node-host.blocked .map-graph-circle{fill:var(--wb-bad-fill,var(--wb-bad))}' +
			'.map-graph-node-host.stress .map-graph-circle{stroke:none;opacity:.65}' +
			'.map-graph-node-host:hover .map-graph-circle,.map-graph-node-host:focus .map-graph-circle,.map-graph-node-host.selected .map-graph-circle{fill:var(--wb-text);stroke:var(--wb-accent);stroke-width:2}' +
			'.map-graph-zone-label,.map-graph-special-label,.map-graph-zone-meta{font-family:var(--wb-font);fill:var(--wb-text);pointer-events:none;paint-order:stroke fill;stroke:var(--wb-bg);stroke-width:4px;stroke-linejoin:round}' +
			'.map-graph-zone-label,.map-graph-special-label{font-size:15px;font-weight:700}' +
			'.map-graph-zone-meta{font-family:var(--wb-mono,monospace);font-size:13px;fill:var(--wb-text-soft)}' +
			'@container (max-width:900px){.map-graph-zone-label,.map-graph-special-label{font-size:22px}.map-graph-zone-meta{font-size:16px}}' +
			'@container (max-width:600px){.map-graph-zone-label,.map-graph-special-label{font-size:32px}.map-graph-zone-meta{display:none}}' +
			'@container (max-width:390px){.map-graph-zone-label,.map-graph-special-label{font-size:46px}}' +
			'@container (max-width:265px){.map-graph-zone-label,.map-graph-special-label{font-size:54px}}' +
			'.map-graph-empty{font-family:var(--wb-font);font-size:14px;fill:var(--wb-text-soft)}' +
			'.map-graph-svg.has-focus .map-graph-edge{opacity:.14}' +
			'.map-graph-svg.has-focus .map-graph-edge.is-hot{opacity:1}' +
			'.map-graph-edge-hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer;vector-effect:non-scaling-stroke}' +
			'.map-graph-tip{position:absolute;z-index:12;display:none;max-width:280px;padding:10px 12px;border:1px solid var(--wb-border);border-radius:var(--wb-radius-s,10px);background:var(--wb-surface);color:var(--wb-text);font-size:12px;line-height:1.42;box-shadow:var(--wb-shadow-lg,0 12px 32px rgba(0,0,0,.32));pointer-events:none}' +
			'.map-graph-tip strong{display:block;font-size:12.5px;margin-bottom:2px}' +
			'.map-graph-tip .muted{color:var(--wb-text-soft);font-size:11px;font-family:var(--wb-mono,monospace)}' +
			'.map-graph-tip ul{margin:7px 0 0;padding-left:15px;display:grid;gap:3px}' +
			'.map-graph-tip .tip-row{display:flex;justify-content:space-between;gap:14px;color:var(--wb-text-soft);font-size:11px;margin-top:6px;padding-top:5px;border-top:1px solid var(--wb-border)}' +
			'.map-graph-tip .tag{display:inline-block;margin-left:5px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;vertical-align:1px}' +
			'.map-graph-tip .tag.allow{background:var(--wb-good-soft);color:var(--wb-good)}' +
			'.map-graph-tip .tag.deny{background:var(--wb-bad-soft);color:var(--wb-bad)}' +
			'.map-graph-hud{position:absolute;right:10px;bottom:10px;z-index:5;display:inline-flex;gap:3px;padding:3px;border:1px solid var(--wb-border);border-radius:var(--wb-radius-s,8px);background:color-mix(in srgb,var(--wb-surface) 88%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
			'.map-graph-hud button{width:26px;height:24px;border:0;border-radius:5px;background:transparent;color:var(--wb-text-soft);font:700 12px/1 var(--wb-mono,monospace);cursor:pointer;padding:0;display:grid;place-items:center}' +
			'.map-graph-hud button:hover{background:var(--wb-surface-2,rgba(128,128,128,.14));color:var(--wb-text)}';

		var pat = svg('pattern', { id: gridId, width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
		pat.appendChild(svg('circle', { cx: 12, cy: 12, r: 0.9, 'class': 'map-graph-grid-dot' }));
		defs.appendChild(pat);

		function makeMarker(id, cls) {
			var m = svg('marker', { id: id, markerWidth: 9, markerHeight: 8, refX: 7.2, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
			m.appendChild(svg('path', { d: 'M0.6,0.8 L8.2,4 L0.6,7.2 L2.3,4 z', 'class': 'map-graph-arrow ' + cls }));
			return m;
		}
		defs.appendChild(makeMarker(allowId, 'allow'));
		defs.appendChild(makeMarker(denyId, 'deny'));
		root.appendChild(defs);

		root.appendChild(svg('rect', { x: 0, y: 0, width: graph.width, height: graph.height, rx: 14, 'class': 'map-graph-bg' }));
		root.appendChild(svg('rect', { x: 0, y: 0, width: graph.width, height: graph.height, rx: 14, fill: 'url(#' + gridId + ')', 'pointer-events': 'none' }));

		var edgeLayer = svg('g', { 'class': 'map-graph-edges' });
		var nodeLayer = svg('g', { 'class': 'map-graph-nodes' });
		var viewport = svg('g', { 'class': 'map-graph-viewport' });
		viewport.appendChild(edgeLayer);
		viewport.appendChild(nodeLayer);
		root.appendChild(viewport);

		var view = { x: 0, y: 0, k: 1 };
		function clampPan() {
			if (view.k <= 1.001) { view.k = 1; view.x = 0; view.y = 0; return; }
			view.x = Math.min(0, Math.max(graph.width * (1 - view.k), view.x));
			view.y = Math.min(0, Math.max(graph.height * (1 - view.k), view.y));
		}
		function applyView() {
			viewport.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
			if (root.style) {
				root.style.touchAction = view.k > 1.01 ? 'none' : 'pan-y pinch-zoom';
				root.style.cursor = view.k > 1.01 ? 'grab' : 'default';
			}
		}
		function zoomAt(factor, px, py) {
			var next = Math.min(8, Math.max(1, view.k * factor));
			var ratio = next / view.k;
			view.x = px - ratio * (px - view.x);
			view.y = py - ratio * (py - view.y);
			view.k = next;
			clampPan();
			applyView();
		}
		function svgPoint(ev) {
			var rect = root.getBoundingClientRect();
			return {
				x: (ev.clientX - rect.left) * graph.width / Math.max(1, rect.width),
				y: (ev.clientY - rect.top) * graph.height / Math.max(1, rect.height)
			};
		}
		applyView();

		root.addEventListener('wheel', function (ev) {
			ev.preventDefault();
			var pt = svgPoint(ev);
			zoomAt(ev.deltaY < 0 ? 1.18 : (1 / 1.18), pt.x, pt.y);
		}, { passive: false });

		var drag = null, suppressClick = false;
		root.addEventListener('pointerdown', function (ev) {
			if (view.k <= 1.01) return;
			drag = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
			hideTip();
		});
		root.addEventListener('pointermove', function (ev) {
			if (!drag) return;
			var rect = root.getBoundingClientRect();
			var dx = (ev.clientX - drag.sx) * graph.width / Math.max(1, rect.width);
			var dy = (ev.clientY - drag.sy) * graph.height / Math.max(1, rect.height);
			if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
				drag.moved = true;
				if (root.style) root.style.cursor = 'grabbing';
				try { root.setPointerCapture(ev.pointerId); } catch (e) {}
			}
			if (!drag.moved) return;
			view.x = drag.vx + dx;
			view.y = drag.vy + dy;
			clampPan();
			applyView();
		});
		function endDrag(ev) {
			suppressClick = !!(drag && drag.moved);
			drag = null;
			applyView();
			if (ev && ev.pointerId != null) {
				try { root.releasePointerCapture(ev.pointerId); } catch (e) {}
			}
		}
		root.addEventListener('pointerup', endDrag);
		root.addEventListener('pointercancel', endDrag);
		root.addEventListener('click', function (ev) {
			if (suppressClick) { ev.stopPropagation(); ev.preventDefault(); suppressClick = false; }
		}, true);
		root.addEventListener('dblclick', function () {
			view.x = 0; view.y = 0; view.k = 1;
			applyView();
		});

		var nodesById = {};
		graph.nodes.forEach(function (n) { nodesById[n.id] = n; });
		function node(id) { return nodesById[id] || null; }

		function endpointName(id) {
			var it = node(id);
			if (it) {
				if (it.zone) return it.zone.name || it.zone.id;
				if (it.special) return labels[it.special] || it.label || it.id;
				if (it.device) return it.device.name || it.device.mac || it.device.id;
			}
			return String(id);
		}

		var tooltip = null, tipVisible = false;
		if (!graph.stress) {
			if (container.style) container.style.position = 'relative';
			tooltip = document.createElement('div');
			tooltip.className = 'map-graph-tip';
		}
		function showTip(ev, html) {
			if (!tooltip) return;
			tooltip.innerHTML = html;
			tooltip.style.display = 'block';
			tipVisible = true;
			var bounds = container.getBoundingClientRect();
			if (!bounds.width) return;
			var tw = tooltip.offsetWidth || 220, th = tooltip.offsetHeight || 64;
			var left = ev.clientX - bounds.left + 14;
			var top = ev.clientY - bounds.top + 12;
			if (left + tw > bounds.width - 8) left = Math.max(8, ev.clientX - bounds.left - tw - 12);
			if (top + th > bounds.height - 8) top = Math.max(8, ev.clientY - bounds.top - th - 12);
			tooltip.style.left = left + 'px';
			tooltip.style.top = top + 'px';
		}
		function hideTip() {
			if (tooltip && tipVisible) { tooltip.style.display = 'none'; tipVisible = false; }
		}

		var renderedEdges = [];
		function focusEntity(entityId, singleEdge) {
			if (graph.stress) return;
			var anyMatch = false;
			renderedEdges.forEach(function (rec) {
				var hot = singleEdge ? (rec === singleEdge) :
					(rec.edge.from === entityId || rec.edge.to === entityId);
				rec.path.classList.toggle('is-hot', hot);
				if (hot) anyMatch = true;
			});
			root.classList.toggle('has-focus', anyMatch);
		}
		function clearFocus() {
			root.classList.remove('has-focus');
			renderedEdges.forEach(function (rec) { rec.path.classList.remove('is-hot'); });
		}

		function bindInteractive(el, htmlFn, focusId, edgeRec) {
			if (graph.stress) return;
			el.addEventListener('mouseenter', function (ev) {
				focusEntity(focusId, edgeRec);
				if (htmlFn) showTip(ev, htmlFn());
			});
			el.addEventListener('mousemove', function (ev) {
				if (tipVisible && htmlFn) showTip(ev, htmlFn());
			});
			el.addEventListener('mouseleave', function () {
				clearFocus();
				hideTip();
			});
		}

		var visibleZoneEdges = graph.zoneEdges.filter(function (e) { return e.action === 'allow' || options.showDenied === true; });
		var visibleEdges = graph.edges.filter(function (e) { return e.action === 'allow' || options.showDenied === true; });
		var visibleObservedEdges = graph.observedEdges.filter(function (e) { return e.action === 'allow' || options.showDenied === true; });

		function edgeTipHtml(edge, observed) {
			var tag = '<span class="tag ' + (edge.action === 'allow' ? 'allow' : 'deny') + '">' +
				(observed ? (edge.action === 'allow' ? 'observed allow' : 'observed block') : (edge.action === 'allow' ? 'allowed' : 'denied')) + '</span>';
			var rows = ['<strong>' + esc(endpointName(edge.from)) + ' → ' + esc(endpointName(edge.to)) + ' ' + tag + '</strong>'];
			if (edge.services && edge.services.length) rows.push('<div class="muted">Service: ' + esc(edge.services.join(', ')) + '</div>');
			if (edge.names && edge.names.length) rows.push('<div class="muted">' + esc(edge.names.slice(0, 3).join(' · ')) + '</div>');
			return rows.join('');
		}

		function drawEdge(edge, observed, zoneEdge) {
			var from = node(edge.from), to = node(edge.to);
			if (!from || !to) return;
			var d = edgeLine(from, to);
			var cls = 'map-graph-edge' + (zoneEdge ? ' zone-edge' : '') + (observed ? ' observed' : (!zoneEdge ? ' device-edge' : '')) + ' ' + edge.action;
			var marker = edge.action === 'deny' ? denyId : allowId;
			var path = svg('path', { d: d, 'class': cls, 'marker-end': 'url(#' + marker + ')' });
			edgeLayer.appendChild(path);
			var rec = { edge: edge, path: path };
			renderedEdges.push(rec);
			if (!graph.stress) {
				var hit = svg('path', { d: d, 'class': 'map-graph-edge-hit' });
				bindInteractive(hit, function () { return edgeTipHtml(edge, observed); }, null, rec);
				edgeLayer.appendChild(hit);
			}
		}
		visibleObservedEdges.forEach(function (e) { drawEdge(e, true, false); });
		visibleEdges.forEach(function (e) { drawEdge(e, false, false); });
		visibleZoneEdges.forEach(function (e) { drawEdge(e, false, true); });

		function deviceTipHtml(dev) {
			var z = findZone(dev, graph.zones);
			var rows = [
				'<strong>' + esc(dev.name || dev.mac || dev.id) + '</strong>',
				'<div class="muted">' + esc([dev.ip, dev.mac].filter(Boolean).join(' · ')) + (z ? ' · ' + esc(z.name) : '') + '</div>'
			];
			var lines = graph.edges.concat(graph.observedEdges).filter(function (e) {
				return e.from === 'host:' + dev.id || e.to === 'host:' + dev.id;
			});
			if (lines.length) {
				rows.push('<ul>');
				lines.forEach(function (e) {
					var out = e.from === 'host:' + dev.id;
					var other = out ? endpointName(e.to) : endpointName(e.from);
					var svc = (e.services && e.services.length) ? ' · ' + esc(e.services.join(', ')) : '';
					rows.push('<li>' + (out ? '→ ' : '← ') + esc(other) + svc + ' <span class="tag ' + (e.action === 'allow' ? 'allow' : 'deny') + '">' + (e.action === 'allow' ? 'allowed' : 'denied') + '</span></li>');
				});
				rows.push('</ul>');
			}
			return rows.join('');
		}

		function zoneTipHtml(z, hostCount) {
			var zid = 'zone:' + z.id;
			var rows = [
				'<strong>' + esc(z.name || z.id) + '</strong>',
				'<div class="muted">' + esc(z.cidr || 'Subnet not reported') + (z.inputPolicy ? ' · Router input: ' + esc(z.inputPolicy) : z.trust ? ' · ' + esc(z.trust) : '') + '</div>'
			];
			var segRules = graph.zoneEdges.filter(function (e) { return e.from === zid || e.to === zid; });
			var intra = graph.intraPolicies[zid] || [];
			if (segRules.length || intra.length) {
				rows.push('<ul>');
				segRules.forEach(function (e) {
					var out = e.from === zid;
					rows.push('<li>' + (out ? '→ ' : '← ') + esc(endpointName(out ? e.to : e.from)) + ' <span class="tag ' + e.action + '">' + (e.action === 'allow' ? 'allowed' : 'denied') + '</span></li>');
				});
				intra.forEach(function (ir) {
					rows.push('<li>↻ ' + esc(ir.name) + ' <span class="tag ' + ir.action + '">' + (ir.action === 'allow' ? 'intra allow' : 'intra deny') + '</span></li>');
				});
				rows.push('</ul>');
			} else {
				rows.push('<div class="muted" style="margin-top:5px">No explicit inter-zone rules.</div>');
			}
			var exc = graph.edges.filter(function (e) { return e.from === zid || e.to === zid; }).length;
			rows.push('<div class="tip-row"><span>' + hostCount + (hostCount === 1 ? ' client' : ' clients') + '</span><span>' + exc + ' exceptions</span></div>');
			return rows.join('');
		}

		graph.nodes.forEach(function (item) {
			var isIso = item.kind === 'zone' && item.zone && item.zone.isolation;
			var isTrusted = item.kind === 'zone' && item.zone && !item.zone.isolation && (item.zone.inputPolicy === 'ACCEPT' || item.zone.trust === 'Trusted');
			var isBlockedHost = item.kind === 'host' && !!graph.blockedHosts[item.id];
			var cls = 'map-graph-node map-graph-node-' + item.kind +
				(isIso ? ' isolated' : (isTrusted ? ' trusted' : '')) +
				(isBlockedHost ? ' blocked' : '') +
				(item.device && item.device.stress ? ' stress' : '') +
				(options.selectedId && options.selectedId === item.id ? ' selected' : '');
			var g = svg('g', { 'class': cls, 'data-node-id': item.id });

			if (item.kind === 'zone') {
				if (typeof options.onZoneClick === 'function') {
					g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
					g.setAttribute('aria-label', item.zone.name || item.zone.id);
					g.addEventListener('click', function () { options.onZoneClick(item.zone); });
					g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); options.onZoneClick(item.zone); } });
				}
				if (isIso) g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: item.r + 5, 'class': 'map-graph-zone-ring' }));
				g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: item.r, 'class': 'map-graph-circle' }));
				addText(g, item.x, item.y - item.r - (isIso ? 14 : 10), item.zone.name || item.zone.id, 'map-graph-zone-label', { 'text-anchor': 'middle' });
				var hc = item.hostCount || 0;
				var meta = (item.zone.cidr ? item.zone.cidr + ' · ' : '') + hc + (hc === 1 ? ' client' : ' clients');
				addText(g, item.x, item.y + item.r + (isIso ? 19 : 16), meta, 'map-graph-zone-meta', { 'text-anchor': 'middle' });
				bindInteractive(g, function () { return zoneTipHtml(item.zone, hc); }, item.id, null);
			} else if (item.kind === 'special') {
				g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: item.r + 5, 'class': 'map-graph-halo' }));
				g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: item.r, 'class': 'map-graph-circle' }));
				drawHubGlyph(g, item.special, item.x, item.y);
				var lbl = labels[item.special] || item.label;
				addText(g, item.x, item.special === 'internet' ? item.y - item.r - 3 : item.y + item.r + 19, lbl, 'map-graph-special-label', { 'text-anchor': 'middle' });
				bindInteractive(g, function () {
					var cnt = graph.zoneEdges.concat(graph.edges).filter(function (e) { return e.from === item.id || e.to === item.id; }).length;
					return '<strong>' + esc(lbl) + '</strong><div class="muted">' + cnt + ' policy path' + (cnt === 1 ? '' : 's') + '</div>';
				}, item.id, null);
			} else {
				if (!graph.stress) {
					g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: 11, 'class': 'map-graph-hit' }));
					g.setAttribute('tabindex', '0');
					g.setAttribute('role', 'button');
					g.setAttribute('aria-label', item.device.name || item.device.mac || item.device.id);
					if (typeof options.onHostClick === 'function') {
						g.addEventListener('click', function () { options.onHostClick(item.device); });
						g.addEventListener('keydown', function (ev) {
							if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); options.onHostClick(item.device); }
						});
					}
					bindInteractive(g, function () { return deviceTipHtml(item.device); }, item.id, null);
				}
				g.appendChild(svg('circle', { cx: item.x, cy: item.y, r: item.r || 5, 'class': 'map-graph-circle' }));
			}
			nodeLayer.appendChild(g);
		});

		if (!graph.nodes.length) {
			addText(root, 500, 310, labels.empty || 'No verified topology data is available.', 'map-graph-empty', { 'text-anchor': 'middle' });
		}

		var hud = document.createElement('div');
		hud.className = 'map-graph-hud';
		[
			['+', 'Zoom in', function () { zoomAt(1.35, graph.width / 2, graph.height / 2); }],
			['−', 'Zoom out', function () { zoomAt(1 / 1.35, graph.width / 2, graph.height / 2); }],
			['1:1', 'Reset view', function () { view.x = 0; view.y = 0; view.k = 1; applyView(); }]
		].forEach(function (spec) {
			var b = document.createElement('button');
			b.type = 'button';
			b.textContent = spec[0];
			b.title = spec[1];
			b.setAttribute('aria-label', spec[1]);
			b.addEventListener('click', spec[2]);
			hud.appendChild(b);
		});
		if (container.style) container.style.position = 'relative';

		clear(container);
		container.appendChild(root);
		container.appendChild(hud);
		if (tooltip) container.appendChild(tooltip);

		var zoneAllowCount = graph.zoneEdges.filter(function (e) { return e.action === 'allow'; }).length;
		var exceptionCount = graph.edges.filter(function (e) { return e.action === 'allow'; }).length;
		return {
			nodeCount: graph.nodes.length,
			clientCount: graph.clientCount,
			zoneAllowCount: zoneAllowCount,
			exceptionCount: exceptionCount,
			allowedCount: zoneAllowCount + exceptionCount,
			deniedCount: graph.zoneEdges.filter(function (e) { return e.action === 'deny'; }).length + graph.edges.filter(function (e) { return e.action === 'deny'; }).length,
			observedAllowedCount: graph.observedEdges.filter(function (e) { return e.action === 'allow'; }).length,
			observedDeniedCount: graph.observedEdges.filter(function (e) { return e.action === 'deny'; }).length,
			visibleEdgeCount: visibleZoneEdges.length + visibleEdges.length + visibleObservedEdges.length,
			renderMs: Math.max(0, clock() - started),
			stress: graph.stress
		};
	}

	var api = { build: build, render: render };
	if (typeof window !== 'undefined') window.WBMapGraph = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
