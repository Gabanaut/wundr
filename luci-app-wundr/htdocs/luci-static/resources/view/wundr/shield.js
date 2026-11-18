'use strict';
'require view';
'require uci';
'require firewall';
'require dom';
'require wundr.ui as wb';
'require wundr.policy as policy';

/* Wundr Security (Shield) — a live posture audit derived from the running
 * firewall config. Every result is computed from real UCI; every action links
 * to the native LuCI firewall editor (validated forms + standard apply), so
 * nothing here writes config directly. Wundr's own pause/bedtime rules
 * (`wundr_*`) are excluded from the "loose rule" audit — they are intentional
 * restrictions, not exposures. */

function splitList(v) {
	if (Array.isArray(v)) return v;
	if (v == null || v === '') return [];
	return String(v).trim().split(/\s+/);
}

function computeChecks(uplinks) {
	var out = [];
	var defaults = uci.sections('firewall', 'defaults')[0] || {};
	var syn = defaults.synflood_protect != null ? defaults.synflood_protect : defaults.syn_flood;
	var synOn = syn == null ? null : /^(1|on|yes|true)$/i.test(syn);
	out.push({ name: _('SYN-flood protection'), ok: synOn, detail: synOn == null ? _('Not set explicitly in firewall defaults.') : synOn ? _('Enabled in firewall defaults.') : _('Disabled in firewall defaults.') });
	var incoming = uci.sections('firewall', 'rule').filter(function(rule) {
		return !/^(0|off|no|false)$/i.test(rule.enabled) && (uplinks.includes(rule.src) || rule.src === '*') && String(rule.target).toUpperCase() === 'ACCEPT';
	});
	out.unshift({ name: _('Incoming allow rules'), ok: null, detail: uplinks.length ? _('%d enabled rules from an uplink or any zone.').format(incoming.length) : _('Uplink zone not reported; exceptions have not been counted.') });
	out.push({ name: _('UPnP mappings'), ok: null, detail: _('Dynamic mappings are not listed in the static firewall configuration.') });
	out.push({ name: _('Client DNS'), ok: null, detail: _('DHCP can suggest resolvers; that does not prevent clients from choosing another one.'), link: [ 'wundr/network/lan-config', _('Open LAN & DHCP') ] });

	return out;
}

function card(title, bodyChildren, action) {
	return E('section', { 'class': 'wb-card' }, [
		E('div', { 'class': 'wb-pagetitle' }, [ E('h3', { 'class': 'wb-h' }, [ title ]), action || '' ]),
		E('div', {}, bodyChildren)
	]);
}

function scrollTable(cols, rows) {
	return E('div', { 'class': 'wb-table-scroll' }, [ E('table', { 'class': 'wb-table' }, [
		E('thead', {}, [ E('tr', {}, cols.map(function(c) { return E('th', {}, [ c ]); })) ]),
		E('tbody', {}, rows.length ? rows : [ E('tr', {}, [ E('td', { 'class': 'wb-empty', 'colspan': String(cols.length) }, [ _('Nothing here.') ]) ]) ])
	]) ]);
}

function linkBtn(href, label, primary) {
	return E('a', { 'class': 'wb-btn' + (primary ? ' primary' : ''), 'href': L.url(href) }, [ label ]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('firewall'),
			uci.load('dhcp'),
			firewall.getZones(),
			wb.hostHints(), policy.read()
		]);
	},

	render: function(data) {
		var zones = data[2] || [];
		var hints = data[3] || {};
		var scope = data[4], uplinks = scope.uplinks, inside = zones.map(function(zone) { return zone.getName(); }).filter(function(name) { return !uplinks.includes(name); });
		var mount = E('div');

		function validPortOrRange(v) {
			var s = String(v || '').trim();
			if (/^\d{1,5}$/.test(s)) return Number(s) >= 1 && Number(s) <= 65535;
			var m = /^(\d{1,5})-(\d{1,5})$/.exec(s);
			return !!m && Number(m[1]) >= 1 && Number(m[2]) <= 65535 && Number(m[1]) <= Number(m[2]);
		}
		function validIpv4(v) {
			var p = String(v || '').trim().split('.');
			return p.length === 4 && p.every(function(o) { return /^\d{1,3}$/.test(o) && Number(o) <= 255; });
		}

		function openAddForwardModal() {
			var hostOpts = [ [ '', _('Choose a known device (optional)…') ] ];
			Object.keys(hints).sort().forEach(function(mac) {
				var h = hints[mac] || {};
				var ip = (Array.isArray(h.ipaddrs) && h.ipaddrs[0]) || h.ip || '';
				if (ip) hostOpts.push([ mac, (h.name ? h.name + ' — ' : '') + ip + ' (' + mac + ')' ]);
			});
			var picker = wb.select(hostOpts, '');
			var src = wb.select([ ['', _('Choose uplink')] ].concat(uplinks.map(function(name) { return [name, name]; })), uplinks.length === 1 ? uplinks[0] : '');
			var dest = wb.select([ ['', _('Choose destination zone')] ].concat(inside.map(function(name) { return [name, name]; })), '');
			var nameInp = wb.input({ 'placeholder': _('e.g. WireGuard / Plex / Game server') });
			var protoSel = wb.select([ [ 'tcp udp', 'TCP + UDP' ], [ 'tcp', 'TCP' ], [ 'udp', 'UDP' ] ], 'tcp udp');
			var extInp = wb.input({ 'placeholder': _('e.g. 51820 or 8000-8010') });
			var ipInp = wb.input({ 'placeholder': '192.168.1.50' });
			var intInp = wb.input({ 'placeholder': _('Same as external port') });

			picker.addEventListener('change', function() {
				if (!picker.value) return;
				var selected = hints[picker.value];
				ipInp.value = L.toArray(selected.ipaddrs)[0] || selected.ip || '';
				var zone = scope.source(picker.value); dest.value = inside.includes(zone) ? zone : '';
				if (!nameInp.value.trim()) {
					var txt = picker.options[picker.selectedIndex].text.split(' — ')[0];
					if (txt && txt.indexOf('.') < 0) nameInp.value = txt;
				}
			});

			wb.formModal(_('Add port forward'), [
				{ label: _('Device'), node: picker },
				{ label: _('Name'), node: nameInp },
				{ label: _('Protocol'), node: protoSel },
				{ label: _('Uplink zone'), node: src },
				{ label: _('External WAN port'), node: extInp, help: _('Single port (e.g. 443) or range (e.g. 27015-27030).') },
				{ label: _('Internal IPv4'), node: ipInp },
				{ label: _('Destination zone'), node: dest },
				{ label: _('Internal port'), node: intInp, desc: _('Leave blank to forward to the same port number.') }
			], function() {
				var nm = nameInp.value.trim();
				var ext = extInp.value.trim();
				var dstIp = ipInp.value.trim();
				var dstPort = intInp.value.trim() || ext;
				if (!nm) throw new Error(_('Please enter a rule name.'));
				if (!uplinks.includes(src.value) || !inside.includes(dest.value)) throw new Error(_('Choose the uplink and destination firewall zones.'));
				if (!validPortOrRange(ext)) throw new Error(_('External port must be 1–65535 (or start-end range).'));
				if (!validIpv4(dstIp)) throw new Error(_('Enter a valid internal IPv4 address.'));
				if (!validPortOrRange(dstPort)) throw new Error(_('Internal port must be 1–65535 (or start-end range).'));
				var sid = uci.add('firewall', 'redirect');
				uci.set('firewall', sid, 'target', 'DNAT');
				uci.set('firewall', sid, 'src', src.value);
				uci.set('firewall', sid, 'dest', dest.value);
				uci.set('firewall', sid, 'name', nm);
				uci.set('firewall', sid, 'proto', protoSel.value);
				uci.set('firewall', sid, 'src_dport', ext);
				uci.set('firewall', sid, 'dest_ip', dstIp);
				uci.set('firewall', sid, 'dest_port', dstPort);
				return wb.reviewChanges()
					.then(function() { return uci.load('firewall'); }).then(rerender);
			}, { ok: _('Add forward') });
		}

		function rerender() {
			var checks = computeChecks(uplinks);
			var policies = zones.filter(function(zone) { return uplinks.includes(zone.getName()); }).map(function(zone) { return [zone.getName(), String(zone.getInput() || '').toUpperCase()]; });
			var values = Array.from(new Set(policies.map(function(entry) { return entry[1]; })));
			var headline = !values.length ? _('WAN input policy unavailable') : values.length !== 1 ? _('WAN defaults differ by zone') : _('WAN default: %s').format(({ REJECT: _('Reject'), ACCEPT: _('Accept'), DROP: _('Drop') })[values[0]] || _('Unknown'));

			var checkItems = checks.map(function(c) {
				return E('div', { 'class': 'wb-check' }, [
					E('span', { 'class': 'mark ' + (c.ok === true ? 'good' : c.ok === false ? 'bad' : 'mut') }, [ c.ok === true ? '✓' : c.ok === false ? '!' : 'i' ]),
					E('div', { 'style': 'flex:1;min-width:0' }, [ E('div', { 'class': 'name' }, [ c.name ]), E('div', { 'class': 'meta' }, [ c.detail ]) ]),
					c.link ? linkBtn(c.link[0], c.link[1]) : ''
				]);
			});

			var redirRows = uci.sections('firewall', 'redirect').slice(0, 30).map(function(r) {
				var sid = r['.name'];
				var on = r.enabled !== '0';
				return E('tr', {}, [
					E('td', { 'class': 'name' }, [ r.name || sid ]),
					E('td', { 'class': 'mono' }, [ (r.proto || 'tcpudp') + ' :' + (r.src_dport || r.ext_port || '') ]),
					E('td', { 'class': 'mono' }, [ (r.dest_ip || '') + ':' + (r.dest_port || r.src_dport || '') ]),
					E('td', { 'class': 'actions' }, [
						wb.toggle(on, function(next) {
							if (next) uci.unset('firewall', sid, 'enabled');
							else uci.set('firewall', sid, 'enabled', '0');
							return wb.reviewChanges()
								.then(function() { return uci.load('firewall'); }).then(rerender);
						}, { 'aria-label': _('Enable port forward') }),
						wb.iconButton('trash', _('Delete port forward'), { 'class': 'wb-icon-btn sm danger', 'click': function() {
							wb.confirm(_('Delete “%s”?').format(r.name || sid), _('Remove this forwarding rule from the pending configuration?'), { ok: _('Review deletion'), danger: true }).then(function(yes) {
								if (!yes) return;
								uci.remove('firewall', sid);
								return wb.reviewChanges()
									.then(function() { return uci.load('firewall'); }).then(rerender);
							});
						} })
					])
				]);
			});

			var ruleRows = uci.sections('firewall', 'rule').filter(function(r) { return !/^wundr_/.test(String(r.name || '')); }).slice(0, 30).map(function(r) {
				return E('tr', {}, [
					E('td', { 'class': 'name' }, [ r.name || r['.name'] ]),
					E('td', { 'class': 'mono' }, [ (r.src || _('Router')) + ' → ' + (r.dest || _('Router')) ]),
					E('td', {}, [ wb.pill(r.target || _('Not specified'), 'mut') ])
				]);
			});

			var zoneRows = zones.map(function(z) {
				var inp = z.getInput(), fwd = z.getForward();
				return E('tr', {}, [
					E('td', { 'class': 'name mono' }, [ z.getName() ]),
					E('td', { 'class': 'mono' }, [ splitList(z.get('network')).join(', ') || '—' ]),
					E('td', { 'class': 'mono' }, [ 'In ' + inp + ' · Fwd ' + fwd + (z.isMasquerade() ? ' · Masq' : '') ])
				]);
			});

			var fwdActions = E('div', { 'style': 'display:flex;gap:6px;flex-wrap:wrap' }, [
				uplinks.length && inside.length ? E('button', { 'class': 'wb-btn sm primary', 'id': 'wb-add-forward', 'type': 'button', 'click': openAddForwardModal }, [ wb.iconLabel('plus', _('Add forward')) ]) : '',
				E('a', { 'class': 'wb-btn sm', 'href': L.url('admin/network/firewall/forwards') }, [ _('All in LuCI') ])
			]);

			dom.content(mount, [
				wb.hero(headline, _('Default for traffic addressed to the router, before individual rule exceptions.'), policies.map(function(entry) { return wb.pill(entry[0] + ': ' + (entry[1] || _('Unknown')), entry[1] === 'ACCEPT' ? 'warn' : 'mut'); }), [linkBtn('admin/network/firewall/rules', _('Review firewall rules'))]),
				card(_('Exceptions and settings'), [ E('div', { 'class': 'wb-list' }, checkItems) ]),
				E('div', { 'class': 'wb-grid cols-2' }, [
					card(_('Port forwards'), [ scrollTable([ _('Name'), _('External'), _('Internal'), '' ], redirRows) ], fwdActions),
					card(_('Firewall zones'), [ scrollTable([ _('Zone'), _('Interfaces'), _('Policy') ], zoneRows) ], linkBtn('admin/network/firewall/zones', _('Manage')))
				]),
				card(_('Custom rules'), [ scrollTable([ _('Rule'), _('Path'), _('Action') ], ruleRows) ], linkBtn('admin/network/firewall/rules', _('Manage rules')))
			]);
		}

		rerender();
		return mount;
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
