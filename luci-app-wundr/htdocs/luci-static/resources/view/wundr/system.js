'use strict';
'require view';
'require rpc';
'require uci';
'require form';
'require poll';
'require dom';
'require ui';
'require tools.widgets as widgets';
'require wundr.ui as wb';

/* Wundr System — live resources, identity/time editor, live log tail, and
 * maintenance links that reuse native LuCI pages (so backup, sysupgrade,
 * reboot and password change keep the standard safeguards). */

var callInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
var callBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });
var callLog = rpc.declare({ object: 'log', method: 'read', params: [ 'lines', 'stream', 'oneshot' ], expect: { log: [] } });
var callTZones = rpc.declare({ object: 'luci', method: 'getTimezones', expect: { '': {} } });

function fmt(bytes) {
	var n = Number(bytes) || 0, u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return (i ? n.toFixed(1) : n) + ' ' + u[i];
}
function usage(mem) {
	if (!mem || !mem.total) return null;
	var av = mem.available != null ? mem.available : (mem.free || 0) + (mem.buffered || 0) + (mem.cached || 0);
	return { pct: Math.max(0, Math.min(100, Math.round((1 - av / mem.total) * 100))), used: Math.max(0, mem.total - av), total: mem.total };
}
function renderLogs(r) {
	var lines = (r && Array.isArray(r.log)) ? r.log : [];
	if (!lines.length) return [ E('div', { 'class': 'wb-empty' }, [ _('No log entries reported yet.') ]) ];
	return lines.map(function(item) {
		var msg = typeof item === 'string' ? item : ((item && item.message) || '');
		var lvl = 'notice';
		if (/error|crit|alert|emerg|panic|fail|refused|denied/i.test(msg)) lvl = 'error';
		else if (/warn/i.test(msg)) lvl = 'warn';
		return E('div', { 'class': 'wb-log-line ' + lvl }, [
			E('time', {}, [ item && item.timestamp ? new Date(item.timestamp * 1000).toLocaleTimeString() : '' ]),
			E('span', { 'class': 'lvl ' + lvl }, [ lvl ]),
			E('span', { 'class': 'msg' }, [ [ (item && item.hostname), item && item['logtag'] ? String(item['logtag']).replace(/:$/, '') : '', msg ].filter(Boolean).join(' ') ])
		]);
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('system'),
			L.resolveDefault(callBoard(), {}),
			L.resolveDefault(callInfo(), {}),
			L.resolveDefault(callLog(220, false, true), {}).catch(function() { return { log: [] }; }),
			L.resolveDefault(callTZones(), {})
		]);
	},

	render: function(data) {
		var board = data[1] || {}, info = data[2] || {}, logData = data[3] || { log: [] }, tzMap = data[4] || {};
		var rel = board.release || {};
		var u = usage(info.memory);
		var load1 = Array.isArray(info.load) ? info.load[0] / 65536 : null;
		var loadBar = E('i', { 'style': 'width:' + (load1 != null ? Math.min(100, load1 * 12.5).toFixed(0) + '%' : '0%') });
		var memBar = E('i', { 'style': 'width:' + (u ? u.pct : 0) + '%' });
		var loadLbl = E('b', {}, [ load1 != null ? load1.toFixed(2) : '—' ]);
		var memLbl = E('b', {}, [ u ? u.pct + '% · ' + fmt(u.used) + ' / ' + fmt(u.total) : '—' ]);
		var upEl = E('b', {}, [ wb.fmtUptime(info.uptime) ]);
		var tzLabel = E('b', {}, [ (info.localtime && board?.zones) ? new Date(info.localtime * 1000).toLocaleString() : '—' ]);

		function refreshCounters() {
			return L.resolveDefault(callInfo(), {}).then(function(i) {
				if (!i) return;
				if (Array.isArray(i.load)) {
					var l = i.load[0] / 65536;
					loadLbl.textContent = l.toFixed(2);
					loadBar.style.width = Math.min(100, l * 12.5) + '%';
					loadBar.parentNode.className = 'wb-bar' + (l > 4 ? ' bad' : (l > 2 ? ' warn' : ''));
				}
				var x = usage(i.memory);
				if (x) {
					memLbl.textContent = x.pct + '% · ' + fmt(x.used) + ' / ' + fmt(x.total);
					memBar.style.width = x.pct + '%';
					memBar.parentNode.className = 'wb-bar' + (x.pct > 90 ? ' bad' : (x.pct > 80 ? 'warn' : ''));
				}
				upEl.textContent = wb.fmtUptime(i.uptime);
				if (i.localtime) tzLabel.textContent = new Date(i.localtime * 1000).toLocaleString();
			});
		}

		/* ---- form ---- */
		var m = new form.Map('system', null,
			_('Identity and time. Every change is saved via the validated LuCI apply, with a 90-second rollback for safety.'));
		m.chainload = function() { return m.children; };
		var s = m.section(form.NamedSection, 'system', 'system', _('Basic settings'));
		var o;
		o = s.option(form.Value, 'hostname', _('Hostname'), _('How this router names itself on the local network.'));
		o.datatype = 'hostname'; o.rmempty = false;

		var tzo = s.option(form.ListValue, 'zonename', _('Time zone'));
		tzo.value('UTC', 'UTC');
		Object.keys(tzMap || {}).sort().forEach(function(z) { tzo.value(z, tzMap[z].abbr || z); });
		tzo.rmempty = false;
		tzo.write = function(section_id, value) {
			uci.set('system', section_id, 'zonename', value);
			var tz = tzMap[value] ? tzMap[value].tzstring : null;
			if (tz) uci.set('system', section_id, 'timezone', tz);
		};

		var ntp = s.option(form.Flag, 'ntp', _('Internet time synchronisation'), _('Uses NTP to keep the clock aligned — schedules and logs will be accurate.'));
		ntp.rmempty = false;
		ntp.default = ntp.enabled;

		/* ---- maintenance block ---- */
		var mtItems = [
			[ _('Configuration backup'), _('Download a restorable archive of just your settings.'), 'admin/system/flash#backup', 'download' ],
			[ _('Firmware upgrade'), _('Flash a new image — keep or replace configuration.'), 'admin/system/flash', 'refresh' ],
			[ _('Software packages'), _('Install or remove services (AdGuard Home, SQM, VPN servers…).'), 'admin/system/packages', 'apps' ],
			[ _('Startup & shutdown'), _('Toggle which services start at boot.'), 'admin/system/startup', 'sliders' ],
			[ _('Administrator access'), _('Change the LuCI / SSH password.'), 'admin/system/admin', 'shield' ],
			[ _('Reboot'), _('Restart the router now.'), 'admin/system/reboot', 'power' ]
		];
		var mt = E('div', { 'style': 'display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))' });
		mtItems.forEach(function(row) {
			mt.appendChild(E('div', { 'class': 'wb-setting' }, [
				E('div', { 'class': 'grow' }, [ E('div', { 'class': 'name' }, [ row[0] ]), E('div', { 'class': 'meta' }, [ row[1] ]) ]),
				E('a', { 'class': 'wb-btn sm ghost', 'href': L.url(row[2]) }, [ wb.iconLabel(row[3], _('Open')) ])
			]));
		});

		return m.render().then(function(formNode) {
			var C = 2 * Math.PI * 42, pct = u ? u.pct : 0;
			var ring = E('div', { 'class': 'wb-score ' + (pct > 80 ? 'bad' : (pct > 60 ? 'warn' : 'good')), 'style':'width:96px;height:96px' }, [
				E('svg', { 'viewBox': '0 0 100 100' }, [
					E('circle', { 'class': 'track', 'cx': '50', 'cy': '50', 'r': '42' }),
					E('circle', { 'class': 'val', 'cx': '50', 'cy': '50', 'r': '42', 'stroke-dasharray': String(C), 'stroke-dashoffset': String(C * (1 - pct / 100)) })
				]),
				E('span', { 'class': 'num' }, [ String(pct) ])
			]);

			var statusCard = E('section', { 'class': 'wb-card wb-hero' }, [
				E('h2', { 'class': 'wb-h' }, [ (board.hostname || 'OpenWrt') ]),
				E('div', { 'class': 'wb-sub' }, [ (rel.description || (rel.distribution || 'OpenWrt') + ' ' + (rel.version || '')) + (board.model ? ' · ' + board.model : '') + (board.kernel ? ' · kernel ' + board.kernel : '') ]),
				E('div', { 'style': 'display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:14px' }, [
					ring, E('div', {}, [
						E('div', { 'class': 'wb-bar-label' }, [ E('span', {}, [ _('Memory used') ]), memLbl ]),
						E('div', { 'class': 'wb-bar' }, [ memBar ])
					]),
					E('div', {}, [
						E('div', { 'class': 'wb-bar-label' }, [ E('span', {}, [ _('CPU load (1 min)') ]), loadLbl ]),
						E('div', { 'class': 'wb-bar' }, [ loadBar ])
					]),
					E('div', { 'style':'min-width:120px' }, [ wb.kv([ [ _('Uptime'), upEl ], [ _('Local time'), tzLabel ] ]) ])
				])
			]);

			var logBox = E('div', { 'class': 'wb-log' }, renderLogs(logData));
			function refreshLogs() { return L.resolveDefault(callLog(220, false, true), { log: [] }).then(function(r) { dom.content(logBox, renderLogs(r)); }); }

			poll.add(refreshCounters, 5);
			poll.add(refreshLogs, 30);

			return E('div', {}, [
				wb.hero(_('System'), _('Device identity, live resources, live logs and standard maintenance shortcuts.'), [], [
					E('a', { 'class': 'wb-btn primary', 'href': L.url('admin/system/reboot') }, [ wb.iconLabel('power', _('Reboot')) ]),
					E('a', { 'class': 'wb-btn', 'href': L.url('admin/system/flash') }, [ wb.iconLabel('download', _('Backup / flash')) ])
				]),
				statusCard,
				E('div', { 'class': 'wb-grid cols-2' }, [
					E('section', { 'class': 'wb-card' }, [ formNode ]),
					wb.card(_('Maintenance'), [ mt ])
				]),
				wb.card(_('Live system log'), [ E('div', { 'class': 'wb-sub', 'style': 'margin-bottom:8px' }, [ _('Recent kernel and daemon messages — new lines auto-refresh.') ]), logBox ])
			]);
		});
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
