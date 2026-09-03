'use strict';
'require view';
'require form';
'require uci';
'require poll';
'require network';
'require dom';
'require wundr.ui as wb';

/* Wundr Internet — live WAN status plus the connection editor (DHCP / static /
 * PPPoE, DNS override, MAC clone, IPv6). Writes use LuCI's native form.Map,
 * so validation, staging and the rollback-protected apply are stock LuCI. */

function wanName(wans) {
	var up = (wans || []).filter(function(n) { return n.isUp(); })[0];
	return (up || (wans || [])[0] || { getName: function() { return 'wan'; } }).getName();
}

function deviceSectionFor(devname) {
	var found = null;
	uci.sections('network', 'device', function(s) { if (!found && s.name === devname) found = s['.name']; });
	return found;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('network'), network.getWANNetworks(), network.getWAN6Networks(), network.getProtocols() ]);
	},

	render: function(data) {
		var wans = data[1] || [], wan6s = data[2] || [], protocols = data[3] || [];
		var ifname = wanName(wans);
		if (!uci.get('network', ifname)) {
			uci.add('network', 'interface', ifname);
			uci.set('network', ifname, 'proto', 'dhcp');
		}
		var installed = {};
		protocols.forEach(function(p) { installed[p.getProtocol()] = p.isInstalled(); });

		/* ---- live status ---- */
		var headline = E('h2', { 'class': 'wb-h' }, [ _('Internet') ]);
		var statePill = wb.pill('…', 'mut');
		var stIp = wb.stat('—', _('IPv4 address')), stGw = wb.stat('—', _('Gateway')), stUp = wb.stat('—', _('Connected for')), stDns = wb.stat('—', _('DNS'));
		var detail = E('div');

		function refresh() {
			network.flushCache();
			return Promise.all([ network.getWANNetworks(), network.getWAN6Networks() ]).then(function(res) {
				var w = (res[0] || []).filter(function(n) { return n.getName() === ifname; })[0] || (res[0] || [])[0];
				var w6 = (res[1] || [])[0];
				var up = !!(w && w.isUp());
				dom.content(statePill, [ up ? _('Online') : (w && w.isPending() ? _('Connecting…') : _('Offline')) ]);
				statePill.className = 'wb-pill ' + (up ? 'good' : (w && w.isPending() ? 'warn' : 'bad'));
				dom.content(stIp.firstChild, [ (w && w.getIPAddr()) || '—' ]);
				dom.content(stGw.firstChild, [ (w && w.getGatewayAddr()) || '—' ]);
				dom.content(stUp.firstChild, [ up ? wb.fmtUptime(w.getUptime()) : '—' ]);
				var dns = w ? w.getDNSAddrs() : [];
				dom.content(stDns.firstChild, [ dns.length ? dns.join(', ') : '—' ]);
				var dev = w ? w.getL3Device() : null;
				dom.content(detail, [ wb.kv([
					[ _('Interface'), w ? w.getName() : ifname, 'mono' ],
					[ _('Protocol'), w ? w.getI18n() : '—' ],
					[ _('Device'), dev ? dev.getName() : '—', 'mono' ],
					[ _('MAC address'), dev ? dev.getMAC() : '—', 'mono' ],
					[ _('Traffic'), dev ? (wb.fmtBytes(dev.getRXBytes()) + ' ↓ · ' + wb.fmtBytes(dev.getTXBytes()) + ' ↑') : '—' ],
					[ _('IPv6 address'), (w6 && w6.getIP6Addr()) || (w && w.getIP6Addr()) || _('None') , 'mono' ],
					[ _('IPv6 prefix'), (w6 && w6.getIP6Prefix()) || _('None'), 'mono' ],
					[ _('IPv6 DNS'), w6 && w6.getDNS6Addrs().length ? w6.getDNS6Addrs().join(', ') : _('None'), 'mono' ]
				]) ]);
			});
		}

		var hero = E('section', { 'class': 'wb-card wb-hero' }, [
			E('div', { 'style': 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [ headline, statePill ]),
			E('div', { 'class': 'wb-sub' }, [ _('How this router reaches the internet. Change the connection type below if your provider requires it.') ]),
			E('div', { 'class': 'wb-hero-row' }, [ stIp, stGw, stUp, stDns, E('div', { 'class': 'wb-hero-actions' }, [
				E('a', { 'class': 'wb-btn', 'href': L.url('wundr/network/diagnostics') }, [ wb.iconLabel('speed', _('Test connection')) ]),
				E('a', { 'class': 'wb-btn', 'href': L.url('admin/network/network') }, [ wb.iconLabel('sliders', _('All interfaces')) ])
			]) ])
		]);

		/* ---- editor ---- */
		var m = new form.Map('network', _('Connection settings'),
			_('Most homes use "Automatic (DHCP)". Fibre and DSL providers often require PPPoE with a username and password. Changes apply with a rollback safety net.'));

		var s = m.section(form.NamedSection, ifname, 'interface', _('WAN connection'));
		var o;

		o = s.option(form.ListValue, 'proto', _('Connection type'));
		o.value('dhcp', _('Automatic (DHCP) — cable, fibre ONT, most modems'));
		o.value('static', _('Static IP — address supplied by your provider'));
		if (installed.pppoe !== false) o.value('pppoe', _('PPPoE — username and password from your provider'));
		o.default = 'dhcp';
		o.rmempty = false;

		o = s.option(form.Value, 'hostname', _('Hostname to send'), _('Optional. Some providers identify you by this name.'));
		o.depends('proto', 'dhcp');
		o.datatype = 'hostname';

		o = s.option(form.Value, 'ipaddr', _('IPv4 address'));
		o.depends('proto', 'static'); o.datatype = 'ip4addr'; o.rmempty = false;
		o = s.option(form.Value, 'netmask', _('Subnet mask'));
		o.depends('proto', 'static'); o.datatype = 'netmask4'; o.default = '255.255.255.0';
		o = s.option(form.Value, 'gateway', _('Gateway'));
		o.depends('proto', 'static'); o.datatype = 'ip4addr'; o.rmempty = false;

		o = s.option(form.Value, 'username', _('PPPoE username'));
		o.depends('proto', 'pppoe'); o.rmempty = false;
		o = s.option(form.Value, 'password', _('PPPoE password'));
		o.depends('proto', 'pppoe'); o.password = true; o.rmempty = false;
		o = s.option(form.Value, 'service', _('Service name'), _('Leave empty unless your provider specifies one.'));
		o.depends('proto', 'pppoe');

		o = s.option(form.Flag, 'peerdns', _('Use provider DNS servers'), _('Turn off to choose your own resolvers, e.g. a privacy or family-filtering DNS.'));
		o.default = '1'; o.rmempty = false;
		o.depends('proto', 'dhcp'); o.depends('proto', 'pppoe');

		o = s.option(form.DynamicList, 'dns', _('DNS servers'), _('Handed to the router and, unless overridden under LAN & DHCP, to every device.'));
		o.datatype = 'ipaddr';
		o.depends({ proto: 'dhcp', peerdns: '0' });
		o.depends({ proto: 'pppoe', peerdns: '0' });
		o.depends('proto', 'static');
		o.placeholder = '1.1.1.1';

		o = s.option(form.Value, 'metric', _('Route priority (metric)'), _('Lower wins when several uplinks exist. Leave empty for the default.'));
		o.datatype = 'uinteger';

		/* MAC clone and MTU live on the L2 device section, not the interface. */
		var devname = uci.get('network', ifname, 'device') || uci.get('network', ifname, 'ifname') || '';
		devname = String(devname).split(/\s+/)[0];
		if (devname && devname.indexOf('@') !== 0) {
			o = s.option(form.Value, '_macaddr', _('Clone MAC address'), _('Some providers lock the line to the first router they saw. Enter that router\'s MAC to take over seamlessly. Empty = hardware default.'));
			o.datatype = 'macaddr';
			o.placeholder = 'AA:BB:CC:DD:EE:FF';
			o.cfgvalue = function() { var sid = deviceSectionFor(devname); return sid ? (uci.get('network', sid, 'macaddr') || '') : ''; };
			o.write = function(section_id, value) {
				var sid = deviceSectionFor(devname);
				if (!sid) { sid = uci.add('network', 'device'); uci.set('network', sid, 'name', devname); }
				uci.set('network', sid, 'macaddr', value);
			};
			o.remove = function() { var sid = deviceSectionFor(devname); if (sid) uci.unset('network', sid, 'macaddr'); };

			o = s.option(form.Value, '_mtu', _('MTU'), _('Maximum packet size. Leave empty unless your provider tells you otherwise (PPPoE commonly uses 1492).'));
			o.datatype = 'range(576,9200)';
			o.placeholder = '1500';
			o.cfgvalue = function() { var sid = deviceSectionFor(devname); return sid ? (uci.get('network', sid, 'mtu') || '') : ''; };
			o.write = function(section_id, value) {
				var sid = deviceSectionFor(devname);
				if (!sid) { sid = uci.add('network', 'device'); uci.set('network', sid, 'name', devname); }
				uci.set('network', sid, 'mtu', value);
			};
			o.remove = function() { var sid = deviceSectionFor(devname); if (sid) uci.unset('network', sid, 'mtu'); };
		}

		var wan6 = (wan6s[0] && wan6s[0].getName()) || (uci.get('network', 'wan6') ? 'wan6' : null);
		if (wan6) {
			var s6 = m.section(form.NamedSection, wan6, 'interface', _('IPv6'));
			o = s6.option(form.Flag, '_enabled', _('Enable IPv6 on the internet connection'), _('Uses DHCPv6 / prefix delegation from your provider. Turn off only if IPv6 causes problems.'));
			o.rmempty = false;
			o.cfgvalue = function(sid) { return uci.get('network', sid, 'disabled') === '1' ? '0' : '1'; };
			o.write = function(sid, value) { if (value === '1') uci.unset('network', sid, 'disabled'); else uci.set('network', sid, 'disabled', '1'); };
			o.remove = function(sid) { uci.set('network', sid, 'disabled', '1'); };
		}

		refresh();
		poll.add(refresh, 5);

		return m.render().then(function(formNode) {
			return E('div', {}, [ hero, wb.card(_('Connection details'), [ detail ]), formNode ]);
		});
	}
});
