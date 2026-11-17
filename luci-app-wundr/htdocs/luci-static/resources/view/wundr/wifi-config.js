'use strict';
'require view';
'require form';
'require uci';
'require rpc';

/* Wundr Wi-Fi — native configuration editor over /etc/config/wireless.
 * Writes flow through LuCI's standard UCI apply (validated + rollback).
 * Field set mirrors the vendor advanced page: mode, channel, width,
 * power, country, isolation, hidden. Each SSID can also be attached to
 * a network (flat LAN or a VLAN segment) via the native `network` option. */

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wireless'),
			uci.load('network')
		]);
	},

	render: function() {
		var m, s, o;

		m = new form.Map('wireless', _('Wi-Fi Radios & Networks'),
			_('Per-radio settings and SSIDs. Changes apply through LuCI\'s ' +
			  'standard confirm & apply — the radios reload safely.'));

		/* ---- Radio hardware (one section per wifi-device) ---- */
		s = m.section(form.GridSection, 'wifi-device', _('Radios'));
		s.addremove = false;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'disabled', _('Radio disabled'),
			_('Turn off this radio entirely.'));
		o.default = '0';

		o = s.option(form.ListValue, 'band', _('Band'));
		o.value('2g', _('2.4 GHz'));
		o.value('5g', _('5 GHz'));
		o.value('6g', _('6 GHz'));
		o.rmempty = true;

		o = s.option(form.ListValue, 'htmode', _('Channel width / mode'),
			_('Values are generation-prefixed (HT=n, VHT=ac, HE=ax, EHT=be). ' +
			  'Only modes the radio supports are accepted; leave unset for the driver default.'));
		o.value('', _('Driver default'));
		o.value('HT20', _('HT20 — 20 MHz (n)'));
		o.value('HT40', _('HT40 — 40 MHz (n)'));
		o.value('VHT40', _('VHT40 — 40 MHz (ac)'));
		o.value('VHT80', _('VHT80 — 80 MHz (ac)'));
		o.value('VHT160', _('VHT160 — 160 MHz (ac)'));
		o.value('HE20', _('HE20 — 20 MHz (ax)'));
		o.value('HE40', _('HE40 — 40 MHz (ax)'));
		o.value('HE80', _('HE80 — 80 MHz (ax)'));
		o.value('HE160', _('HE160 — 160 MHz (ax)'));
		o.value('EHT20', _('EHT20 — 20 MHz (be)'));
		o.value('EHT40', _('EHT40 — 40 MHz (be)'));
		o.value('EHT80', _('EHT80 — 80 MHz (be)'));
		o.value('EHT160', _('EHT160 — 160 MHz (be)'));
		o.value('EHT320', _('EHT320 — 320 MHz (be, 6 GHz)'));
		o.rmempty = true;

		o = s.option(form.Value, 'country', _('Country code'),
			_('Regulatory domain. Determines allowed channels and power.'));
		o.default = '00';
		o.rmempty = true;

		o = s.option(form.Value, 'channel', _('Channel'),
			_('Auto (or auto with a list like "auto") lets the router pick. ' +
			  'Fixed channels bypass ACS/DFS. Values depend on band and country.'));
		o.default = 'auto';
		o.datatype = 'or("auto", uinteger)';
		o.rmempty = true;

		o = s.option(form.ListValue, 'txpower', _('Transmit power (dBm)'),
			_('Leave unset for the regulatory maximum.'));
		o.value('', _('Auto (max)'));
		for (var p = 30; p >= 4; p -= 2)
			o.value(String(p), String(p) + ' dBm');
		o.rmempty = true;

		/* ---- SSIDs (one section per wifi-iface) ---- */
		s = m.section(form.GridSection, 'wifi-iface', _('Networks (SSIDs)'));
		s.addremove = true;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'disabled', _('SSID disabled'));
		o.default = '0';

		o = s.option(form.Value, 'ssid', _('Network name (SSID)'));
		o.rmempty = false;

		o = s.option(form.Flag, 'hidden', _('Hide SSID'),
			_('Hidden networks are not broadcast; clients must know the name.'));
		o.default = '0';

		o = s.option(form.Flag, 'isolate', _('Client isolation'),
			_('Clients on this SSID cannot see each other. Recommended for guest networks.'));
		o.default = '0';

		o = s.option(form.ListValue, 'encryption', _('Encryption'));
		o.value('none', _('Open (no encryption)'));
		o.value('psk2', _('WPA2-PSK'));
		o.value('psk-mixed', _('WPA2/WPA3-PSK'));
		o.value('sae-mixed', _('WPA3-SAE (transition)'));
		o.value('sae', _('WPA3-SAE only'));
		o.default = 'psk-mixed';

		o = s.option(form.Value, 'key', _('Network key'),
			_('Minimum 8 characters for WPA2/WPA3.'));
		o.password = true;
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.depends('encryption', 'sae-mixed');
		o.depends('encryption', 'sae');
		o.validate = function(section_id, value) {
			var enc = uci.get('wireless', section_id, 'encryption');
			if (enc === 'none' || value == null || value === '') return true;
			return value.length >= 8 ? true : _('Key must be at least 8 characters');
		};

		o = s.option(form.ListValue, 'device', _('Radio'),
			_('Which radio this network runs on.'));
		uci.sections('wireless', 'wifi-device', function(dev) {
			o.value(dev['.name'], dev['.name'] + (dev.band ? ' (' + dev.band + ')' : ''));
		});
		o.rmempty = false;

		/* ---- Network attach: flat LAN or a VLAN segment ----
		   UCI stores this as ONE space-separated string ("lan guest" or a
		   single "lan"); native LuCI reads it via L.toArray + split(/\s+/)
		   and writes it back with join(' '). A plain ListValue would write a
		   scalar and silently DROP extra networks, so we read the first
		   token for display and re-join all tokens on write. */
		o = s.option(form.ListValue, 'network', _('Network / segment'),
			_('Which network this SSID bridges into. "lan" is the flat network; ' +
			  'lan<VLAN> entries are isolated segments managed under Network → Flat / VLAN Mode. ' +
			  'Guest and IoT SSIDs should attach to their own segment.'));
		o.value('lan', _('LAN (flat network)'));
		uci.sections('network', 'interface', function(ifc) {
			var id = ifc['.name'];
			if (id === 'lan' || id === 'loopback' || /^wan/.test(id)) return;
			var label = id;
			var m = /^lan(\d+)$/.exec(id);
			if (m) label = 'VLAN ' + m[1] + ' (' + id + ')';
			o.value(id, label);
		});
		o.rmempty = false;
		o.default = 'lan';
		o.cfgvalue = function(section_id) {
			var raw = uci.get('wireless', section_id, 'network') || 'lan';
			return String(raw).split(/\s+/)[0] || 'lan';
		};
		o.write = function(section_id, formvalue) {
			var raw = String(uci.get('wireless', section_id, 'network') || '').trim();
			var extra = raw.split(/\s+/).slice(1).filter(function(t) { return t; });
			var nets = [formvalue].concat(extra);
			uci.set('wireless', section_id, 'network', nets.join(' '));
		};

		return m.render();
	}
});
