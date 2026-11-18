'use strict';
'require view';
'require uci';
'require poll';
'require dom';
'require wundr.policy as policy';
'require ui';
'require wundr.ui as wb';

function collect() {
	return Promise.all([ wb.hostHints(), policy.read() ]).then(function(res) {
		return Object.assign({ hints: res[0] }, res[1]);
	});
}

function buildList(data) {
	var hints = data.hints || {}, leases = data.leases || [], stations = data.stations || {};
	var byMac = {};
	function ensure(mac) {
		mac = String(mac).toUpperCase();
		if (!byMac[mac]) byMac[mac] = { mac: mac, name: null, ip: null, online: false, signal: null, ssid: null };
		return byMac[mac];
	}
	Object.keys(hints).forEach(function(mac) {
		var hint = hints[mac];
		if (!hint) return;
		var host = ensure(mac);
		host.name = hint.name;
		host.ip = L.toArray(hint.ipaddrs || hint.ipv4)[0];
	});
	leases.forEach(function(l) {
		if (!l || !l.macaddr) return;
		var h = ensure(l.macaddr);
		if (l.hostname && !h.name) h.name = l.hostname;
		if (l.ipaddr) h.ip = l.ipaddr;
		h.lease = l;
	});
	Object.keys(stations).forEach(function(mac) {
		var h = ensure(mac), s = stations[mac];
		/* assoclist station `signal` is a plain dBm integer (matches native view). */
		h.online = true; h.signal = s.signal; h.ssid = s.ssid || null;
	});
	return Object.values(byMac).sort(function(a, b) {
		if (a.online !== b.online) return a.online ? -1 : 1;
		return String(a.name || a.mac).localeCompare(String(b.name || b.mac));
	});
}

function blockRuleName(mac) { return 'wundr_block_' + mac.replace(/[^0-9a-fA-F]/g, ''); }

return view.extend({
	load: function() {
		return Promise.all([ uci.load('dhcp'), uci.load('firewall'), collect() ]);
	},

	render: function(data) {
		var live = data[2];
		var body = E('div');
		var searchBox = wb.input({ 'type': 'search', 'placeholder': _('Search name, IP or MAC…'), 'aria-label': _('Filter devices') });
		var heading = E('h2', { 'class': 'wb-h' }), summary = E('div', { 'class': 'wb-sub' });

		/* Persistent static-lease name overrides live in DHCP host sections. */
		function leaseName(mac) {
			var hit = null;
			uci.sections('dhcp', 'host', function(s) {
				var m = L.toArray(s.mac);
				if (!hit && m.filter(Boolean).map(function(x){return x.toUpperCase();}).indexOf(mac.toUpperCase()) >= 0) hit = s['.name'];
			});
			return hit;
		}

		function row(dev) {
			var lsid = leaseName(dev.mac);
			var conn = dev.online ? ('Wi-Fi' + (dev.ssid ? ' · ' + dev.ssid : '')) : _('Not reported');
			var displayName = (lsid && uci.get('dhcp', lsid, 'name')) || dev.name || _('Unknown device');
			var pinnedIp = lsid ? uci.get('dhcp', lsid, 'ip') : null;
			var zone = live.source(dev.mac), ip = dev.ip || pinnedIp || '', status = dev.online ? _('Wi-Fi associated') : dev.lease ? _('Lease recorded') : _('Last seen');
			function inspect() {
				zone = live.source(dev.mac);
				var name = blockRuleName(dev.mac), rules = uci.sections('firewall', 'rule').filter(function(rule) { return rule.name === name; });
				var paths = policy.targets([dev.mac], live);
				var scoped = paths && paths.every(function(path) { return rules.some(function(rule) { return policy.matches(rule, dev.mac, zone, [path.dest]); }); });
				var pathLabel = paths ? zone + ' → ' + live.uplinks.join(', ') : _('Unverified');
				var details = wb.kv([[ _('IPv4'), ip ], [ _('MAC'), dev.mac, 'mono' ], [ _('Connection'), conn ], [ _('Firewall zone'), zone || _('Unassigned') ], [ _('Uplink path'), pathLabel ], [ _('Device pause rule'), rules.length ? (scoped ? _('Configured for this path') : _('Configured; scope unverified')) : _('Not configured') ]]);
				ui.showModal([displayName], [ details,
					E('div', { 'class': 'wb-action-row' }, [ E('button', { 'class': 'wb-btn', 'click': function() { addLease(dev, displayName); } }, _('Static lease')),
						paths || rules.length ? E('button', { 'class': 'wb-btn', 'click': ui.createHandlerFn(null, async function() {
							var current = await policy.read(), next = policy.targets([dev.mac], current);
							if (!details.isConnected || !details.closest('.modal-overlay-active')) return;
							if (!rules.length && (!next || JSON.stringify(next) !== JSON.stringify(paths))) { live = Object.assign({}, live, current); inspect(); return; }
							policy.replaceRules([name], name, rules.length ? [] : next);
							return wb.reviewChanges().then(render);
						}) }, rules.length ? _('Remove device pause') : _('Configure WAN pause')) : '', E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')) ]) ]);
			}
			return E('tr', { 'data-hay': [displayName, ip, dev.mac, zone].join(' ').toLowerCase() }, [
				E('td', { 'class': 'name' }, [
					E('button', { 'class': 'wb-device-name wb-device-open', 'type': 'button', 'click': inspect }, [
						E('span', { 'class': 'ico' + (dev.online ? ' online' : '') }, [ wb.icon(dev.online ? 'wifi' : 'devices', 16) ]),
						E('span', { 'class': 'grow' }, [ E('b', {}, [ displayName ]), E('small', { 'class': 'desktop-id' }, [ dev.mac ]), E('small', { 'class': 'mobile-id' }, [ [ip || dev.mac, zone || _('Unassigned')].join(' · ') ]) ]), E('small', { 'class': 'mobile-status' }, [ status ])
					])
				]),
				E('td', { 'class': 'mono' }, [ dev.ip || pinnedIp || '—' ]),
				E('td', {}, [ conn, ' ', dev.online ? wb.sigBars(dev.signal) : '' ]),
				E('td', { 'class': 'mono' }, [ dev.online ? wb.pill(_('Online'), 'good') : wb.pill(dev.lease ? _('Lease recorded') : _('Last seen'), 'mut') ]),
				E('td', { 'class': 'actions' }, [
					E('button', { 'class': 'wb-btn sm' + (lsid ? ' active' : ''), 'title': lsid ? _('Edit or remove static lease') : _('Set up a static lease'), 'click': function() { addLease(dev, displayName); } }, [ lsid ? _('Static IP') : _('Lease') ]),
					wb.iconButton('devices', _('Device details'), { 'click': inspect })
				])
			]);
		}

		function validIpv4(v) {
			var p = String(v || '').trim().split('.');
			return p.length === 4 && p.every(function(o) { return /^\d{1,3}$/.test(o) && Number(o) <= 255; });
		}

		function addLease(dev, suggestName) {
			var existing = leaseName(dev.mac);
			var curName = existing ? (uci.get('dhcp', existing, 'name') || '') : (suggestName && suggestName !== _('Unknown device') ? suggestName : '');
			var curIp = (existing && uci.get('dhcp', existing, 'ip')) || dev.ip || '';
			var name = wb.input({ 'value': curName, 'placeholder': _('e.g. Living-room TV') });
			var ip = wb.input({ 'value': curIp, 'placeholder': '192.168.1.50', 'id': 'wb-lease-ip' });
			var rmBox = existing ? E('input', { 'type': 'checkbox' }) : null;
			var fields = [
				{ label: _('Name'), node: name },
				{ label: _('IPv4 address'), node: ip, desc: _('Pins this address to %s. Reuse the current one to avoid surprises.').format(dev.mac) },
				{ raw: E('div', { 'class': 'wb-form-desc' }, [ _('Device: ') + dev.mac ]) }
			];
			if (rmBox) {
				fields.push({ label: _('Remove'), node: E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [ rmBox, _('Remove this device from the reservation') ]) });
			}
			wb.formModal(existing ? _('Edit static lease') : _('Static lease'), fields, function() {
				if (rmBox && rmBox.checked) {
					var otherMacs = L.toArray(uci.get('dhcp', existing, 'mac')).filter(function(mac) { return mac.toUpperCase() !== dev.mac; });
					if (otherMacs.length) uci.set('dhcp', existing, 'mac', otherMacs);
					else uci.remove('dhcp', existing);
					return wb.reviewChanges()
						.then(function() { return uci.load('dhcp'); }).then(render);
				}
				var ipVal = ip.value.trim();
				if (ipVal && !validIpv4(ipVal)) throw new Error(_('Enter a valid IPv4 address (e.g. 192.168.1.50).'));
				var host = existing || uci.add('dhcp', 'host');
				if (name.value.trim()) uci.set('dhcp', host, 'name', name.value.trim());
				else uci.unset('dhcp', host, 'name');
				if (!existing) uci.set('dhcp', host, 'mac', [ dev.mac ]);
				if (ipVal) uci.set('dhcp', host, 'ip', ipVal);
				else uci.unset('dhcp', host, 'ip');
				return wb.reviewChanges()
					.then(function() { return uci.load('dhcp'); }).then(render);
			}, { ok: existing ? _('Save lease') : _('Add lease') });
		}

		function render() {
			var list = buildList(live);
			var table = E('table', { 'class': 'wb-table wb-client-table' }, [
				E('thead', {}, [ E('tr', {}, [ E('th', {}, _('Device')), E('th', {}, _('IPv4')), E('th', {}, _('Connection')), E('th', {}, _('Status')), E('th', { 'style': 'text-align:right' }, _('Actions')) ]) ]),
				E('tbody', {}, list.length ? list.map(row) : [ E('tr', {}, [ E('td', { 'class': 'wb-empty', 'colspan': '5' }, _('No devices have been seen yet.')) ]) ])
			]);
			var online = list.filter(function(d) { return d.online; }).length;
			heading.textContent = list.length + ' ' + _('devices');
			summary.textContent = _('%d associated with Wi-Fi').format(online);
			dom.content(body, [ wb.card(null, [ E('div', { 'class': 'wb-table-scroll' }, [ table ]) ]) ]);
			applyFilter();
		}

		function applyFilter() {
			var q = searchBox.value.trim().toLowerCase();
			body.querySelectorAll('tbody tr[data-hay]').forEach(function(tr) {
				tr.style.display = (!q || tr.getAttribute('data-hay').indexOf(q) >= 0) ? '' : 'none';
			});
		}
		searchBox.addEventListener('input', applyFilter);

		render();
		poll.add(function() { return collect().then(function(d) { if (!body.contains(document.activeElement)) { live = d; render(); } }); }, 5);
		return E('div', {}, [ E('section', { 'class': 'wb-card wb-hero' }, [ heading, summary, E('div', { 'class': 'wb-action-row' }, [ searchBox ]) ]), body ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
