'use strict';
'require view';
'require form';
'require uci';
'require network';
'require dom';
'require wundr.ui as wb';

/* Wundr LAN/DHCP — native configuration editor over network + dhcp configs.
 * Handles both OpenWrt 24+/25+ CIDR `list ipaddr` ('192.168.1.1/24') and
 * classic scalar `ipaddr` + `netmask`, plus DHCP DNS servers (option 6). */

function parseDnsOpt6(section_id) {
	var list = L.toArray(uci.get('dhcp', section_id, 'dhcp_option'));
	for (var i = 0; i < list.length; i++) {
		var s = String(list[i]);
		if (/^6,/.test(s)) {
			var parts = s.split(',');
			return { primary: parts[1] || '', secondary: parts[2] || '' };
		}
	}
	return { primary: '', secondary: '' };
}

function writeDnsOpt6(section, section_id) {
	var primary = (section.formvalue(section_id, '_dns_primary') || '').trim();
	var secondary = (section.formvalue(section_id, '_dns_secondary') || '').trim();
	var others = L.toArray(uci.get('dhcp', section_id, 'dhcp_option')).filter(function(x) {
		return !/^6,/.test(String(x));
	});
	var opt6 = (primary || secondary)
		? '6,' + [ primary, secondary ].filter(Boolean).join(',')
		: null;
	var next = opt6 ? others.concat([ opt6 ]) : others;
	if (next.length)
		uci.set('dhcp', section_id, 'dhcp_option', next);
	else
		uci.unset('dhcp', section_id, 'dhcp_option');
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'),
			uci.load('dhcp'),
			wb.hostHints()
		]).then(function(res) {
			/* Some minimal builds ship without a dhcp.lan section; create it
			   so the NamedSection editors below have something to bind to. */
			if (!uci.get('dhcp', 'lan')) {
				uci.add('dhcp', 'dhcp', 'lan');
				uci.set('dhcp', 'lan', 'interface', 'lan');
			}
			return res[2] || {};
		});
	},

	render: function(hints) {
		var m, m2, s, o;

		m = new form.Map('network', _('LAN & DHCP'),
			_('Router address and the settings handed to LAN clients. ' +
			  'Changes apply through LuCI\'s standard confirm & apply.'));

		/* ---- LAN interface (network config) ---- */
		s = m.section(form.NamedSection, 'lan', 'interface', _('LAN Interface'));

		function writeLanSubnet(section, sid) {
			var raw = uci.get('network', sid, 'ipaddr');
			var ip = section.formvalue(sid, 'ipaddr') || String(L.toArray(raw)[0] || '').split('/')[0];
			var mask = section.formvalue(sid, 'netmask') || '255.255.255.0';
			if (!ip) return;
			if (Array.isArray(raw) || (raw && String(raw).indexOf('/') > 0)) {
				var pfx = network.maskToPrefix(mask);
				var rest = L.toArray(raw).slice(1);
				uci.set('network', sid, 'ipaddr', [ ip + '/' + (pfx != null ? pfx : 24) ].concat(rest));
				uci.unset('network', sid, 'netmask');
			} else {
				uci.set('network', sid, 'ipaddr', ip);
				uci.set('network', sid, 'netmask', mask);
			}
		}

		o = s.option(form.Value, 'ipaddr', _('Router IPv4 address'),
			_('The address used to reach this router and the default gateway for clients.'));
		o.datatype = 'ip4addr("nomask")';
		o.rmempty = false;
		o.cfgvalue = function(sid) {
			var first = L.toArray(uci.get('network', sid, 'ipaddr'))[0] || '';
			return String(first).split('/')[0];
		};
		o.write = function(sid) { writeLanSubnet(this.section, sid); };

		o = s.option(form.Value, 'netmask', _('Subnet mask'));
		o.datatype = 'ip4addr("nomask")';
		o.default = '255.255.255.0';
		o.rmempty = false;
		o.cfgvalue = function(sid) {
			var mask = uci.get('network', sid, 'netmask');
			if (mask) return mask;
			var first = L.toArray(uci.get('network', sid, 'ipaddr'))[0] || '';
			var pfx = String(first).split('/')[1];
			return (pfx != null && pfx !== '') ? (network.prefixToMask(+pfx) || '255.255.255.0') : '255.255.255.0';
		};
		o.write = function(sid) { writeLanSubnet(this.section, sid); };

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
		o.datatype = 'ip4addr("nomask")';
		o.optional = true;
		o.rmempty = true;
		o.cfgvalue = function(section_id) { return parseDnsOpt6(section_id).primary; };
		o.write = function(section_id) { writeDnsOpt6(this.section, section_id); };
		o.remove = function(section_id) { writeDnsOpt6(this.section, section_id); };

		o = s.option(form.Value, '_dns_secondary', _('Secondary DNS'),
			_('Optional fallback for clients.'));
		o.datatype = 'ip4addr("nomask")';
		o.optional = true;
		o.rmempty = true;
		o.cfgvalue = function(section_id) { return parseDnsOpt6(section_id).secondary; };
		o.write = function(section_id) { writeDnsOpt6(this.section, section_id); };
		o.remove = function(section_id) { writeDnsOpt6(this.section, section_id); };

		/* ---- IPv6 LAN Services (RA & DHCPv6) ---- */
		s = m2.section(form.NamedSection, 'lan', 'dhcp', _('IPv6 LAN Announcements'));

		o = s.option(form.ListValue, 'ra', _('Router Advertisements (SLAAC)'),
			_('Server mode advertises IPv6 prefixes to LAN clients automatically.'));
		o.value('server', _('Server mode (default)'));
		o.value('hybrid', _('Hybrid mode'));
		o.value('relay', _('Relay mode'));
		o.value('disabled', _('Disabled'));
		o.default = 'server';
		o.rmempty = true;

		o = s.option(form.ListValue, 'dhcpv6', _('DHCPv6 Service'));
		o.value('server', _('Server mode (stateful + stateless)'));
		o.value('hybrid', _('Hybrid mode'));
		o.value('relay', _('Relay mode'));
		o.value('disabled', _('Disabled'));
		o.default = 'server';
		o.rmempty = true;

		/* ---- Static DHCP Leases ---- */
		s = m2.section(form.GridSection, 'host', _('Static DHCP Leases'),
			_('Pin fixed IPv4 addresses and hostnames to devices by MAC address.'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;

		o = s.option(form.Value, 'name', _('Hostname'));
		o.datatype = 'hostname';
		o.rmempty = true;

		o = s.option(form.DynamicList, 'mac', _('MAC address'));
		o.datatype = 'macaddr';
		o.rmempty = false;
		Object.keys(hints || {}).sort().forEach(function(mac) {
			var h = hints[mac] || {};
			var ipHint = (Array.isArray(h.ipaddrs) && h.ipaddrs[0]) || h.ip || '';
			var lbl = [ mac, h.name, ipHint ].filter(Boolean).join(' · ');
			o.value(mac, lbl);
		});

		o = s.option(form.Value, 'ip', _('IPv4 address'));
		o.datatype = 'or(ip4addr("nomask"), "ignore")';
		o.placeholder = '192.168.1.50';
		o.rmempty = true;

		o = s.option(form.Value, 'leasetime', _('Lease time'));
		o.placeholder = '12h';
		o.rmempty = true;

		return Promise.all([ m.render(), m2.render() ]).then(function(nodes) {
			return E('div', {}, nodes);
		});
	}
});
