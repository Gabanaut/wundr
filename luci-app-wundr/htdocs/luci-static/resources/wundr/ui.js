'use strict';
'require baseclass';
'require ui';
'require uci';
'require dom';

/* Wundr shared view helpers: DOM primitives, formatting and the
 * save-and-apply flow used by every Wundr screen. Writes always go through
 * LuCI's own uci.js staging + ui.changes.apply() so they are validated,
 * atomic and (for checked applies) rollback-protected. */

function icon(name, size) {
	var span = E('span', { 'class': 'btn-ico', 'aria-hidden': 'true' });
	if (window.wbIcon) span.innerHTML = window.wbIcon(name, size || 16);
	return span;
}

function iconLabel(name, text) {
	return E('span', { 'class': 'btn-ico-label' }, [ icon(name, 15), document.createTextNode(text) ]);
}

function iconButton(name, label, attrs) {
	var btn = E('button', Object.assign({ 'class': 'wb-icon-btn', 'type': 'button', 'title': label, 'aria-label': label }, attrs || {}));
	if (window.wbIcon) btn.innerHTML = window.wbIcon(name, 16);
	return btn;
}

function iconLink(name, label, href, attrs) {
	var a = E('a', Object.assign({ 'class': 'wb-icon-btn', 'href': href, 'title': label, 'aria-label': label }, attrs || {}));
	if (window.wbIcon) a.innerHTML = window.wbIcon(name, 16);
	return a;
}

function help(text) {
	return E('button', { 'class': 'wb-help', 'type': 'button', 'aria-label': _('Help: ') + text, 'data-tip': text }, [ '?' ]);
}

function pill(text, kind) {
	return E('span', { 'class': 'wb-pill ' + (kind || 'mut') }, [ text ]);
}

function stat(value, label, extra) {
	return E('div', { 'class': 'wb-stat' }, [ E('b', {}, [ value == null || value === '' ? '—' : String(value), extra || '' ]), E('span', {}, [ label ]) ]);
}

function hero(title, sub, row, actions) {
	return E('section', { 'class': 'wb-card wb-hero' }, [
		E('h2', { 'class': 'wb-h' }, [ title ]),
		sub ? E('div', { 'class': 'wb-sub' }, [ sub ]) : '',
		(row && row.length) || (actions && actions.length) ? E('div', { 'class': 'wb-hero-row' }, (row || []).concat(actions && actions.length ? [ E('div', { 'class': 'wb-hero-actions' }, actions) ] : [])) : ''
	]);
}

function card(title, children, opts) {
	opts = opts || {};
	var head = title ? E('div', { 'class': 'wb-pagetitle' }, [
		E('h3', { 'class': 'wb-h' }, [ title, opts.help ? help(opts.help) : '' ]),
		opts.actions || ''
	]) : '';
	return E('section', { 'class': 'wb-card' + (opts['class'] ? ' ' + opts['class'] : '') }, [
		head,
		opts.sub ? E('div', { 'class': 'wb-sub', 'style': 'margin:-6px 0 12px' }, [ opts.sub ]) : '',
		E('div', {}, children)
	]);
}

function kv(pairs) {
	var nodes = [];
	pairs.forEach(function(p) {
		if (!p) return;
		nodes.push(E('dt', {}, [ p[0] ]));
		nodes.push(E('dd', { 'class': p[2] || '' }, [ p[1] == null || p[1] === '' ? '—' : p[1] ]));
	});
	return E('dl', { 'class': 'wb-kv' }, nodes);
}

function empty(text, iconName, action) {
	return E('div', { 'class': 'wb-empty' }, [
		iconName ? E('div', { 'class': 'ico' }, [ icon(iconName, 22) ]) : '',
		E('div', {}, [ text ]),
		action || ''
	]);
}

function toast(title, sub, kind) {
	if (window.WB && typeof window.WB.toast === 'function') return window.WB.toast(title, sub, kind);
	ui.addTimeLimitedNotification(title, [ E('p', {}, [ sub || '' ]) ], 5000, kind === 'bad' ? 'error' : 'info');
	return null;
}

/* Toggle switch. onChange(nextState) must return a Promise; the control is
 * disabled while pending and reverts visually if the promise rejects. */
function toggle(checked, onChange, attrs) {
	var btn = E('button', Object.assign({ 'class': 'wb-toggle', 'type': 'button', 'role': 'switch', 'aria-checked': checked ? 'true' : 'false' }, attrs || {}));
	btn.addEventListener('click', function() {
		if (btn.disabled) return;
		var next = btn.getAttribute('aria-checked') !== 'true';
		btn.setAttribute('aria-checked', String(next));
		btn.disabled = true; btn.classList.add('busy');
		Promise.resolve().then(function() { return onChange(next); }).then(function() {
			btn.disabled = false; btn.classList.remove('busy');
		}).catch(function(err) {
			btn.setAttribute('aria-checked', String(!next));
			btn.disabled = false; btn.classList.remove('busy');
			toast(_('Change failed'), err && err.message ? err.message : String(err || ''), 'bad');
		});
	});
	return btn;
}

/* Stage → save → apply. `checked` enables the rollback-protected apply that
 * native LuCI uses for connectivity-affecting changes (IPs, Wi-Fi, VLANs).
 * ui.changes.apply() drives its own progress/error banner; a genuine staged
 * save failure (expired session, ACL rejection) surfaces via the toast. */
function apply(checked, successTitle, successSub) {
	return uci.save().then(function() {
		ui.changes.apply(!!checked);
		if (successTitle) toast(successTitle, successSub || '', 'good');
	}, function(err) {
		var msg = (err && err.message) ? err.message : String(err || _('Unknown error'));
		toast(_('Could not save changes'), msg, 'bad');
		throw err;
	});
}

function confirm(title, message, opts) {
	opts = opts || {};
	return new Promise(function(resolve) {
		ui.showModal(title, [
			E('p', {}, [ message ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); resolve(false); } }, [ opts.cancel || _('Cancel') ]),
				' ',
				E('button', { 'class': 'btn ' + (opts.danger ? 'cbi-button-negative important' : 'cbi-button-positive'), 'click': function() { ui.hideModal(); resolve(true); } }, [ opts.ok || _('Continue') ])
			])
		]);
	});
}

/* Generic modal form: fields = [{ id, label, node, help }]; onSubmit(values) may
 * return a Promise; a rejection or thrown Error is shown inline. */
function formModal(title, fields, onSubmit, opts) {
	opts = opts || {};
	var err = E('div', { 'class': 'wb-form-error' });
	var rows = fields.map(function(f) {
		if (f.raw) return f.raw;
		return E('div', { 'class': 'wb-form-row' }, [
			E('label', { 'class': 'wb-form-label', 'for': f.node.id || '' }, [ f.label, f.help ? help(f.help) : '' ]),
			E('div', {}, [ f.node, f.desc ? E('div', { 'class': 'wb-form-desc' }, [ f.desc ]) : '' ])
		]);
	});
	var okBtn = E('button', { 'class': 'btn cbi-button-positive' }, [ opts.ok || _('Save') ]);
	okBtn.addEventListener('click', function() {
		err.textContent = '';
		okBtn.disabled = true; okBtn.classList.add('spinning');
		Promise.resolve().then(function() { return onSubmit(); }).then(function() {
			ui.hideModal();
		}).catch(function(e) {
			err.textContent = e && e.message ? e.message : String(e || _('Unknown error'));
			okBtn.disabled = false; okBtn.classList.remove('spinning');
		});
	});
	ui.showModal(title, [
		opts.intro ? E('p', {}, [ opts.intro ]) : '',
		E('div', {}, rows),
		err,
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]), ' ', okBtn
		])
	]);
	var first = document.querySelector('.modal input, .modal select');
	if (first) first.focus();
}

function input(attrs) {
	return E('input', Object.assign({ 'class': 'wb-input', 'type': 'text' }, attrs || {}));
}

function select(options, value, attrs) {
	return E('select', Object.assign({ 'class': 'wb-input' }, attrs || {}), options.map(function(o) {
		var v = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o;
		return E('option', Object.assign({ 'value': v }, String(v) === String(value) ? { 'selected': 'selected' } : {}), [ label ]);
	}));
}

/* ---- formatting ---- */
function fmtBytes(n) {
	n = Number(n) || 0;
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return (i ? n.toFixed(n >= 100 ? 0 : 1) : n) + ' ' + u[i];
}
function fmtRate(bytesPerSec) {
	var bits = (Number(bytesPerSec) || 0) * 8;
	var u = [ 'bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s' ], i = 0;
	while (bits >= 1000 && i < u.length - 1) { bits /= 1000; i++; }
	return (i ? bits.toFixed(bits >= 100 ? 0 : 1) : Math.round(bits)) + ' ' + u[i];
}
function fmtUptime(sec) {
	sec = Number(sec) || 0;
	var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
	if (d) return d + 'd ' + h + 'h';
	if (h) return h + 'h ' + m + 'm';
	return m + 'm';
}
function fmtDuration(sec) {
	sec = Number(sec) || 0;
	if (sec <= 0) return _('expired');
	var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
	return h ? h + 'h ' + m + 'm' : m + 'm';
}

/* ---- Wi-Fi / device helpers ---- */
function signalQuality(dbm) {
	if (dbm == null || !isFinite(dbm)) return 0;
	return dbm > -55 ? 4 : (dbm > -67 ? 3 : (dbm > -80 ? 2 : 1));
}
function sigBars(dbm) {
	return E('span', { 'class': 'wb-sig', 'data-q': String(signalQuality(dbm)), 'title': dbm != null ? dbm + ' dBm' : '' }, [ E('i'), E('i'), E('i'), E('i') ]);
}
function macKey(mac) {
	return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}
function encryptionLabel(enc) {
	enc = String(enc || '').toLowerCase();
	if (!enc || enc === 'none') return _('Open');
	if (enc === 'owe') return _('Enhanced Open (OWE)');
	if (enc.indexOf('sae-mixed') === 0) return 'WPA2 / WPA3';
	if (enc.indexOf('sae') === 0) return 'WPA3';
	if (enc.indexOf('psk-mixed') === 0) return 'WPA / WPA2';
	if (enc.indexOf('psk2') === 0) return 'WPA2';
	if (enc.indexOf('psk') === 0) return 'WPA';
	if (enc.indexOf('wpa3') === 0) return 'WPA3 Enterprise';
	if (enc.indexOf('wpa') === 0) return 'WPA Enterprise';
	if (enc.indexOf('wep') === 0) return 'WEP';
	return enc.toUpperCase();
}
function bandLabel(band, channel) {
	if (band === '2g') return '2.4 GHz';
	if (band === '5g') return '5 GHz';
	if (band === '6g') return '6 GHz';
	if (channel != null) return channel > 177 ? '6 GHz' : (channel > 14 ? '5 GHz' : '2.4 GHz');
	return _('Radio');
}

function menuHas(tree, route) {
	if (!tree || !route) return false;
	var cur = tree, parts = String(route).split('/');
	for (var i = 0; i < parts.length && cur; i++)
		cur = cur.children && cur.children[parts[i]];
	return !!cur;
}

/* OpenWrt 24.10 & 25.12+ ship `admin/system/package-manager` (opkg/apk);
 * OpenWrt 23.05 shipped `admin/system/opkg`. Resolve dynamically via menu. */
function pkgLink(attrs, children) {
	var a = E('a', Object.assign({ 'href': L.url('admin/system/package-manager') }, attrs || {}), children);
	if (ui && ui.menu && typeof ui.menu.load === 'function') {
		ui.menu.load().then(function(tree) {
			var cands = [ 'admin/system/package-manager', 'admin/system/opkg', 'admin/system/software' ];
			for (var i = 0; i < cands.length; i++) {
				if (menuHas(tree, cands[i])) { a.href = L.url(cands[i]); break; }
			}
		}).catch(function() {});
	}
	return a;
}

return baseclass.extend({
	icon: icon, iconLabel: iconLabel, iconButton: iconButton, iconLink: iconLink, help: help,
	pill: pill, stat: stat, hero: hero, card: card, kv: kv, empty: empty, toast: toast, toggle: toggle,
	apply: apply, confirm: confirm, formModal: formModal, input: input, select: select,
	fmtBytes: fmtBytes, fmtRate: fmtRate, fmtUptime: fmtUptime, fmtDuration: fmtDuration,
	signalQuality: signalQuality, sigBars: sigBars, macKey: macKey, encryptionLabel: encryptionLabel, bandLabel: bandLabel,
	menuHas: menuHas, pkgLink: pkgLink
});
