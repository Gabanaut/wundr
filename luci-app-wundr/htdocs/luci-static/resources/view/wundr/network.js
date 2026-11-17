'use strict';
'require view';
'require uci';
'require rpc';
'require poll';
'require network';
'require dom';
'require wundr.ui as wb';

/* Wundr Network overview — LAN addressing, DHCP, switch ports, VLAN segments
 * and every logical interface, read directly from the live router config.
 * Editing: LAN & DHCP Settings (native form), Flat/VLAN Mode (guided editor)
 * or full LuCI for anything exotic. */

var callDeviceStatus = rpc.declare({ object: 'network.device', method: 'status', params: [ 'name' ], expect: { '': {} } });

function bridgeLanDevice() {
	var dev = uci.get('network', 'lan', 'device');
	if (!dev) {
		var ifname = uci.get('network', 'lan', 'ifname');
		dev = ifname ? String(ifname).split(/\s+/)[0] : 'br-lan';
	}
	return String(dev).split(/\s+/)[0];
}

function lanPorts(bridge) {
	/* Only real bridge membership; never guess port names for unknown switches. */
	var ports = [];
	uci.sections('network', 'device', function(s) {
		if (s.name === bridge || s['.name'] === bridge) {
			var p = s.ports;
			if (typeof p === 'string') p = p.split(/\s+/);
			if (Array.isArray(p)) p.forEach(function(x) { if (x) ports.push(x); });
		}
	});
	return ports;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'), uci.load('dhcp'), uci.load('firewall')
		]);
	},

	render: function() {
		var bridge = bridgeLanDevice();
		var ports = lanPorts(bridge);
		var scroll = E('div');
		var portScroll = E('div');

		function facts() {
			var rawIp = L.toArray(uci.get('network', 'lan', 'ipaddr'))[0] || '';
			var ip = rawIp ? String(rawIp).split('/')[0] : '—';
			var pfx = rawIp ? String(rawIp).split('/')[1] : null;
			var mask = uci.get('network', 'lan', 'netmask') || ((pfx != null && pfx !== '') ? (network.prefixToMask(+pfx) || '255.255.255.0') : '255.255.255.0');
			var start = uci.get('dhcp', 'lan', 'start'), limit = uci.get('dhcp', 'lan', 'limit');
			var ignore = uci.get('dhcp', 'lan', 'ignore') === '1';
			return [
				[ _('Router IP'), ip, 'mono' ],
				[ _('Subnet mask'), mask, 'mono' ],
				[ _('DHCP pool'), ignore ? _('Disabled') : (start && limit ? '' + (Number(start) || 0) + ' → ' + (Number(start) + Number(limit) - 1) : _('Router default')) ],
				[ _('Bridge'), bridge, 'mono' ]
			];
		}

		function vlans() {
			var sections = uci.sections('network', 'bridge-vlan').filter(function(s) { return s.device === bridge; });
			if (!uci.get('network', bridge, 'vlan_filtering') && !sections.length)
				return { mode: _('Flat network'), rows: [] };
			var rows = [];
			var seen = {};
			sections.forEach(function(s) {
				var vid = parseInt(s.vlan, 10);
				if (!isFinite(vid)) return;
				var name = 'vlan' + vid;
				uci.sections('network', 'interface', function(i) {
					if (!seen[vid] && /^lan\d+$/.test(i['.name']) && new RegExp(bridge + '\\.' + vid + '$').test(i.device || '')) {
						name = i['.name']; seen[vid] = true;
					}
				});
				rows.push({ vid: vid, name: name, ports: L.toArray(s.ports).join(' · ') || '—' });
			});
			return { mode: _('Segmented (VLANs)'), rows: rows };
		}

		function interfaces() {
			var rows = [];
			uci.sections('network', 'interface', function(i) {
				if (i['.name'] === 'loopback') return;
				var zone = null;
				uci.sections('firewall', 'zone', function(z) {
					var nets = Array.isArray(z.network) ? z.network : String(z.network || '').split(/\s+/);
					if (nets.indexOf(i['.name']) >= 0) zone = z.name || z['.name'];
				});
				rows.push({ id: i['.name'], proto: i.proto || '—', device: i.device || i.ifname || '—', ip: L.toArray(i.ipaddr).join(', '), zone: zone || '—' });
			});
			return rows;
		}

		function renderMain() {
			var f = facts(), v = vlans();
			dom.content(scroll, [
				E('div', { 'class': 'wb-grid' }, [
					wb.card(_('LAN & DHCP'), [ wb.kv(f) ], { actions: E('a', { 'class': 'wb-btn sm primary', 'href': L.url('wundr/network/lan-config') }, [ wb.iconLabel('edit', _('Edit')) ]) }),
					wb.card(_('Topology'), [
						wb.kv([ [ _('Mode'), v.mode ], [ _('Segments'), v.rows.length ? String(v.rows.length) : '0' ] ])
					], { actions: E('a', { 'class': 'wb-btn sm', 'href': L.url('wundr/network/mode') }, [ wb.iconLabel(v.rows.length ? 'sliders' : 'plus', v.rows.length ? _('Manage segments') : _('Create segments')) ]) })
				]),
				v.rows.length ? E('section', { 'class': 'wb-card' }, [
					E('h3', { 'class': 'wb-h' }, [ _('VLAN segments on %s').format(bridge) ]),
					E('div', { 'class': 'wb-table-scroll' }, [ E('table', { 'class': 'wb-table' }, [
						E('thead', {}, [ E('tr', {}, [ E('th', {}, 'VLAN'), E('th', {}, _('Interface')), E('th', {}, _('Ports (u/t)')) ]) ]),
						E('tbody', {}, v.rows.map(function(r) { return E('tr', {}, [ E('td', { 'class': 'name' }, [ String(r.vid) ]), E('td', { 'class': 'mono' }, [ r.name ]), E('td', { 'class': 'mono' }, [ r.ports ]) ]); }))
					]) ])
				]) : '',
				E('section', { 'class': 'wb-card' }, [
					E('h3', { 'class': 'wb-h' }, [ _('Logical interfaces') ]),
					E('div', { 'class': 'wb-sub', 'style': 'margin-bottom:8px' }, [ _('Firewall zones decide what each interface may reach.') ]),
					E('div', { 'class': 'wb-table-scroll' }, [ E('table', { 'class': 'wb-table' }, [
						E('thead', {}, [ E('tr', {}, [ E('th', {}, _('Interface')), E('th', {}, _('Protocol')), E('th', {}, _('Device')), E('th', {}, _('IPv4')), E('th', {}, _('Zone')) ]) ]),
						E('tbody', {}, interfaces().map(function(i) { return E('tr', {}, [
							E('td', { 'class': 'name mono' }, [ i.id ]), E('td', {}, [ i.proto ]), E('td', { 'class': 'mono' }, [ String(i.device).split(/\s+/)[0] ]),
							E('td', { 'class': 'mono' }, [ i.ip || '—' ]), E('td', {}, [ i.zone ])
						]); }))
					]) ])
				])
			]);
			if (ports.length) {
				var portRows = ports.map(function(p) {
					var pill = wb.pill('…', 'mut'), stat = E('span', { 'class': 'mono' }, [ '…' ]);
					L.resolveDefault(callDeviceStatus(p), {}).then(function(st) {
						var up = !!(st && st.carrier);
						pill.className = 'wb-pill ' + (up ? 'good' : 'mut');
						dom.content(pill, [ up ? _('Up') : _('Down') ]);
						dom.content(stat, [ (up && st.speed ? st.speed + ' Mbit/s' : (up ? _('no speed reported') : '—')) + (up && st.duplex ? ' ' + st.duplex : '') ]);
					});
					return E('tr', {}, [ E('td', { 'class': 'name mono' }, [ p ]), E('td', {}, [ pill ]), E('td', {}, [ stat ]) ]);
				});
				dom.content(portScroll, [ E('div', { 'class': 'wb-table-scroll' }, [ E('table', { 'class': 'wb-table' }, [
					E('thead', {}, [ E('tr', {}, [ E('th', {}, _('Port')), E('th', {}, _('Link')), E('th', {}, _('Status')) ]) ]),
					E('tbody', {}, portRows)
				]) ]) ]);
			} else {
				dom.content(portScroll, [ wb.empty(_('This switch is managed by firmware — individual port state is shown in native LuCI.'), 'port') ]);
			}
		}

		renderMain();
		var hero = wb.hero(_('Network'), _('Local addressing, segments and switch ports. Changes apply with a rollback safety net.'), [], [
			E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/network') }, [ wb.iconLabel('sliders', _('All interfaces (LuCI)')) ])
		]);
		return E('div', {}, [ hero, scroll, wb.card(_('Switch ports'), [ portScroll ], { sub: _('Live link status of the LAN ports (carrier + negotiated speed).') }) ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
