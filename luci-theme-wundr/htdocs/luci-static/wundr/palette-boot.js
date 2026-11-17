/* Wundr palette-boot.js - pre-paint theme and accent boot. */
(function () {
	'use strict';
	var PALETTES = {
		Splunk:    { a: '#f48120', b: '#ff9e3d', t: '#a05515', on: '#14151a' },
		Aurora:    { a: '#5b5fe8', b: '#8b5cf6', t: '#5256d1', on: '#ffffff' },
		Robinhood: { a: '#12a150', b: '#22c55e', t: '#0d763b', on: '#14151a' },
		UniFi:     { a: '#0065ff', b: '#2f88ff', t: '#0052cf', on: '#ffffff' },
		FT:        { a: '#1c4f9e', b: '#2f6fd0', t: '#1c4f9e', on: '#ffffff' },
		Honey:     { a: '#e09f3e', b: '#c47f1f', t: '#855e25', on: '#14151a' },
		Nord:      { a: '#5fa8bd', b: '#81a1c1', t: '#3e6e7c', on: '#14151a' }
	};

	var GRAPHITE = {
		dark:  { '--wb-bg': '#050505', '--wb-bg-2': '#0b0b0b', '--wb-surface': '#0f0f0f', '--wb-surface-2': '#171717', '--wb-border': '#222222', '--wb-border-strong': '#333',
			'--wb-text': '#f5f5f5', '--wb-text-soft': '#8a8a8a', '--wb-text-mute': '#909090',
			'--wb-accent': '#f2f2f2', '--wb-accent-2': '#b5b5b5', '--wb-on-accent': '#0a0a0a', '--wb-accent-soft': 'rgba(242,242,242,0.12)' },
		light: { '--wb-bg': '#f7f7f7', '--wb-bg-2': '#efefef', '--wb-surface': '#ffffff', '--wb-surface-2': '#f1f1f1', '--wb-border': '#e6e6e6', '--wb-border-strong': '#cfcfcf',
			'--wb-text': '#0a0a0a', '--wb-text-soft': '#6f6f6f', '--wb-text-mute': '#6a6a6a',
			'--wb-accent': '#0a0a0a', '--wb-accent-2': '#262626', '--wb-on-accent': '#ffffff', '--wb-accent-soft': 'rgba(10,10,10,0.08)' }
	};

	function saved() {
		try { return localStorage.getItem('wb-palette'); } catch (e) { return null; }
	}

	function apply(id) {
		var el = document.documentElement, s = el.style;
		var dark = el.getAttribute('data-theme') === 'dark';
		var studio = el.getAttribute('data-studio');
		if (id === 'Uber') {
			var set = GRAPHITE[dark ? 'dark' : 'light'];
			Object.keys(set).forEach(function (k) { s.setProperty(k, set[k]); });
			s.setProperty('--wb-accent-text', set['--wb-accent']);
			s.setProperty('--wb-grad', 'linear-gradient(135deg, ' + set['--wb-accent'] + ', ' + set['--wb-accent-2'] + ')');
			return;
		}
		var pal = PALETTES[id];
		if (!pal) return;
		var txt = dark ? pal.a : (studio === 'kyoto' && id === 'Splunk' ? '#904c13' : pal.t);
		s.setProperty('--wb-accent', pal.a);
		s.setProperty('--wb-accent-2', pal.b);
		s.setProperty('--wb-accent-text', txt);
		s.setProperty('--wb-on-accent', pal.on);
		s.setProperty('--wb-accent-soft', 'rgba(' + [
			parseInt(pal.a.slice(1, 3), 16), parseInt(pal.a.slice(3, 5), 16), parseInt(pal.a.slice(5, 7), 16)
		].join(', ') + ', ' + (dark ? '0.18' : '0.14') + ')');
		s.setProperty('--wb-grad', 'linear-gradient(135deg, ' + pal.a + ', ' + pal.b + ')');
	}

	var p = saved();
	var st = document.documentElement.getAttribute('data-studio');
	if (p || (st !== 'nordic' && st !== 'kyoto')) apply(p || 'Splunk');
	window.wbPaletteBoot = { apply: apply, palettes: PALETTES, savedId: p || 'Splunk' };
})();
