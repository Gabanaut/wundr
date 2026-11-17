'use strict';
'require view';
'require uci';
'require rpc';
'require form';
'require tools.widgets as widgets';
'require wundr.ui as wb';

/* Wundr QoS — real bufferbloat control when sqm-scripts is installed.
 * SQM is detected by its init script (`rc list` → "sqm"), never faked.
 * When present this is a native LuCI form.Map over sqm's `queue` sections,
 * so shaping works exactly as the stock SQM app (validated + apply). When
 * absent, an honest card points at the package installer. */

var callList = rpc.declare({ object: 'rc', method: 'list', expect: { '': {} } });

return view.extend({
	load: function() {
		return L.resolveDefault(callList(), null).then(function(rc) {
			if (!rc) return { unavailable: true };
			if (!Object.prototype.hasOwnProperty.call(rc, 'sqm')) return { haveSqm: false };
			return uci.load('sqm').then(function() { return { haveSqm: true }; })
				.catch(function() { return { unavailable: true }; });
		});
	},

	render: function(state) {
		if (state.unavailable) return wb.card(_('Quality of service'), [ wb.empty(_('Could not read SQM settings. Check your permissions and reload this page.')) ]);
		if (!state.haveSqm) {
			return E('div', {}, [
				wb.hero(_('Quality of service'), _('Stop one heavy download from ruining video calls for everyone else.'), [], [
					wb.pkgLink({ 'class': 'wb-btn primary' }, [ wb.iconLabel('download', _('Install SQM')) ])
				]),
				E('div', { 'class': 'wb-setting-note warn' }, [ _('SQM is not installed on this router.') ]),
				wb.card(_('What it does'), [ E('p', { 'class': 'wb-sub' }, [
					_('Smart Queue Management shapes your connection to ~90% of its real capacity and queues the rest fairly, so latency stays low under load. Install '),
					E('code', {}, [ 'sqm-scripts + luci-app-sqm' ]), _(' via the package manager, then reopen this page.')
				]) ])
			]);
		}

		var m = new form.Map('sqm', _('Traffic shaping'),
			_('Set the shaped upload and download rates to about 85–90% of your true ' +
			  'line speed (measure with a speed test on an idle link). This keeps ' +
			  'latency low while someone is saturating the connection.'));

		var s = m.section(form.GridSection, 'queue', _('Shaped connections'),
			_('One row per interface you want to shape — usually your WAN.'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;

		var o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.rmempty = false;

		o = s.option(widgets.DeviceSelect, 'interface', _('Network device'), _('The uplink device this queue shapes.'));
		o.nocreate = true;
		o.rmempty = false;

		o = s.option(form.Value, 'download', _('Download (kbit/s)'), _('Use 0 to turn off download shaping.'));
		o.datatype = 'uinteger';
		o.rmempty = false;

		o = s.option(form.Value, 'upload', _('Upload (kbit/s)'), _('Use 0 to turn off upload shaping.'));
		o.datatype = 'uinteger';
		o.rmempty = false;

		o = s.option(form.ListValue, 'qdisc', _('Queue discipline'));
		var disciplines = new Set([ 'cake', 'fq_codel' ]);
		uci.sections('sqm', 'queue').forEach(function(queue) { if (queue.qdisc) disciplines.add(queue.qdisc); });
		disciplines.forEach(function(name) { o.value(name, name); });
		o.default = 'cake';
		o.rmempty = false;

		return m.render().then(function(node) {
			var active = uci.sections('sqm', 'queue').filter(function(q) { return q.enabled === '1'; }).length;
			return E('div', {}, [
				wb.hero(_('Quality of service'), _('Real bufferbloat control via SQM. Pick an interface and the two line speeds – that is all most homes need.'), [
					wb.stat(String(active), _('Enabled queues')),
					wb.stat(String(uci.sections('sqm', 'queue').length), _('Configured'))
				]),
				node,
				wb.card(_('How it protects you'), [ E('p', { 'class': 'wb-sub' }, [
				 _('Without shaping, one saturating transfer inflates ping for video calls, gaming and VoIP. Shaping keeps a shallow, fairly-shared queue at each boundary so latency stays under control even at full speed.')
				]) ])
			]);
		});
	}
});
