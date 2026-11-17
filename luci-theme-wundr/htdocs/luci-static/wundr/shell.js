'use strict';
(function () {
	var d = document;
	var PALETTES = [
		{ id: 'Splunk',    name: 'Ember',    a: '#f48120', b: '#ff9e3d', t: '#a05515', on: '#14151a' },
		{ id: 'Aurora',    name: 'Aurora',   a: '#5b5fe8', b: '#8b5cf6', t: '#5256d1', on: '#ffffff' },
		{ id: 'Robinhood', name: 'Meadow',   a: '#12a150', b: '#22c55e', t: '#0d763b', on: '#14151a' },
		{ id: 'UniFi',     name: 'Harbor',   a: '#0065ff', b: '#2f88ff', t: '#0052cf', on: '#ffffff' },
		{ id: 'FT',        name: 'Luxe',     a: '#1c4f9e', b: '#2f6fd0', t: '#1c4f9e', on: '#ffffff' },
		{ id: 'Honey',     name: 'Honey',    a: '#e09f3e', b: '#c47f1f', t: '#855e25', on: '#14151a' },
		{ id: 'Nord',      name: 'Nordic',   a: '#5fa8bd', b: '#81a1c1', t: '#3e6e7c', on: '#14151a' },
		{ id: 'Uber',      name: 'Graphite', a: '#3a3a3a', b: '#141414' }
	];
	var GRAPHITE = {
		dark:  { '--wb-bg': '#050505', '--wb-bg-2': '#0b0b0b', '--wb-surface': '#0f0f0f', '--wb-surface-2': '#171717', '--wb-border': '#222222', '--wb-border-strong': '#333',
			'--wb-text': '#f5f5f5', '--wb-text-soft': '#8a8a8a', '--wb-text-mute': '#909090',
			'--wb-accent': '#f2f2f2', '--wb-accent-2': '#b5b5b5', '--wb-on-accent': '#0a0a0a', '--wb-accent-soft': 'rgba(242,242,242,0.12)' },
		light: { '--wb-bg': '#f7f7f7', '--wb-bg-2': '#efefef', '--wb-surface': '#ffffff', '--wb-surface-2': '#f1f1f1', '--wb-border': '#e6e6e6', '--wb-border-strong': '#cfcfcf',
			'--wb-text': '#0a0a0a', '--wb-text-soft': '#6f6f6f', '--wb-text-mute': '#6a6a6a',
			'--wb-accent': '#0a0a0a', '--wb-accent-2': '#262626', '--wb-on-accent': '#ffffff', '--wb-accent-soft': 'rgba(10,10,10,0.08)' }
	};
	var GRAPHITE_KEYS = Object.keys(GRAPHITE.dark);
	var STUDIOS = [
		{ key: 'nordic',  label: 'Nordic',  sub: 'Frosted glass', c: '#1d5bd6' },
		{ key: 'kyoto',   label: 'Kyoto',   sub: 'Washi & ink',   c: '#264b73' },
		{ key: 'current', label: 'Classic', sub: 'Slate & ember', c: '#f48120' }
	];

	var currentStudio = 'nordic';
	var currentPalette = null;

	function store(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
	function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
	function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

	/* ---------- colour helpers ---------- */
	function hexToRgb(h) {
		h = h.replace('#', '');
		if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
	function lum(hex) { var r = hexToRgb(hex); return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]); }
	function contrast(fg, bg) {
		var a = lum(fg), b = lum(bg);
		if (a < b) { var t = a; a = b; b = t; }
		return (a + 0.05) / (b + 0.05);
	}
	function darken(hex, f) {
		return '#' + hexToRgb(hex).map(function (v) { return Math.round(v * f); })
			.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
	}
	function bestOnAccent(accent) {
		return contrast('#14151a', accent) >= contrast('#ffffff', accent) ? '#14151a' : '#ffffff';
	}
	function accentText(accent) {
		var t = accent, i = 0;
		function ok(x) {
			return contrast(x, '#ffffff') >= 4.5 && contrast(x, '#f7f8fa') >= 4.5 &&
				contrast(x, accentSoft(accent, false)) >= 4.5 &&
				contrast(x, accentSoft(accent, true)) >= 4.5;
		}
		while (i < 10 && ok(t) === false) { t = darken(t, 0.90); i++; }
		return t;
	}
	function accentSoft(accent, dark) {
		var r = hexToRgb(accent);
		return 'rgba(' + r[0] + ', ' + r[1] + ', ' + r[2] + ', ' + (dark ? '0.18' : '0.14') + ')';
	}

	/* ---------- theme, studio triad & palette ---------- */
	function isDark() { return d.documentElement.getAttribute('data-theme') === 'dark'; }

	function clearInlineAppearance(root) {
		GRAPHITE_KEYS.forEach(function (k) { root.style.removeProperty(k); });
		['--wb-accent', '--wb-accent-2', '--wb-grad', '--wb-on-accent', '--wb-accent-soft', '--wb-accent-text'].forEach(function (k) { root.style.removeProperty(k); });
	}

	function applyStudio(key) {
		currentStudio = STUDIOS.some(function (s) { return s.key === key; }) ? key : 'nordic';
		store('wb-studio', currentStudio);
		d.documentElement.setAttribute('data-studio', currentStudio);
		remove('wb-palette');
		currentPalette = currentStudio === 'current' ? 'Splunk' : null;
		clearInlineAppearance(d.documentElement);
		if (currentPalette) applyPalette(currentPalette);
		else {
			renderPalettePopover();
			d.dispatchEvent(new CustomEvent('wb-theme-change', { detail: { studio: currentStudio, palette: null, dark: isDark() } }));
		}
	}

	function applyPalette(id) {
		var root = d.documentElement;
		clearInlineAppearance(root);
		if (!id && (currentStudio === 'nordic' || currentStudio === 'kyoto')) {
			currentPalette = null;
			remove('wb-palette');
			renderPalettePopover();
			d.dispatchEvent(new CustomEvent('wb-theme-change', { detail: { studio: currentStudio, palette: null, dark: isDark() } }));
			return;
		}
		currentPalette = PALETTES.some(function (p) { return p.id === id; }) ? id : 'Splunk';
		store('wb-palette', currentPalette);

		if (currentPalette === 'Uber') {
			var set = GRAPHITE[isDark() ? 'dark' : 'light'];
			Object.keys(set).forEach(function (k) { root.style.setProperty(k, set[k]); });
			root.style.setProperty('--wb-grad', 'linear-gradient(135deg, ' + set['--wb-accent'] + ', ' + set['--wb-accent-2'] + ')');
			root.style.setProperty('--wb-accent-text', set['--wb-accent']);
		} else {
			var pal = PALETTES.filter(function (p) { return p.id === currentPalette; })[0];
			var lightTxt = (currentStudio === 'kyoto' && currentPalette === 'Splunk') ? '#904c13' : (pal.t || accentText(pal.a));
			root.style.setProperty('--wb-accent', pal.a);
			root.style.setProperty('--wb-accent-2', pal.b);
			root.style.setProperty('--wb-grad', 'linear-gradient(135deg, ' + pal.a + ', ' + pal.b + ')');
			root.style.setProperty('--wb-on-accent', pal.on || bestOnAccent(pal.a));
			root.style.setProperty('--wb-accent-text', isDark() ? pal.a : lightTxt);
			root.style.setProperty('--wb-accent-soft', accentSoft(pal.a, isDark()));
		}
		renderPalettePopover();
		d.dispatchEvent(new CustomEvent('wb-theme-change', { detail: { studio: currentStudio, palette: currentPalette, dark: isDark() } }));
	}

	function setThemeMode(mode) {
		d.documentElement.setAttribute('data-theme', mode);
		var sun = d.querySelector('.wb-sun-icon'), moon = d.querySelector('.wb-moon-icon');
		if (sun && moon) {
			sun.style.display = mode === 'dark' ? 'none' : 'block';
			moon.style.display = mode === 'dark' ? 'block' : 'none';
		}
	}

	function initTheme() {
		var attrSt = d.documentElement.getAttribute('data-studio');
		var savedSt = load('wb-studio') || attrSt;
		currentStudio = STUDIOS.some(function (s) { return s.key === savedSt; }) ? savedSt : 'nordic';
		d.documentElement.setAttribute('data-studio', currentStudio);
		setThemeMode(isDark() ? 'dark' : 'light');

		var btn = d.getElementById('wb-theme-toggle');
		if (btn) btn.addEventListener('click', function () {
			var mode = isDark() ? 'light' : 'dark';
			setThemeMode(mode);
			store('wb-theme', mode);
			applyPalette(currentPalette);
		});
		if (window.matchMedia) {
			matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
				if (load('wb-theme')) return;
				setThemeMode(ev.matches ? 'dark' : 'light');
				applyPalette(currentPalette);
			});
		}
		var savedPal = load('wb-palette');
		applyPalette(savedPal || (currentStudio === 'current' ? 'Splunk' : null));
	}

	function renderPalettePopover() {
		var pop = d.getElementById('wb-palette-popover');
		if (!pop) return;
		var hasCustomAccent = !!currentPalette && !(currentStudio === 'current' && currentPalette === 'Splunk');
		pop.innerHTML =
			'<div class="wb-popover-h"><span>Studio style</span></div>' +
			'<div class="wb-studio-grid"></div>' +
			'<div class="wb-popover-h"><span>Color accent</span>' +
				(hasCustomAccent ? '<button type="button" class="wb-popover-reset">Studio default</button>' : '') +
			'</div>' +
			'<div class="wb-palette-grid"></div>';

		var sGrid = pop.querySelector('.wb-studio-grid');
		STUDIOS.forEach(function (st) {
			var btn = d.createElement('button');
			btn.type = 'button';
			var act = st.key === currentStudio;
			btn.className = 'wb-studio-btn' + (act ? ' active' : '');
			btn.setAttribute('aria-pressed', String(act));
			btn.innerHTML = '<b><i style="background:' + st.c + '"></i>' + st.label + '</b><small>' + st.sub + '</small>';
			btn.addEventListener('click', function (ev) {
				ev.stopPropagation();
				applyStudio(st.key);
			});
			sGrid.appendChild(btn);
		});

		var resetBtn = pop.querySelector('.wb-popover-reset');
		if (resetBtn) resetBtn.addEventListener('click', function (ev) {
			ev.stopPropagation();
			applyPalette(currentStudio === 'current' ? 'Splunk' : null);
		});

		var grid = pop.querySelector('.wb-palette-grid');
		PALETTES.forEach(function (p) {
			var item = d.createElement('button');
			item.type = 'button';
			var isAct = p.id === currentPalette;
			item.className = 'wb-palette-item' + (isAct ? ' active' : '');
			item.setAttribute('aria-pressed', String(isAct));
			item.innerHTML = '<span class="wb-swatch" style="background:linear-gradient(135deg, ' + p.a + ', ' + p.b + ')"></span><span>' + p.name + '</span>';
			item.addEventListener('click', function (ev) {
				ev.stopPropagation();
				applyPalette(p.id);
				closePalette();
			});
			grid.appendChild(item);
		});
	}

	function closePalette() {
		var pop = d.getElementById('wb-palette-popover'), btn = d.getElementById('wb-palette-btn');
		if (pop) pop.hidden = true;
		if (btn) btn.setAttribute('aria-expanded', 'false');
	}

	function initPaletteButton() {
		var btn = d.getElementById('wb-palette-btn'), pop = d.getElementById('wb-palette-popover');
		if (!btn || !pop) return;
		btn.addEventListener('click', function (ev) {
			ev.stopPropagation();
			var open = pop.hidden;
			pop.hidden = !open;
			btn.setAttribute('aria-expanded', String(open));
		});
		d.addEventListener('click', function (ev) {
			if (!pop.hidden && !pop.contains(ev.target) && ev.target !== btn) closePalette();
		});
	}

	/* ---------- navigation ---------- */
	function setGroup(group, open) {
		var toggle = group.querySelector('.wb-nav-group-toggle');
		group.classList.toggle('is-open', open);
		if (toggle) toggle.setAttribute('aria-expanded', String(open));
	}

	function currentPath() {
		var p = (window.L && L.env && Array.isArray(L.env.dispatchpath)) ? L.env.dispatchpath : [];
		if (!p.length && window.L && L.env && Array.isArray(L.env.requestpath)) p = L.env.requestpath;
		return p.join('/');
	}

	function initNav() {
		var shell = d.querySelector('.wb-shell');
		var toggle = d.querySelector('.wb-navtoggle');
		function setDrawer(open) {
			if (!shell) return;
			shell.classList.toggle('nav-open', open);
			if (toggle) toggle.setAttribute('aria-expanded', String(open));
		}
		if (toggle) toggle.addEventListener('click', function () { setDrawer(!shell.classList.contains('nav-open')); });
		if (shell) shell.addEventListener('click', function (ev) {
			/* the ::before backdrop has no node; a click on the shell outside the nav closes the drawer */
			if (shell.classList.contains('nav-open') && !ev.target.closest('.wb-sidenav') && !ev.target.closest('.wb-navtoggle')) setDrawer(false);
		});

		d.querySelectorAll('.wb-nav-group').forEach(function (group) {
			var name = group.getAttribute('data-nav-group');
			var saved = load('wb-nav-' + name);
			if (saved === 'true' || saved === 'false') setGroup(group, saved === 'true');
			var t = group.querySelector('.wb-nav-group-toggle');
			if (t) t.addEventListener('click', function () {
				var open = !group.classList.contains('is-open');
				setGroup(group, open);
				store('wb-nav-' + name, String(open));
			});
		});

		var here = currentPath();
		var best = null, bestLen = -1;
		d.querySelectorAll('.wb-nav a[data-nav]').forEach(function (a) {
			a.getAttribute('data-nav').split(/\s+/).forEach(function (route) {
				if (route && (here === route || here.indexOf(route + '/') === 0) && route.length > bestLen) { best = a; bestLen = route.length; }
			});
			a.addEventListener('click', function () { setDrawer(false); });
		});
		if (best) {
			best.classList.add('active');
			best.setAttribute('aria-current', 'page');
			var group = best.closest('.wb-nav-group');
			if (group) setGroup(group, true);
		}

		if (window.wbIcon) {
			d.querySelectorAll('.wb-nav-ico[data-icon]').forEach(function (span) {
				span.innerHTML = wbIcon(span.getAttribute('data-icon'), 18);
			});
		}

		/* Advanced (full LuCI) drawer */
		var proBtn = d.getElementById('wb-pro-toggle');
		var drawer = d.getElementById('wb-pro-drawer');
		var backdrop = d.getElementById('wb-pro-backdrop');
		var proClose = d.getElementById('wb-pro-drawer-close');
		function setPro(open) {
			if (!drawer) return;
			drawer.hidden = !open;
			if (backdrop) backdrop.hidden = !open;
			drawer.setAttribute('aria-hidden', String(!open));
			if (proBtn) proBtn.setAttribute('aria-expanded', String(open));
			if (open) { setDrawer(false); var first = drawer.querySelector('a'); if (first) first.focus(); }
		}
		if (proBtn) proBtn.addEventListener('click', function () { setPro(drawer && drawer.hidden); });
		if (proClose) proClose.addEventListener('click', function () { setPro(false); });
		if (backdrop) backdrop.addEventListener('click', function () { setPro(false); });
		d.addEventListener('keydown', function (ev) {
			if (ev.key !== 'Escape') return;
			setPro(false);
			setDrawer(false);
			closePalette();
			hideSearch();
		});
	}

	/* ---------- search (sidebar + full LuCI menu) ---------- */
	var searchIndex = null;
	var searchActive = -1;

	function buildSearchIndex() {
		if (searchIndex) return Promise.resolve(searchIndex);
		var items = [];
		d.querySelectorAll('.wb-nav a[data-nav]').forEach(function (a) {
			var group = a.closest('.wb-nav-group');
			var groupName = group ? (group.querySelector('.wb-nav-group-toggle span:nth-child(2)') || {}).textContent : '';
			items.push({ title: a.textContent.trim(), path: groupName ? groupName.trim() : 'Wundr', href: a.href, kind: 'wundr' });
		});
		if (!window.L || typeof L.require !== 'function') { searchIndex = items; return Promise.resolve(items); }
		return L.require('ui').then(function (ui) {
			return ui.menu.load().then(function (tree) {
				function walk(node, trail, url) {
					var children = ui.menu.getChildren(node);
					children.forEach(function (child) {
						if (child.name === 'wundr') return;
						var childUrl = url ? url + '/' + child.name : child.name;
						var title = child.title ? String(child.title) : child.name;
						var isLeaf = !ui.menu.getChildren(child).length;
						var crumbs = trail.concat([title]);
						if (isLeaf || (child.action && child.action.type === 'view'))
							items.push({ title: title, path: crumbs.slice(0, -1).join(' › ') || 'LuCI', href: L.url(childUrl), kind: 'luci' });
						walk(child, crumbs, childUrl);
					});
				}
				walk(tree, [], '');
				searchIndex = items;
				return items;
			});
		}).catch(function () { searchIndex = items; return items; });
	}

	function hideSearch() {
		var box = d.getElementById('wb-search-results');
		if (box) { box.hidden = true; box.innerHTML = ''; box.removeAttribute('aria-activedescendant'); }
		searchActive = -1;
	}

	function renderSearch(query) {
		var box = d.getElementById('wb-search-results');
		if (!box) return;
		var q = query.trim().toLowerCase();
		if (!q) { hideSearch(); return; }
		buildSearchIndex().then(function (items) {
			var words = q.split(/\s+/);
			var hits = items.filter(function (it) {
				var hay = (it.title + ' ' + it.path).toLowerCase();
				return words.every(function (w) { return hay.indexOf(w) >= 0; });
			}).sort(function (a, b) {
				var ai = a.title.toLowerCase().indexOf(q), bi = b.title.toLowerCase().indexOf(q);
				var ak = a.kind === 'wundr' ? 0 : 1, bk = b.kind === 'wundr' ? 0 : 1;
				return (ai < 0) - (bi < 0) || ak - bk || a.title.localeCompare(b.title);
			}).slice(0, 12);
			box.innerHTML = '';
			if (!hits.length) {
				var none = d.createElement('div'); none.className = 'wb-search-empty'; none.textContent = 'No matching pages';
				box.appendChild(none);
			}
			hits.forEach(function (it, i) {
				var a = d.createElement('a');
				a.className = 'wb-search-item' + (i === 0 ? ' is-active' : '');
				a.id = 'wb-search-item-' + i;
				a.href = it.href;
				a.setAttribute('role', 'option');
				a.innerHTML = (window.wbIcon ? wbIcon(it.kind === 'wundr' ? 'dashboard' : 'sliders', 16) : '') + '<strong></strong><span class="path"></span>';
				a.querySelector('strong').textContent = it.title;
				a.querySelector('.path').textContent = it.path;
				box.appendChild(a);
			});
			searchActive = hits.length ? 0 : -1;
			box.setAttribute('aria-activedescendant', searchActive >= 0 ? 'wb-search-item-0' : '');
			box.hidden = false;
		});
	}

	function initSearch() {
		var input = d.getElementById('wb-menu-search');
		var box = d.getElementById('wb-search-results');
		if (!input || !box) return;
		input.addEventListener('input', function () { renderSearch(input.value); });
		input.addEventListener('focus', function () { if (input.value) renderSearch(input.value); });
		input.addEventListener('keydown', function (ev) {
			var items = box.querySelectorAll('.wb-search-item');
			if (ev.key === 'Escape') { input.value = ''; hideSearch(); input.blur(); return; }
			if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
				if (!items.length) return;
				ev.preventDefault();
				searchActive = (searchActive + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
				items.forEach(function (el, i) { el.classList.toggle('is-active', i === searchActive); });
				items[searchActive].scrollIntoView({ block: 'nearest' });
				box.setAttribute('aria-activedescendant', items[searchActive].id);
			}
			if (ev.key === 'Enter' && items.length && searchActive >= 0) {
				ev.preventDefault();
				location.href = items[searchActive].href;
			}
		});
		d.addEventListener('click', function (ev) {
			if (!box.hidden && !ev.target.closest('.wb-search')) hideSearch();
		});
		d.addEventListener('keydown', function (ev) {
			if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); input.focus(); input.select(); }
		});
	}

	/* ---------- live status rail ---------- */
	function initRail() {
		var rail = d.getElementById('wb-statusrail');
		if (!rail || !window.L || typeof L.require !== 'function') return;

		var loadChip = chip('cpu', 'CPU', true), memChip = chip('mem', 'RAM', true), wanChip = chip('wan', 'Internet', false);
		rail.appendChild(wanChip.el); rail.appendChild(loadChip.el); rail.appendChild(memChip.el);

		function chip(id, label, optional) {
			var el = d.createElement('span');
			el.className = 'wb-chip' + (optional ? ' optional' : '');
			el.innerHTML = '<span class="dot"></span><span class="lbl"></span><b></b>';
			el.querySelector('.lbl').textContent = label;
			return { el: el, val: el.querySelector('b'), dot: el.querySelector('.dot') };
		}
		function setChip(c, text, state) {
			c.val.textContent = text;
			c.el.classList.toggle('is-warn', state === 'warn');
			c.el.classList.toggle('is-bad', state === 'bad');
		}

		Promise.all([ L.require('rpc'), L.require('poll') ]).then(function (mods) {
			var rpc = mods[0], poll = mods[1];
			var callInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
			var callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
			poll.add(function () {
				if (rail.offsetParent === null) return Promise.resolve();
				return Promise.all([ L.resolveDefault(callInfo(), {}), L.resolveDefault(callIfaces(), []) ]).then(function (res) {
					var info = res[0] || {}, ifaces = res[1] || [];
					var load1 = Array.isArray(info.load) ? info.load[0] / 65536 : null;
					if (load1 != null) {
						setChip(loadChip, load1.toFixed(2), load1 > 4 ? 'bad' : (load1 > 2 ? 'warn' : 'ok'));
						loadChip.el.title = 'Load average (1 min): ' + load1.toFixed(2);
					}
					if (info.memory && info.memory.total) {
						var used = 1 - ((info.memory.available != null ? info.memory.available : info.memory.free) / info.memory.total);
						var pct = Math.round(used * 100);
						setChip(memChip, pct + '%', pct > 90 ? 'bad' : (pct > 75 ? 'warn' : 'ok'));
						memChip.el.title = 'Memory used: ' + pct + '%';
					}
					var wan = ifaces.filter(function (i) {
						return i.up && Array.isArray(i.route) && i.route.some(function (r) { return r.target === '0.0.0.0' && r.mask === 0; });
					})[0];
					if (wan) {
						var addr = (wan['ipv4-address'] && wan['ipv4-address'][0]) ? wan['ipv4-address'][0].address : '';
						setChip(wanChip, 'Online', 'ok');
						wanChip.el.title = (wan.interface || 'wan') + (addr ? ' · ' + addr : '');
					} else {
						var any = ifaces.filter(function (i) { return /^wan/.test(i.interface || ''); })[0];
						setChip(wanChip, any && any.pending ? 'Connecting' : 'Offline', any && any.pending ? 'warn' : 'bad');
						wanChip.el.title = 'No default route';
					}
				});
			}, 5);
		}).catch(function () { rail.innerHTML = ''; });
	}

	/* ---------- toast helper ---------- */
	function toast(title, sub, kind) {
		var region = d.querySelector('.wb-toast-region');
		if (!region) { region = d.createElement('div'); region.className = 'wb-toast-region'; d.body.appendChild(region); }
		while (region.firstChild) region.removeChild(region.firstChild);
		var t = d.createElement('div');
		t.className = 'wb-toast' + (kind ? ' ' + kind : '');
		t.setAttribute('role', 'status');
		t.setAttribute('aria-live', 'polite');
		var body = d.createElement('div'); body.className = 'wb-toast-body';
		var h = d.createElement('div'); h.className = 'wb-toast-title'; h.textContent = title;
		body.appendChild(h);
		if (sub) { var s = d.createElement('div'); s.className = 'wb-toast-sub'; s.textContent = sub; body.appendChild(s); }
		var close = d.createElement('button'); close.type = 'button'; close.className = 'wb-toast-close'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '\u00d7';
		var timer = null;
		function dismiss() {
			if (timer) { clearTimeout(timer); timer = null; }
			t.classList.add('closing');
			setTimeout(function () { t.remove(); }, 250);
		}
		close.addEventListener('click', dismiss);
		t.appendChild(body); t.appendChild(close);
		region.appendChild(t);
		timer = setTimeout(dismiss, kind === 'bad' ? 8000 : 5200);
		return t;
	}

	window.WB = { toast: toast, palettes: PALETTES, studios: STUDIOS, applyPalette: applyPalette, applyStudio: applyStudio };

	function boot() {
		initTheme();
		initPaletteButton();
		initNav();
		initSearch();
		initRail();
	}
	if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})();
