'use strict';
'require view';
'require uci';
'require firewall';
'require network';
'require dom';
'require wundr.ui as wb';

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

function computeChecks(zones) {
	var out = [];
	var wan = zones.filter(function(z) { return z.getName() === 'wan'; })[0];
	var custom = uci.sections('firewall', 'rule').filter(function(r) { return !/^wundr_/.test(String(r.name || '')); });
	var redirs = uci.sections('firewall', 'redirect');

	var wanInput = wan ? String(uci.get('firewall', wan['.name'], 'input') || 'DROP').toUpperCase() : 'DROP';
	out.push({ name: _('Internet side drops unsolicited traffic'), ok: wanInput !== 'ACCEPT', detail: 'wan "input" = ' + wanInput });

	var synOn = zones.some(function(z) { return uci.get('firewall', z['.name'], 'syn_flood') === '1'; });
	out.push({ name: _('SYN-flood protection'), ok: synOn, detail: synOn ? _('Enabled on at least one zone.') : _('Disabled — enable under Zones for internet-facing routers.') });

	var broad = custom.filter(function(r) {
		if (String(r.target || '').toUpperCase() !== 'ACCEPT') return false;
		var src = String(r.src || '').toLowerCase();
		return src === 'wan' || src === '*';
	});
	out.push({ name: _('Loose allow rules from the internet'), ok: !broad.length, detail: broad.length ? broad.length + ' broad ACCEPT rule(s) to review.' : _('None detected.') });

	var upnps = redirs.filter(function(r) { return /upnp/i.test(String(r.name || '')); }).length;
	out.push({ name: _('UPnP-created port opens'), ok: upnps === 0, detail: upnps + ' forward(s) look UPnP-created.' });

	out.push({ name: _('Explicit port forwards'), ok: redirs.length <= 6, detail: redirs.length + ' active — each is a door in from the internet.' });

	var dns = uci.sections('dhcp', 'dnsmasq')[0] || {};
	out.push({
		name: _('Clients forced to use router DNS'), ok: dns.noresolv === '1',
		detail: dns.noresolv === '1' ? _('Upstream resolvers will not leak to clients.') : _('Clients receive provider DNS via DHCP. Set DHCP DNS to filter.'),
		link: [ 'wundr/network/lan-config', _('Open LAN & DHCP') ]
	});

	return out;
}

function scoreOf(checks) {
	var app = checks.filter(function(c) { return c.ok === true || c.ok === false; });
	return app.length ? Math.round(app.filter(function(c) { return c.ok; }).length / app.length * 100) : null;
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
			L.resolveDefault(network.getHostHints(), {})
		]);
	},

	render: function(data) {
		var zones = data[2] || [];
		var hints = data[3] || {};
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
			var hostOpts = [ [ '', _('Choose a connected device (optional)…') ] ];
			Object.keys(hints).sort().forEach(function(mac) {
				var h = hints[mac] || {};
				var ip = (Array.isArray(h.ipaddrs) && h.ipaddrs[0]) || h.ip || '';
				if (ip) hostOpts.push([ ip, (h.name ? h.name + ' — ' : '') + ip + ' (' + mac + ')' ]);
			});
			var picker = wb.select(hostOpts, '');
			var nameInp = wb.input({ 'placeholder': _('e.g. WireGuard / Plex / Game server') });
			var protoSel = wb.select([ [ 'tcp udp', 'TCP + UDP' ], [ 'tcp', 'TCP' ], [ 'udp', 'UDP' ] ], 'tcp udp');
			var extInp = wb.input({ 'placeholder': _('e.g. 51820 or 8000-8010') });
			var ipInp = wb.input({ 'placeholder': '192.168.1.50' });
			var intInp = wb.input({ 'placeholder': _('Same as external port') });

			picker.addEventListener('change', function() {
				if (!picker.value) return;
				ipInp.value = picker.value;
				if (!nameInp.value.trim()) {
					var txt = picker.options[picker.selectedIndex].text.split(' — ')[0];
					if (txt && txt.indexOf('.') < 0) nameInp.value = txt;
				}
			});

			wb.formModal(_('Add port forward'), [
				{ label: _('Device'), node: picker },
				{ label: _('Name'), node: nameInp },
				{ label: _('Protocol'), node: protoSel },
				{ label: _('External WAN port'), node: extInp, help: _('Single port (e.g. 443) or range (e.g. 27015-27030).') },
				{ label: _('Internal IPv4'), node: ipInp },
				{ label: _('Internal port'), node: intInp, desc: _('Leave blank to forward to the same port number.') }
			], function() {
				var nm = nameInp.value.trim();
				var ext = extInp.value.trim();
				var dstIp = ipInp.value.trim();
				var dstPort = intInp.value.trim() || ext;
				if (!nm) throw new Error(_('Please enter a rule name.'));
				if (!validPortOrRange(ext)) throw new Error(_('External port must be 1–65535 (or start-end range).'));
				if (!validIpv4(dstIp)) throw new Error(_('Enter a valid internal IPv4 address.'));
				if (!validPortOrRange(dstPort)) throw new Error(_('Internal port must be 1–65535 (or start-end range).'));
				var sid = uci.add('firewall', 'redirect');
				uci.set('firewall', sid, 'target', 'DNAT');
				uci.set('firewall', sid, 'src', 'wan');
				uci.set('firewall', sid, 'dest', 'lan');
				uci.set('firewall', sid, 'name', nm);
				uci.set('firewall', sid, 'proto', protoSel.value);
				uci.set('firewall', sid, 'src_dport', ext);
				uci.set('firewall', sid, 'dest_ip', dstIp);
				uci.set('firewall', sid, 'dest_port', dstPort);
				return wb.apply(false, _('Port forward added'), nm + ' → ' + dstIp + ':' + dstPort)
					.then(function() { return uci.load('firewall'); }).then(rerender);
			}, { ok: _('Add forward') });
		}

		function rerender() {
			var checks = computeChecks(zones);
			var score = scoreOf(checks);
			var passCount = checks.filter(function(c) { return c.ok === true; }).length;
			var appCount = checks.filter(function(c) { return c.ok === true || c.ok === false; }).length;
			var failing = checks.filter(function(c) { return c.ok === false; });

			var Circ = 2 * Math.PI * 42;
			var ringColor = score == null ? 'var(--wb-border)' : (score >= 80 ? 'var(--wb-good)' : (score >= 50 ? 'var(--wb-warn)' : 'var(--wb-bad)'));
			var ring = E('div', { 'class': 'wb-score' }, [
				E('svg', { 'viewBox': '0 0 100 100' }, [
					E('circle', { 'class': 'track', 'cx': '50', 'cy': '50', 'r': '42' }),
					E('circle', { 'class': 'val', 'style': 'stroke:' + ringColor, 'cx': '50', 'cy': '50', 'r': '42', 'stroke-dasharray': String(Circ), 'stroke-dashoffset': String(Circ * (score == null ? 1 : 1 - score / 100)) })
				]),
				E('span', { 'class': 'num' }, [ String(score == null ? '—' : score) ])
			]);

			var checkItems = checks.map(function(c) {
				return E('div', { 'class': 'wb-check' }, [
					E('span', { 'class': 'mark ' + (c.ok === true ? 'good' : (c.ok === false ? 'bad' : 'warn')) }, [ c.ok === true ? '✓' : '!' ]),
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
							return wb.apply(false, next ? _('Port forward enabled') : _('Port forward disabled'), r.name || sid)
								.then(function() { return uci.load('firewall'); }).then(rerender);
						}, { 'aria-label': _('Enable port forward') }),
						wb.iconButton('trash', _('Delete port forward'), { 'class': 'wb-icon-btn sm danger', 'click': function() {
							wb.confirm(_('Delete “%s”?').format(r.name || sid), _('This closes the forwarded WAN port immediately.'), { ok: _('Delete'), danger: true }).then(function(yes) {
								if (!yes) return;
								uci.remove('firewall', sid);
								return wb.apply(false, _('Port forward deleted'), r.name || sid)
									.then(function() { return uci.load('firewall'); }).then(rerender);
							});
						} })
					])
				]);
			});

			var ruleRows = uci.sections('firewall', 'rule').filter(function(r) { return !/^wundr_/.test(String(r.name || '')); }).slice(0, 30).map(function(r) {
				return E('tr', {}, [
					E('td', { 'class': 'name' }, [ r.name || r['.name'] ]),
					E('td', { 'class': 'mono' }, [ (r.src || '*') + ' → ' + (r.dest || '*') ]),
					E('td', {}, [ E('span', { 'class': 'wb-pill ' + (String(r.target || 'ACCEPT').toUpperCase() === 'ACCEPT' ? 'mut' : 'warn') }, [ r.target || 'ACCEPT' ]) ])
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
				E('button', { 'class': 'wb-btn sm primary', 'type': 'button', 'click': openAddForwardModal }, [ wb.iconLabel('plus', _('Add forward')) ]),
				E('a', { 'class': 'wb-btn sm', 'href': L.url('admin/network/firewall/forwards') }, [ _('All in LuCI') ])
			]);

			dom.content(mount, [
				E('section', { 'class': 'wb-card wb-hero' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:22px;flex-wrap:wrap' }, [
						ring,
						E('div', { 'style': 'flex:1;min-width:220px' }, [
							E('h2', { 'class': 'wb-h', 'style': 'margin:0 0 4px' }, [ score == null ? _('Security posture unavailable') : (score >= 80 ? _('Your network looks protected') : (score >= 50 ? _('Worth tightening') : _('Attention needed'))) ]),
							E('div', { 'class': 'wb-sub' }, [ passCount + ' / ' + appCount + ' ' + _('security checks passing') ]),
							failing.length ? E('div', { 'class': 'wb-sub', 'style': 'margin-top:6px;color:var(--wb-warn)' }, [ failing.map(function(c) { return c.name; }).join(' · ') ]) : ''
						]),
						E('div', { 'class': 'wb-hero-actions' }, [
							E('button', { 'class': 'wb-btn primary', 'type': 'button', 'click': openAddForwardModal }, [ wb.iconLabel('plus', _('Add port forward')) ]),
							linkBtn('admin/network/firewall/rules', _('Firewall rules'))
						])
					])
				]),
				card(_('Checks'), [ E('div', { 'class': 'wb-list' }, checkItems) ]),
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
