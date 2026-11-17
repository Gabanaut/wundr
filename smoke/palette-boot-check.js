'use strict';
/* Palette-boot functional check — runs palette-boot.js outside a browser
 * (jsdom-free): verifies script syntax, the mode-dependent Graphite branch,
 * and that every saved palette id produces all six token properties.
 * Browsers exercise it for real via extras/browser-smoke/index.html. */
var fs = require('fs');
var vm = require('vm');

var code = fs.readFileSync('luci-theme-wundr/htdocs/luci-static/wundr/palette-boot.js', 'utf8');
var failures = [];

function bootWith(saved, theme, studio) {
	var props = {};
	var sandbox = {
		window: {},
		document: {
			documentElement: {
				style: { setProperty: function (k, v) { props[k] = v; } },
				getAttribute: function (attr) {
					if (attr === 'data-studio') return studio || 'current';
					return theme;
				}
			}
		},
		localStorage: { getItem: function () { return saved; } }
	};
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox);
	return { props: props, api: sandbox.window.wbPaletteBoot };
}

/* 1. default Splunk in Classic ('current'), light */
var r = bootWith(null, 'light', 'current');
['--wb-accent', '--wb-accent-2', '--wb-accent-text', '--wb-on-accent', '--wb-accent-soft', '--wb-grad']
	.forEach(function (k) { if (r.props[k] == null) failures.push('default boot missing ' + k); });
if (r.props['--wb-accent'] !== '#f48120') failures.push('default accent wrong: ' + r.props['--wb-accent']);
if (r.props['--wb-accent-text'] !== '#a05515') failures.push('default accent-text wrong: ' + r.props['--wb-accent-text']);

/* 1b. Nordic & Kyoto with no custom palette saved keep their CSS studio accents untouched */
var rNordic = bootWith(null, 'dark', 'nordic');
if (Object.keys(rNordic.props).length !== 0)
	failures.push('nordic without saved palette should preserve native CSS studio tokens');
var rKyotoCustom = bootWith('Splunk', 'light', 'kyoto');
if (rKyotoCustom.props['--wb-accent-text'] !== '#904c13')
	failures.push('kyoto + Splunk light must use #904c13 AA text override, got: ' + rKyotoCustom.props['--wb-accent-text']);

/* 2. saved Honey, dark: text must be the vivid accent (dark-mode mapping) */
r = bootWith('Honey', 'dark');
if (r.props['--wb-accent-text'] !== '#e09f3e') failures.push('dark Honey accent-text should be accent: ' + r.props['--wb-accent-text']);
if (r.props['--wb-accent-soft'] !== 'rgba(224, 159, 62, 0.18)') failures.push('dark Honey soft wrong: ' + r.props['--wb-accent-soft']);

/* 3. Graphite (Uber) light: accent == text == #0a0a0a, on == #ffffff, surfaces applied */
r = bootWith('Uber', 'light');
if (r.props['--wb-accent'] !== '#0a0a0a' || r.props['--wb-accent-text'] !== '#0a0a0a')
	failures.push('Uber light accent/text wrong: ' + r.props['--wb-accent'] + ' / ' + r.props['--wb-accent-text']);
if (r.props['--wb-on-accent'] !== '#ffffff') failures.push('Uber light on-accent wrong');
if (r.props['--wb-bg'] !== '#f7f7f7' || r.props['--wb-surface'] !== '#ffffff')
	failures.push('Uber light surfaces missing in palette-boot');

/* 4. Graphite (Uber) dark: #f2f2f2 accent + #050505/#0f0f0f surfaces */
r = bootWith('Uber', 'dark');
if (r.props['--wb-accent'] !== '#f2f2f2') failures.push('Uber dark accent wrong: ' + r.props['--wb-accent']);
if (r.props['--wb-bg'] !== '#050505' || r.props['--wb-surface'] !== '#0f0f0f')
	failures.push('Uber dark surfaces missing in palette-boot');

/* 5. shell.js PALETTES ids (8 including Uber) and boot ids (7 + Uber branch) must match */
var shell = fs.readFileSync('luci-theme-wundr/htdocs/luci-static/wundr/shell.js', 'utf8');
var shellIds = shell.match(/id: '([^']+)'/g).map(function (s) { return s.match(/'([^']+)'/)[1]; });
var bootCode = fs.readFileSync('luci-theme-wundr/htdocs/luci-static/wundr/palette-boot.js', 'utf8');
var bootIds = Object.keys(r.api.palettes);
if (bootCode.indexOf("id === 'Uber'") >= 0) bootIds.push('Uber');
if (shellIds.indexOf('Uber') < 0) failures.push('Uber missing from shell.js PALETTES (hidden from popover)');
shellIds.sort(); bootIds.sort();
if (JSON.stringify(shellIds) !== JSON.stringify(bootIds))
	failures.push('palette id drift: shell=' + shellIds.join(',') + ' boot=' + bootIds.join(','));

/* 6. per-palette t values in boot must equal t values in shell (source of truth parity) */
shellIds.forEach(function (id) {
	if (id === 'Uber') return;
	var row = new RegExp("id: '" + id + "',[^}]*t: '(#[0-9a-f]{6})'").exec(shell);
	var brow = new RegExp(id + ":\\s*\\{[^}]*t: '(#[0-9a-f]{6})'").exec(bootCode);
	if (row && brow && row[1].toLowerCase() !== brow[1].toLowerCase())
		failures.push(id + ' t mismatch: shell ' + row[1] + ' vs boot ' + brow[1]);
});

if (failures.length) {
	console.error('palette-boot: FAIL\n  ' + failures.join('\n  '));
	process.exit(1);
}
console.log('palette-boot: PASS (defaults, dark mapping, Graphite both modes, id parity, value parity)');
