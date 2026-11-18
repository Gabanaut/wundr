'use strict';
'require view';
'require rpc';
'require poll';
'require uci';
'require network';
'require ui';
'require dom';
'require wundr.ui as wb';

/* Wundr Dashboard — live overview: internet state, traffic, health, Wi-Fi, devices. */

var callSystemInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
var callSystemBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });
var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
var callRealtime = rpc.declare({ object: 'luci', method: 'getRealtimeStats', params: [ 'mode', 'device' ], expect: { result: [] } });

var HISTORY = 60;

function wanOf(networks) {
	return (networks || []).find(function(net) { return net.isUp(); }) || (networks || [])[0] || null;
}

async function collect() {
	await network.flushCache();
	return Promise.all([
		L.resolveDefault(callSystemInfo(), {}),
		network.getWANNetworks(),
		network.getWifiNetworks(),
		network.getWifiDevices(),
		L.resolveDefault(callLeases(), null), network.getWAN6Networks()
	]).then(function(res) {
		var wifiNets = (res[2] || []).filter(function(net) { return net.getMode() === 'ap'; });
		return Promise.all(wifiNets.map(function(n) { return L.resolveDefault(n.getAssocList(), null); })).then(function(assocs) {
			return { info: res[0], wans: (res[1] || []).concat(res[5] || []), wifiNets: wifiNets, radios: res[3] || [], leases: res[4], assocs: assocs };
		});
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			collect(),
			L.resolveDefault(uci.load('wireless'), null)
		]).then(function(res) {
			var wan = wanOf(res[1].wans);
			var dev = wan ? wan.getL3Device() : null;
			var seed = dev ? L.resolveDefault(callRealtime('interface', dev.getName()), []) : Promise.resolve([]);
			return seed.then(function(rows) { return { board: res[0], data: res[1], seed: rows }; });
		});
	},

	render: function(state) {
		var board = state.board || {};
		var rx = [], tx = [];
		var lastCounters = null;

		/* Seed the sparklines from the router's own 1 s counter history. */
		(state.seed || []).slice(-HISTORY - 1).reduce(function(prev, row) {
			if (prev && row[0] > prev[0]) {
				var dt = row[0] - prev[0];
				rx.push(Math.max(0, (row[1] - prev[1]) / dt));
				tx.push(Math.max(0, (row[3] - prev[3]) / dt));
			}
			return row;
		}, null);

		var statusPill = wb.pill('…', 'mut');
		var headline = E('h2', { 'class': 'wb-h' }, [ _('Checking your network…') ]);
		var stWan = wb.stat('—', _('WAN address')), stUp = wb.stat('—', _('Uptime')), stDev = wb.stat('—', _('Other leased devices')), stCli = wb.stat('—', _('Wi-Fi clients'));
		var shareBtn = E('button', { 'class': 'wb-btn primary', 'click': function() { shareWifi(); } }, [ wb.iconLabel('qr', _('Share Wi-Fi')) ]);
		var hero = E('section', { 'class': 'wb-card wb-hero' }, [
			E('div', { 'style': 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [ headline, statusPill ]),
			E('div', { 'class': 'wb-sub' }, [ (board.hostname || 'OpenWrt') + (board.model ? ' · ' + board.model : '') + (board.release && board.release.description ? ' · ' + board.release.description : '') ]),
			E('div', { 'class': 'wb-hero-row' }, [ stWan, stUp, stCli, stDev, E('div', { 'class': 'wb-hero-actions' }, [
				shareBtn,
				E('a', { 'class': 'wb-btn', 'href': L.url('wundr/network/diagnostics') }, [ wb.iconLabel('speed', _('Diagnostics')) ])
			]) ])
		]);

		var downVal = E('b', {}, [ '—' ]), upVal = E('b', {}, [ '—' ]);
		var downCanvas = E('canvas', { 'height': '56' }), upCanvas = E('canvas', { 'height': '56' });
		var trafficCard = wb.card(_('Internet traffic'), [
			E('div', { 'class': 'wb-grid cols-2', 'style': 'margin:0' }, [
				E('div', { 'class': 'wb-spark-card' }, [ E('div', { 'class': 'wb-spark-head' }, [ downVal, E('span', { 'class': 'wb-sub' }, [ _('Download') ]) ]), downCanvas ]),
				E('div', { 'class': 'wb-spark-card' }, [ E('div', { 'class': 'wb-spark-head' }, [ upVal, E('span', { 'class': 'wb-sub' }, [ _('Upload') ]) ]), upCanvas ])
			])
		], { actions: wb.iconLink('internet', _('Internet settings'), L.url('wundr/internet')) });

		var loadBar = E('i', { 'style': 'width:0%' }), memBar = E('i', { 'style': 'width:0%' });
		var loadLbl = E('b', {}, [ '—' ]), memLbl = E('b', {}, [ '—' ]);
		var healthKv = E('div');
		var healthCard = wb.card(_('Router health'), [
			E('div', { 'class': 'wb-bar-label' }, [ E('span', {}, [ _('CPU load (1 min)') ]), loadLbl ]),
			E('div', { 'class': 'wb-bar', 'id': 'wb-load-bar' }, [ loadBar ]),
			E('div', { 'class': 'wb-bar-label', 'style': 'margin-top:12px' }, [ E('span', {}, [ _('Memory used') ]), memLbl ]),
			E('div', { 'class': 'wb-bar', 'id': 'wb-mem-bar' }, [ memBar ]),
			E('div', { 'style': 'margin-top:14px' }, [ healthKv ])
		], { actions: wb.iconLink('system', _('System settings'), L.url('wundr/system')) });

		var wifiBody = E('div');
		var wifiCard = wb.card(_('Wi-Fi'), [ wifiBody ], { actions: wb.iconLink('wifi', _('Wi-Fi overview'), L.url('wundr/network/wifi')) });

		var tiles = E('div', { 'class': 'wb-tiles' }, [
			tile('wifi', _('Wi-Fi'), _('Networks, radios, QR'), 'wundr/network/wifi'),
			tile('devices', _('Devices'), _('Who is connected'), 'wundr/network/devices'),
			tile('families', _('Family'), _('Pause & bedtime'), 'wundr/protection/families'),
			tile('shield', _('Security'), _('Posture & port rules'), 'wundr/protection/security'),
			tile('map', _('Network Map'), _('Segments & policy'), 'wundr/network/map'),
			tile('qos', _('QoS'), _('Smooth latency'), 'wundr/network/qos'),
			tile('apps', _('Apps'), _('Installed services'), 'wundr/services/apps'),
			tile('port', _('Network'), _('LAN, DHCP, VLANs'), 'wundr/network/overview')
		]);

		function tile(icon, name, sub, path) {
			return E('a', { 'class': 'wb-tile', 'href': L.url(path) }, [ E('span', { 'class': 'ico' }, [ wb.icon(icon, 18) ]), E('b', {}, [ name ]), E('span', {}, [ sub ]) ]);
		}

		function draw() {
			if (!window.WBCharts) return;
			var max = Math.max.apply(null, rx.concat(tx).concat([ 1 ]));
			WBCharts.area(downCanvas, rx.length ? rx : [ 0, 0 ], { max: max, height: 56, color: 'var(--wb-accent)', width: downCanvas.parentNode.clientWidth || 260 });
			WBCharts.area(upCanvas, tx.length ? tx : [ 0, 0 ], { max: max, height: 56, color: 'var(--wb-info)', width: upCanvas.parentNode.clientWidth || 260 });
		}

		function update(d) {
			var info = d.info || {};
			var wan = wanOf(d.wans);
			var up = !!(wan && wan.isUp());
			dom.content(headline, [ up ? _('WAN link up') : !wan ? _('WAN link not reported') : wan.isPending() ? _('WAN link connecting') : _('WAN link down') ]);
			dom.content(statusPill, [ wan ? wan.getName() : _('Unknown') ]);
			statusPill.className = 'wb-pill ' + (up ? 'good' : wan ? 'warn' : 'mut');
			dom.content(stWan.firstChild, [ (wan && wan.getIPAddr()) || (wan && wan.getIP6Addr()) || '—' ]);
			dom.content(stUp.firstChild, [ info.uptime != null ? wb.fmtUptime(info.uptime) : '—' ]);

			var dev = wan ? wan.getL3Device() : null;
			if (dev) {
				var now = Date.now() / 1000, c = { name: dev.getName(), t: now, rx: dev.getRXBytes(), tx: dev.getTXBytes() };
				if (lastCounters && lastCounters.name !== c.name) { rx = []; tx = []; }
				if (lastCounters && lastCounters.name === c.name && c.t > lastCounters.t) {
					var dt = c.t - lastCounters.t;
					var r = Math.max(0, (c.rx - lastCounters.rx) / dt), t = Math.max(0, (c.tx - lastCounters.tx) / dt);
					rx.push(r); tx.push(t);
					if (rx.length > HISTORY) rx.shift();
					if (tx.length > HISTORY) tx.shift();
				}
				lastCounters = c;
			} else { lastCounters = null; rx = []; tx = []; }
			dom.content(downVal, [ rx.length ? wb.fmtRate(rx[rx.length - 1]) : '—' ]);
			dom.content(upVal, [ tx.length ? wb.fmtRate(tx[tx.length - 1]) : '—' ]);
			draw();

			var load1 = Array.isArray(info.load) ? info.load[0] / 65536 : null;
			if (load1 != null) {
				var lp = Math.min(100, Math.round(load1 * 50));
				loadBar.style.width = lp + '%';
				dom.content(loadLbl, [ load1.toFixed(2) ]);
				loadBar.parentNode.className = 'wb-bar' + (load1 > 4 ? ' bad' : (load1 > 2 ? ' warn' : ''));
			}
			if (info.memory && info.memory.total) {
				var avail = info.memory.available != null ? info.memory.available : info.memory.free;
				var mp = Math.round((1 - avail / info.memory.total) * 100);
				memBar.style.width = mp + '%';
				dom.content(memLbl, [ mp + '% · ' + wb.fmtBytes(info.memory.total - avail) + ' / ' + wb.fmtBytes(info.memory.total) ]);
				memBar.parentNode.className = 'wb-bar' + (mp > 90 ? ' bad' : (mp > 75 ? ' warn' : ''));
			}
			dom.content(healthKv, [ wb.kv([
				[ _('Firmware'), board.release ? board.release.description : '—' ],
				[ _('Kernel'), board.kernel || '—' ],
				[ _('Local time'), info.localtime ? new Date(info.localtime * 1000).toLocaleString() : '—' ]
			]) ]);

			var stations = new Set(), other = new Set(), leases = d.leases && d.leases.dhcp_leases;
			var measured = d.assocs.every(Array.isArray);
			d.assocs.forEach(function(list) { (list || []).forEach(function(item) { if (item.mac) stations.add(item.mac.toUpperCase()); }); });
			(leases || []).forEach(function(lease) { if (lease.macaddr && lease.expires !== 0 && !stations.has(lease.macaddr.toUpperCase())) other.add(lease.macaddr.toUpperCase()); });
			dom.content(stDev.firstChild, [ measured && Array.isArray(leases) ? String(other.size) : '—' ]);
			dom.content(stCli.firstChild, [ measured ? String(stations.size) : '—' ]);

			var radioChips = (d.radios || []).map(function(r) {
				var count = 0;
				(d.wifiNets || []).forEach(function(n, i) { if (n.getWifiDeviceName() === r.getName()) count += ((d.assocs || [])[i] || []).length; });
				return E('span', { 'class': 'wb-radio' + (r.isUp() ? '' : ' off') }, [ E('span', { 'class': 'sig' }), wb.bandLabel(r.get('band')), ' · ', count + ' ' + _('clients') ]);
			});
			var ssids = (d.wifiNets || []).filter(function(n) { return n.getMode() === 'ap' || !n.getMode(); }).map(function(n) {
				var idx = (d.wifiNets || []).indexOf(n);
				var radio = d.radios.find(function(item) { return item.getName() === n.getWifiDeviceName(); });
				return E('div', { 'class': 'wb-setting' }, [
					E('div', { 'class': 'grow' }, [ E('div', { 'class': 'name' }, [ n.getActiveSSID() || n.getSSID() || _('Unnamed') ]), E('div', { 'class': 'meta' }, [ wb.bandLabel(radio && radio.get('band'), n.getChannel()) + ' · ' + wb.encryptionLabel(n.get('encryption')) ]) ]),
					wb.pill(n.isUp() ? (((d.assocs[idx]) || []).length + ' ' + _('clients')) : (n.isDisabled() ? _('Off') : _('Down')), n.isUp() ? 'good' : 'mut')
				]);
			});
			dom.content(wifiBody, [
				radioChips.length ? E('div', { 'class': 'wb-radio-row', 'style': 'margin-bottom:10px' }, radioChips) : '',
				ssids.length ? E('div', {}, ssids) : wb.empty(_('No Wi-Fi networks configured yet.'), 'wifi', E('a', { 'class': 'wb-btn primary', 'href': L.url('wundr/network/wifi') }, [ _('Set up Wi-Fi') ]))
			]);
		}

		function shareWifi() {
			var nets = uci.sections('wireless', 'wifi-iface').filter(function(s) { return (s.mode || 'ap') === 'ap' && s.disabled !== '1' && uci.get('wireless', s.device, 'disabled') !== '1' && s.ssid && wb.wifiQrType(s); });
			if (!nets.length) { wb.toast(_('No shareable Wi-Fi network'), _('No enabled network with a supported QR credential was reported.'), 'warn'); return; }
			var pick = wb.select(nets.map(function(s) { return [ s['.name'], [s.ssid, s.device, L.toArray(s.network).join(', ')].filter(Boolean).join(' · ') ]; }), nets[0]['.name'], { 'id': 'wb-share-network' });
			var canvas = E('canvas');
			var label = E('div', { 'class': 'wb-qr-ssid' });
			function redraw() {
				var s = uci.get('wireless', pick.value) || {};
				var type = wb.wifiQrType(s);
				var drawn = type && window.WBQR && WBQR.draw(canvas, WBQR.wifiString(s.ssid, s.key || '', type, s.hidden === '1'), { size: 240 });
				canvas.hidden = !drawn;
				dom.content(label, [ drawn ? s.ssid : _('Wi-Fi code unavailable') ]);
			}
			pick.addEventListener('change', redraw);
			redraw();
			ui.showModal(_('Share Wi-Fi'), [
				E('p', {}, [ _('Point a phone camera at the code to join instantly.') ]),
				E('div', { 'class': 'wb-form-row' }, [ E('label', { 'class': 'wb-form-label', 'for': 'wb-share-network' }, [ _('Network') ]), pick ]),
				E('div', { 'class': 'wb-qr' }, [ canvas ]), label,
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Close') ]) ])
			]);
		}

		update(state.data);
		poll.add(function() { return collect().then(update); }, 3);

		return E('div', {}, [ hero, E('div', { 'class': 'wb-grid cols-2' }, [ trafficCard, healthCard ]), wifiCard, wb.card(_('Quick access'), [ tiles ]) ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
