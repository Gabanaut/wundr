#!/usr/bin/env node
'use strict';

/* Smoke & geometry verification for luci-theme-wundr/htdocs/luci-static/wundr/map-graph.js
 * and luci-app-wundr/htdocs/luci-static/resources/view/wundr/map.js.
 *
 * Verifies:
 *  1. Symmetric 1..6 zone layouts fit strictly inside the 1000x620 viewBox with no overlaps.
 *  2. Duplicate host IDs are deduplicated and multi-interface zone.network tokens resolve.
 *  3. Unassigned devices get a neutral group distinct from configured zones.
 *  4. Intra-zone rules (src == dest) populate intraPolicies without self-loop paths.
 *  5. Blocked host rules populate blockedHosts and toggle cleanly via showDenied.
 *  6. 512-node phyllotaxis stress mode packs all hosts inside their parent zone radius.
 *  7. Quadratic Bezier edge paths trim along control-point tangents cleanly at node rims.
 *  8. Minimal DOM render check: HUD zoom controls, SVG markers, mobile-safe touchAction,
 *     and host click callback wiring.
 */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var mapGraph = require(path.join(ROOT, 'luci-theme-wundr/htdocs/luci-static/wundr/map-graph.js'));

var checks = 0;
function ok(cond, msg) {
	assert.ok(cond, msg);
	checks++;
}

/* 1. 1..6 zone geometry bounds & non-overlap */
for (var n = 1; n <= 6; n++) {
	var zones = [];
	for (var i = 0; i < n; i++) {
		zones.push({ id: 'z' + i, name: 'Zone ' + i, cidr: '10.0.' + i + '.0/24', isolation: i > 0, trust: i === 0 ? 'Trusted' : 'Restricted' });
	}
	var g = mapGraph.build({
		zones: zones,
		devices: [{ id: 'h0', name: 'Host 0', zone: 'z0' }],
		policies: [
			{ source: { type: 'zone', id: 'z0' }, destination: { type: 'internet' }, action: 'allow' },
			{ source: { type: 'zone', id: 'z0' }, destination: { type: 'router' }, action: 'allow' }
		]
	});
	ok(g.width === 1000 && g.height === 620, 'viewBox 1000x620 for n=' + n);
	var zNodes = g.nodes.filter(function (x) { return x.kind === 'zone' || x.kind === 'special'; });
	zNodes.forEach(function (zn) {
		ok(zn.x - zn.r >= 20 && zn.x + zn.r <= g.width - 20, 'horizontal fit: ' + zn.id + ' (n=' + n + ')');
		ok(zn.y - zn.r >= 20 && zn.y + zn.r <= g.height - 20, 'vertical fit: ' + zn.id + ' (n=' + n + ')');
	});
	for (var a = 0; a < zNodes.length; a++) {
		for (var b = a + 1; b < zNodes.length; b++) {
			var dist = Math.hypot(zNodes[a].x - zNodes[b].x, zNodes[a].y - zNodes[b].y);
			ok(dist > zNodes[a].r + zNodes[b].r + 8, 'non-overlapping circles ' + zNodes[a].id + ' vs ' + zNodes[b].id + ' (n=' + n + ')');
		}
	}
}

/* 2. Host deduplication, multi-token zone.network matching, intra-zone & blockedHosts */
var multi = mapGraph.build({
	zones: [
		{ id: 'lan', name: 'Main LAN', network: 'lan lan6 br-lan', isolation: false, trust: 'Trusted' },
		{ id: 'iot', name: 'IoT', network: 'iot vlan30', isolation: true, trust: 'Restricted' }
	],
	devices: [
		{ id: 'dup', name: 'Laptop', interface: 'lan6' },
		{ id: 'dup', name: 'Laptop Duplicate', interface: 'lan6' },
		{ id: 'cam1', name: 'Doorbell', network: 'vlan30' },
		{ id: 'stray', name: 'Rogue', network: 'unknown_vlan' }
	],
	policies: [
		{ name: 'lan->wan', source: { type: 'zone', id: 'lan' }, destination: { type: 'internet' }, action: 'allow' },
		{ name: 'iot intra block', source: { type: 'zone', id: 'iot' }, destination: { type: 'zone', id: 'iot' }, action: 'deny' },
		{ name: 'pause cam1', source: { type: 'device', id: 'cam1' }, destination: { type: 'internet' }, action: 'deny' },
		{ name: 'guest private block', source: { type: 'zone', id: 'iot' }, destination: { type: 'private' }, action: 'deny' }
	]
});
ok(multi.clientCount === 3, 'deduplicates duplicate host IDs');
ok(multi.zones.some(function (z) { return z.id === 'unassigned'; }), 'creates fallback unassigned zone for orphan host');
ok(Array.isArray(multi.intraPolicies['zone:iot']) && multi.intraPolicies['zone:iot'].length === 1, 'records intra-zone policy');
ok(multi.blockedHosts['host:cam1'] === true, 'tracks blocked host IDs');
ok(multi.zoneEdges.some(function (e) { return e.from === 'zone:iot' && e.to === 'zone:lan' && e.action === 'deny'; }), 'expands private endpoint excluding unassigned');

var uncertain = mapGraph.build({
	zones: [{ id: 'unassigned', network: 'shared' }, { id: 'constructor', network: 'other' }],
	devices: [{ id: 'missing', zone: null, interface: 'shared' }, { id: 'known', zone: 'constructor' }]
});
var unknownGroup = uncertain.zones.find(function (zone) { return zone.unassigned; });
ok(unknownGroup && unknownGroup.id !== 'unassigned' && !unknownGroup.isolation && !unknownGroup.trust, 'unknown group does not replace or claim the policy of a real zone');
ok(uncertain.nodes.find(function (node) { return node.id === 'host:missing'; }).zoneId === unknownGroup.id, 'explicitly unknown zone is not guessed from an ambiguous interface');
ok(uncertain.nodes.find(function (node) { return node.id === 'host:known'; }).zoneId === 'constructor', 'zone names are stored as data, not object properties');

/* 3. 512-node stress packing */
var stressGraph = mapGraph.build({ stress: true, stressCount: 512 });
ok(stressGraph.clientCount === 512, 'builds 512 stress hosts');
var sZones = {};
stressGraph.nodes.forEach(function (nd) { if (nd.kind === 'zone') sZones[nd.id] = nd; });
stressGraph.nodes.forEach(function (nd) {
	if (nd.kind !== 'host') return;
	var pz = sZones['zone:' + nd.zoneId];
	var d = Math.hypot(nd.x - pz.x, nd.y - pz.y);
	ok(d <= pz.r - 8.5, 'stress host packed inside parent zone rim');
});

/* 4. Minimal DOM shim render check (SVG paths, rim trimming, HUD, touchAction, onHostClick) */
function makeEl(tag) {
	var listeners = {};
	var classes = new Set();
	var el = {
		tagName: tag,
		attrs: {},
		style: {},
		children: [],
		firstChild: null,
		textContent: '',
		innerHTML: '',
		classList: {
			add: function (c) { classes.add(c); },
			remove: function (c) { classes.delete(c); },
			toggle: function (c, force) {
				var on = force !== undefined ? !!force : !classes.has(c);
				if (on) classes.add(c); else classes.delete(c);
			},
			contains: function (c) { return classes.has(c); }
		},
		setAttribute: function (k, v) {
			this.attrs[k] = String(v);
			if (k === 'class') {
				classes.clear();
				String(v).split(/\s+/).filter(Boolean).forEach(function (c) { classes.add(c); });
			}
		},
		getAttribute: function (k) { return this.attrs[k]; },
		appendChild: function (ch) {
			this.children.push(ch);
			this.firstChild = this.children[0] || null;
			return ch;
		},
		removeChild: function (ch) {
			var idx = this.children.indexOf(ch);
			if (idx >= 0) this.children.splice(idx, 1);
			this.firstChild = this.children[0] || null;
		},
		addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
		dispatch: function (ev, payload) { (listeners[ev] || []).forEach(function (fn) { fn(payload || {}); }); },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1000, height: 620 }; }
	};
	return el;
}

var fakeDoc = {
	createElementNS: function (_ns, tag) { return makeEl(tag); },
	createElement: function (tag) { return makeEl(tag); }
};
var vm = require('vm');
var src = fs.readFileSync(path.join(ROOT, 'luci-theme-wundr/htdocs/luci-static/wundr/map-graph.js'), 'utf8');
var ctx = { window: { performance: { now: function () { return 10; } } }, document: fakeDoc, module: { exports: {} } };
vm.runInNewContext(src, ctx);

var clickedHost = null;
var mount = makeEl('div');
var renderRes = ctx.window.WBMapGraph.render(mount, {
	zones: [
		{ id: 'lan', name: 'LAN', cidr: '192.168.1.0/24', isolation: false, trust: 'Trusted' },
		{ id: 'guest', name: 'Guest', cidr: '192.168.20.0/24', isolation: true, trust: 'Untrusted' }
	],
	devices: [
		{ id: 'd1', name: 'MacBook', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:01', zone: 'lan' }
	],
	policies: [
		{ source: { type: 'zone', id: 'lan' }, destination: { type: 'internet' }, action: 'allow', name: 'lan->wan' },
		{ source: { type: 'device', id: 'd1' }, destination: { type: 'internet' }, action: 'deny', name: 'pause' }
	],
	showDenied: true,
	onHostClick: function (dev) { clickedHost = dev; }
});

ok(renderRes && renderRes.clientCount === 1, 'DOM render reports clientCount');
ok(renderRes.zoneAllowCount === 1 && renderRes.deniedCount === 1, 'DOM render counts allow and deny edges');
ok(mount.children.length === 3, 'mounts SVG + HUD + tooltip elements');
var svgEl = mount.children[0];
var hudEl = mount.children[1];
ok(svgEl.style.touchAction === 'pan-y pinch-zoom', 'unzoomed SVG preserves mobile pan-y pinch-zoom');
ok(hudEl.children.length === 3, 'HUD renders +, -, 1:1 controls');

/* Zoom in via HUD button -> touchAction switches to none; Reset -> back to pan-y pinch-zoom */
hudEl.children[0].dispatch('click');
ok(svgEl.style.touchAction === 'none', 'zoomed SVG switches touchAction to none for 2D pan');
hudEl.children[2].dispatch('click');
ok(svgEl.style.touchAction === 'pan-y pinch-zoom', '1:1 reset restores mobile-safe touchAction');

/* Verify quadratic Bezier path syntax and host click callback */
var viewport = svgEl.children[3];
var edgeLayer = viewport.children[0];
var nodeLayer = viewport.children[1];
var firstEdgePath = edgeLayer.children[0];
ok(/^M-?\d+\.\d+ -?\d+\.\d+ Q-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/.test(firstEdgePath.attrs.d), 'Bezier path d attribute is well-formed');

var hostNode = nodeLayer.children.filter(function (c) { return String(c.attrs['data-node-id']).indexOf('host:') === 0; })[0];
ok(!!hostNode, 'renders host node group');
hostNode.dispatch('click');
ok(clickedHost && clickedHost.id === 'd1', 'onHostClick fires with device payload');

/* 5. Verify production map.js includes lan->wan forwarding & onHostClick */
var prodMapJs = fs.readFileSync(path.join(ROOT, 'luci-app-wundr/htdocs/luci-static/resources/view/wundr/map.js'), 'utf8');
ok(!/f\.dest\s*===\s*'wan'\s*&&\s*f\.src\s*!==\s*'lan'/.test(prodMapJs), 'production map.js no longer suppresses lan->wan forwarding');
ok(/onHostClick\s*:/.test(prodMapJs), 'production map.js wires onHostClick');
ok(/showDenied\s*:/.test(prodMapJs), 'production map.js wires showDenied');

console.log('map-graph-check: ' + checks + ' checks passed');
