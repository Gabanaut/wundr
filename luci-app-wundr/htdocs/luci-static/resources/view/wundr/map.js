'use strict';
'require view';
'require uci';
'require wundr.policy as policy';
'require dom';
'require poll';
'require firewall';
'require ui';
'require wundr.ui as wb';

/* Wundr Network Map — the real topology rendered from firewall zones and the
 * leases that resolve into them. Every arrow is backed by a concrete firewall
 * rule (accept or deny). No reachability is invented. */

function enabled(section) { return !/^(0|off|no|false)$/i.test(section.enabled); }

return view.extend({
	load: function() {
		return Promise.all([
			firewall.getZones(), wb.hostHints(), policy.read()
		]);
	},

	render: function(data) {
		var zones = (data[0] || []).filter(function(zone) { return zone.getName() && zone.getName() !== 'loopback'; });
		var hints = data[1] || {}, state = data[2];
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
		function clients(snapshot) {
			var unique = new Map();
			(snapshot.leases || []).forEach(function(lease) {
				if (!lease || !lease.macaddr || lease.expires === 0) return;
				var mac = String(lease.macaddr).toUpperCase(), iface = lease.interface || '';
				if (unique.has(mac) && (!iface || unique.get(mac).interface)) return;
				unique.set(mac, { id: mac.toLowerCase(), mac: mac, ip: lease.ipaddr || '', name: lease.hostname || (hints[mac] || {}).name || mac, zone: snapshot.source(mac), interface: iface });
			});
			return Array.from(unique.values()).sort(function(left, right) { return left.id.localeCompare(right.id); });
		}
		var devices = clients(state);

		/* Build policy arrows straight from firewall forwardings + reject rules. */
		function paths() {
			var policies = [], blockedMacs = Object.create(null), byMac = new Map(devices.map(function(dev) { return [dev.mac, dev]; }));
			uci.sections('firewall', 'forwarding', function(rule) {
				if (!rule.src || !rule.dest || !enabled(rule)) return;
				var to = state.uplinks.includes(rule.dest) ? { type: 'internet' } : { type: 'zone', id: rule.dest };
				policies.push({ source: { type: 'zone', id: rule.src }, destination: to, action: 'allow', name: rule.src + ' → ' + rule.dest, origin: 'firewall.forwarding' });
			});
			uci.sections('firewall', 'rule', function(rule) {
				if (!/^wundr_(pause|block|bedtime)_/.test(String(rule.name || ''))) return;
				L.toArray(rule.src_mac).forEach(function(mac) {
					var dev = byMac.get(String(mac).toUpperCase());
					if (!dev || !policy.matches(rule, mac, dev.zone, state.uplinks)) return;
					blockedMacs[dev.mac] = rule.name;
					policies.push({ source: { type: 'device', id: dev.id }, destination: { type: 'internet' }, action: 'deny', name: rule.name, origin: 'Wundr' });
				});
			});
			return { policies: policies, blocked: blockedMacs };
		}
		var links = paths(), showDenied = true;
		var graphMount = E('div', { 'class': 'map-graph-mount' });
		var graphMetric = E('div', { 'class': 'wb-sub map-graph-metric' });
		var clientStat = wb.stat(String(devices.length), _('Clients'));
		var leaseStatus = E('div', { 'class': 'wb-sub', 'role': 'status' }, state.leases ? '' : _('DHCP lease data is unavailable.'));
		var zoneButtons = E('div', { 'class': 'wb-zone-index', 'role': 'group', 'aria-label': _('Inspect a zone') });
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
		}, [ _('Show restriction rules') ]);

		function redraw() {
			if (!window.WBMapGraph) { graphMount.innerHTML = ''; graphMount.appendChild(E('div', { 'class': 'wb-empty' }, [ _('The SVG graph engine did not load.') ])); return; }
			var res = WBMapGraph.render(graphMount, {
				zones: zoneList,
				devices: devices,
				policies: links.policies,
				observed: [],
				showDenied: showDenied,
				onHostClick: function(dev) { if (window.matchMedia('(max-width: 700px)').matches) openZone(dev.zone); else openClientDetails(dev); },
				onZoneClick: function(zone) { openZone(zone.unassigned ? null : zone.id); },
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
		function assigned(zone) { return devices.filter(function(dev) { return dev.zone === zone; }); }
		function clientButton(dev) {
			return E('button', { 'class': 'map-device', 'type': 'button', 'click': function() { openClientDetails(dev); } }, [
				E('span', { 'class': 'map-device-dot' + (links.blocked[dev.mac] ? ' blocked' : '') }), E('span', {}, [dev.name]), E('small', {}, [dev.ip || dev.mac])
			]);
		}
		function openZone(id) {
			var members = assigned(id), zone = zoneList.find(function(item) { return item.id === id; });
			var forwards = id ? uci.sections('firewall', 'forwarding').filter(function(rule) { return enabled(rule) && (rule.src === id || rule.dest === id); }) : [];
			ui.showModal([zone ? zone.name : _('Unassigned')], [ wb.kv([[ _('Network'), zone && zone.network ], [ _('Router input'), zone && zone.inputPolicy ], [ _('Configured paths'), forwards.map(function(rule) { return rule.src + ' → ' + rule.dest; }).join(', ') || _('None reported') ]]),
				E('h4', {}, [_('Reported clients')]), E('div', { 'class': 'map-devices' }, members.length ? members.map(clientButton) : [_('No leases reported.')]),
				E('div', { 'class': 'right' }, [E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))]) ]);
		}
		function zonesList() {
			var groups = devices.some(function(dev) { return !dev.zone; }) ? zoneList.concat([{ id: null, name: _('Unassigned'), network: '' }]) : zoneList;
			dom.content(zoneButtons, groups.map(function(zone) { return E('button', { 'class': 'wb-zone-link', 'type': 'button', 'click': function() { openZone(zone.id); } }, [zone.name, E('small', {}, [String(assigned(zone.id).length)])]); }));
			return groups.map(function(zone) {
				var attached = assigned(zone.id);
				return E('article', { 'class': 'map-zone' + (zone.isolation ? ' restricted' : zone.inputPolicy === 'ACCEPT' ? ' trusted' : '') }, [
					E('div', { 'class': 'map-zone-head' }, [
						E('div', {}, [ E('h3', {}, [ zone.name ]), E('div', { 'class': 'wb-sub' }, [ [zone.cidr, zone.network].filter(Boolean).join(' · ') || _('No matching interface') ]) ]),
						wb.pill(attached.length + ' ' + _('clients'), 'mut')
					]),
					E('div', { 'class': 'map-devices' }, attached.length ? attached.map(clientButton) : E('div', { 'class': 'wb-sub' }, _('No leases reported.')))
				]);
			});
		}

		function openClientDetails(dev) {
			ui.showModal([_('Device %s').format(dev.name)], [
				wb.kv([ [ _('MAC'), dev.mac, 'mono' ], [ _('IPv4'), dev.ip || '—', 'mono' ], [ _('Interface'), dev.interface || '—', 'mono' ], [ _('Firewall zone'), dev.zone || _('Unassigned') ] ]),
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': function() { openZone(dev.zone); } }, _('View zone')), ' ', E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Close') ]) ])
			]);
		}

		function rebuildBody() {
			dom.content(body, [
				wb.card(_('Client directory'), [ E('div', { 'class': 'map-zones' }, zonesList()) ]),
				E('details', { 'class': 'wb-map-diagnostics' }, [ E('summary', {}, _('Map diagnostics')), graphMetric,
					E('pre', { 'class': 'mono', 'style': 'max-height:320px;overflow:auto' }, [ JSON.stringify({ zones: zoneList, devices: devices, policies: links.policies }, null, 2) ]) ])
			]);
		}
		rebuildBody();
		poll.add(function() { return L.resolveDefault(policy.read(), null).then(function(reply) {
			if (!reply || !reply.leases) { leaseStatus.textContent = _('Could not refresh DHCP leases.'); return; }
			leaseStatus.textContent = '';
			var next = clients(reply);
			if (JSON.stringify(next) === JSON.stringify(devices) && reply.uplinks.join() === state.uplinks.join()) return;
			state = reply; devices = next; links = paths();
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
					E('div', { 'class': 'wb-hero-actions' }, [
						E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/zones') }, [ _('Zones config') ]),
						E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/firewall/rules') }, [ _('Rules') ])
					])
				])
			]),
			wb.card(_('Policy graph'), [
				zoneButtons, graphMount, leaseStatus,
				E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px' }, [
					E('div', { 'class': 'map-legend', 'style': 'margin:0' }, [
						E('span', {}, [ E('i', { 'class': 'legend-dot live' }), _('Reported lease') ]),
						E('span', {}, [ E('i', { 'class': 'legend-line allow' }), _('Zone forwarding') ]),
						E('span', {}, [ E('i', { 'class': 'legend-line deny' }), _('Paused / bedtime block') ]),
						E('span', {}, [ E('i', { 'class': 'legend-dot isolated' }), _('Restricted forwarding') ])
					])
				])
			], { actions: denyBtn, class: 'map-graph-card' }),
			body
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
