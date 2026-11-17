'use strict';
/* Wundr contrast harness — verifies WCAG AA for every text token pairing the
 * theme actually renders (soft pills are measured on the REAL blended color).
 * Run: node smoke/contrast-check.js   (exit 1 on any FAIL)
 * Pairing set mirrors smoke/contrast-check.js docs in docs/PACKAGING.md. */

function hexToRgb(h) {
	h = h.replace('#', '');
	if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) { var r = hexToRgb(hex); return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]); }
function contrast(a, b) { var x = lum(a), y = lum(b); if (x < y) { var t = x; x = y; y = t; } return (x + 0.05) / (y + 0.05); }
function blend(fg, alpha, bg) {
	var f = hexToRgb(fg), b = hexToRgb(bg);
	var c = f.map(function (v, i) { return Math.round(alpha * v + (1 - alpha) * b[i]); });
	return '#' + c.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}
function darken(hex, f) {
	return '#' + hexToRgb(hex).map(function (v) { return Math.round(v * f); })
		.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}
function brighten(hex, f) {
	return '#' + hexToRgb(hex).map(function (v) { return Math.min(255, Math.round(v + (255 - v) * f)); })
		.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}

var LIGHT = { white: '#ffffff', s2: '#f7f8fa', surface: '#171a22' };
var DARK_SURFACE = '#171a22';

var PALETTES = { Splunk: '#f48120', Aurora: '#5b5fe8', Robinhood: '#12a150', UniFi: '#0065ff', FT: '#1c4f9e', Honey: '#e09f3e', Nordic: '#5fa8bd', Graphite: '#0a0a0a' };

/* accentLightText() replica — MUST stay in sync with shell.js (iterative
 * darken by 0.90, same acceptance targets) and the precomputed values in
 * shell.js/palette-boot.js. */
function accentText(accent) {
	var t = accent, i = 0;
	function ok(x) {
		return contrast(x, LIGHT.white) >= 4.5 && contrast(x, LIGHT.s2) >= 4.5 &&
			contrast(x, blend(accent, 0.14, LIGHT.white)) >= 4.5 &&
			contrast(x, blend(accent, 0.18, LIGHT.white)) >= 4.5;
	}
	while (i < 10 && ok(t) === false) { t = darken(t, 0.90); i++; }
	return t;
}

/* Verify the precomputed table shipped in shell.js + palette-boot.js exactly
 * matches what the formula derives — drift between the two is a real bug.
 * (Uber/Graphite is mode-dependent: it routes through the GRAPHITE surface
 * sets in shell.js/palette-boot.js, not this table.) */
var SHIPPED = {
	Splunk: '#a05515', Aurora: '#5256d1', Robinhood: '#0d763b', UniFi: '#0052cf',
	FT: '#1c4f9e', Honey: '#855e25', Nordic: '#3e6e7c'
};

var failures = [];
function check(label, fg, bg, threshold) {
	var c = contrast(fg, bg);
	var pass = c >= (threshold || 4.5);
	if (pass === false) failures.push(label + ': ' + c.toFixed(2) + ' < ' + (threshold || 4.5));
	console.log('  ' + c.toFixed(2).padStart(6) + ' ' + (pass ? 'PASS' : 'FAIL') + '  ' + label);
	return c;
}

console.log('== per-palette accentText (light mode) ==');
Object.keys(PALETTES).forEach(function (id) {
	var a = PALETTES[id];
	if (id === 'Graphite') return; /* mode-dependent; see GRAPHITE check below */
	var t = accentText(a);
	if (SHIPPED[id] !== t) failures.push(id + ' shipped accentText ' + SHIPPED[id] + ' != derived ' + t);
	check(id + ' text on white', t, LIGHT.white);
	check(id + ' text on surface-2', t, LIGHT.s2);
	check(id + ' text on soft14', t, blend(a, 0.14, LIGHT.white));
	check(id + ' text on soft18', t, blend(a, 0.18, LIGHT.white));
});
/* Graphite/Uber light+dark shipped values (accent == text == #0a0a0a / #f2f2f2). */
check('Graphite text on white', '#0a0a0a', LIGHT.white);
check('Graphite text on soft14 (accent #0a0a0a)', '#0a0a0a', blend('#0a0a0a', 0.14, LIGHT.white));
check('Graphite light mute #6a6a6a on #f1f1f1', '#6a6a6a', '#f1f1f1');
check('Graphite dark mute #909090 on #171717', '#909090', '#171717');

console.log('== light-mode static status text (pills on own soft bg + on surfaces) ==');
var LIGHT_STATUS = { good: '#177a4c', bad: '#b83540', warn: '#8f5e00', info: '#2c64c9' };
Object.keys(LIGHT_STATUS).forEach(function (k) {
	var text = LIGHT_STATUS[k];
	var softSrc = { good: '#1f9d61', bad: '#d64550', warn: '#d98f00', info: '#3b82f6' }[k];
	var alpha = k === 'warn' ? 0.15 : 0.13;
	check(k + ' on soft ' + alpha, text, blend(softSrc, alpha, LIGHT.white));
	check(k + ' on white', text, LIGHT.white);
	check(k + ' on surface-2', text, LIGHT.s2);
});

console.log('== dark-mode static status text (pills on own soft bg over #171a22) ==');
var DARK_STATUS = { good: '#3ecf8e', bad: '#f87171', warn: '#d98f00', info: '#7ab3ff' };
Object.keys(DARK_STATUS).forEach(function (k) {
	var text = DARK_STATUS[k];
	var softSrc = { good: '#3ecf8e', bad: '#f87171', warn: '#d98f00', info: '#7ab3ff' }[k];
	var alpha = k === 'warn' ? 0.15 : 0.13;
	check(k + ' on soft ' + alpha, text, blend(softSrc, alpha, DARK_SURFACE));
	check(k + ' on surface', text, DARK_SURFACE);
});

console.log('== misc pairings ==');
check('light mute #677083 on white', '#677083', LIGHT.white);
check('light mute #677083 on s2', '#677083', LIGHT.s2);
check('light soft #667085 on white', '#667085', LIGHT.white);
check('dark mute #8b93a7 on surface', '#8b93a7', DARK_SURFACE);
check('on-accent #14151a on Splunk accent', '#14151a', '#f48120');
check('Splunk accent on dark surface', '#f48120', DARK_SURFACE);
check('Splunk accent on dark soft18', '#f48120', blend('#f48120', 0.18, DARK_SURFACE));

console.log('== Nordic & Kyoto themes WCAG AA ==');
var NORDIC_L_SURF = blend('#ffffff', 0.88, '#eaf0f7');
var NORDIC_D_SURF = blend('#141d2f', 0.84, '#090e18');
check('Nordic light text on surface', '#0f172a', NORDIC_L_SURF);
check('Nordic light mute on surface-2', '#556377', '#f1f5fb');
check('Nordic light accent-text on surface', '#1849b2', NORDIC_L_SURF);
check('Nordic light on-accent on accent', '#ffffff', '#1d5bd6');
check('Nordic light good on soft', '#137347', blend('#1aa163', 0.12, NORDIC_L_SURF));
check('Nordic light warn on soft', '#855600', blend('#d48b00', 0.14, NORDIC_L_SURF));
check('Nordic light bad on soft', '#b42736', blend('#e03e4f', 0.12, NORDIC_L_SURF));
check('Nordic dark text on surface', '#f0f5fc', NORDIC_D_SURF);
check('Nordic dark mute on surface-2', '#8ea2bd', '#1a253b');
check('Nordic dark accent-text on surface', '#78b2ff', NORDIC_D_SURF);
check('Nordic dark on-accent on accent', '#081324', '#68a8ff');
check('Nordic dark good on soft', '#4ade80', blend('#22c55e', 0.13, NORDIC_D_SURF));
check('Nordic dark warn on soft', '#fbbf24', blend('#f59e0b', 0.14, NORDIC_D_SURF));
check('Nordic dark bad on soft', '#fb7185', blend('#f43f5e', 0.14, NORDIC_D_SURF));

var KYOTO_L_SURF = '#faf9f5';
var KYOTO_D_SURF = '#161b22';
check('Kyoto light text on surface', '#181b20', KYOTO_L_SURF);
check('Kyoto light mute on surface-2', '#5d626d', '#efece3');
check('Kyoto light accent-text on surface', '#1e3e61', KYOTO_L_SURF);
check('Kyoto light on-accent on accent', '#ffffff', '#264b73');
check('Kyoto light Ember override #904c13 on #efece3', '#904c13', '#efece3');
check('Kyoto light good on soft', '#1e6641', blend('#2c8557', 0.12, KYOTO_L_SURF));
check('Kyoto light warn on soft', '#7d5200', blend('#ba7d08', 0.13, KYOTO_L_SURF));
check('Kyoto light bad on soft', '#a62b2b', blend('#c93e3e', 0.12, KYOTO_L_SURF));
check('Kyoto dark text on surface', '#eaecef', KYOTO_D_SURF);
check('Kyoto dark mute on surface-2', '#8e98a8', '#1d232c');
check('Kyoto dark accent-text on surface', '#85b4e6', KYOTO_D_SURF);
check('Kyoto dark on-accent on accent', '#0e1621', '#85b4e6');
check('Kyoto dark good on soft', '#52c98a', blend('#2f9e66', 0.13, KYOTO_D_SURF));
check('Kyoto dark warn on soft', '#e5ac3f', blend('#cf911d', 0.14, KYOTO_D_SURF));
check('Kyoto dark bad on soft', '#f28482', blend('#d14945', 0.14, KYOTO_D_SURF));

console.log('');
if (failures.length) {
	console.log('CONTRAST: FAIL (' + failures.length + ')');
	failures.forEach(function (f) { console.log('  - ' + f); });
	process.exit(1);
} else {
	console.log('CONTRAST: PASS (all pairings >= 4.5:1)');
}
