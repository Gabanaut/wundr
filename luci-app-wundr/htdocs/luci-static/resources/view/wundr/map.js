'use strict';
'require view';
'require uci';
'require rpc';
'require dom';
'require poll';
'require firewall';
'require ui';
'require wundr.ui as wb';

/* Wundr Network Map — the real topology rendered from firewall zones and the
 * leases that resolve into them. Every arrow is backed by a concrete firewall
 * rule (accept or deny). No reachability is invented. */

var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
function enabled(section) { return !/^(0|off|no|false)$/i.test(section.enabled); }

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'), uci.load('firewall'), firewall.getZones(), wb.hostHints(), L.resolveDefault(callLeases(), null)
		]);
	},

	render: function(data) {
		var zones = (data[2] || []).filter(function(zone) { return zone.getName() && zone.getName() !== 'loopback'; });
		var hints = data[3] || {}, devices = [];
		function cidrOf(i) {
			var ip = L.toArray(uci.get('network', i, 'ipaddr'))[0] || '', mask = uci.get('network', i, 'netmask');
			if (!ip) return '';
			if (String(ip).indexOf('/') > 0) return String(ip);
			return mask ? ip + '/' + mask : String(ip);
		}

		var zoneList = zones.map(function(z) {
			var nets = L.toArray(z.get('network'));
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
				inputPolicy: z.getInput(),
				isolation: /^(DROP|REJECT)$/i.test(z.getForward())
			};
		});
		function clients(leases) {
			var unique = new Map();
			leases.forEach(function(lease) {
				if (!lease || !lease.macaddr || lease.expires === 0) return;
				var mac = String(lease.macaddr).toUpperCase(), iface = lease.interface || '';
				var matches = iface ? zoneList.filter(function(zone) {
					return L.toArray(zone.network).some(function(net) { return net === iface || uci.get('network', net, 'device') === iface; });
				}) : [];
				if (unique.has(mac) && (unique.get(mac).zone || matches.length !== 1)) return;
				unique.set(mac, { id: mac.toLowerCase(), mac: mac, ip: lease.ipaddr || '', name: lease.hostname || (hints[mac] || {}).name || mac, zone: matches.length === 1 ? matches[0].id : null, interface: iface });
			});
			return Array.from(unique.values()).sort(function(left, right) { return left.id.localeCompare(right.id); });
		}
		var firstLeases = data[4] && data[4].dhcp_leases;
		devices = clients(Array.isArray(firstLeases) ? firstLeases : []);

		/* Build policy arrows straight from firewall forwardings + reject rules. */
		var policies = [];
		var blockedMacs = Object.create(null);
		uci.sections('firewall', 'forwarding', function(f) {
			if (!f.src || !f.dest || !enabled(f)) return;
			if (f.dest === 'wan') {
				policies.push({ source: { type: 'zone', id: f.src }, destination: { type: 'internet' }, action: 'allow', name: 'fwd ' + f.src + '→wan', origin: 'firewall.forwarding' });
			} else {
				policies.push({ source: { type: 'zone', id: f.src }, destination: { type: 'zone', id: f.dest }, action: 'allow', name: 'fwd ' + f.src + '→' + f.dest, origin: 'firewall.forwarding' });
			}
		});
		uci.sections('firewall', 'rule', function(r) {
			if (!enabled(r) || r.dest !== 'wan' || !/^wundr_(pause|block|bedtime)_/.test(String(r.name || ''))) return;
			var macs = L.toArray(r.src_mac);
			var act = String(r.target || '').toUpperCase();
			if (act !== 'REJECT' && act !== 'DROP') return;
			macs.forEach(function(m) {
				blockedMacs[m.toUpperCase()] = r.name;
				policies.push({ source: { type: 'device', id: m.toLowerCase() }, destination: { type: 'internet' }, action: 'deny', name: r.name, origin: 'Wundr family' });
			});
		});

		var showDenied = Object.keys(blockedMacs).length > 0;
		var graphMount = E('div', { 'class': 'map-graph-mount' });
		var graphMetric = E('div', { 'class': 'wb-sub map-graph-metric' });
		var clientStat = wb.stat(String(devices.length), _('Clients'));
		var leaseStatus = E('div', { 'class': 'wb-sub', 'role': 'status' }, Array.isArray(firstLeases) ? '' : _('DHCP lease data is unavailable.'));
		var denyBtn = E('button', {
			'class': 'wb-btn sm' + (showDenied ? ' active' : ''),
			'type': 'button',
			'aria-pressed': String(showDenied),
			'click': function() {
				showDenied = !showDenied;
				denyBtn.classList.toggle('active', showDenied);
				denyBtn.setAttribute('aria-pressed', String(showDenied));
				redraw();
			}
		}, [ _('Blocked rules') ]);

		function redraw() {
			if (!window.WBMapGraph) { graphMount.innerHTML = ''; graphMount.appendChild(E('div', { 'class': 'wb-empty' }, [ _('The SVG graph engine did not load.') ])); return; }
			var res = WBMapGraph.render(graphMount, {
				zones: zoneList,
				devices: devices,
				policies: policies.filter(Boolean),
				observed: [],
				showDenied: showDenied,
					onHostClick: openClientDetails,
				labels: { graph: _('Network topology graph'), internet: _('Internet / WAN'), router: _('Router'), private: _('Private'), internal: _('All clients'), empty: _('No topology data to draw.') }
			});
			if (res && res.renderMs != null) {
				graphMetric.textContent = '%d %s · %d %s · %d %s · %.1f ms'.format(
					res.clientCount, _('clients'),
					res.zoneAllowCount || 0, _('allow edges'),
					res.deniedCount || 0, _('deny rules'),
					res.renderMs
				);
			}
		}
		redraw();

		var body = E('div');
		function zonesList() {
			var groups = devices.some(function(dev) { return !dev.zone; }) ? zoneList.concat([{ id: null, name: _('Unassigned'), network: '' }]) : zoneList;
			return groups.map(function(zone) {
				var attached = devices.filter(function(dev) { return dev.zone === zone.id; });
				return E('article', { 'class': 'map-zone' + (zone.isolation ? ' restricted' : zone.inputPolicy === 'ACCEPT' ? ' trusted' : '') }, [
					E('div', { 'class': 'map-zone-head' }, [
						E('div', {}, [ E('h3', {}, [ zone.name ]), E('div', { 'class': 'wb-sub' }, [ [zone.cidr, zone.network].filter(Boolean).join(' · ') || _('No matching interface') ]) ]),
						wb.pill(attached.length + ' ' + _('clients'), 'mut')
					]),
					E('div', { 'class': 'map-devices' }, attached.length ? attached.map(function(dev) {
						return E('button', { 'class': 'map-device', 'type': 'button', 'click': function() { openClientDetails(dev); } }, [
							E('span', { 'class': 'map-device-dot' + (blockedMacs[dev.mac] ? ' blocked' : '') }),
							E('span', {}, [ dev.name ]), E('small', {}, [ dev.mac ])
						]);
					}) : E('div', { 'class': 'wb-sub' }, _('No leases reported.')))
				]);
			});
		}

		function openClientDetails(dev) {
			ui.showModal(_('Device %s').format(dev.name), [
				wb.kv([ [ _('MAC'), dev.mac, 'mono' ], [ _('IPv4'), dev.ip || '—', 'mono' ], [ _('Interface'), dev.interface || '—', 'mono' ], [ _('Firewall zone'), dev.zone || _('Unassigned') ] ]),
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
						var f = uci.sections('firewall', 'forwarding').filter(function(x) { return x.src === z.getName() && enabled(x); });
						return E('div', { 'class': 'wb-setting' }, [ E('div', { 'class': 'grow' }, [ E('div', { 'class': 'name' }, [ z.getName() ]) ]), f.length ? E('span', {}, f.map(function(x) { return wb.pill('→ ' + x.dest, 'good'); })) : wb.pill(_('No explicit forwarding'), 'mut') ]);
					})) ])
				])
			]);
		}
		rebuildBody();
		poll.add(function() { return L.resolveDefault(callLeases(), null).then(function(reply) {
			if (!reply || !Array.isArray(reply.dhcp_leases)) { leaseStatus.textContent = _('Could not refresh DHCP leases.'); return; }
			leaseStatus.textContent = '';
			var next = clients(reply.dhcp_leases);
			if (JSON.stringify(next) === JSON.stringify(devices)) return;
			devices = next;
			clientStat.firstChild.textContent = String(devices.length);
			redraw(); rebuildBody();
		}); }, 30);

		return E('div', {}, [
			E('section', { 'class': 'wb-card wb-hero' }, [
				E('h2', { 'class': 'wb-h' }, [ _('Network map') ]),
				E('div', { 'class': 'wb-sub' }, [ _('Arrows show configured rules, not live traffic. Scheduled restrictions may not be active now.') ]),
				E('div', { 'class': 'wb-hero-row' }, [
					wb.stat(String(zoneList.length), _('Zones')),
					clientStat,
					wb.stat(String(policies.length), _('Policy arrows')),
					E('div', { 'class': 'wb-hero-actions' }, [
						E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/zones') }, [ _('Zones config') ]),
						E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/rules') }, [ _('Rules') ])
					])
				])
			]),
			wb.card(_('Policy graph'), [
				graphMount, leaseStatus,
				E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px' }, [
					E('div', { 'class': 'map-legend', 'style': 'margin:0' }, [
						E('span', {}, [ E('i', { 'class': 'legend-dot live' }), _('Reported lease') ]),
						E('span', {}, [ E('i', { 'class': 'legend-line allow' }), _('Zone forwarding') ]),
						E('span', {}, [ E('i', { 'class': 'legend-line deny' }), _('Paused / bedtime block') ]),
						E('span', {}, [ E('i', { 'class': 'legend-dot isolated' }), _('Restricted forwarding') ])
					]),
					graphMetric
				])
			], { actions: denyBtn, class: 'map-graph-card' }),
			body
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
