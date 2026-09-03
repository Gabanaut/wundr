'use strict';
'require view';
'require uci';
'require rpc';
'require poll';
'require dom';
'require network';
'require ui';
'require form';
'require tools.widgets as widgets';
'require wundr.ui as wb';

/* Wundr Families — parental controls that work on stock OpenWrt.
 *
 * A profile groups device MACs. Enforcement is derived firewall state, written
 * through LuCI's own UCI + apply path (validated, atomic, rollback-capable):
 *   • Pause    → rule `wundr_pause_<id>`   (lan→wan REJECT for those MACs).
 *   • Bedtime  → rule `wundr_bedtime_<id>`  same, PLUS fw4 time options
 *                (weekdays / start_time / stop_time) so the window is enforced
 *                by the router itself, even with this page closed.
 * Profiles live in /etc/config/wundr as `family` sections. Wundr owns only the
 * `wundr_*` rules; it rebuilds them from the profiles on every save so an edit
 * can never strand a stale rule. Nothing is written outside LuCI's own path. */

var callHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });
var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

var DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];
var DAY_LABEL = { Mon: _('Mon'), Tue: _('Tue'), Wed: _('Wed'), Thu: _('Thu'), Fri: _('Fri'), Sat: _('Sat'), Sun: _('Sun') };

function ruleName(sid, kind) { return 'wundr_%s_%s'.format(kind, String(sid).replace(/[^0-9a-zA-Z]/g, '')); }
function macsOf(p) {
	var list = Array.isArray(p.devices) ? p.devices : (p.devices ? [ p.devices ] : []);
	return list.filter(Boolean).map(function(m) { return String(m).toUpperCase(); });
}
function splitList(v) { return Array.isArray(v) ? v : (v ? String(v).trim().split(/\s+/) : []); }
function hm(v) { var m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function inBedtimeWindow(p) {
	if (p.mode !== 'schedule') return false;
	var s = hm(p.bedtime_start), e = hm(p.bedtime_end);
	if (s == null || e == null) return false;
	var days = splitList(p.bedtime_days);
	if (days.length && days.indexOf(DAYS[(new Date().getDay() + 6) % 7]) < 0) return false;
	var now = new Date(), m = now.getHours() * 60 + now.getMinutes();
	return s <= e ? (m >= s && m < e) : (m >= s || m < e);
}

/* Rebuild every Wundr-managed rule from the profiles (idempotent). */
function syncFirewall() {
	uci.sections('firewall', 'rule', function(r) {
		if (/^wundr_(pause|bedtime)_/.test(String(r.name || ''))) uci.remove('firewall', r['.name']);
	});
	uci.sections('wundr', 'family', function(p) {
		var macs = macsOf(p);
		if (!macs.length) return;
		var kind = p.state_paused === '1' ? 'pause' : (p.mode === 'schedule' ? 'bedtime' : null);
		if (!kind) return;
		var cid = uci.add('firewall', 'rule');
		uci.set('firewall', cid, 'name', ruleName(p['.name'], kind));
		uci.set('firewall', cid, 'comment', 'Wundr · %s · %s'.format(kind, p.name || p['.name']));
		uci.set('firewall', cid, 'src', 'lan');
		uci.set('firewall', cid, 'dest', 'wan');
		uci.set('firewall', cid, 'proto', 'all');
		uci.set('firewall', cid, 'target', 'REJECT');
		uci.set('firewall', cid, 'src_mac', macs);
		if (kind === 'bedtime') {
			var days = splitList(p.bedtime_days);
			uci.set('firewall', cid, 'weekdays', (days.length ? days : DAYS).join(' '));
			uci.set('firewall', cid, 'start_time', (p.bedtime_start || '21:00') + ':00');
			uci.set('firewall', cid, 'stop_time', (p.bedtime_end || '07:00') + ':00');
		}
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wundr'), uci.load('firewall'),
			L.resolveDefault(callHints(), {}),
			L.resolveDefault(callLeases(), {})
		]);
	},

	render: function(data) {
		var hints = data[2] || {}, leaseTree = data[3] || {};
		var names = {};
		Object.keys(hints).forEach(function(mac) { if (hints[mac] && hints[mac].name) names[mac.toUpperCase()] = hints[mac].name; });
		(function walk(o) {
			Object.keys(o).forEach(function(k) {
				var v = o[k];
				if (v && typeof v === 'object') {
					if (v.macaddr) names[v.macaddr.toUpperCase()] = names[v.macaddr.toUpperCase()] || v.hostname || null;
					else walk(v);
				}
			});
		})(leaseTree);
		var knownMacs = Object.keys(names).sort();

		function friendly(mac) { return names[mac] || null; }
		function statusPill(p) {
			if (p.state_paused === '1') return wb.pill(_('Paused'), 'bad');
			if (inBedtimeWindow(p)) return wb.pill(_('Bedtime now'), 'warn');
			if (p.mode === 'schedule') return wb.pill(_('Bedtime %s').format(p.bedtime_start || '21:00'), 'mut');
			return wb.pill(_('Active'), 'good');
		}

		var body = E('div');

		function profileCard(p) {
			var macs = macsOf(p), paused = p.state_paused === '1';
			return E('div', { 'class': 'wb-card' }, [
				E('div', { 'class': 'wb-person-top' }, [
					E('div', { 'class': 'wb-avatar', 'style': 'background:' + (p.color || 'var(--wb-accent)') }, [ ((p.name || '?').trim().charAt(0) || '?').toUpperCase() ]),
					E('div', { 'style': 'flex:1;min-width:0' }, [
						E('h3', { 'class': 'wb-h', 'style': 'margin:0' }, [ p.name || p['.name'] ]),
						E('div', { 'class': 'wb-sub' }, [ p.mode === 'schedule' ? _('Bedtime %s–%s').format(p.bedtime_start || '21:00', p.bedtime_end || '07:00') : _('No schedule') ]) ]),
					statusPill(p)
				]),
				E('div', { 'class': 'wb-device-chips', 'style': 'margin:8px 0 4px' }, macs.length ? macs.map(function(m) {
					return E('span', { 'class': 'wb-device-chip', 'title': m }, [ friendly(m) || m ]);
				}) : [ E('span', { 'class': 'wb-sub' }, [ _('No devices assigned yet') ]) ]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
					E('button', { 'class': 'wb-btn sm' + (paused ? ' primary' : ''), 'click': function() { togglePause(p); } }, [ wb.iconLabel(paused ? 'play' : 'pause', paused ? _('Resume') : _('Pause internet')) ]),
					E('button', { 'class': 'wb-btn sm', 'click': function() { openEditor(p); } }, [ wb.iconLabel('edit', _('Edit')) ]),
					E('button', { 'class': 'wb-btn sm danger', 'click': function() { removeProfile(p); } }, [ wb.iconLabel('trash', _('Delete')) ])
				])
			]);
		}

		function rerender() {
			var list = uci.sections('wundr', 'family');
			var paused = list.filter(function(p) { return p.state_paused === '1'; }).length;
			var inBed = list.filter(inBedtimeWindow).length;
			dom.content(body, [
				wb.hero(_('Families'), _('Group devices into people, then pause them instantly or set a bedtime the firewall enforces itself.'), [
					wb.stat(String(list.length), _('Profiles')),
					wb.stat(String(paused), _('Paused now')),
					wb.stat(String(inBed), _('In bedtime'))
				], [ E('button', { 'class': 'wb-btn primary', 'click': function() { openEditor(null); } }, [ wb.iconLabel('plus', _('New profile')) ]) ]),
				list.length ? E('div', { 'class': 'wb-grid' }, list.map(profileCard))
					: wb.empty(_('No profiles yet. Create one, assign devices, then pause or schedule their internet in one tap.'), 'families',
						E('button', { 'class': 'wb-btn primary', 'click': function() { openEditor(null); } }, [ wb.iconLabel('plus', _('Create first profile')) ]))
			]);
		}

		function reloadUci() { return uci.load('wundr').then(function() { return uci.load('firewall'); }); }

		function togglePause(p) {
			var going = p.state_paused !== '1';
			if (going) uci.set('wundr', p['.name'], 'state_paused', '1'); else uci.unset('wundr', p['.name'], 'state_paused');
			syncFirewall();
			return wb.apply(false, going ? _('Internet paused') : _('Internet resumed'), p.name || '')
				.then(reloadUci).then(rerender)
				.catch(function() {
					if (going) uci.unset('wundr', p['.name'], 'state_paused'); else uci.set('wundr', p['.name'], 'state_paused', '1');
					syncFirewall(); return uci.load('wundr').then(rerender);
				});
		}

		function removeProfile(p) {
			wb.confirm(_('Delete “%s”?').format(p.name || p['.name']), _('Any pause or bedtime firewall rule for this profile is removed too.')).then(function(yes) {
				if (!yes) return;
				uci.remove('wundr', p['.name']);
				syncFirewall();
				return wb.apply(false, _('Profile deleted'), p.name || '').then(reloadUci).then(rerender);
			});
		}

		function openEditor(existing) {
			/* For a new profile we must NOT uci.add() here — cancelling the
			 * dialog would leave a phantom staged section. sid fills in on save. */
			var sid = existing ? existing['.name'] : null;
			var p = existing || { mode: 'unlimited', devices: [] };
			var name = wb.input({ 'value': p.name || '', 'placeholder': _('e.g. Kids / Bedroom'), 'maxlength': '32' });
			var mode = wb.select([ [ 'unlimited', _('Always allowed') ], [ 'schedule', _('Bedtime window (firewall schedule)') ] ], p.mode || 'unlimited');
			var start = wb.input({ 'type': 'time', 'value': p.bedtime_start || '21:00' });
			var end = wb.input({ 'type': 'time', 'value': p.bedtime_end || '07:00' });
			var chosen = Array.isArray(p.bedtime_days) && p.bedtime_days.length ? p.bedtime_days : DAYS;
			var dayBoxes = DAYS.map(function(d) {
				var cb = E('input', { 'type': 'checkbox', 'value': d });
				cb.checked = chosen.indexOf(d) >= 0;
				return E('label', { 'style': 'display:inline-flex;align-items:center;gap:5px;margin:2px 12px 2px 0;font-weight:600' }, [ cb, document.createTextNode(DAY_LABEL[d]) ]);
			});
			var mine = {}; macsOf(p).forEach(function(m) { mine[m] = true; });
			var deviceList = E('div', { 'class': 'wb-checklist' }, knownMacs.length ? knownMacs.map(function(mac) {
				var cb = E('input', { 'type': 'checkbox', 'value': mac }); cb.checked = !!mine[mac];
				return E('label', { 'title': mac }, [ cb, E('span', { 'class': 'grow' }, [ friendly(mac) || _('Unnamed device') ]), E('small', {}, [ mac ]) ]);
			}) : [ E('div', { 'class': 'wb-sub', 'style': 'padding:10px' }, [ _('No devices seen yet — connect one, or add a MAC manually below.') ]) ]);
			var extra = wb.input({ 'placeholder': _('aa:bb:cc:dd:ee:ff (optional)'), 'type': 'text' });
			function syncBlocks() {
				var sch = mode.value === 'schedule';
				[ start, end ].forEach(function(el) { el.disabled = !sch; });
				dayBoxes.forEach(function(l) { l.querySelector('input').disabled = !sch; });
			}
			mode.addEventListener('change', syncBlocks); syncBlocks();

			wb.formModal(existing ? _('Edit profile') : _('New profile'), [
				{ label: _('Name'), node: name },
				{ label: _('Control'), node: mode, help: _('Bedtime becomes a real firewall time rule enforced by the router.') },
				{ label: _('From'), node: start },
				{ label: _('To'), node: end },
				{ label: _('Days'), node: E('div', { 'style': 'display:flex;flex-wrap:wrap;max-width:420px' }, dayBoxes) },
				{ label: _('Devices'), node: deviceList, desc: _('Tick every device that belongs to this person or group.') },
				{ label: _('Extra MAC'), node: extra }
			], function() {
				if (!name.value.trim()) throw new Error(_('Please give the profile a name.'));
				var macs = Array.prototype.map.call(deviceList.querySelectorAll('input:checked'), function(cb) { return cb.value; });
				var ex = (extra.value || '').trim().toUpperCase();
				if (ex) {
					if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(ex)) throw new Error(_('“%s” is not a MAC address.').format(extra.value.trim()));
					ex = ex.replace(/-/g, ':');
					if (macs.indexOf(ex) < 0) macs.push(ex);
				}
				var modeVal = mode.value; /* disabled selects still expose .value */
				if (modeVal === 'schedule' && (!/^\d{1,2}:\d{2}$/.test(start.value) || !/^\d{1,2}:\d{2}$/.test(end.value)))
					throw new Error(_('Enter both times as HH:MM.'));
				/* section created only once every validation passes — a
				 * cancelled dialog must not stage a phantom profile */
				if (sid == null) sid = uci.add('wundr', 'family');
				uci.set('wundr', sid, 'name', name.value.trim());
				uci.set('wundr', sid, 'mode', modeVal);
				if (macs.length) uci.set('wundr', sid, 'devices', macs); else uci.unset('wundr', sid, 'devices');
				if (modeVal === 'schedule') {
					if (!/^\d{1,2}:\d{2}$/.test(start.value) || !/^\d{1,2}:\d{2}$/.test(end.value)) throw new Error(_('Enter both times as HH:MM.'));
					uci.set('wundr', sid, 'bedtime_start', start.value);
					uci.set('wundr', sid, 'bedtime_end', end.value);
					var days = dayBoxes.map(function(l) { return l.querySelector('input'); }).filter(function(cb) { return cb.checked; }).map(function(cb) { return cb.value; });
					uci.set('wundr', sid, 'bedtime_days', days.length ? days : DAYS.slice());
				} else {
					[ 'bedtime_start', 'bedtime_end', 'bedtime_days' ].forEach(function(k) { uci.unset('wundr', sid, k); });
				}
				p.name = name.value.trim(); /* keep status pill honest before rerender */
				syncFirewall();
				return wb.apply(false, existing ? _('Profile updated') : _('Profile created'), name.value.trim()).then(reloadUci).then(rerender);
			}, { intro: existing ? null : _('A profile groups devices so you can pause or schedule them together.'), ok: existing ? _('Save') : _('Create') });
		}

		rerender();
		poll.add(rerender, 60); /* keeps the "Bedtime now" pill accurate as time passes */
		return body;
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
