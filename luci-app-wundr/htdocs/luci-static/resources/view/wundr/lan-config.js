'use strict';
'require view';
'require form';
'require uci';
'require dom';

/* Wundr LAN/DHCP — native configuration editor over network + dhcp configs.
 * Includes the DHCP DNS servers handed to clients (dhcp option 6),
 * which the vendor panel exposes and our read-only view did not. */

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'),
			uci.load('dhcp')
		]).then(function() {
			/* Some minimal builds ship without a dhcp.lan section; create it
			   so the NamedSection editors below have something to bind to. */
			if (!uci.get('dhcp', 'lan'))
				uci.add('dhcp', 'dhcp', 'lan');
		});
	},

	render: function() {
		var m, m2, s, o;

		m = new form.Map('network', _('LAN & DHCP'),
			_('Router address and the settings handed to LAN clients. ' +
			  'Changes apply through LuCI\'s standard confirm & apply.'));

		/* ---- LAN interface (network config) ---- */
		s = m.section(form.NamedSection, 'lan', 'interface', _('LAN Interface'));

		o = s.option(form.Value, 'ipaddr', _('Router IPv4 address'),
			_('The address used to reach this router and the default gateway for clients.'));
		o.datatype = 'ip4addr';
		o.rmempty = false;

		o = s.option(form.Value, 'netmask', _('Subnet mask'));
		o.datatype = 'netmask4';
		o.default = '255.255.255.0';
		o.rmempty = false;

		/* ---- DHCP server (dhcp config, lan section) ---- */
		m2 = new form.Map('dhcp', _('DHCP Server'));

		s = m2.section(form.NamedSection, 'lan', 'dhcp', _('DHCP Pool'));

		o = s.option(form.Flag, 'ignore', _('Disable DHCP on LAN'),
			_('When checked, no addresses are handed out (e.g. another DHCP server exists).'));
		o.default = '0';

		o = s.option(form.Value, 'start', _('Pool start (offset)'),
			_('Offset from the network base: 100 means x.x.x.100.'));
		o.datatype = 'range(1,252)';
		o.default = '100';
		o.rmempty = false;

		o = s.option(form.Value, 'limit', _('Pool size'),
			_('Number of addresses in the pool.'));
		o.datatype = 'range(1,252)';
		o.default = '150';
		o.rmempty = false;

		o = s.option(form.Value, 'leasetime', _('Lease time'),
			_('e.g. 12h (hours), 30m (minutes). Clients renew at half this interval.'));
		o.default = '12h';
		o.rmempty = false;

		/* ---- DNS handed to clients (dhcp option 6) ---- */
		s = m2.section(form.NamedSection, 'lan', 'dhcp', _('DNS Handed to Clients'));

		/* dhcp option 6 carries "6,primary,secondary". Two friendly fields
		   map onto it via cfgvalue/write so users never see the wire format. */
		o = s.option(form.Value, '_dns_primary', _('Primary DNS'),
			_('Leave empty to hand out the router itself (recommended unless running an external resolver like AdGuard Home).'));
		o.datatype = 'ip4addr';
		o.rmempty = true;
		o.cfgvalue = function(section_id) {
			var opt = uci.get('dhcp', section_id, 'dhcp_option') || '';
			var parts = String(opt).split(',');
			return parts[1] || '';
		};
		o.write = function(section_id, value) {
			var secondary = this.map.formvalue('_dns_secondary', section_id) || '';
			if (value || secondary)
				uci.set('dhcp', section_id, 'dhcp_option', '6,' + (value || '') + (secondary ? ',' + secondary : ''));
			else
				uci.unset('dhcp', section_id, 'dhcp_option');
		};
		o.remove = function(section_id) { uci.unset('dhcp', section_id, 'dhcp_option'); };

		o = s.option(form.Value, '_dns_secondary', _('Secondary DNS'),
			_('Optional fallback for clients.'));
		o.datatype = 'ip4addr';
		o.rmempty = true;
		o.cfgvalue = function(section_id) {
			var opt = uci.get('dhcp', section_id, 'dhcp_option') || '';
			return String(opt).split(',')[2] || '';
		};
		o.write = function(section_id, value) {
			/* primary's write handles the combined option; nothing to do here */
		};
		o.remove = function(section_id) { /* handled by primary */ };


		return Promise.all([ m.render(), m2.render() ]).then(function(nodes) {
			return E('div', {}, nodes);
		});
	}
});
