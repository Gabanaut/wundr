'use strict';
'require view';
'require uci';
'require poll';
'require network';
'require ui';
'require dom';
'require wundr.ui as wb';

/* Wundr Wi-Fi — one card per network name (SSID) across all bands, live
 * client counts, on/off, QR sharing, one-tap guest network creation, and
 * per-radio status. Detailed tuning lives in Wi-Fi Settings (wifi-config). */

function loadLive() {
	network.flushCache();
	return Promise.all([ network.getWifiDevices(), network.getWifiNetworks() ]).then(function(res) {
		var nets = res[1] || [];
		return Promise.all(nets.map(function(n) { return L.resolveDefault(n.getAssocList(), []); })).then(function(assocs) {
			var byName = {};
			nets.forEach(function(n, i) { byName[n.getName()] = { net: n, clients: assocs[i] || [] }; });
			return { radios: res[0] || [], nets: nets, live: byName };
		});
	});
}

function networkLabel(net) {
	return L.toArray(net).map(function(name) {
		if (name === 'lan') return _('Main LAN');
		var match = /^lan(\d+)$/.exec(name);
		return match ? _('VLAN') + ' ' + match[1] + ' (' + name + ')' : name;
	}).join(', ') || _('Not attached');
}

function attachOptions(guest) {
	var opts = [];
	var zones = guest ? uci.sections('firewall', 'zone') : [];
	var forwards = guest ? uci.sections('firewall', 'forwarding') : [];
	var lanDevice = uci.get('network', 'lan', 'device');
	uci.sections('network', 'interface', function(ifc) {
		var id = ifc['.name'];
		if (id === 'loopback' || /^wan/.test(id) || ifc.proto === 'none') return;
		if (guest) {
			if (id === 'lan' || ifc.proto !== 'static' || (lanDevice && ifc.device === lanDevice)) return;
			var members = zones.filter(function(zone) { return L.toArray(zone.network).indexOf(id) >= 0; });
			var zone = members[0];
			if (members.length !== 1 || !zone.name || /^(lan|wan)$/.test(zone.name) || L.toArray(zone.network).includes('lan')) return;
			if (!/^(REJECT|DROP)$/i.test(zone.input) || !/^(REJECT|DROP)$/i.test(zone.forward)) return;
			if (forwards.some(function(rule) { return (rule.src === zone.name || rule.src === '*') && rule.dest !== 'wan' && !/^(0|off|no|false)$/i.test(rule.enabled); })) return;
		}
		opts.push([ id, id === 'lan' ? _('Main LAN (full access)') : networkLabel(id) ]);
	});
	return opts;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('wireless'), uci.load('network'), loadLive(), L.resolveDefault(uci.load('firewall'), null) ]);
	},

	render: function(data) {
		var live = data[2];
		var body = E('div');
		var radiosBody = E('div');

		function groups() {
			var map = Object.create(null), order = [];
			uci.sections('wireless', 'wifi-iface', function(s) {
				if ((s.mode || 'ap') !== 'ap') return;
				var fields = Object.keys(s).filter(function(key) { return key[0] !== '.' && key !== 'device'; }).sort();
				var key = s.ssid ? JSON.stringify(fields.map(function(field) { return [field, s[field]]; })) : s['.name'];
				if (!map[key]) { map[key] = { ssid: s.ssid || _('Unnamed'), ifaces: [] }; order.push(key); }
				map[key].ifaces.push(s);
			});
			return order.map(function(k) { return map[k]; });
		}

		function radioOf(sid) {
			return live.radios.filter(function(r) { return r.getName() === sid; })[0] || null;
		}

		function ssidCard(g) {
			var anyOn = g.ifaces.some(function(s) { return s.disabled !== '1'; });
			var first = g.ifaces[0];
			var clients = 0;
			var bands = g.ifaces.map(function(s) {
				var r = radioOf(s.device), l = live.live[s['.name']];
				var up = !!(l && l.net.isUp());
				if (l) clients += l.clients.length;
				return E('span', { 'class': 'wb-radio' + (up ? '' : ' off'), 'title': s.device }, [ E('span', { 'class': 'sig' }), wb.bandLabel(r ? r.get('band') : null, l ? l.net.getChannel() : null), l && up ? ' · ' + l.clients.length : '' ]);
			});
			var enc = first.encryption || 'none';
			var isOpen = enc === 'none';
			var facts = [ wb.encryptionLabel(enc), networkLabel(first.network) ];
			var scope = networkLabel(first.network) + ' · ' + g.ifaces.map(function(iface) { return iface.device; }).join(', ');
			if (first.hidden === '1') facts.push(_('Hidden'));
			if (first.isolate === '1') facts.push(_('Client isolation'));

			return E('section', { 'class': 'wb-card wb-ssid-card' }, [
				E('div', { 'class': 'wb-ssid-head' }, [
					E('span', { 'class': 'ico' + (anyOn ? '' : ' off') }, [ wb.icon('wifi', 20) ]),
					E('div', { 'class': 'grow' }, [ E('h3', {}, [ g.ssid ]), E('div', { 'class': 'wb-sub' }, [ facts.join(' · ') ]) ]),
					wb.toggle(anyOn, function(next) {
						g.ifaces.forEach(function(s) { if (next) uci.unset('wireless', s['.name'], 'disabled'); else uci.set('wireless', s['.name'], 'disabled', '1'); });
						return wb.reviewChanges();
					}, { 'aria-label': _('Enable %s on %s').format(g.ssid, scope) })
				]),
				E('div', { 'class': 'wb-radio-row' }, bands),
				E('div', { 'class': 'wb-action-row' }, [
					wb.pill(anyOn ? clients + ' ' + _('connected') : _('Off'), anyOn ? (clients ? 'good' : 'mut') : 'mut'),
					isOpen ? wb.pill(_('No password'), 'warn') : '',
					E('span', { 'style': 'flex:1' }),
					wb.wifiQrType(first) ? wb.iconButton('qr', _('Share with QR code'), { 'click': function() { shareQr(first); } }) : '',
					wb.iconLink('edit', _('Edit in Wi-Fi Settings'), L.url('wundr/network/wifi-config')),
					wb.iconButton('trash', _('Delete network'), { 'class': 'wb-icon-btn danger', 'click': function() {
						wb.confirm(_('Delete “%s”?').format(g.ssid), _('Remove %d access point(s): %s. Other networks with the same name are not included.').format(g.ifaces.length, scope), { ok: _('Review deletion'), danger: true }).then(function(yes) {
							if (!yes) return;
							g.ifaces.forEach(function(s) { uci.remove('wireless', s['.name']); });
							return wb.reviewChanges().then(rerender);
						});
					} })
				])
			]);
		}

		function shareQr(s) {
			var canvas = E('canvas');
			var type = wb.wifiQrType(s);
			if (!type || !window.WBQR || !WBQR.draw(canvas, WBQR.wifiString(s.ssid, s.key || '', type, s.hidden === '1'), { size: 240 })) return wb.toast(_('Wi-Fi code unavailable'), _('Join this network manually.'), 'warn');
			ui.showModal([_('Join “%s”').format(s.ssid)], [
				E('p', {}, [ _('Scan with a phone camera to connect. The code contains the network name and password.') ]),
				E('div', { 'class': 'wb-qr' }, [ canvas ]),
				E('div', { 'class': 'wb-qr-ssid' }, [ s.ssid ]),
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Close') ]) ])
			]);
		}

		function addNetwork(preset) {
			var radios = live.radios;
			if (!radios.length) { wb.toast(_('No Wi-Fi radios found'), _('This router reports no wireless hardware.'), 'warn'); return; }
			var guest = preset === 'guest', options = attachOptions(guest);
			if (guest && !options.length) {
				ui.showModal(_('Guest network needs a separate segment'), [
					E('p', {}, _('No eligible guest segment was found. Create a segment with restricted input and forwarding, then return to Wi-Fi.')),
					E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')), ' ', E('a', { 'class': 'wb-btn primary', 'href': L.url('wundr/network/mode') }, _('Set up a segment')) ])
				]);
				return;
			}
			var ssid = wb.input({ 'id': 'wb-new-ssid', 'maxlength': '32', 'placeholder': preset === 'guest' ? _('Guest') : _('My Wi-Fi'), 'value': preset === 'guest' ? _('Guest') : '' });
			var sae = L.hasSystemFeature('hostapd', 'sae');
			var enc = wb.select([], '', { 'id': 'wb-new-enc' });
			var key = wb.input({ 'id': 'wb-new-key', 'type': 'password', 'minlength': '8', 'maxlength': '63', 'autocomplete': 'new-password' });
			var attach = wb.select(guest ? [ [ '', _('Choose a segment') ] ].concat(options) : options, guest ? '' : 'lan', { 'id': 'wb-new-net' });
			var isolate = E('input', { 'type': 'checkbox', 'id': 'wb-new-isolate' });
			if (preset === 'guest') isolate.checked = true;
			var hidden = E('input', { 'type': 'checkbox', 'id': 'wb-new-hidden' });
			var radioBoxes = radios.map(function(r) {
				var cb = E('input', { 'type': 'checkbox', 'value': r.getName() });
				cb.disabled = r.get('band') === '6g' && !sae;
				cb.checked = !cb.disabled && !r.isDisabled();
				cb.addEventListener('change', updateModes);
				return E('label', {}, [ cb, ' ', wb.bandLabel(r.get('band')), E('small', {}, [ r.getName() ]) ]);
			});
			function selectedRadios() { return radios.filter(function(radio, index) { return radioBoxes[index].querySelector('input').checked; }); }
			function allowedModes() {
				if (selectedRadios().some(function(radio) { return radio.get('band') === '6g'; })) return sae ? ['sae'] : [];
				return (sae ? ['sae-mixed', 'sae'] : []).concat(['psk2', 'none']);
			}
			function updateModes() {
				var modes = allowedModes(), selected = modes.includes(enc.value) ? enc.value : modes[0];
				dom.content(enc, modes.map(function(mode) { return E('option', { 'value': mode }, [ wb.encryptionLabel(mode) ]); }));
				enc.value = selected || ''; key.disabled = enc.value === 'none';
			}
			updateModes();
			enc.addEventListener('change', function() { key.disabled = enc.value === 'none'; });

			wb.formModal(preset === 'guest' ? _('Create guest network') : _('Create Wi-Fi network'), [
				{ label: _('Network name'), node: ssid, help: _('The name people see when they look for Wi-Fi (SSID).') },
				{ label: _('Bands'), node: E('div', { 'class': 'wb-checklist' }, radioBoxes) },
				{ label: _('Security'), node: enc },
				{ label: _('Password'), node: key, desc: _('8–63 characters.') },
				{ label: _('Access'), node: attach, desc: guest ? _('Only segments with restricted firewall defaults are listed. Individual firewall rules can grant additional access.') : _('The selected network determines which firewall rules apply.') },
				{ label: _('Options'), node: E('div', { 'style': 'display:grid;gap:6px' }, [
					E('label', {}, [ isolate, ' ', _('Isolate clients on the same access point') ]),
					E('label', {}, [ hidden, ' ', _('Hide network name') ])
				]) }
			], function() {
				var name = ssid.value.trim();
				if (!name || new TextEncoder().encode(name).length > 32) throw new Error(_('The network name must be 1–32 bytes.'));
				if (!attachOptions(guest).some(function(option) { return option[0] === attach.value; })) throw new Error(_('Choose an available network segment.'));
				if (!allowedModes().includes(enc.value)) throw new Error(_('Choose security supported by every selected band.'));
				var keyBytes = new TextEncoder().encode(key.value).length;
				if (enc.value !== 'none' && (keyBytes < 8 || keyBytes > 63)) throw new Error(_('The password must be 8–63 bytes.'));
				var chosen = selectedRadios().map(function(radio) { return radio.getName(); });
				if (!chosen.length) throw new Error(_('Select at least one band.'));
				chosen.forEach(function(radio) {
					var sid = uci.add('wireless', 'wifi-iface');
					uci.set('wireless', sid, 'device', radio);
					uci.set('wireless', sid, 'mode', 'ap');
					uci.set('wireless', sid, 'ssid', name);
					uci.set('wireless', sid, 'network', attach.value);
					uci.set('wireless', sid, 'encryption', enc.value);
					if (enc.value === 'sae') uci.set('wireless', sid, 'ieee80211w', '2');
					if (enc.value !== 'none') uci.set('wireless', sid, 'key', key.value);
					if (isolate.checked) uci.set('wireless', sid, 'isolate', '1');
					if (hidden.checked) uci.set('wireless', sid, 'hidden', '1');
					uci.unset('wireless', radio, 'disabled');
				});
				return wb.reviewChanges().then(rerender);
			}, { ok: _('Create') });
		}

		function radioCard(r) {
			var name = r.getName();
			var nets = live.nets.filter(function(n) { return n.getWifiDeviceName() === name; });
			var upNet = nets.filter(function(n) { return n.isUp(); })[0];
			var clients = nets.reduce(function(sum, n) { return sum + ((live.live[n.getName()] || { clients: [] }).clients.length); }, 0);
			var conf = uci.get('wireless', name) || {};
			var on = !r.isDisabled();
			return E('div', { 'class': 'wb-radio-card' }, [
				E('div', { 'class': 'head' }, [
					E('h4', {}, [ wb.bandLabel(conf.band, upNet ? upNet.getChannel() : null), ' ', E('small', { 'class': 'mono' }, [ name ]) ]),
					wb.pill(on ? (r.isUp() ? _('On') : _('Starting')) : _('Off'), on ? (r.isUp() ? 'good' : 'warn') : 'mut'),
					wb.toggle(on, function(next) {
						if (next) uci.unset('wireless', name, 'disabled'); else uci.set('wireless', name, 'disabled', '1');
						return wb.reviewChanges();
					}, { 'aria-label': _('Enable radio') + ' ' + name })
				]),
				wb.kv([
					[ _('Channel'), upNet && upNet.getChannel() ? upNet.getChannel() + (conf.channel === 'auto' || !conf.channel ? ' (' + _('auto') + ')' : '') : (conf.channel || _('auto')) ],
					[ _('Width / mode'), conf.htmode || _('Driver default') ],
					[ _('Transmit power'), upNet && upNet.getTXPower() ? upNet.getTXPower() + ' dBm' : (conf.txpower ? conf.txpower + ' dBm' : _('Maximum')) ],
					[ _('Country'), (upNet && upNet.getCountryCode()) || conf.country || '—' ],
					[ _('Networks'), nets.length + ' · ' + clients + ' ' + _('clients') ]
				]),
				E('div', { 'class': 'pillrow' }, [ E('a', { 'class': 'wb-btn sm', 'href': L.url('wundr/network/wifi-config') }, [ wb.iconLabel('sliders', _('Tune radio')) ]) ])
			]);
		}

		function rerender() {
			var gs = groups();
			dom.content(body, gs.length ? E('div', { 'class': 'wb-grid' }, gs.map(ssidCard)) :
				wb.empty(_('No Wi-Fi networks yet. Create your first network to get started.'), 'wifi', E('button', { 'class': 'wb-btn primary', 'click': function() { addNetwork(); } }, [ _('Create Wi-Fi network') ])));
			dom.content(radiosBody, live.radios.length ? E('div', { 'class': 'wb-radio-grid' }, live.radios.map(radioCard)) : wb.empty(_('No wireless radios detected on this router.'), 'wifi'));
		}

		poll.add(function() { return loadLive().then(function(l) { live = l; rerender(); }); }, 5);
		rerender();

		var hero = wb.hero(_('Wi-Fi'), _('Separate networks for family, guests and smart-home devices — each shareable with a QR code.'), [
			wb.stat(String(groups().length), _('Networks')),
			wb.stat(String(live.radios.filter(function(r) { return r.isUp(); }).length) + ' / ' + live.radios.length, _('Radios on')),
			wb.stat(String(Object.keys(live.live).reduce(function(n, k) { return n + live.live[k].clients.length; }, 0)), _('Clients now'))
		], [
			E('button', { 'class': 'wb-btn primary', 'click': function() { addNetwork(); } }, [ wb.iconLabel('plus', _('New network')) ]),
			E('button', { 'class': 'wb-btn', 'click': function() { addNetwork('guest'); } }, [ wb.iconLabel('guest', _('Guest network')) ]),
			E('a', { 'class': 'wb-btn', 'href': L.url('wundr/network/wifi-config') }, [ wb.iconLabel('sliders', _('Wi-Fi Settings')) ])
		]);

		return E('div', {}, [ hero, body, wb.card(_('Radios'), [ radiosBody ], { sub: _('Live channel and power per band. Turn a band off to save power or reduce interference.') }) ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
