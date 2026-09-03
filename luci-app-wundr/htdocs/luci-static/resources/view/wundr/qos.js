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
		return L.resolveDefault(callList(), {}).then(function(rc) {
			var haveSqm = Object.keys(rc || {}).some(function(n) { return /^sqm/i.test(n); });
			if (!haveSqm) return { haveSqm: false };
			return uci.load('sqm').then(function() { return { haveSqm: true }; })
				.catch(function() { return { haveSqm: true, empty: true }; });
		});
	},

	render: function(state) {
		if (!state.haveSqm) {
			return E('div', {}, [
				wb.hero(_('Quality of service'), _('Stop one heavy download from ruining video calls for everyone else.'), [], [
					E('a', { 'class': 'wb-btn primary', 'href': L.url('admin/system/packages') }, [ wb.iconLabel('download', _('Install SQM')) ])
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
		o.default = o.enabled;

		o = s.option(widgets.NetworkSelect, 'interface', _('Interface'), _('The uplink this queue shapes.'));
		o.nocreate = true;
		o.rmempty = false;

		o = s.option(form.Value, 'download', _('Download (kbit/s)'), _('Optional — SQM can often auto-detect. e.g. 90000 for ~90 Mbit.'));
		o.datatype = 'or(uinteger, string)';
		o.rmempty = true;

		o = s.option(form.Value, 'upload', _('Upload (kbit/s)'));
		o.datatype = 'or(uinteger, string)';
		o.rmempty = true;

		o = s.option(form.ListValue, 'qd', _('Queue discipline'));
		o.optional = true;
		o.value('', _('cake (default — best all-round)'));
		o.value('cake', _('cake'));
		o.value('fq_codel', _('fq_codel'));
		o.rmempty = true;

		return m.render().then(function(node) {
			var active = uci.sections('sqm', 'queue').filter(function(q) { return q.enabled === '1' || q.enabled == null; }).length;
			return E('div', {}, [
				wb.hero(_('Quality of service'), _('Real bufferbloat control via SQM. Pick an interface and the two line speeds – that is all most homes need.'), [
					wb.stat(String(active), _('Active queues')),
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
