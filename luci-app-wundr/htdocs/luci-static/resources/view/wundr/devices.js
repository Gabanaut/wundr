'use strict';
'require view';
'require uci';
'require rpc';
'require poll';
'require dom';
'require network';
'require form';
'require ui';
'require tools.widgets as widgets';
'require wundr.ui as wb';

/* Wundr Devices — the live client list. Each device can be renamed, given a
 * static lease, or paused (a lan→wan REJECT firewall rule keyed on its MAC).
 * Data comes entirely from network.js + rpcd getDHCPLeases — nothing invented.
 * Writes stage via uci.js then apply through LuCI's validated path. */

var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

function collect() {
	network.flushCache();
	return Promise.all([
		wb.hostHints(),
		L.resolveDefault(callLeases(), {}),
		network.getWifiNetworks()
	]).then(function(res) {
		var hints = res[0] || {}, leases = (res[1] && res[1].dhcp_leases) || [], nets = res[2] || [];
		return Promise.all(nets.map(function(n) {
			return L.resolveDefault(n.getAssocList(), []).then(function(list) {
				return (list || []).map(function(a) { return Object.assign({ ssid: n.getActiveSSID() }, a); });
			});
		})).then(function(slists) {
			var stations = {};
			slists.forEach(function(list) { list.forEach(function(a) { if (a.mac) stations[a.mac.toUpperCase()] = a; }); });
			return { hints: hints, leases: leases, stations: stations };
		});
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
function findBlock(mac) {
	var name = blockRuleName(mac), hit = null;
	uci.sections('firewall', 'rule', function(s) { if (!hit && s.name === name) hit = s['.name']; });
	return hit;
}

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
			var blocked = !!findBlock(dev.mac);
			var lsid = leaseName(dev.mac);
			var conn = dev.online ? ('Wi-Fi' + (dev.ssid ? ' · ' + dev.ssid : '')) : _('Not reported');
			var displayName = (lsid && uci.get('dhcp', lsid, 'name')) || dev.name || _('Unknown device');
			var pinnedIp = lsid ? uci.get('dhcp', lsid, 'ip') : null;
			return E('tr', { 'data-hay': (String(displayName) + ' ' + (dev.ip || '') + ' ' + dev.mac).toLowerCase() }, [
				E('td', { 'class': 'name' }, [
					E('div', { 'class': 'wb-device-name' }, [
						E('span', { 'class': 'ico' + (dev.online ? ' online' : '') }, [ wb.icon(dev.online ? 'wifi' : 'devices', 16) ]),
						E('div', {}, [ E('b', {}, [ displayName ]), E('small', {}, [ dev.mac ]) ])
					])
				]),
				E('td', { 'class': 'mono' }, [ dev.ip || pinnedIp || '—' ]),
				E('td', {}, [ conn, ' ', dev.online ? wb.sigBars(dev.signal) : '' ]),
				E('td', { 'class': 'mono' }, [ dev.online ? wb.pill(_('Online'), 'good') : wb.pill(dev.lease ? _('Lease recorded') : _('Last seen'), 'mut') ]),
				E('td', { 'class': 'actions' }, [
					E('button', { 'class': 'wb-btn sm' + (lsid ? ' active' : ''), 'title': lsid ? _('Edit or remove static lease') : _('Set up a static lease'), 'click': function() { addLease(dev, displayName); } }, [ lsid ? _('Static IP') : _('Lease') ]),
					wb.toggle(!blocked, function(allow) { return setBlock(dev, allow); }, { 'aria-label': _('Allow internet'), 'title': allow_(blocked) })
				])
			]);
		}
		function allow_(blocked) { return blocked ? _('Currently paused — click to allow') : _('Click to pause internet'); }

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
					return wb.apply(false)
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
				return wb.apply(false)
					.then(function() { return uci.load('dhcp'); }).then(render);
			}, { ok: existing ? _('Save lease') : _('Add lease') });
		}

		function setBlock(dev, allow) {
			var existing = findBlock(dev.mac);
			if (!allow) {
				if (existing) return Promise.resolve();
				var cid = uci.add('firewall', 'rule');
				uci.set('firewall', cid, 'name', blockRuleName(dev.mac));
				uci.set('firewall', cid, 'comment', 'Wundr · paused ' + dev.mac);
				uci.set('firewall', cid, 'src', 'lan');
				uci.set('firewall', cid, 'dest', 'wan');
				uci.set('firewall', cid, 'proto', 'all');
				uci.set('firewall', cid, 'target', 'REJECT');
				uci.set('firewall', cid, 'src_mac', [ dev.mac.toUpperCase() ]);
			} else if (existing) {
				uci.remove('firewall', existing);
			}
			return wb.apply(false)
				.then(function() { return collect(); })
				.then(function(d) { live = d; render(); })
				.catch(function() { render(); });
		}

		function render() {
			var list = buildList(live);
			var table = E('table', { 'class': 'wb-table' }, [
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
		poll.add(function() { return collect().then(function(d) { live = d; render(); }); }, 5);
		return E('div', {}, [ E('section', { 'class': 'wb-card wb-hero' }, [ heading, summary, E('div', { 'class': 'wb-action-row' }, [ searchBox ]) ]), body ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
