'use strict';
'require view';
'require uci';
'require rpc';
'require dom';
'require poll';
'require network';
'require firewall';
'require ui';
'require tools.widgets as widgets';
'require wundr.ui as wb';

/* Wundr Network Map — the real topology rendered from firewall zones and the
 * leases that resolve into them. Every arrow is backed by a concrete firewall
 * rule (accept or deny). No reachability is invented. */

var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
var callHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });

function splitList(v) { return Array.isArray(v) ? v : (v ? String(v.split ? v : v).trim().split(/\s+/) : []); }

function zoneTrust(z) {
	var n = (z.getName() || '').toLowerCase();
	if (n === 'wan' || n === 'wwan') return 'Untrusted';
	if (/guest|iot|private|cam|secure/.test(n)) return 'Restricted';
	if (n === 'lan') return 'Trusted';
	return z.get('input') === 'ACCEPT' ? 'Trusted' : 'Restricted';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'), uci.load('dhcp'), uci.load('firewall'), uci.load('wireless'),
			firewall.getZones(), network.getHostHints(), L.resolveDefault(callHints(), {}), L.resolveDefault(callLeases(), {})
		]);
	},

	render: function(data) {
		var zones = data[4] || [];
		var hints1 = data[5] || {}, hints2 = data[6] || {}, leases = (data[7] && data[7].dhcp_leases) || [];
		var nameFor = {};
		Object.keys(hints1).concat(Object.keys(hints2)).forEach(function(m) {
			var v = hints1[m] || hints2[m] || {};
			if (v.name) nameFor[m.toUpperCase()] = v.name;
		});
		leases.forEach(function(l) { if (l && l.macaddr && l.hostname) nameFor[l.macaddr.toUpperCase()] = l.hostname; });
		var byZoneMAC = {};
		leases.forEach(function(l) {
			if (!l || !l.macaddr || !l.interface) return;
			if (l.expires < 0) return;
			(byZoneMAC[l.interface] = byZoneMAC[l.interface] || []).push(l.macaddr);
		});

		function ifaceOf(zone) { return splitList(zone.get('network'))[0] || ''; }
		function cidrOf(i) {
			var ip = uci.get('network', i, 'ipaddr'), mask = uci.get('network', i, 'netmask');
			if (!ip) return '';
			return mask ? ip + '/' + mask : ip;
		}

		var zoneList = zones.map(function(z) {
			var nets = splitList(z.get('network'));
			var ip = '';
			nets.some(function(n) {
				var a = cidrOf(n);
				if (a) { ip = a; return true; }
				return false;
			});
			return {
				id: z.getName(),
				name: z.getName().toUpperCase(),
				cidr: ip,
				network: nets.join(' '),
				trust: zoneTrust(z),
				isolation: /^accept$/i.test(z.getForward() || z.get('forward')) === false
			};
		}).filter(function(z) { return z.id !== 'loopback'; });

		var devices = [];
		zoneList.forEach(function(z) {
			var nets = z.network.split(' ');
			var macs = [];
			nets.forEach(function(n) { if (byZoneMAC[n]) Array.prototype.push.apply(macs, byZoneMAC[n]); });
			macs.forEach(function(m) {
				var l = leases.filter(function(x) { return x.macaddr === m; })[0];
				devices.push({ id: m.toLowerCase(), mac: m, ip: l && l.ipaddr, name: nameFor[m] || (_('Device ') + m.slice(-4)), zone: z.id });
			});
		});

		/* Build policy arrows straight from firewall forwardings + reject rules. */
		var policies = [];
		var fwd = {};
		uci.sections('firewall', 'forwarding', function(f) {
			fwd[f.src + '→' + f.dest] = true;
			if (f.dest === 'wan' && f.src !== 'lan') {
				/* Only emit a zone→internet arrow for the src itself; the graph
				 * will draw it when a matching zone node exists. */
				policies.push({ source: { type: 'zone', id: f.src }, destination: { type: 'internet' }, action: 'allow', name: 'fwd ' + f.src, origin: 'firewall.forwarding' });
			}
			if (/^lan$/.test(f.dest) && f.src !== 'wan') {
				policies.push({ source: { type: 'zone', id: f.src }, destination: { type: 'zone', id: 'lan' }, action: 'allow', name: 'fwd ' + f.src + '→lan', origin: 'firewall.forwarding' });
			}
		});
		uci.sections('firewall', 'rule', function(r) {
			if (!/^wundr_/.test(String(r.name || ''))) return;
			var macs = splitList(r.src_mac);
			var act = String(r.target || 'REJECT').toUpperCase();
			if (act !== 'REJECT' && act !== 'DROP') return;
			macs.forEach(function(m) {
				policies.push({ source: { type: 'device', id: m.toLowerCase() }, destination: { type: 'internet' }, action: 'deny', name: r.name, origin: 'Wundr family' });
			});
		});

		var graphMount = E('div', { 'class': 'map-graph-mount' });
		var graphMetric = E('div', { 'class': 'wb-sub map-graph-metric' });
		function redraw() {
			if (!window.WBMapGraph) { graphMount.innerHTML = ''; graphMount.appendChild(E('div', { 'class': 'wb-empty' }, [ _('The SVG graph engine did not load.') ])); return; }
			var res = WBMapGraph.render(graphMount, {
				zones: zoneList,
				devices: devices,
				policies: policies.filter(Boolean),
				observed: [],
				labels: { graph: _('Network topology graph'), internet: _('Internet / WAN'), router: _('Router'), private: _('Private'), internal: _('All clients'), empty: _('No topology data to draw.') }
			});
			if (res && res.renderMs != null) graphMetric.textContent = '%d %s · %d %s · %d ms'.format(res.clientCount, _('clients'), res.zoneAllowCount || 0, _('allow edges'), res.renderMs);
		}
		redraw();

		var body = E('div');
		function zonesList() {
			return zones.filter(function(z) { return z.getName() !== 'loopback'; }).map(function(z) {
				var ifaces = splitList(z.get('network'));
				var attached = ifaces.reduce(function(n, x) { return n + (byZoneMAC[x] || []).length; }, 0);
				return E('article', { 'class': 'map-zone ' + (zoneTrust(z) === 'Trusted' ? 'trusted' : 'restricted') }, [
					E('div', { 'class': 'map-zone-head' }, [
						E('div', {}, [ E('h3', {}, [ z.getName() ]), E('div', { 'class': 'wb-sub' }, [ (cidrOf(ifaces[0]) || 'no address') + ' · ' + ifaces.join(', ') ]) ]),
						wb.pill(attached + ' ' + _('clients'), 'mut')
					]),
					E('div', { 'class': 'map-devices' }, function() {
						var macs = [];
						ifaces.forEach(function(i) { (byZoneMAC[i] || []).forEach(function(m) { macs.push(m); }); });
						if (!macs.length) return E('div', { 'class': 'wb-sub' }, [ _('No leases found in this zone.') ]);
						return macs.slice(0, 12).map(function(m) {
							return E('button', { 'class': 'map-device', 'type': 'button', 'onclick': function() { openClientDetails(m); } }, [
								E('span', { 'class': 'map-device-dot' }),
								E('span', {}, [ nameFor[m] || m ]),
								E('small', {}, [ m ])
							]);
						});
					}())
				]);
			});
		}

		function openClientDetails(mac) {
			var l = leases.filter(function(x) { return x.macaddr === mac; })[0] || {};
			var iface = l.interface || '';
			var zone = (zones.filter(function(z) { return splitList(z.get('network')).indexOf(iface) >= 0; })[0] || {}).getName || function() { return iface; };
			ui.showModal(_('Device %s').format(nameFor[mac] || mac), [
				wb.kv([ [ _('MAC'), mac, 'mono' ], [ _('IPv4'), l.ipaddr || '—', 'mono' ], [ _('Interface'), iface || '—', 'mono' ], [ _('Firewall zone'), zone() ] ]),
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Close') ]) ])
			]);
		}

		function rebuildBody() {
			dom.content(body, [
				wb.card(_('Zones and clients'), [
					E('div', { 'class': 'wb-sub', 'style': 'margin-bottom:10px' }, [ _('Firewall zones are drawn from /etc/config/firewall. Clients appear where their DHCP lease’s interface name matches a zone member.') ]),
					E('div', { 'class': 'map-zones' }, zonesList())
				]),
				wb.card(_('How to read this map'), [ E('p', { 'class': 'wb-sub' }, [
					_('Solid green arrows = firewall forwardings that let traffic leave a zone. Dotted red = a Wundr pause/bedtime REJECT rule attached to a device. Every line comes from a real file, not inferred.') ]),
					E('details', {}, [ E('summary', { 'style': 'cursor:pointer' }, [ _('Underlying JSON (%s edges)').format(policies.length) ]), E('pre', { 'class': 'mono', 'style': 'max-height:320px;overflow:auto;margin-top:8px' }, [ JSON.stringify({ zones: zoneList, devices: devices, policies: policies }, null, 2) ]) ]) ]),
				E('div', { 'class': 'wb-grid cols-2' }, [
					wb.card(_('Segment arrows'), [ E('div', { 'class': 'wb-list' }, zones.map(function(z) {
						var f = uci.sections('firewall', 'forwarding').filter(function(x) { return x.src === z.getName(); });
						return E('div', { 'class': 'wb-setting' }, [ E('div', { 'class': 'grow' }, [ E('div', { 'class': 'name' }, [ z.getName() ]) ]), f.length ? E('span', {}, f.map(function(x) { return wb.pill('→ ' + x.dest, 'good'); })) : wb.pill(_('no allow-out'), 'mut') ]);
					})) ])
				])
			]);
		}
		rebuildBody();
		poll.add(function() { return Promise.all([ network.flushCache(), L.resolveDefault(callLeases(), {}) ]).then(function() { /* reload leases lazily on interval */ }).catch(function(){}); }, 30);

		return E('div', {}, [
			E('section', { 'class': 'wb-card wb-hero' }, [
				E('h2', { 'class': 'wb-h' }, [ _('Network map') ]),
				E('div', { 'class': 'wb-sub' }, [ _('Every arrow below is a firewall forwarding or Wundr rule — nothing is guessed. Hover or click a dot for details.') ]),
				E('div', { 'class': 'wb-hero-row' }, [
					wb.stat(String(zoneList.length), _('Zones')),
					wb.stat(String(devices.length), _('Clients')),
					wb.stat(String(policies.length), _('Policy arrows'))
				], [
					E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/zones') }, [ _('Zones config') ]),
					E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/rules') }, [ _('Rules') ])
				])
			]),
			wb.card(_('Policy graph'), [ graphMount, graphMetric ]),
			body
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
