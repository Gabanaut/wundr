'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';
'require wundr.ui as wb';

/* Wundr Apps — the optional services installed on this router.
 * Built directly from `rc list` (real init scripts); every card only exposes
 * actions that stock LuCI already uses on the same object:
 *   • Start / Stop / Restart via `rc init <name> <action>`
 *   • Enable or disable at boot via `rc init <name> enable|disable`
 * Nothing is invented; absent apps simply do not appear. */

var callList = rpc.declare({ object: 'rc', method: 'list' });
var callInit = rpc.declare({ object: 'rc', method: 'init', params: [ 'name', 'action' ] });

/* Core scripts that are either always-on, glue, or not "apps" a user wants. */
var CORE_RE = /^(boot|sysctl|system|network|log|rpcd|uhttpd|urandom|watchdog|dnsmasq|dropbear|firewall|odhcpd|timestamp|wpad|netmonitor|done|led|flash|gpio|kmod|bootcount|services|uci|sysfixtime|sysntpd|bootlog|failsafe|httpd|lighttpd|netconfig|dnsmasq_slow|wpad-openssl|wpad-wolfssl|hostsdb|autoshares|umount|block|mount|bootable|usb|storage|extroot)/i;

var INFO = {
	AdGuardHome:       { title: _('AdGuard Home'),       page: 'admin/services/adguardhome' },
	adblock:           { title: _('Adblock'),            page: 'admin/services/adblock' },
	'adblock-fast':    { title: _('Adblock Fast'),       page: 'admin/services/adblock-fast' },
	banip:             { title: _('banIP'),              page: 'admin/services/banip' },
	sqm:               { title: _('SQM QoS'),            page: 'admin/network/sqm' },
	miniupnpd:         { title: _('UPnP & NAT-PMP'),     page: 'admin/services/upnp' },
	samba4:            { title: _('Samba 4 Shares'),     page: 'admin/services/samba4' },
	samba:             { title: _('Samba Shares'),       page: 'admin/services/samba' },
	ksmbd:             { title: _('ksmbd SMB Shares'),   page: 'admin/services/ksmbd' },
	minidlna:          { title: _('MiniDLNA Media'),     page: 'admin/services/minidlna' },
	ddns:              { title: _('Dynamic DNS'),        page: 'admin/services/ddns' },
	acme:              { title: _('ACME TLS Certs'),     page: 'admin/services/acme' },
	'https-dns-proxy': { title: _('DNS over HTTPS'),     page: 'admin/services/https-dns-proxy' },
	smartdns:          { title: _('SmartDNS'),           page: 'admin/services/smartdns' },
	stubby:            { title: _('Stubby DoT'),         page: null },
	nlbwmon:           { title: _('Bandwidth Monitor'),  page: 'admin/services/nlbw' },
	vnstat:            { title: _('vnStat Traffic'),     page: 'admin/status/vnstat2' },
	mwan3:             { title: _('Multi-WAN (mwan3)'),  page: 'admin/network/mwan3' },
	pbr:               { title: _('Policy Routing'),     page: 'admin/services/pbr' },
	tailscale:         { title: _('Tailscale VPN'),      page: 'admin/vpn/tailscale' },
	zerotier:          { title: _('ZeroTier VPN'),       page: 'admin/vpn/zerotier' },
	cloudflared:       { title: _('Cloudflare Tunnel'),  page: 'admin/vpn/cloudflared' },
	openvpn:           { title: _('OpenVPN'),            page: 'admin/vpn/openvpn' },
	'openvpn-client':  { title: _('OpenVPN client') },
	'openvpn-server':  { title: _('OpenVPN server') },
	wireguard:         { title: _('WireGuard VPN'),      page: 'admin/network/network' },
	ttyd:              { title: _('Web Terminal (ttyd)'),page: 'admin/services/ttyd' },
	dockerd:           { title: _('Docker Containers'),  page: 'admin/services/dockerman' },
	aria2:             { title: _('Aria2 Downloads'),    page: 'admin/services/aria2' },
	transmission:      { title: _('Transmission'),       page: 'admin/services/transmission' },
	wol:               { title: _('Wake on LAN'),        page: 'admin/services/wol' },
	olsr:              { title: _('OLSR mesh') },
	babeld:            { title: _('Babel routing') },
	mesh11sd:          { title: _('802.11s EasyMesh') },
	dhcp_hotspots:     { title: _('Hotspot (openNDS)'),  page: 'admin/services/opnds' },
	opennds:           { title: _('Hotspot (openNDS)') },
	nodogsplash:       { title: _('Hotspot (noDog)') }
};
function friendly(name) {
	var i = INFO[name] || {};
	return { title: i.title || name.replace(/[-_]/g, ' ').replace(/^./, function(c) { return c.toUpperCase(); }),
		page: i.page || null, desc: i.desc || null };
}

function collect(list) {
	return Object.keys(list || {}).filter(function(name) { return !CORE_RE.test(name); }).map(function(name) {
		var e = list[name] || {};
		return { name: name, enabled: e.enabled === true || e.enabled === 1, start: e.start };
	}).sort(function(a, b) { return a.name.localeCompare(b.name); });
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callList(), {}),
			(ui.menu && typeof ui.menu.load === 'function') ? L.resolveDefault(ui.menu.load(), null) : Promise.resolve(null)
		]);
	},
	render: function(res) {
		var raw = res[0] || {}, menuTree = res[1];
		var mount = E('div');
		var entries = collect(raw);

		function run(s, action) {
			return function(ev) {
				var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
				if (btn) { btn.disabled = true; }
				return callInit(s.name, action).then(function() { return L.resolveDefault(callList(), {}); })
					.then(function(fresh) { entries = collect(fresh); render(); })
					.catch(function() { wb.toast(_('%s failed').format(action), friendly(s.name).title, 'bad'); if (btn) btn.disabled = false; });
			};
		}

		function card(s) {
			var f = friendly(s.name);
			return E('article', { 'class': 'wb-card wb-app-card' }, [
				E('div', { 'class': 'head' }, [
					E('span', { 'class': 'dot' + (s.enabled ? ' on' : '') }),
					E('h3', { 'title': f.title }, [ f.title ]),
					wb.toggle(s.enabled, function(next) {
						return callInit(s.name, next ? 'enable' : 'disable').then(function() {
							wb.toast(next ? _('Runs at boot') : _('No longer starts at boot'), f.title, next ? 'good' : 'warn');
							return L.resolveDefault(callList(), {}).then(function(x) { entries = collect(x); render(); });
						});
					}, { 'aria-label': _('Start at boot'), 'title': _('Start at boot?') })
				]),
				E('p', { 'class': 'wb-sub', 'style': 'margin-bottom:6px' }, [ f.desc || _('Service script: /etc/init.d/%s.').format(s.name) ]),
				E('div', { 'class': 'foot pillrow' }, [
					E('button', { 'class': 'wb-btn sm', 'click': run(s, 'start') }, [ wb.iconLabel('play', _('Start')) ]),
					E('button', { 'class': 'wb-btn sm', 'click': run(s, 'restart') }, [ wb.iconLabel('refresh', _('Restart')) ]),
					E('button', { 'class': 'wb-btn sm', 'click': run(s, 'stop') }, [ wb.iconLabel('pause', _('Stop')) ]),
					E('div', { 'style': 'flex:1' }),
					(f.page && (!menuTree || wb.menuHas(menuTree, f.page))) ? E('a', { 'class': 'wb-btn sm primary', 'href': L.url(f.page) }, [ _('Configure') ]) : ''
				])
			]);
		}

		function render() {
			dom.content(mount, entries.length
				? E('div', { 'class': 'wb-grid' }, entries.map(card))
				: wb.empty(_('No optional services were detected. Install AdGuard Home, banIP, SQM or a VPN from the package manager and they will show up here.'), 'apps',
					wb.pkgLink({ 'class': 'wb-btn primary' }, [ _('Open package manager') ])));
		}
		render();
		poll.add(function() { return L.resolveDefault(callList(), {}).then(function(x) { entries = collect(x); render(); }); }, 20);
		return E('div', {}, [
			wb.hero(_('Apps & Services'), _('Optional software detected from installed init scripts. Toggle boot behaviour, start / stop now, or open the service\'s own settings page.'), [
				wb.stat(String(entries.length), _('Detected')),
				wb.stat(String(entries.filter(function(s){ return s.enabled; }).length), _('Enabled at boot'))
			], [
				wb.pkgLink({ 'class': 'wb-btn' }, [ wb.iconLabel('download', _('Package manager')) ]),
				E('a', { 'class': 'wb-btn', 'href': L.url('admin/system/startup') }, [ wb.iconLabel('sliders', _('All boot scripts')) ])
			]),
			mount
		]);
	},
	handleSave: null, handleSaveApply: null, handleReset: null
});
