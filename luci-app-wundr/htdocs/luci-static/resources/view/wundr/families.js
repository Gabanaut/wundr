'use strict';
'require view';
'require uci';
'require poll';
'require dom';
'require wundr.ui as wb';
'require wundr.policy as policy';

var DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];
var DAY_LABEL = { Mon: _('Mon'), Tue: _('Tue'), Wed: _('Wed'), Thu: _('Thu'), Fri: _('Fri'), Sat: _('Sat'), Sun: _('Sun') };

function ruleName(sid, kind) { return 'wundr_%s_%s'.format(kind, String(sid).replace(/[^0-9a-zA-Z]/g, '')); }
function macsOf(p) {
	var list = Array.isArray(p.devices) ? p.devices : (p.devices ? [ p.devices ] : []);
	return list.filter(Boolean).map(function(m) { return String(m).toUpperCase(); });
}
function splitList(v) { return Array.isArray(v) ? v : (v ? String(v).trim().split(/\s+/) : []); }
function ruleNames(sid) { return [ruleName(sid, 'pause'), ruleName(sid, 'bedtime')]; }
function schedule(days, start, end) {
	var first = { weekdays: days.join(' '), start_time: start + ':00', stop_time: end + ':00' };
	if (start < end) return [first];
	first.stop_time = '23:59:59';
	return [ first, { weekdays: days.map(function(day) { return DAYS[(DAYS.indexOf(day) + 1) % 7]; }).join(' '), start_time: '00:00:00', stop_time: end + ':00' } ];
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wundr'), wb.hostHints(), policy.read()
		]);
	},

	render: function(data) {
		var hints = data[1] || {}, state = data[2], names = Object.create(null);
		Object.keys(hints).forEach(function(mac) { names[mac.toUpperCase()] = (hints[mac] || {}).name || null; });
		(state.leases || []).forEach(function(lease) { if (lease.macaddr) names[lease.macaddr.toUpperCase()] = names[lease.macaddr.toUpperCase()] || lease.hostname || null; });
		Object.keys(state.stations).forEach(function(mac) { if (!(mac in names)) names[mac] = null; });
		var knownMacs = Object.keys(names).sort();

		function friendly(mac) { return names[mac] || null; }
		function statusPill(p) {
			if (p.state_paused !== '1' && p.mode !== 'schedule') return wb.pill(_('No family rule'), 'mut');
			var paths = policy.targets(macsOf(p), state);
			if (!paths) return wb.pill(_('Scope unverified'), 'warn');
			var wanted = ruleName(p['.name'], p.state_paused === '1' ? 'pause' : 'bedtime');
			var rules = uci.sections('firewall', 'rule').filter(function(rule) { return rule.name === wanted; });
			var covered = paths.every(function(path) { return path.src_mac.every(function(mac) { return rules.some(function(rule) { return policy.matches(rule, mac, path.src, [path.dest]); }); }); });
			return covered ? wb.pill(p.state_paused === '1' ? _('Pause configured') : _('Schedule configured'), 'mut') : wb.pill(_('Review rule scope'), 'warn');
		}

		var body = E('div');

		function memberCard(p) {
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
				}) : [ E('span', { 'class': 'wb-sub' }, [ _('No devices in this profile yet') ]) ]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
					E('button', { 'class': 'wb-btn sm' + (paused ? ' primary' : ''), 'click': function() { togglePause(p); } }, [ wb.iconLabel(paused ? 'play' : 'pause', paused ? _('Resume') : _('Pause internet')) ]),
					E('button', { 'class': 'wb-btn sm', 'click': function() { openEditor(p); } }, [ wb.iconLabel('edit', _('Edit')) ]),
					E('button', { 'class': 'wb-btn sm danger', 'click': function() { removeMember(p); } }, [ wb.iconLabel('trash', _('Delete')) ])
				])
			]);
		}

		function rerender() {
			var list = uci.sections('wundr', 'family');
			var paused = list.filter(function(p) { return p.state_paused === '1'; }).length;
			var scheduled = list.filter(function(p) { return p.mode === 'schedule'; }).length;
			dom.content(body, [
				wb.hero(_('Family'), _('WAN access rules by person. Schedules use the router clock.'), [
					wb.stat(String(list.length), _('Members')),
					wb.stat(String(paused), _('Pause profiles')),
					wb.stat(String(scheduled), _('Schedules'))
				], [ E('button', { 'class': 'wb-btn primary', 'click': function() { openEditor(null); } }, [ wb.iconLabel('plus', _('Add member')) ]) ]),
				list.length ? E('div', { 'class': 'wb-grid' }, list.map(memberCard))
					: wb.empty(_('No members yet. Add one, tick their devices, then pause or schedule their internet in one tap.'), 'families',
						E('button', { 'class': 'wb-btn primary', 'click': function() { openEditor(null); } }, [ wb.iconLabel('plus', _('Add your first member')) ]))
			]);
		}

		function reloadUci() { return uci.load('wundr').then(function() { return uci.load('firewall'); }); }

		function togglePause(p) {
			var going = p.state_paused !== '1';
			return policy.read().then(function(current) {
				state = current;
				var sid = p['.name'], name = ruleName(sid, 'pause');
				var bedtime = ruleName(sid, 'bedtime');
				var restore = !going && p.mode === 'schedule' && !uci.sections('firewall', 'rule').some(function(rule) { return rule.name === bedtime; });
				var paths = going || restore ? policy.targets(macsOf(p), state) : [];
				if (!paths) { rerender(); return wb.toast(_('Cannot place every device'), _('A known client zone and uplink are required for a pause rule.'), 'warn'); }
				if (going) uci.set('wundr', sid, 'state_paused', '1'); else uci.unset('wundr', sid, 'state_paused');
				if (restore) {
					var days = splitList(p.bedtime_days);
					policy.replaceRules([bedtime], bedtime, paths, schedule(days.length ? days : DAYS, p.bedtime_start || '21:00', p.bedtime_end || '07:00'));
				}
				policy.replaceRules([name], name, going ? paths : []);
				return wb.reviewChanges().then(reloadUci).then(rerender);
			}).catch(function() { rerender(); });
		}

		function removeMember(p) {
			wb.confirm(_('Remove “%s”?').format(p.name || p['.name']), _('Only this profile and its Wundr rules will be removed. Other access rules stay in place.')).then(function(yes) {
				if (!yes) return;
				uci.remove('wundr', p['.name']);
				policy.replaceRules(ruleNames(p['.name']), null, []);
				return wb.reviewChanges().then(reloadUci).then(rerender);
			});
		}

		function openEditor(existing) {
			/* For a new member we must NOT uci.add() here — cancelling the
			 * dialog would leave a phantom staged section. sid fills in on save. */
			var sid = existing ? existing['.name'] : null;
			var p = existing || { '.name': null, mode: 'unlimited', devices: [] };
			var name = wb.input({ 'value': p.name || '', 'placeholder': _('e.g. Ava / Kids / Bedroom'), 'maxlength': '32' });
			var mode = wb.select([ [ 'unlimited', _('Always allowed') ], [ 'schedule', _('Bedtime window (firewall schedule)') ] ], p.mode || 'unlimited');
			var start = wb.input({ 'type': 'time', 'value': p.bedtime_start || '21:00' });
			var end = wb.input({ 'type': 'time', 'value': p.bedtime_end || '07:00' });
			var chosen = splitList(p.bedtime_days);
			if (!chosen.length) chosen = DAYS;
			var dayBoxes = DAYS.map(function(d) {
				var cb = E('input', { 'type': 'checkbox', 'value': d });
				cb.checked = chosen.indexOf(d) >= 0;
				return E('label', { 'style': 'display:inline-flex;align-items:center;gap:5px;margin:2px 12px 2px 0;font-weight:600' }, [ cb, document.createTextNode(DAY_LABEL[d]) ]);
			});
			var mine = macsOf(p), choices = Array.from(new Set(mine.concat(knownMacs))).sort();
			var deviceList = E('div', { 'class': 'wb-checklist' }, choices.length ? choices.map(function(mac) {
				var cb = E('input', { 'type': 'checkbox', 'value': mac }); cb.checked = mine.includes(mac);
				return E('label', { 'title': mac }, [ cb, E('span', { 'class': 'grow' }, [ friendly(mac) || (knownMacs.includes(mac) ? _('Unnamed device') : _('Not currently seen')) ]), E('small', {}, [ mac ]) ]);
			}) : [ E('div', { 'class': 'wb-sub', 'style': 'padding:10px' }, [ _('No devices seen yet — connect one, or add a MAC manually below.') ]) ]);
			var extra = wb.input({ 'placeholder': _('aa:bb:cc:dd:ee:ff (optional)'), 'type': 'text' });
			function syncBlocks() {
				var sch = mode.value === 'schedule';
				[ start, end ].forEach(function(el) { el.disabled = !sch; });
				dayBoxes.forEach(function(l) { l.querySelector('input').disabled = !sch; });
			}
			mode.addEventListener('change', syncBlocks); syncBlocks();

			wb.formModal(existing ? _('Edit member') : _('New member'), [
				{ label: _('Name'), node: name },
				{ label: _('Control'), node: mode, help: _('Bedtime becomes a real firewall time rule enforced by the router.') },
				{ label: _('From'), node: start },
				{ label: _('To'), node: end },
				{ label: _('Days'), node: E('div', { 'style': 'display:flex;flex-wrap:wrap;max-width:420px' }, dayBoxes) },
				{ label: _('Devices'), node: deviceList, desc: _('Tick every device that belongs to this member — phones, laptops, consoles.') },
				{ label: _('Extra MAC'), node: extra }
			], async function(stillOpen) {
				if (!name.value.trim()) throw new Error(_('Please give the member a name.'));
				var macs = Array.from(deviceList.querySelectorAll('input')).filter(function(cb) { return cb.checked; }).map(function(cb) { return cb.value; });
				var ex = (extra.value || '').trim().toUpperCase();
				if (ex) {
					if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(ex)) throw new Error(_('“%s” is not a MAC address.').format(extra.value.trim()));
					ex = ex.replace(/-/g, ':');
					if (macs.indexOf(ex) < 0) macs.push(ex);
				}
				var modeVal = mode.value;
				var days = dayBoxes.map(function(label) { return label.querySelector('input'); }).filter(function(cb) { return cb.checked; }).map(function(cb) { return cb.value; });
				if (modeVal === 'schedule') {
					var time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
					if (!time.test(start.value) || !time.test(end.value) || start.value === end.value) throw new Error(_('Choose distinct start and end times.'));
					if (!days.length) throw new Error(_('Choose at least one weekday.'));
				}
				var changed = !existing || macs.slice().sort().join() !== mine.slice().sort().join() || modeVal !== p.mode || (modeVal === 'schedule' && (start.value !== p.bedtime_start || end.value !== p.bedtime_end || days.join() !== chosen.join()));
				var paths = [];
				if (changed && (modeVal === 'schedule' || p.state_paused === '1')) {
					state = await policy.read();
					if (!stillOpen()) return;
					paths = policy.targets(macs, state);
					if (!paths) throw new Error(_('Every selected device needs a known client zone and uplink before its rule can be changed.'));
				}
				if (sid == null) {
					var index = 1;
					while (uci.get('wundr', 'member' + index)) index++;
					sid = uci.add('wundr', 'family', 'member' + index);
				}
				uci.set('wundr', sid, 'name', name.value.trim());
				uci.set('wundr', sid, 'mode', modeVal);
				if (macs.length) uci.set('wundr', sid, 'devices', macs); else uci.unset('wundr', sid, 'devices');
				if (modeVal === 'schedule') {
					uci.set('wundr', sid, 'bedtime_start', start.value);
					uci.set('wundr', sid, 'bedtime_end', end.value);
					uci.set('wundr', sid, 'bedtime_days', days);
				} else {
					[ 'bedtime_start', 'bedtime_end', 'bedtime_days' ].forEach(function(k) { uci.unset('wundr', sid, k); });
				}
				if (changed) {
					var bedtime = ruleName(sid, 'bedtime'), pause = ruleName(sid, 'pause');
					policy.replaceRules([bedtime], bedtime, modeVal === 'schedule' ? paths : [], schedule(days, start.value, end.value));
					policy.replaceRules([pause], pause, p.state_paused === '1' ? paths : []);
				}
				return wb.reviewChanges().then(reloadUci).then(rerender);
			}, { intro: existing ? null : _('A member profile groups one person\'s devices — however many they own — so you can pause or schedule them together.'), ok: existing ? _('Save') : _('Add') });
		}

		rerender();
		poll.add(function() { return policy.read().then(function(current) { state = current; rerender(); }); }, 60);
		return body;
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
