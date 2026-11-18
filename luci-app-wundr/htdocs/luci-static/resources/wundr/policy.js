'use strict';
'require baseclass';
'require network';
'require rpc';
'require uci';

var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

function unique(values) { return Array.from(new Set(values)); }

function scope(leases, stations, uplinks) {
	var zones = uci.sections('firewall', 'zone');
	function zoneFor(iface) {
		if (!iface) return null;
		var matches = zones.filter(function(zone) {
			return L.toArray(zone.network).some(function(net) { return net === iface || uci.get('network', net, 'device') === iface; }) || L.toArray(zone.device).includes(iface);
		});
		return matches.length === 1 ? matches[0].name || null : null;
	}
	var byMac = new Map();
	(leases || []).forEach(function(lease) {
		if (!lease || lease.expires === 0 || !lease.macaddr || !lease.interface) return;
		var mac = String(lease.macaddr).toUpperCase();
		byMac.set(mac, (byMac.get(mac) || []).concat(lease.interface));
	});
	function source(mac) {
		mac = String(mac).toUpperCase();
		var station = stations[mac];
		var interfaces = station ? station.networks : byMac.get(mac) || [];
		var found = unique(interfaces.map(zoneFor));
		return found.length === 1 ? found[0] : null;
	}
	var destinations = unique(uplinks.map(zoneFor));
	return { leases: leases, stations: stations, source: source, uplinks: destinations.includes(null) ? [] : destinations };
}

function read() {
	return Promise.all([ uci.load('network'), uci.load('firewall'), L.resolveDefault(network.flushCache(), null) ]).then(function() {
		return Promise.all([ L.resolveDefault(callLeases(), null), L.resolveDefault(network.getWifiNetworks(), []),
			L.resolveDefault(network.getWANNetworks(), null), L.resolveDefault(network.getWAN6Networks(), null) ]);
	}).then(function(data) {
		var leases = data[0] && Array.isArray(data[0].dhcp_leases) ? data[0].dhcp_leases : null;
		var radios = data[1].filter(function(net) { return net.getMode() === 'ap'; });
		return Promise.all(radios.map(function(net) { return L.resolveDefault(net.getAssocList(), []); })).then(function(lists) {
			var stations = Object.create(null);
			lists.forEach(function(list, index) {
				var net = radios[index], names = net.getNetworkNames();
				list.forEach(function(item) {
					if (!item.mac) return;
					var mac = String(item.mac).toUpperCase(), prev = stations[mac];
					stations[mac] = { ssid: net.getActiveSSID(), signal: item.signal, networks: unique((prev ? prev.networks : []).concat(names)) };
				});
			});
			var routes = data[2] && data[3] ? data[2].concat(data[3]) : [];
			return scope(leases, stations, unique(routes.map(function(net) { return net.getName(); })));
		});
	});
}

function matches(rule, mac, source, uplinks) {
	return !!source && (rule.src === source || rule.src === '*') && uplinks.includes(rule.dest) &&
		!/^(0|off|no|false)$/i.test(rule.enabled) && /^(DROP|REJECT)$/i.test(rule.target) &&
		L.toArray(rule.src_mac).some(function(value) { return String(value).toUpperCase() === String(mac).toUpperCase(); });
}

function targets(macs, state) {
	if (!macs.length || !state.uplinks.length) return null;
	var groups = new Map();
	for (var mac of unique(macs)) {
		var zone = state.source(mac);
		if (!zone || state.uplinks.includes(zone)) return null;
		groups.set(zone, (groups.get(zone) || []).concat(mac));
	}
	var result = [];
	groups.forEach(function(members, zone) { state.uplinks.forEach(function(dest) { result.push({ src: zone, dest: dest, src_mac: members }); }); });
	return result;
}

function replaceRules(ownedNames, name, paths, times) {
	uci.sections('firewall', 'rule').filter(function(rule) { return ownedNames.includes(rule.name); }).forEach(function(rule) { uci.remove('firewall', rule['.name']); });
	paths.forEach(function(path) {
		(times || [{}]).forEach(function(time) {
			var sid = uci.add('firewall', 'rule');
			var options = Object.assign({ name: name, target: 'REJECT', proto: 'all' }, path, time);
			Object.keys(options).forEach(function(key) { uci.set('firewall', sid, key, options[key]); });
		});
	});
}

return baseclass.extend({ read: read, scope: scope, matches: matches, targets: targets, replaceRules: replaceRules });