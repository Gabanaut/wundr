'use strict';
'require view';
'require form';
'require uci';
'require dom';
'require ui';

/* Wundr Network Mode — flat LAN vs VLAN-segmented topology.
 *
 * Flat mode:    one LAN, one DHCP pool, no bridge-vlan sections.
 * Segmented:    vlan_filtering on the LAN bridge + bridge-vlan sections +
 *               one logical interface + firewall zone + DHCP per segment.
 *
 * All writes flow through LuCI's native UCI staging (uci.set → uci.save →
 * ui.changes.apply), so the apply is validated, atomic and rollback-capable
 * exactly like every native LuCI page. The guided "Add segment" modal creates
 * the companion sections across network/firewall/dhcp in one staged batch.
 *
 * Port-spec grammar mirrors native LuCI tools/bridgevlan.js:
 *   "port"      → untagged + PVID (native VLAN for that port)
 *   "port:t"    → tagged (trunk)
 *   "port:u"    → untagged without PVID
 *   "port:u*"   → untagged + PVID (explicit)
 * A port may be untagged on at most ONE vlan (its PVID); tagged on many.
 */

var VLAN_MIN = 1, VLAN_MAX = 4094;

/* ---- port-spec helpers (mirror of native bridgevlan.js read side) ---- */

function parsePortSpec(spec) {
	var m = String(spec).match(/^([^:]+)(?::([ut*]*))?$/);
	if (!m) return null;
	var flags = m[2] || '';
	return {
		port: m[1],
		tagged: /t/.test(flags),
		untagged: /u/.test(flags) || flags === '',
		pvid: /\*/.test(flags) || flags === ''
	};
}

function formatPortSpec(port, tagged, pvid) {
	/* Native semantics: PVID requires untagged egress. "t*" (tagged+PVID)
	   is explicitly rejected by native validation, so tagged specs never
	   carry the PVID flag. */
	if (tagged) return port + ':t';
	return pvid ? port + ':u*' : port + ':u';
}

function vlanPorts(sectionId) {
	return L.toArray(uci.get('network', sectionId, 'ports'));
}

/* ---- bridge discovery ---- */

function lanBridgeName() {
	/* The device the lan interface attaches to: explicit device option,
	   else the interface name itself if it is a bridge (br-lan). */
	var dev = uci.get('network', 'lan', 'device');
	if (dev) return String(dev).split(/\s+/)[0];
	var ifname = uci.get('network', 'lan', 'ifname');
	return ifname ? String(ifname).split(/\s+/)[0] : null;
}

/* True when the LAN itself rides a VLAN sub-interface (device "br-lan.1"
   or ifname "br-lan.1 eth0" style). Such setups are already segmented at
   the L2 level in a way this editor does not model — they must be shown
   as unsupported, never as "flat". */
function lanIsVlanSubinterface() {
	var name = lanBridgeName();
	return name != null && /^\w+\.\d+$/.test(name);
}

function findBridgeSection(bridgeName) {
	var found = null;
	uci.sections('network', 'device', function(s) {
		if (found) return;
		if (s.type !== 'bridge') return;
		if ((s.name || s['.name']) === bridgeName) found = s['.name'];
	});
	return found;
}

function bridgeVlanSections(bridgeName) {
	var out = [];
	uci.sections('network', 'bridge-vlan', function(s) {
		if (s.device === bridgeName) out.push(s['.name']);
	});
	return out;
}

function bridgePorts(bridgeSectionId, bridgeName) {
	var seen = {};
	L.toArray(uci.get('network', bridgeSectionId, 'ports')).forEach(function(p) { seen[p] = true; });
	uci.sections('network', 'bridge-vlan', function(bvs) {
		if (bvs.device !== bridgeName) return;
		vlanPorts(bvs['.name']).forEach(function(spec) {
			var parsed = parsePortSpec(spec);
			if (parsed) seen[parsed.port] = true;
		});
	});
	return Object.keys(seen).sort(L.naturalCompare);
}

/* ---- validation (mirror of native checkUnsupportedConfig) ---- */

function validateVlanMap(bridgeName) {
	var issues = [];
	var untaggedOwner = {};

	uci.sections('network', 'bridge-vlan', function(bvs) {
		if (bvs.device !== bridgeName) return;
		var vid = +bvs.vlan;
		if (!(vid >= VLAN_MIN && vid <= VLAN_MAX)) {
			issues.push(_('VLAN ID %s is outside the valid range 1–4094.').format(bvs.vlan));
			return;
		}
		vlanPorts(bvs['.name']).forEach(function(spec) {
			var parsed = parsePortSpec(spec);
			if (!parsed) {
				issues.push(_('Port specification "%s" on VLAN %d cannot be parsed.').format(spec, vid));
				return;
			}
			if (parsed.tagged && parsed.pvid)
				issues.push(_('Port "%s" has the primary VLAN flag together with tagged egress on VLAN %d.').format(parsed.port, vid));
			else if (parsed.tagged && parsed.untagged)
				issues.push(_('Port "%s" is both tagged and untagged on VLAN %d.').format(parsed.port, vid));
			else if (parsed.pvid && !parsed.tagged && !parsed.untagged)
				issues.push(_('Port "%s" is the primary VLAN on VLAN %d but has no untagged egress.').format(parsed.port, vid));

			if (parsed.untagged) {
				if (untaggedOwner[parsed.port] != null && untaggedOwner[parsed.port] !== vid)
					issues.push(_('Port "%s" is untagged on more than one VLAN (%d and %d).').format(parsed.port, untaggedOwner[parsed.port], vid));
				untaggedOwner[parsed.port] = vid;
			}
		});
	});

	return issues;
}

/* ---- segment naming helpers ---- */

function segmentInterfaceName(vid) { return 'lan' + vid; }
function segmentVlanSectionName(vid) { return 'wundr_vlan' + vid; }

/* The 8021q sub-interface netifd creates for a bridge-vlan is named
   "<bridge>.<vid>" — so "br-lan.10" on br-lan, but "br-foo.10" elsewhere.
   The prefix must follow the actual bridge, never a hardcoded name. */
function segmentDeviceName(bridgeName, vid) {
	return (bridgeName || 'br-lan') + '.' + vid;
}

function usedVids() {
	var used = {};
	uci.sections('network', 'bridge-vlan', function(s) {
		var vid = +s.vlan;
		if (vid >= VLAN_MIN && vid <= VLAN_MAX) used[vid] = true;
	});
	return used;
}

function usedInterfaceNames() {
	var used = {};
	uci.sections('network', 'interface', function(s) { used[s['.name']] = true; });
	return used;
}

function usedZoneNames() {
	var used = {};
	uci.sections('firewall', 'zone', function(s) {
		var n = s.name || s['.name'];
		used[n] = true;
	});
	return used;
}

function nextFreeVid(used) {
	for (var v = 10; v <= VLAN_MAX; v += 10)
		if (!used[v]) return v;
	for (var w = VLAN_MIN; w <= VLAN_MAX; w++)
		if (!used[w]) return w;
	return null;
}

function freeThirdOctet() {
	/* Segments use 192.168.<third>.1/24; avoid the LAN third and collisions. */
	var lanIp = uci.get('network', 'lan', 'ipaddr') || '';
	var lanThird = String(lanIp).split('.')[2];
	var used = {};
	uci.sections('network', 'interface', function(s) {
		var ip = s.ipaddr || '';
		var t = String(ip).split('.')[2];
		if (t != null && t !== '') used[t] = true;
	});
	for (var t = 0; t <= 255; t++) {
		var s = String(t);
		if (s !== lanThird && !used[s]) return s;
	}
	return null;
}

/* ---- mode detection ---- */

function detectMode() {
	var bridgeName = lanBridgeName();
	if (!bridgeName) return { mode: 'unknown', bridge: null, bridgeSection: null };
	if (lanIsVlanSubinterface())
		return { mode: 'unsupported', bridge: bridgeName, bridgeSection: null };
	var bridgeSection = findBridgeSection(bridgeName);
	var vlans = bridgeName ? bridgeVlanSections(bridgeName) : [];
	var filtering = bridgeSection && uci.get('network', bridgeSection, 'vlan_filtering') === '1';
	if (vlans.length || filtering)
		return { mode: 'vlan', bridge: bridgeName, bridgeSection: bridgeSection };
	return { mode: 'flat', bridge: bridgeName, bridgeSection: bridgeSection };
}

/* ---- guided segment creation (staged, atomic via native apply) ---- */

function createSegment(vid, name, subnet, dhcp, bridgeName) {
	/* 1. bridge-vlan section on the LAN bridge: no untagged ports until
	      the user assigns them in the matrix. */
	var vlanSid = uci.add('network', 'bridge-vlan', segmentVlanSectionName(vid));
	uci.set('network', vlanSid, 'device', bridgeName);
	uci.set('network', vlanSid, 'vlan', String(vid));

	/* 2. logical interface on <bridge>.<vid> */
	var ifSid = uci.add('network', 'interface', segmentInterfaceName(vid));
	uci.set('network', ifSid, 'device', segmentDeviceName(bridgeName, vid));
	uci.set('network', ifSid, 'proto', 'static');
	uci.set('network', ifSid, 'ipaddr', '192.168.' + subnet + '.1');
	uci.set('network', ifSid, 'netmask', '255.255.255.0');

	/* 3. firewall zone: forward to lan allowed (internet access), input
	   from the segment accepted (reach the router UI/DNS). */
	var zoneSid = uci.add('firewall', 'zone');
	uci.set('firewall', zoneSid, 'name', name);
	uci.set('firewall', zoneSid, 'network', segmentInterfaceName(vid));
	uci.set('firewall', zoneSid, 'input', 'ACCEPT');
	uci.set('firewall', zoneSid, 'output', 'ACCEPT');
	uci.set('firewall', zoneSid, 'forward', 'REJECT');

	var fwdSid = uci.add('firewall', 'forwarding');
	uci.set('firewall', fwdSid, 'src', name);
	uci.set('firewall', fwdSid, 'dest', 'lan');

	/* 4. DHCP pool on the new interface. Always keyed by the interface
	   name so removeSegment can find it; 'ignore' mode still creates the
	   section (with ignore=1) so the UI shows the pool as disabled. */
	if (dhcp) {
		var dhcpSid = uci.add('dhcp', 'dhcp', segmentInterfaceName(vid));
		if (dhcp === 'ignore')
			uci.set('dhcp', dhcpSid, 'ignore', '1');
		else if (dhcp === 'dhcp') {
			uci.set('dhcp', dhcpSid, 'start', '100');
			uci.set('dhcp', dhcpSid, 'limit', '150');
			uci.set('dhcp', dhcpSid, 'leasetime', '12h');
		}
		/* 'static' → section exists with no pool options; dnsmasq serves
		   nothing, static clients configure themselves. */
	}
}

function removeSegment(vid) {
	var ifName = segmentInterfaceName(vid);
	var vlanSid = segmentVlanSectionName(vid);

	uci.remove('network', vlanSid);

	/* firewall zone + forwardings bound to the interface */
	var zoneSids = [];
	uci.sections('firewall', 'zone', function(s) {
		if (L.toArray(s.network).indexOf(ifName) !== -1) zoneSids.push(s['.name']);
	});
	zoneSids.forEach(function(sid) {
		var zoneName = uci.get('firewall', sid, 'name');
		uci.sections('firewall', 'forwarding', function(f) {
			if (f.src === zoneName || f.dest === zoneName)
				uci.remove('firewall', f['.name']);
		});
		uci.remove('firewall', sid);
	});

	/* Detach SSIDs bound to this segment — a wifi-iface referencing a
	   dead network breaks the whole wireless config on reload. */
	uci.sections('wireless', 'wifi-iface', function(s) {
		var nets = L.toArray(s.network);
		if (nets.indexOf(ifName) === -1) return;
		var kept = nets.filter(function(n) { return n !== ifName; });
		if (kept.length)
			uci.set('wireless', s['.name'], 'network', kept.join(' '));
		else
			uci.set('wireless', s['.name'], 'network', 'lan');
	});

	uci.remove('network', ifName);
	uci.remove('dhcp', ifName);
}

/* ---- view ---- */

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'),
			uci.load('firewall'),
			uci.load('dhcp'),
			uci.load('wireless')
		]);
	},

	render: function() {
		var self = this;
		var state = detectMode();
		var bridgeName = state.bridge;
		var bridgeSection = state.bridgeSection;
		var isVlan = state.mode === 'vlan';
		var isUnsupported = state.mode === 'unsupported';

		/* ---------- unsupported topology (LAN on a VLAN subinterface) ---------- */
		if (isUnsupported) {
			return E('div', {}, [
				E('section', { 'class': 'wb-card wb-hero' }, [
					E('h2', { 'class': 'wb-h' }, _('Network topology')),
					E('div', { 'class': 'wb-sub' },
						_('The LAN interface is attached to a VLAN sub-interface (%s). This setup is already segmented at the bridge level in a way this editor does not model. Use the native LuCI network editor to manage it.').format(bridgeName)),
					E('div', { 'style': 'margin-top:12px' }, [
						E('a', { 'class': 'wb-btn primary', 'href': L.url('admin/network/network') }, _('Open native LuCI network editor'))
					])
				])
			]);
		}

		/* Physical ports of the bridge (fallback: common DSA names). */
		var ports = bridgeSection
			? bridgePorts(bridgeSection, bridgeName)
			: [ 'lan1', 'lan2', 'lan3', 'lan4', 'lan5' ];

		/* ---------- mode card ---------- */
		var modeCard = E('section', { 'class': 'wb-card wb-hero' }, [
			E('h2', { 'class': 'wb-h' }, _('Network topology')),
			E('div', { 'class': 'wb-sub' },
				_('Choose one flat network for everything, or split the router into isolated segments (VLANs) for guests, IoT, cameras and more. Changes apply through LuCI\'s standard confirm & apply with automatic rollback.')),
			E('div', { 'class': 'wb-hero-row', 'style': 'margin-top:12px' }, [
				E('div', { 'class': 'wb-stat' }, [
					E('b', {}, isVlan ? _('Segmented (VLANs)') : _('Flat network')),
					E('span', {}, _('Current mode'))
				]),
				E('div', { 'class': 'wb-stat' }, [
					E('b', {}, bridgeName || _('Unavailable')),
					E('span', {}, _('LAN bridge'))
				]),
				E('div', { 'class': 'wb-stat' }, [
					E('b', {}, String(bridgeVlanSections(bridgeName).length)),
					E('span', {}, _('Segments'))
				])
			])
		]);

		/* ---------- mode switch ---------- */
		var modeSwitch = E('div', { 'class': 'wb-card' }, [
			E('h3', { 'class': 'wb-h' }, _('Topology mode')),
			E('div', { 'class': 'wb-sub' },
				isVlan
					? _('The LAN bridge has VLAN filtering enabled. Switching back to flat removes all Wundr-managed segments and returns every port to the single LAN.')
					: _('All ports and Wi-Fi networks share one LAN. Enabling segmentation adds VLAN filtering to the bridge and lets you create isolated segments below.')),
			E('div', { 'style': 'margin-top:12px' }, [
				E('button', {
					'class': 'wb-btn' + (isVlan ? '' : ' primary'),
					'click': ui.createHandlerFn(self, function() {
						if (isVlan) return;
						self.enableVlanMode(bridgeSection);
					})
				}, [ isVlan ? _('Segmentation active') : _('Use a flat network') ]),
				' ',
				E('button', {
					'class': 'wb-btn' + (isVlan ? ' primary' : ''),
					'click': ui.createHandlerFn(self, function() {
						if (!isVlan) return;
						self.disableVlanMode(bridgeSection);
					})
				}, [ isVlan ? _('Return to flat network') : _('Segment the network (VLANs)') ])
			])
		]);

		/* ---------- segment matrix (VLAN mode only) ---------- */
		var matrixCard = null;
		if (isVlan) {
			var vlans = [];
			uci.sections('network', 'bridge-vlan', function(s) {
				if (s.device !== bridgeName) return;
				/* Skip malformed entries (missing / non-numeric / out of range
				   vlan) — validateVlanMap already surfaces them in the issue
				   box; rendering an editable row with a NaN VID is useless. */
				var v = +s.vlan;
				if (v >= VLAN_MIN && v <= VLAN_MAX) vlans.push(s);
			});
			vlans.sort(function(a, b) { return (+a.vlan) - (+b.vlan); });

			var header = [ E('th', {}, _('VLAN ID')), E('th', {}, _('Name')) ];
			ports.forEach(function(p) { header.push(E('th', { 'class': 'mono' }, p)); });
			header.push(E('th', {}, _('Interface')));
			header.push(E('th', {}, _('Actions')));

			var rows = vlans.map(function(v) {
				var vid = +v.vlan;
				var managed = /^wundr_vlan\d+$/.test(v['.name']);
				var specByPort = {};
				vlanPorts(v['.name']).forEach(function(spec) {
					var parsed = parsePortSpec(spec);
					if (parsed) specByPort[parsed.port] = parsed;
				});

				var zoneSid = self.zoneForInterface(segmentInterfaceName(vid));
				var zoneName = zoneSid ? (uci.get('firewall', zoneSid, 'name') || '') : '';

				/* Column order must match the header: ID, Name, ports…, Interface, Actions. */
				var cells = [ E('td', { 'class': 'name mono' }, String(vid)) ];

				cells.push(managed
					? E('td', {}, [
						E('input', {
							'class': 'wb-input', 'type': 'text',
							'value': zoneName,
							'placeholder': _('Zone name'),
							'style': 'max-width:140px',
							'change': ui.createHandlerFn(self, function(ev) {
								self.renameZone(segmentInterfaceName(vid), ev.target.value);
							})
						})
					])
					: E('td', {}, E('span', { 'class': 'wb-sub' }, '—')));

				ports.forEach(function(p) {
					var parsed = specByPort[p];
					var tagged = parsed && parsed.tagged;
					var untagged = parsed && parsed.untagged;
					var pvid = parsed && parsed.pvid;
					cells.push(E('td', {}, [
						E('button', {
							'class': 'wb-btn' + (tagged ? ' primary' : ''),
							'style': 'padding:2px 8px;font-size:11px',
							'title': _('Toggle tagged (trunk)'),
							'click': ui.createHandlerFn(self, function() {
								self.togglePort(v['.name'], p, 'tagged', tagged);
							})
						}, [ 'T' ]),
						' ',
						E('button', {
							'class': 'wb-btn' + (untagged ? ' primary' : ''),
							'style': 'padding:2px 8px;font-size:11px',
							'title': _('Toggle untagged (access). One untagged VLAN per port.'),
							'click': ui.createHandlerFn(self, function() {
								self.togglePort(v['.name'], p, 'untagged', untagged);
							})
						}, [ 'U' ]),
						pvid ? E('span', { 'class': 'wb-pill', 'style': 'margin-left:4px' }, 'PVID') : E([])
					]));
				});

				cells.push(E('td', { 'class': 'mono' }, segmentDeviceName(bridgeName, vid)));
				cells.push(E('td', {}, [
					(/^wundr_vlan\d+$/.test(v['.name'])
						? E('button', {
								'class': 'wb-btn',
								'style': 'padding:2px 8px;font-size:11px',
								'click': ui.createHandlerFn(self, function() {
									self.removeSegmentFlow(vid);
								})
							}, [ _('Remove') ])
						: E('span', { 'class': 'wb-sub', 'title': _('This segment was created outside Wundr; edit or remove it in the native LuCI network editor.') },
							_('Native')))
				]));

				return E('tr', {}, cells);
			});

			var issues = validateVlanMap(bridgeName);
			var issueBox = issues.length
				? E('div', { 'class': 'wb-form-error', 'style': 'margin-top:10px' }, [
					E('b', {}, _('Configuration issues:')),
					E('ul', {}, issues.map(function(i) { return E('li', {}, i); }))
				  ])
				: null;

			matrixCard = E('section', { 'class': 'wb-card', 'style': 'margin-top:14px' }, [
				E('div', { 'class': 'wb-pagetitle' }, [
					E('h3', { 'class': 'wb-h' }, _('Segment port matrix')),
					E('button', {
						'class': 'wb-btn primary',
						'click': ui.createHandlerFn(self, self.addSegmentFlow)
					}, [ _('Add segment') ])
				]),
				E('div', { 'class': 'wb-sub' },
					_('T = tagged (trunk to another switch/AP). U = untagged (access port). Each physical port may be untagged on exactly one VLAN — that becomes its native network.')),
				E('div', { 'class': 'wb-table-scroll', 'style': 'margin-top:10px' }, [
					E('table', { 'class': 'wb-table' }, [
						E('thead', {}, [ E('tr', {}, header) ]),
						E('tbody', {}, rows.length ? rows : [ E('tr', {}, [ E('td', { 'class': 'wb-empty', 'colspan': String(header.length) }, _('No segments yet. Add one below.')) ]) ])
					])
				]),
				issueBox
			]);
		}

		/* ---------- Wi-Fi binding hint ---------- */
		var wifiCard = E('section', { 'class': 'wb-card', 'style': 'margin-top:14px' }, [
			E('h3', { 'class': 'wb-h' }, _('Wi-Fi networks')),
			E('div', { 'class': 'wb-sub' }, [
				_('Each SSID can be attached to the flat LAN or to one of the segments via its Network setting. '),
				E('a', { 'href': L.url('wundr/network/wifi-config') }, _('Open Wi-Fi settings →'))
			])
		]);

		return E('div', {}, [ modeCard, modeSwitch, matrixCard, wifiCard ].filter(function(n) { return n; }));
	},

	/* ---- flows ---- */

	/* Upload locally-staged uci changes to the server, then run the
	   rollback-capable apply. uci.save() is REQUIRED: uci.set() only stages
	   in browser memory; without save() the apply would commit nothing.
	   Checked apply gives the 90s connectivity guard — if a VLAN change
	   locks the user out, the router auto-reverts. A failed save (ACL
	   rejection, session expiry) surfaces in a modal, mirroring the
	   native form.Map.save error handling. */
	applyStaged: function() {
		return uci.save().then(function() {
			return ui.changes.apply(true);
		}).catch(function(e) {
			ui.showModal(_('Save error'), [
				E('p', {}, _('An error occurred while saving the configuration:')),
				E('p', {}, [ E('em', { 'style': 'white-space:pre-wrap' }, (e && e.message) || String(e)) ]),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Dismiss') ])
				])
			]);
		});
	},

	enableVlanMode: function(bridgeSection) {
		if (!bridgeSection) {
			ui.hideModal();
			ui.showModal(_('Cannot enable segmentation'), [
				E('p', {}, _('The LAN interface is not attached to a managed bridge device. Configure a bridge in native LuCI first.')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Dismiss') ])
				])
			]);
			return;
		}
		uci.set('network', bridgeSection, 'vlan_filtering', '1');
		return this.applyStaged();
	},

	disableVlanMode: function(bridgeSection) {
		var self = this;
		var bridgeName = lanBridgeName();
		var vlans = bridgeVlanSections(bridgeName);
		var managed = vlans.filter(function(sid) {
			return /^wundr_vlan\d+$/.test(sid);
		});

		ui.showModal(_('Return to flat network'), [
			E('p', {}, _('This removes %d segment(s) and their firewall zones, DHCP pools and Wi-Fi bindings, then disables VLAN filtering on %s. Devices connected through a segment will lose connectivity until they reconnect to the main network.').format(managed.length, bridgeName)),
			E('p', {}, _('Third-party VLAN sections (not created by Wundr) are kept but will no longer take effect once filtering is off.')),
			E('div', { 'class': 'button-row' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(self, function() {
						managed.forEach(function(sid) {
							var vid = String(sid).replace(/^wundr_vlan/, '');
							if (/^\d+$/.test(vid)) removeSegment(+vid);
							else uci.remove('network', sid);
						});
						uci.set('network', bridgeSection, 'vlan_filtering', '0');
						ui.hideModal();
						return self.applyStaged();
					})
				}, [ _('Confirm') ])
			])
		]);
	},

	addSegmentFlow: function() {
		var self = this;
		var used = usedVids();
		var ifNames = usedInterfaceNames();
		var zones = usedZoneNames();
		var vid = nextFreeVid(used);
		var third = freeThirdOctet();

		var vidInput = E('input', { 'class': 'wb-input', 'type': 'number', 'min': String(VLAN_MIN), 'max': String(VLAN_MAX), 'value': vid != null ? String(vid) : '' });
		var nameInput = E('input', { 'class': 'wb-input', 'type': 'text', 'value': '', 'placeholder': _('e.g. Guest, IoT, Cameras') });
		var thirdInput = E('input', { 'class': 'wb-input', 'type': 'text', 'value': third || '', 'placeholder': 'e.g. 20' });
		var dhcpSelect = E('select', { 'class': 'wb-input' }, [
			E('option', { 'value': 'dhcp' }, _('DHCP server on this segment')),
			E('option', { 'value': 'static' }, _('No DHCP (static clients only)')),
			E('option', { 'value': 'ignore' }, _('DHCP relay / external server'))
		]);

		function row(label, input, help) {
			return E('div', { 'class': 'wb-form-row' }, [
				E('span', { 'class': 'wb-form-label' }, [ label, help ? E('div', { 'class': 'wb-help' }, help) : E([]) ]),
				input
			]);
		}

		var errBox = E('div', { 'class': 'wb-form-error', 'style': 'display:none' });

		function validate(v, nm, t) {
			if (!/^\d+$/.test(v) || +v < VLAN_MIN || +v > VLAN_MAX)
				return _('VLAN ID must be between 1 and 4094.');
			if (used[+v])
				return _('VLAN ID %d is already in use.').format(+v);
			if (!/^[A-Za-z0-9_]{1,11}$/.test(nm))
				return _('Name must be 1–11 letters, digits or underscores (firewall zone limit).');
			if (zones[nm])
				return _('A firewall zone with that name already exists.');
			if (ifNames[segmentInterfaceName(+v)])
				return _('Interface %s already exists.').format(segmentInterfaceName(+v));
			if (!/^\d{1,3}$/.test(t) || +t > 255)
				return _('Third octet must be 0–255.');
			if (t === String(uci.get('network', 'lan', 'ipaddr') || '').split('.')[2])
				return _('That octet is used by the main LAN subnet.');
			return null;
		}

		ui.showModal(_('Add network segment'), [
			E('p', { 'class': 'wb-sub' }, _('Creates the bridge VLAN, logical interface, firewall zone and DHCP pool in one staged batch. Nothing is applied until you confirm the standard apply dialog.')),
			row(_('VLAN ID (1–4094)'), vidInput, _('The 802.1Q tag carried on trunk links.')),
			row(_('Segment name'), nameInput, _('Used as the firewall zone name.')),
			row(_('Subnet third octet'), thirdInput, _('The segment uses 192.168.<this>.0/24 with the router at .1.')),
			row(_('Address assignment'), dhcpSelect, null),
			errBox,
			E('div', { 'class': 'button-row', 'style': 'margin-top:14px' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(self, function() {
						var v = vidInput.value, nm = nameInput.value.trim(), t = thirdInput.value.trim();
						var problem = validate(v, nm, t);
						if (problem) {
							errBox.textContent = problem;
							errBox.style.display = 'block';
							return;
						}
						createSegment(+v, nm, t, dhcpSelect.value, lanBridgeName());
						ui.hideModal();
						return self.applyStaged();
					})
				}, [ _('Create segment') ])
			])
		]);
	},

	removeSegmentFlow: function(vid) {
		var self = this;
		ui.showModal(_('Remove segment %d').format(vid), [
			E('p', {}, _('Removes the bridge VLAN, interface, firewall zone, forwardings and DHCP pool for VLAN %d. Clients on this segment lose connectivity.').format(vid)),
			E('div', { 'class': 'button-row' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button-negative important',
					'click': ui.createHandlerFn(self, function() {
						removeSegment(vid);
						ui.hideModal();
						return self.applyStaged();
					})
				}, [ _('Remove') ])
			])
		]);
	},

	/* ---- matrix cell handlers (anti-stacking port writer) ---- */

	togglePort: function(vlanSid, port, role, currentlyOn) {
		var self = this;
		var bridgeName = lanBridgeName();

		/* Turning U on: the port must not be untagged on another VLAN
		   (one untagged VLAN per port = its PVID). Steal it with a clear
		   confirmation rather than creating an invalid double-untagged map. */
		if (!currentlyOn && role === 'untagged') {
			var owner = this.untaggedOwner(bridgeName, port);
			if (owner != null && owner !== vlanSid) {
				var ownerVid = uci.get('network', owner, 'vlan');
				ui.showModal(_('Port already assigned'), [
					E('p', {}, _('Port %s is already untagged on VLAN %s. A port can only be untagged on one VLAN — that VLAN becomes the port\'s native network. Move it?').format(port, ownerVid)),
					E('div', { 'class': 'button-row' }, [
						E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
						E('button', {
							'class': 'btn cbi-button-action important',
							'click': ui.createHandlerFn(self, function() {
								ui.hideModal();
								self.stealUntagged(owner, port);
								self.setPortSpec(vlanSid, port, role);
								return self.applyStaged();
							})
						}, [ _('Move to VLAN %s').format(uci.get('network', vlanSid, 'vlan')) ])
					])
				]);
				return;
			}
		}

		this.setPortSpec(vlanSid, port, currentlyOn ? null : role);
		return this.applyStaged();
	},

	/* Which bridge-vlan section currently owns the untagged (PVID) role
	   for this port. Returns section id or null. */
	untaggedOwner: function(bridgeName, port) {
		var owner = null;
		uci.sections('network', 'bridge-vlan', function(bvs) {
			if (owner || bvs.device !== bridgeName) return;
			var specs = vlanPorts(bvs['.name']);
			for (var i = 0; i < specs.length; i++) {
				var parsed = parsePortSpec(specs[i]);
				if (parsed && parsed.port === port && parsed.untagged) {
					owner = bvs['.name'];
					return;
				}
			}
		});
		return owner;
	},

	/* Remove the port's spec from the owning VLAN section. */
	stealUntagged: function(ownerSid, port) {
		var specs = vlanPorts(ownerSid).filter(function(spec) {
			var parsed = parsePortSpec(spec);
			return !(parsed && parsed.port === port && parsed.untagged);
		});
		if (specs.length)
			uci.set('network', ownerSid, 'ports', specs.sort(L.naturalCompare));
		else
			uci.unset('network', ownerSid, 'ports');
	},

	/* Set or clear one port's role on one VLAN, preserving any coexisting
	   role (e.g. clearing U on a foreign "t*" spec keeps the tagged part).
	   spec == null clears the port's entry entirely. */
	setPortSpec: function(vlanSid, port, role) {
		var specs = vlanPorts(vlanSid).slice();
		var parsedSpecs = specs.map(parsePortSpec);
		var idx = -1;
		for (var i = 0; i < parsedSpecs.length; i++)
			if (parsedSpecs[i] && parsedSpecs[i].port === port) { idx = i; break; }

		if (role == null) {
			/* Clear: drop the whole spec for this port. */
			if (idx !== -1) specs.splice(idx, 1);
		} else if (role === 'tagged') {
			/* Tagged replaces any untagged role (a port cannot be both). */
			var spec = formatPortSpec(port, true, false);
			if (idx !== -1) specs[idx] = spec; else specs.push(spec);
		} else {
			/* Untagged: always carries PVID. */
			var uspec = formatPortSpec(port, false, true);
			if (idx !== -1) specs[idx] = uspec; else specs.push(uspec);
		}

		if (specs.length)
			uci.set('network', vlanSid, 'ports', specs.sort(L.naturalCompare));
		else
			uci.unset('network', vlanSid, 'ports');
	},

	renameZone: function(ifName, newName) {
		var self = this;
		newName = String(newName || '').trim();
		if (!/^[A-Za-z0-9_]{1,11}$/.test(newName)) {
			ui.showModal(_('Invalid zone name'), [
				E('p', {}, _('Use 1–11 letters, digits or underscores.')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Dismiss') ])
				])
			]);
			return;
		}
		var zoneSid = this.zoneForInterface(ifName);
		if (!zoneSid) return;

		var oldName = uci.get('firewall', zoneSid, 'name') || zoneSid;
		if (newName === oldName) return;

		/* Zone names must be unique across firewall config. */
		var clash = null;
		uci.sections('firewall', 'zone', function(s) {
			if (s['.name'] !== zoneSid && (s.name || s['.name']) === newName)
				clash = true;
		});
		if (clash) {
			ui.showModal(_('Name already in use'), [
				E('p', {}, _('A firewall zone with that name already exists.')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, [ _('Dismiss') ])
				])
			]);
			return;
		}

		/* Forwardings reference zones BY NAME — rename them too, or the
		   segment silently loses its internet access. */
		uci.set('firewall', zoneSid, 'name', newName);
		uci.sections('firewall', 'forwarding', function(f) {
			if (f.src === oldName)
				uci.set('firewall', f['.name'], 'src', newName);
			if (f.dest === oldName)
				uci.set('firewall', f['.name'], 'dest', newName);
		});
		return this.applyStaged();
	},

	zoneForInterface: function(ifName) {
		var found = null;
		uci.sections('firewall', 'zone', function(s) {
			if (found) return;
			if (L.toArray(s.network).indexOf(ifName) !== -1) found = s['.name'];
		});
		return found;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
