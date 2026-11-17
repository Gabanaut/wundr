'use strict';
/* OpenWrt 24.10+ (opkg) & 25.x+ (apk) LuCI compatibility & runtime harness.
 * Validates ucode templates, Makefiles/upgrade hooks, menu.d/acl.d schemas,
 * LuCI validation.js datatypes, DOM E() contracts, CSS selectors, and executes
 * load()+render() across all 15 views + theme chrome against simulated OpenWrt
 * 24+/25+ router state (CIDR ipaddr lists, anonymous @system[0], 2FA sysauth).
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var THEME = path.join(ROOT, 'luci-theme-wundr');
var APP = path.join(ROOT, 'luci-app-wundr');
var LUCI_BASE = path.join(ROOT, 'extras', 'openwrt_sources', 'luci', 'modules', 'luci-base');

var failures = [];
var checks = 0;

function ok(msg) { checks++; }
function fail(msg) { checks++; failures.push(msg); }
function assert(cond, msg) { if (cond) ok(msg); else fail(msg); }

function readUtf8(rel) {
	return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ==========================================================================
 * 1. ucode template lexer & grammar check (matches jow-/ucode lexer.c)
 * ========================================================================== */
function stripStringsAndComments(code) {
	var out = '', i = 0, n = code.length;
	while (i < n) {
		var c = code[i], next = code[i + 1];
		if (c === '/' && next === '/') {
			while (i < n && code[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			var q = c;
			out += '""';
			i++;
			while (i < n && code[i] !== q) {
				if (code[i] === '\\') { i += 2; continue; }
				if (q === '`' && code[i] === '$' && code[i + 1] === '{') {
					/* keep template placeholder expressions visible to keyword scan */
					out += '+(';
					i += 2;
					var depth = 1;
					while (i < n && depth > 0) {
						if (code[i] === "'" || code[i] === '"') {
							var sq = code[i++];
							while (i < n && code[i] !== sq) { if (code[i] === '\\') i++; i++; }
							out += '""';
							i++;
							continue;
						}
						if (code[i] === '{') depth++;
						else if (code[i] === '}') { depth--; if (depth === 0) { i++; break; } }
						out += code[i++];
					}
					out += ')+""';
					continue;
				}
				i++;
			}
			i++;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

function checkUcodeTemplate(relPath) {
	var src = readUtf8(relPath);
	var pos = 0, n = src.length;
	var blockStack = [];
	var jsBody = [];

	while (pos < n) {
		var idx = src.indexOf('{', pos);
		if (idx < 0) break;
		var kind = src[idx + 1];
		if (kind !== '%' && kind !== '{' && kind !== '#') { pos = idx + 1; continue; }

		var closeTag = kind === '%' ? '%}' : (kind === '{' ? '}}' : '#}');
		var startInner = idx + 2;
		if (src[startInner] === '-' || (kind === '%' && src[startInner] === '+')) startInner++;

		var endIdx = -1;
		var i = startInner;
		if (kind === '#') {
			endIdx = src.indexOf('#}', i);
			assert(endIdx >= 0, relPath + ': unterminated {# comment #}');
			if (endIdx < 0) return;
			pos = endIdx + 2;
			continue;
		}

		/* Scan balanced respecting quotes so '}}' inside a string won't close early */
		while (i < n) {
			var ch = src[i];
			if (ch === "'" || ch === '"' || ch === '`') {
				var q = ch; i++;
				while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
				i++;
				continue;
			}
			if (ch === '{' && (src[i + 1] === '%' || src[i + 1] === '{')) {
				fail(relPath + ': nested template tag at offset ' + i);
				return;
			}
			if (src.substr(i, 2) === closeTag) { endIdx = i; break; }
			i++;
		}
		assert(endIdx >= 0, relPath + ': unterminated ' + (kind === '%' ? '{%' : '{{') + ' block');
		if (endIdx < 0) return;

		var bodyEnd = endIdx;
		if (src[bodyEnd - 1] === '-') bodyEnd--;
		var inner = src.slice(startInner, bodyEnd).trim();
		var stripped = stripStringsAndComments(inner);

		/* ucode uses C/JS operators (||, &&, !, ==, !=, ??), NEVER Python/Lua or/and/not/nil/elseif/then */
		var badKw = /\b(or|and|not|elseif|then|nil)\b/.exec(stripped);
		assert(!badKw, relPath + ': invalid ucode keyword "' + (badKw && badKw[1]) + '" in `' + inner + '` (ucode requires ||, &&, !, null, elif)');

		if (kind === '{') {
			jsBody.push('__emit__(' + inner + ');');
		} else {
			var t = inner;
			if (/^if\s*\(([\s\S]+)\)\s*:\s*$/.test(t)) {
				blockStack.push('if');
				jsBody.push('if (' + RegExp.$1 + ') {');
			} else if (/^elif\s*\(([\s\S]+)\)\s*:\s*$/.test(t)) {
				assert(blockStack[blockStack.length - 1] === 'if', relPath + ': elif without matching if');
				jsBody.push('} else if (' + RegExp.$1 + ') {');
			} else if (/^else\s*:?\s*$/.test(t)) {
				assert(blockStack.length > 0, relPath + ': else without matching block');
				jsBody.push('} else {');
			} else if (/^endif\s*;?\s*$/.test(t)) {
				assert(blockStack.pop() === 'if', relPath + ': endif without matching if');
				jsBody.push('}');
			} else if (/^for\s*\(\s*let\s+([A-Za-z0-9_,\s]+)\s+in\s+([\s\S]+)\)\s*:\s*$/.test(t)) {
				blockStack.push('for');
				jsBody.push('for (let ' + RegExp.$1.split(',')[0].trim() + ' of (' + RegExp.$2 + ')) {');
			} else if (/^endfor\s*;?\s*$/.test(t)) {
				assert(blockStack.pop() === 'for', relPath + ': endfor without matching for');
				jsBody.push('}');
			} else {
				/* Raw ucode statement block: convert `import { a } from 'x';` for V8 syntax parse */
				var norm = t.replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]\s*;?/gm, 'const {$1} = __imp__;');
				jsBody.push(norm);
			}
		}
		pos = endIdx + 2;
	}

	assert(blockStack.length === 0, relPath + ': unclosed ucode control block(s): ' + blockStack.join(', '));

	try {
		new vm.Script('(function(){' + jsBody.join('\n') + '\n})');
		ok(relPath + ': ucode AST compiles cleanly');
	} catch (e) {
		fail(relPath + ': ucode expression/statement syntax error: ' + e.message);
	}

	/* Verify luci.mk SubstituteVersion sed rule will not double-append ?v= */
	var rawAssetRefs = src.match(/"\{\{\s*(?:media|resource)\s*\}\}[^"]*\.(?:js|css)[^"]*"/g) || [];
	rawAssetRefs.forEach(function (ref) {
		assert(ref.indexOf('?v=') < 0, relPath + ': hardcoded ?v= in ' + ref + ' breaks luci.mk SubstituteVersion');
	});
}

['luci-theme-wundr/ucode/template/themes/wundr/header.ut',
 'luci-theme-wundr/ucode/template/themes/wundr/footer.ut',
 'luci-theme-wundr/ucode/template/themes/wundr/sysauth.ut'].forEach(checkUcodeTemplate);

/* Verify sysauth.ut 2FA & attribute-spacing invariants (LuCI 24.10 / 25.x authplugins) */
var sysauthSrc = readUtf8('luci-theme-wundr/ucode/template/themes/wundr/sysauth.ut');
assert(/fuser\s*&&\s*!auth_plugin/.test(sysauthSrc), 'sysauth.ut: gates invalid-credentials alert on !auth_plugin for 2FA');
assert(!/split\(https_port\b/.test(sysauthSrc), 'sysauth.ut: free of upstream https_port typo');
['placeholder', 'inputmode', 'pattern', 'maxlength', 'autocomplete', 'required'].forEach(function (attr) {
	var re = new RegExp('\\{%\\s*if\\s*\\(field\\.' + attr + '\\):\\s*%\\}\\s+' + attr);
	assert(re.test(sysauthSrc), 'sysauth.ut: leading space before conditional ' + attr + ' attribute');
});

/* Verify header.ut uses resolved dispatch path (ctx.path) for body[data-page] */
var headerSrc = readUtf8('luci-theme-wundr/ucode/template/themes/wundr/header.ut');
assert(/length\(ctx\.path\)\s*\?\s*ctx\.path\s*:\s*ctx\.request_path/.test(headerSrc), 'header.ut: data-page uses resolved ctx.path before ctx.request_path');

/* ==========================================================================
 * 2. OpenWrt 24.10 (opkg) & 25.12+ (apk) Makefiles, menu.d, and acl.d audit
 * ========================================================================== */
var themeMk = readUtf8('luci-theme-wundr/Makefile');
var appMk = readUtf8('luci-app-wundr/Makefile');

assert(/^LUCI_MINIFY_CSS:=0$/m.test(themeMk) && /^LUCI_MINIFY_JS:=0$/m.test(themeMk), 'luci-theme-wundr/Makefile: disables csstidy & jsmin via LUCI_MINIFY_*');
assert(/^LUCI_MINIFY_CSS:=0$/m.test(appMk) && /^LUCI_MINIFY_JS:=0$/m.test(appMk), 'luci-app-wundr/Makefile: disables csstidy & jsmin via LUCI_MINIFY_*');
assert(/PKG_VERSION:=\d+\.\d+\.\d+/.test(themeMk), 'luci-theme-wundr/Makefile: apk-compatible semver PKG_VERSION');
assert(/PKG_VERSION:=\d+\.\d+\.\d+/.test(appMk), 'luci-app-wundr/Makefile: apk-compatible semver PKG_VERSION');
assert(/define Package\/luci-app-wundr\/conffiles[\s\S]*\/etc\/config\/wundr/.test(appMk), 'luci-app-wundr/Makefile: preserves /etc/config/wundr across upgrades via conffiles');
assert(/\*upgrade\*.*exit 0/.test(themeMk) && /PKG_UPGRADE/.test(themeMk), 'luci-theme-wundr/Makefile: prerm/postinst guarded against opkg & apk upgrades');
assert(/\*upgrade\*.*exit 0/.test(appMk) && /PKG_UPGRADE/.test(appMk), 'luci-app-wundr/Makefile: prerm guarded against opkg & apk upgrades');

var menuJson = JSON.parse(readUtf8('luci-app-wundr/root/usr/share/luci/menu.d/luci-app-wundr.json'));
assert(menuJson['wundr'] && menuJson['wundr'].auth && menuJson['wundr'].auth.login === true, 'menu.d: root "wundr" node enforces cookie authentication + login');
assert(Array.isArray(menuJson['wundr'].auth.methods) &&
	menuJson['wundr'].auth.methods.indexOf('cookie:sysauth_https') >= 0 &&
	menuJson['wundr'].auth.methods.indexOf('cookie:sysauth_http') >= 0, 'menu.d: root "wundr" node accepts sysauth_https and sysauth_http cookies');

var aclJson = JSON.parse(readUtf8('luci-app-wundr/root/usr/share/rpcd/acl.d/luci-app-wundr.json'));
var aclRead = aclJson['luci-app-wundr'].read;
var aclWrite = aclJson['luci-app-wundr'].write;

/* ==========================================================================
 * 3. Load real LuCI validation.js (or exact fallback) & verify all datatypes
 * ========================================================================== */
function buildValidatorCompiler() {
	var valPath = path.join(LUCI_BASE, 'htdocs', 'luci-static', 'resources', 'validation.js');
	if (fs.existsSync(valPath)) {
		var valCode = fs.readFileSync(valPath, 'utf8')
			.replace(/^\s*'require\s+[^']+';\s*$/gm, '');
		var BaseClass = function () {};
		BaseClass.extend = function (proto) {
			function C() { if (this.__init__) this.__init__.apply(this, arguments); }
			C.prototype = Object.create(BaseClass.prototype);
			Object.assign(C.prototype, proto);
			C.extend = BaseClass.extend;
			C.instantiate = function (args) { var o = Object.create(C.prototype); C.apply(o, args); return o; };
			return C;
		};
		var sb = {
			baseclass: BaseClass,
			Blob: Blob,
			findParent: function () { return true; },
			_: function (s) { return String(s); },
			L: {
				raise: function (t, fmt) {
					var args = Array.prototype.slice.call(arguments, 2);
					var msg = String(fmt).replace(/%s/g, function () { return args.shift(); });
					throw new Error(t + ': ' + msg);
				}
			}
		};
		String.prototype.format = String.prototype.format || function () {
			var a = Array.prototype.slice.call(arguments);
			return this.replace(/%[sdfux]/g, function () { return String(a.shift()); });
		};
		vm.createContext(sb);
		var Factory = vm.runInContext('(function(){' + valCode + '\n})()', sb);
		return new Factory();
	}
	/* Fallback for CI checkouts without extras/openwrt_sources */
	var KNOWN = {
		integer:1, uinteger:1, float:1, ufloat:1, ipaddr:1, ip4addr:1, ip6addr:1,
		ip6ll:1, ip6ula:1, ip4prefix:1, ip6prefix:1, cidr:1, cidr4:1, cidr6:1,
		ipnet4:1, ipnet6:1, ip6hostid:1, ipmask:1, ipmask4:1, ipmask6:1,
		iprange:1, iprange4:1, iprange6:1, port:1, portrange:1, macaddr:1,
		host:1, hostname:1, network:1, hostport:1, ip4addrport:1, ipaddrport:1,
		sep:1, tuple:1, wpakey:1, wepkey:1, uciname:1, ucifw4zonename:1,
		netdevname:1, range:1, min:1, max:1, length:1, rangelength:1,
		minlength:1, maxlength:1, or:1, and:1, neg:1, list:1, phonedigit:1,
		timehhmmss:1, dateyyyymmdd:1, unique:1, hexstring:1, string:1,
		directory:1, file:1, device:1
	};
	return {
		compile: function (code) {
			var stripped = code.replace(/"[^"]*"|'[^']*'/g, '');
			(stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach(function (tok) {
				if (!KNOWN[tok]) throw new Error('SyntaxError: Unhandled token "' + tok + '"');
			});
			return [function () { return true; }, []];
		}
	};
}

var validatorFactory = buildValidatorCompiler();

/* ==========================================================================
 * 4. Static scan of all JS files (datatypes, E() args, onclick, ACLs, CSS)
 * ========================================================================== */
function listJsFiles(dir) {
	var out = [];
	fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
		var p = path.join(dir, ent.name);
		if (ent.isDirectory()) out = out.concat(listJsFiles(p));
		else if (ent.name.endsWith('.js')) out.push(p);
	});
	return out;
}

var allJs = listJsFiles(THEME).concat(listJsFiles(APP));
var viewFiles = listJsFiles(path.join(APP, 'htdocs', 'luci-static', 'resources', 'view', 'wundr'));

allJs.forEach(function (file) {
	var rel = path.relative(ROOT, file).replace(/\\/g, '/');
	var src = fs.readFileSync(file, 'utf8');
	var noComments = stripStringsAndComments(src);

	/* 4a. Compile every LuCI datatype expression */
	var dtRe = /\.datatype\s*=\s*(['"])((?:\\.|(?!\1).)*)\1/g, m;
	while ((m = dtRe.exec(src)) !== null) {
		try {
			validatorFactory.compile(m[2]);
			ok(rel + ': valid datatype `' + m[2] + '`');
		} catch (e) {
			fail(rel + ': invalid LuCI datatype `' + m[2] + '` -> ' + e.message);
		}
	}

	/* 4b. Forbid E(..., onclick: fn) — LuCI dom.attr registers event name literally */
	var onAttr = /\bE\s*\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*\bon[a-z]+\s*:/.exec(src);
	assert(!onAttr, rel + ': E() uses DOM event name (e.g. "click") not "on*" attribute');

	/* 4c. Forbid nonexistent map.formvalue() */
	assert(!/\.map\.formvalue\s*\(/.test(noComments), rel + ': does not call nonexistent this.map.formvalue()');

	/* 4d. Check E() top-level argument count <= 3 */
	var eCallRe = /\bE\s*\(/g, em;
	while ((em = eCallRe.exec(noComments)) !== null) {
		var start = em.index + em[0].length;
		/* Ignore function E(...) declarations */
		var before = noComments.slice(Math.max(0, em.index - 12), em.index);
		if (/function\s+$/.test(before)) continue;
		var depth = 1, commas = 0, k = start;
		while (k < noComments.length && depth > 0) {
			var ch = noComments[k];
			if (ch === '(' || ch === '[' || ch === '{') depth++;
			else if (ch === ')' || ch === ']' || ch === '}') depth--;
			else if (ch === ',' && depth === 1) commas++;
			k++;
		}
		assert(commas <= 2, rel + ': E() call at offset ' + em.index + ' has ' + (commas + 1) + ' args (max 3; extra args are silently ignored by LuCI)');
	}
});

/* 4e. Views using form.Map must either keep LuCI's Save & Apply footer or provide custom save */
viewFiles.forEach(function (file) {
	var rel = path.relative(ROOT, file).replace(/\\/g, '/');
	var src = fs.readFileSync(file, 'utf8');
	if (/new\s+form\.Map\s*\(/.test(src)) {
		assert(!/handleSaveApply\s*:\s*null/.test(src), rel + ': form.Map view preserves handleSaveApply footer');
	}
	/* Verify UCI read/write ACL coverage */
	var loads = src.match(/uci\.load\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
	loads.forEach(function (l) {
		var pkg = l.match(/['"]([^'"]+)['"]/)[1];
		assert(aclRead.uci.indexOf(pkg) >= 0, rel + ': uci.load("' + pkg + '") covered by read ACL');
	});
	var maps = src.match(/new\s+form\.Map\(\s*['"]([^'"]+)['"]/g) || [];
	maps.forEach(function (mp) {
		var pkg = mp.match(/['"]([^'"]+)['"]/)[1];
		assert(aclRead.uci.indexOf(pkg) >= 0 && aclWrite.uci.indexOf(pkg) >= 0, rel + ': form.Map("' + pkg + '") covered by read+write ACL');
	});
	var writes = src.match(/uci\.(?:set|add|remove|unset)\(\s*['"]([^'"]+)['"]/g) || [];
	writes.forEach(function (w) {
		var pkg = w.match(/['"]([^'"]+)['"]/)[1];
		assert(aclWrite.uci.indexOf(pkg) >= 0, rel + ': uci mutation on "' + pkg + '" covered by write ACL');
	});
});

/* 4f. Verify CSS coverage for LuCI 24+/25+ body-level & core widgets */
var cascadeCss = readUtf8('luci-theme-wundr/htdocs/luci-static/wundr/cascade.css');
var appCss = readUtf8('luci-theme-wundr/htdocs/luci-static/wundr/app.css');
assert(/(^|\n)\.cbi-tooltip\s*\{/.test(cascadeCss), 'cascade.css: styles body-level .cbi-tooltip (unscoped to .wb-content)');
assert(/#modal_overlay\s*\{/.test(cascadeCss) && /body\.modal-overlay-active\s+#modal_overlay/.test(cascadeCss), 'cascade.css: styles LuCI #modal_overlay');
assert(/\.wb-indicators\s+\[data-indicator\]/.test(cascadeCss), 'cascade.css: styles LuCI #indicators [data-indicator]');
assert(/\.wb-content\s+\.cbi-dropdown\[open\]\s*>\s*ul\.dropdown/.test(cascadeCss), 'cascade.css: styles open LuCI .cbi-dropdown');
assert(/\.wb-log-line\s+\.lvl\.error/.test(appCss), 'app.css: styles .wb-log-line .lvl.error');

/* ==========================================================================
 * 5. Simulated OpenWrt 24.10 / 25.12 DOM + LuCI Runtime Execution
 *    Instantiates shell.js, menu-wundr.js, and ALL 15 views against realistic
 *    24+/25+ router state (CIDR ipaddr arrays, anonymous @system[0], etc.)
 * ========================================================================== */
function makeMockDOM() {
	function MockNode(tag) {
		this.tagName = String(tag || 'DIV').toUpperCase();
		this.nodeType = tag === '#fragment' ? 11 : (tag === '#text' ? 3 : 1);
		this.attributes = {};
		this.style = {
			_props: {},
			setProperty: function (k, v) { this._props[k] = String(v); },
			removeProperty: function (k) { delete this._props[k]; },
			getPropertyValue: function (k) { return this._props[k] || ''; }
		};
		this.children = [];
		this.childNodes = this.children;
		this.parentNode = null;
		this.listeners = {};
		this.hidden = false;
		this.disabled = false;
		this.checked = false;
		this.value = '';
		this._text = '';
		var self = this;
		this.classList = {
			_set: function () { return (self.attributes['class'] || '').split(/\s+/).filter(Boolean); },
			add: function () {
				var cur = this._set();
				Array.prototype.forEach.call(arguments, function (c) { if (c && cur.indexOf(c) < 0) cur.push(c); });
				self.attributes['class'] = cur.join(' ');
			},
			remove: function () {
				var rem = Array.prototype.slice.call(arguments);
				self.attributes['class'] = this._set().filter(function (c) { return rem.indexOf(c) < 0; }).join(' ');
			},
			toggle: function (c, force) {
				var has = this.contains(c);
				var on = force !== undefined ? !!force : !has;
				if (on) this.add(c); else this.remove(c);
				return on;
			},
			contains: function (c) { return this._set().indexOf(c) >= 0; }
		};
	}
	Object.defineProperties(MockNode.prototype, {
		className: {
			get: function () { return this.attributes['class'] || ''; },
			set: function (v) { this.attributes['class'] = String(v || ''); }
		},
		id: {
			get: function () { return this.attributes['id'] || ''; },
			set: function (v) { this.attributes['id'] = String(v || ''); }
		},
		firstChild: { get: function () { return this.children[0] || null; } },
		firstElementChild: { get: function () { return this.children.filter(function (c) { return c.nodeType === 1; })[0] || null; } },
		textContent: {
			get: function () {
				if (this.nodeType === 3) return this._text;
				return this.children.map(function (c) { return c.textContent; }).join('') + (this._text || '');
			},
			set: function (v) { this.children = []; this.childNodes = this.children; this._text = String(v == null ? '' : v); }
		},
		innerHTML: {
			get: function () { return this._html || this.textContent; },
			set: function (v) {
				this.children = []; this.childNodes = this.children; this._text = '';
				var html = String(v == null ? '' : v);
				this._html = html;
				var stack = [this];
				var tagRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g, m;
				while ((m = tagRe.exec(html)) !== null) {
					var raw = m[0], tag = m[1], attrs = m[2] || '';
					if (raw.charAt(1) === '/') {
						if (stack.length > 1) stack.pop();
					} else {
						var el = new MockNode(tag);
						var attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(['"])(.*?)\2/g, am;
						while ((am = attrRe.exec(attrs)) !== null) el.setAttribute(am[1], am[3]);
						stack[stack.length - 1].appendChild(el);
						if (!/\/\s*>$/.test(raw) && !/^(br|hr|img|input|meta|link|path|circle|rect|line|ellipse)$/i.test(tag))
							stack.push(el);
					}
				}
			}
		},
		clientWidth: { get: function () { return 320; } },
		offsetWidth: { get: function () { return 220; } },
		offsetHeight: { get: function () { return 48; } },
		offsetParent: { get: function () { return this.hidden ? null : {}; } }
	});
	MockNode.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
	MockNode.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; };
	MockNode.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
	MockNode.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); };
	MockNode.prototype.appendChild = function (child) {
		if (!child) return child;
		if (child.nodeType === 11) {
			var copy = child.children.slice();
			child.children = [];
			copy.forEach(function (c) { this.appendChild(c); }, this);
			return child;
		}
		child.parentNode = this;
		this.children.push(child);
		return child;
	};
	MockNode.prototype.removeChild = function (child) {
		var idx = this.children.indexOf(child);
		if (idx >= 0) { this.children.splice(idx, 1); child.parentNode = null; }
		return child;
	};
	MockNode.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
	MockNode.prototype.addEventListener = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
	MockNode.prototype.dispatchEvent = function (ev) { (this.listeners[ev.type] || []).forEach(function (fn) { fn(ev); }); };
	MockNode.prototype.focus = function () {};
	MockNode.prototype.select = function () {};
	MockNode.prototype.scrollIntoView = function () {};
	MockNode.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 320, height: 180 }; };
	MockNode.prototype.getContext = function () {
		return {
			scale: function () {}, clearRect: function () {}, beginPath: function () {},
			moveTo: function () {}, lineTo: function () {}, stroke: function () {},
			closePath: function () {}, fill: function () {}, arc: function () {},
			fillRect: function () {}, fillText: function () {},
			createLinearGradient: function () { return { addColorStop: function () {} }; }
		};
	};
	function matchSimple(el, sel) {
		if (!el || el.nodeType !== 1) return false;
		sel = sel.trim();
		if (sel.charAt(0) === '#') return el.id === sel.slice(1);
		if (sel.charAt(0) === '.') return el.classList.contains(sel.slice(1));
		var m = /^([a-zA-Z0-9_-]+)?(?:\.([a-zA-Z0-9_-]+))?(?:\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\])?$/.exec(sel);
		if (!m) return false;
		if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
		if (m[2] && !el.classList.contains(m[2])) return false;
		if (m[3]) {
			if (!el.hasAttribute(m[3]) && !(m[3] === 'checked' && el.checked)) return false;
			if (m[4] !== undefined && el.getAttribute(m[3]) !== m[4]) return false;
		}
		return true;
	}
	MockNode.prototype.closest = function (sel) {
		var cur = this;
		while (cur && cur.nodeType === 1) { if (matchSimple(cur, sel)) return cur; cur = cur.parentNode; }
		return null;
	};
	MockNode.prototype.querySelectorAll = function (selGroup) {
		var parts = selGroup.split(',').map(function (s) { return s.trim(); });
		var out = [];
		function walk(n) {
			n.children.forEach(function (c) {
				if (c.nodeType === 1) {
					var hit = parts.some(function (p) {
						var segs = p.split(/\s+/);
						if (!matchSimple(c, segs[segs.length - 1])) return false;
						var anc = c.parentNode;
						for (var idx = segs.length - 2; idx >= 0; idx--) {
							while (anc && !matchSimple(anc, segs[idx])) anc = anc.parentNode;
							if (!anc) return false;
							anc = anc.parentNode;
						}
						return true;
					});
					if (hit) out.push(c);
					walk(c);
				}
			});
		}
		walk(this);
		return out;
	};
	MockNode.prototype.querySelector = function (s) { return this.querySelectorAll(s)[0] || null; };

	var docEl = new MockNode('html');
	docEl.setAttribute('data-theme', 'light');
	var body = new MockNode('body');
	docEl.appendChild(body);

	var doc = {
		readyState: 'complete',
		documentElement: docEl,
		body: body,
		_listeners: {},
		createElement: function (t) { return new MockNode(t); },
		createElementNS: function (ns, t) { return new MockNode(t); },
		createTextNode: function (t) { var n = new MockNode('#text'); n._text = String(t); return n; },
		createDocumentFragment: function () { return new MockNode('#fragment'); },
		getElementById: function (id) { return docEl.querySelector('#' + id); },
		querySelector: function (s) { return docEl.querySelector(s); },
		querySelectorAll: function (s) { return docEl.querySelectorAll(s); },
		addEventListener: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
		dispatchEvent: function (ev) { (this._listeners[ev.type] || []).forEach(function (fn) { fn(ev); }); }
	};
	return { MockNode: MockNode, document: doc };
}

function createLuciSandbox() {
	var domEnv = makeMockDOM();
	var doc = domEnv.document;

	/* Seed theme shell DOM containers matching header.ut + footer.ut */
	['wb-palette-btn', 'wb-palette-popover', 'wb-theme-toggle', 'wb-menu-search',
	 'wb-search-results', 'wb-statusrail', 'indicators', 'wb-sidenav',
	 'wb-pro-toggle', 'wb-pro-drawer', 'wb-pro-backdrop', 'wb-pro-drawer-close',
	 'wb-pro-drawer-menu', 'maincontent', 'tabmenu', 'view'].forEach(function (id) {
		var el = doc.createElement('div');
		el.id = id;
		if (id === 'wb-palette-popover' || id === 'wb-search-results' || id === 'wb-pro-drawer' || id === 'wb-pro-backdrop') el.hidden = true;
		doc.body.appendChild(el);
	});

	/* Realistic OpenWrt 24.10 / 25.12 UCI state:
	 * - network.lan uses CIDR array `ipaddr: ['192.168.1.1/24']` (no scalar netmask!)
	 * - system uses anonymous `cfg01e48a` (`@system[0]`), NO named 'system' section!
	 * - dhcp.lan uses `dhcp_option: ['3,192.168.1.1', '6,1.1.1.1,8.8.8.8']`
	 */
	var uciStore = {
		wundr: {
			global: { '.name': 'global', '.type': 'global', '.anonymous': false, enabled: '1' },
			fam1: { '.name': 'fam1', '.type': 'family', '.anonymous': false, name: 'Kids', mode: 'schedule', bedtime_start: '21:00', bedtime_end: '07:00', bedtime_days: ['Mon', 'Tue'], devices: ['AA:BB:CC:DD:EE:01'] }
		},
		network: {
			loopback: { '.name': 'loopback', '.type': 'interface', proto: 'static', device: 'lo', ipaddr: ['127.0.0.1/8'] },
			br_lan: { '.name': 'br_lan', '.type': 'device', name: 'br-lan', type: 'bridge', ports: ['lan1', 'lan2', 'lan3', 'lan4'], vlan_filtering: '1' },
			lan: { '.name': 'lan', '.type': 'interface', proto: 'static', device: 'br-lan', ipaddr: ['192.168.1.1/24'] },
			wan: { '.name': 'wan', '.type': 'interface', proto: 'dhcp', device: 'eth1' },
			wan6: { '.name': 'wan6', '.type': 'interface', proto: 'dhcpv6', device: 'eth1' },
			wundr_vlan10: { '.name': 'wundr_vlan10', '.type': 'bridge-vlan', device: 'br-lan', vlan: '10', ports: ['lan4:u*'] },
			lan10: { '.name': 'lan10', '.type': 'interface', proto: 'static', device: 'br-lan.10', ipaddr: ['192.168.10.1/24'] }
		},
		dhcp: {
			dnsmasq0: { '.name': 'dnsmasq0', '.type': 'dnsmasq', '.anonymous': true, noresolv: '1' },
			lan: { '.name': 'lan', '.type': 'dhcp', interface: 'lan', start: '100', limit: '150', leasetime: '12h', dhcp_option: ['3,192.168.1.1', '6,1.1.1.1,8.8.8.8'] }
		},
		wireless: {
			radio0: { '.name': 'radio0', '.type': 'wifi-device', band: '2g', channel: 'auto', htmode: 'HE40', country: 'US' },
			radio1: { '.name': 'radio1', '.type': 'wifi-device', band: '5g', channel: '36', htmode: 'HE80', country: 'US' },
			sta_radio0: { '.name': 'sta_radio0', '.type': 'wifi-iface', device: 'radio0', mode: 'sta', network: 'wwan', ssid: 'UpstreamISP', encryption: 'psk2' },
			default_radio0: { '.name': 'default_radio0', '.type': 'wifi-iface', device: 'radio0', mode: 'ap', network: 'lan', ssid: 'HomeWiFi', encryption: 'sae-mixed', key: 'supersecret123' }
		},
		firewall: {
			defaults0: { '.name': 'defaults0', '.type': 'defaults', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', syn_flood: '1' },
			zone_lan: { '.name': 'zone_lan', '.type': 'zone', name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' },
			zone_wan: { '.name': 'zone_wan', '.type': 'zone', name: 'wan', network: ['wan', 'wan6'], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: '1', syn_flood: '1' },
			zone_guest: { '.name': 'zone_guest', '.type': 'zone', name: 'guest', network: ['lan10'], input: 'ACCEPT', output: 'ACCEPT', forward: 'REJECT' },
			fwd_lan_wan: { '.name': 'fwd_lan_wan', '.type': 'forwarding', src: 'lan', dest: 'wan' },
			fwd_guest_lan: { '.name': 'fwd_guest_lan', '.type': 'forwarding', src: 'guest', dest: 'lan' },
			rule_pause: { '.name': 'rule_pause', '.type': 'rule', name: 'wundr_block_AABBCCDDEE02', src: 'lan', dest: 'wan', target: 'REJECT', src_mac: ['AA:BB:CC:DD:EE:02'] }
		},
		system: {
			cfg01e48a: { '.name': 'cfg01e48a', '.type': 'system', '.anonymous': true, hostname: 'OpenWrt25', zonename: 'UTC', timezone: 'GMT0' },
			ntp: { '.name': 'ntp', '.type': 'timeserver', '.anonymous': false, enabled: '1', server: ['0.openwrt.pool.ntp.org'] }
		},
		sqm: {
			eth1: { '.name': 'eth1', '.type': 'queue', '.anonymous': false, interface: 'eth1', enabled: '1', download: '90000', upload: '20000' }
		}
	};

	/* Exact LuCI DOM.create (`E`) contract: max 3 args! */
	function domAppend(elem, children) {
		if (children == null || children === '') return;
		if (Array.isArray(children)) {
			children.forEach(function (c) { domAppend(elem, c); });
		} else if (children && typeof children === 'object' && children.nodeType) {
			elem.appendChild(children);
		} else {
			elem.appendChild(doc.createTextNode(String(children)));
		}
	}
	function E() {
		var html = arguments[0], attr = arguments[1], data = arguments[2];
		if (attr == null || typeof attr !== 'object' || Array.isArray(attr) || attr.nodeType) {
			data = attr; attr = null;
		}
		var elem;
		if (Array.isArray(html)) {
			elem = doc.createDocumentFragment();
			html.forEach(function (h) { domAppend(elem, h); });
		} else if (html && html.nodeType) {
			elem = html;
		} else {
			elem = doc.createElement(html || 'span');
		}
		if (attr) {
			Object.keys(attr).forEach(function (k) {
				if (attr[k] == null) return;
				if (typeof attr[k] === 'function') elem.addEventListener(k, attr[k]);
				else if (typeof attr[k] === 'object') elem.setAttribute(k, JSON.stringify(attr[k]));
				else elem.setAttribute(k, attr[k]);
			});
		}
		domAppend(elem, data);
		return elem;
	}

	var domMod = {
		create: E,
		append: domAppend,
		content: function (node, children) {
			if (!node) return null;
			while (node.firstChild) node.removeChild(node.firstChild);
			domAppend(node, children);
			return node;
		},
		elem: function (x) { return !!(x && x.nodeType === 1); }
	};

	var newCounter = 1;
	var uciMod = {
		_store: uciStore,
		load: function (pkgs) { return Promise.resolve(Array.isArray(pkgs) ? pkgs : [pkgs]); },
		save: function () { return Promise.resolve(); },
		sections: function (conf, type, cb) {
			var bag = uciStore[conf] || {};
			var list = Object.keys(bag).map(function (k) { return bag[k]; }).filter(function (s) { return !type || s['.type'] === type; });
			if (typeof cb === 'function') list.forEach(function (s) { cb(s, s['.name']); });
			return list;
		},
		get: function (conf, sid, opt) {
			if (!sid) return null;
			var s = (uciStore[conf] || {})[sid];
			if (!s) return null;
			return opt == null ? s : (s[opt] !== undefined ? s[opt] : null);
		},
		get_all: function (conf, sid) { return sid ? ((uciStore[conf] || {})[sid] || null) : (uciStore[conf] || {}); },
		set: function (conf, sid, opt, val) {
			uciStore[conf] = uciStore[conf] || {};
			if (!uciStore[conf][sid]) return;
			if (val == null) delete uciStore[conf][sid][opt];
			else uciStore[conf][sid][opt] = Array.isArray(val) ? val.slice() : String(val);
		},
		unset: function (conf, sid, opt) { if (uciStore[conf] && uciStore[conf][sid]) delete uciStore[conf][sid][opt]; },
		add: function (conf, type, name) {
			uciStore[conf] = uciStore[conf] || {};
			var sid = name || ('new00' + (newCounter++));
			uciStore[conf][sid] = { '.name': sid, '.type': type, '.anonymous': !name };
			return sid;
		},
		remove: function (conf, sid) { if (uciStore[conf]) delete uciStore[conf][sid]; }
	};

	function prefixToMask(bits) {
		var m = [];
		for (var i = 0; i < 2; i++) {
			var b = Math.min(16, bits);
			m.push((0xffff << (16 - b)) & 0xffff);
			bits -= b;
		}
		return [m[0] >>> 8, m[0] & 0xff, m[1] >>> 8, m[1] & 0xff].join('.');
	}
	function maskToPrefix(mask) {
		var parts = String(mask).split('.').map(Number);
		if (parts.length !== 4 || parts.some(function (x) { return isNaN(x) || x < 0 || x > 255; })) return null;
		var bits = 0, zero = false;
		for (var i = 0; i < 4; i++) {
			var v = parts[i];
			for (var b = 7; b >= 0; b--) {
				if (v & (1 << b)) { if (zero) return null; bits++; }
				else zero = true;
			}
		}
		return bits;
	}

	var networkMod = {
		flushCache: function () { return Promise.resolve(); },
		prefixToMask: prefixToMask,
		maskToPrefix: maskToPrefix,
		getHostHints: function () { return Promise.resolve({ 'AA:BB:CC:DD:EE:01': { name: 'Ava-iPad' } }); },
		getProtocols: function () {
			return Promise.resolve(['dhcp', 'static', 'pppoe'].map(function (p) {
				return { getProtocol: function () { return p; }, isInstalled: function () { return true; } };
			}));
		},
		getWANNetworks: function () {
			return Promise.resolve([{
				getName: function () { return 'wan'; },
				isUp: function () { return true; },
				isPending: function () { return false; },
				getIPAddr: function () { return '203.0.113.42'; },
				getIP6Addr: function () { return null; },
				getGatewayAddr: function () { return '203.0.113.1'; },
				getUptime: function () { return 86420; },
				getDNSAddrs: function () { return ['1.1.1.1', '9.9.9.9']; },
				getI18n: function () { return 'DHCP client'; },
				getL3Device: function () {
					return { getName: function () { return 'eth1'; }, getMAC: function () { return 'AA:BB:CC:00:11:22'; }, getRXBytes: function () { return 1048576; }, getTXBytes: function () { return 524288; } };
				}
			}]);
		},
		getWAN6Networks: function () {
			return Promise.resolve([{
				getName: function () { return 'wan6'; },
				getIP6Addr: function () { return '2001:db8::2/64'; },
				getIP6Prefix: function () { return '2001:db8:abcd::/48'; },
				getDNS6Addrs: function () { return ['2606:4700:4700::1111']; }
			}]);
		},
		getWifiDevices: function () {
			return Promise.resolve(['radio0', 'radio1'].map(function (rn) {
				var c = uciStore.wireless[rn];
				return {
					getName: function () { return rn; },
					isUp: function () { return true; },
					isDisabled: function () { return c.disabled === '1'; },
					get: function (k) { return c[k] || null; }
				};
			}));
		},
		getWifiNetworks: function () {
			return Promise.resolve(['sta_radio0', 'default_radio0'].map(function (sid) {
				var c = uciStore.wireless[sid];
				return {
					getName: function () { return sid; },
					getMode: function () { return c.mode; },
					getSSID: function () { return c.ssid; },
					getActiveSSID: function () { return c.ssid; },
					getChannel: function () { return c.device === 'radio1' ? 36 : 6; },
					getTXPower: function () { return 20; },
					getCountryCode: function () { return 'US'; },
					getWifiDeviceName: function () { return c.device; },
					getWifiDevice: function () { var r = uciStore.wireless[c.device]; return { get: function (k) { return r[k]; } }; },
					get: function (k) { return c[k] || null; },
					isUp: function () { return c.mode === 'ap'; },
					isDisabled: function () { return c.disabled === '1'; },
					getAssocList: function () {
						return Promise.resolve(c.mode === 'ap' ? [{ mac: 'AA:BB:CC:DD:EE:01', signal: -52 }] : []);
					}
				};
			}));
		}
	};

	var firewallMod = {
		getZones: function () {
			return Promise.resolve(uciMod.sections('firewall', 'zone').map(function (z) {
				return {
					'.name': z['.name'],
					getName: function () { return z.name; },
					get: function (k) { return z[k]; },
					getInput: function () { return z.input || 'REJECT'; },
					getForward: function () { return z.forward || 'REJECT'; },
					isMasquerade: function () { return z.masq === '1'; }
				};
			}));
		}
	};

	/* Minimal faithful form.Map / Section / Option implementation matching LuCI 24+/25+ */
	function CBIOption(map, section, name, title, desc) {
		this.map = map; this.section = section; this.option = name;
		this.title = title || ''; this.description = desc || '';
		this.values = []; this.deps = []; this.rmempty = true; this.optional = false;
		this.enabled = '1'; this.disabled = '0';
		this._formValues = {};
	}
	CBIOption.prototype.value = function (v, l) { this.values.push([v, l || v]); };
	CBIOption.prototype.depends = function (k, v) { this.deps.push([k, v]); };
	CBIOption.prototype.cfgvalue = function (sid) {
		var ucfg = this.uciconfig || this.map.config;
		var usid = this.ucisection || sid;
		var uopt = this.ucioption || this.option;
		var v = uciMod.get(ucfg, usid, uopt);
		return v != null ? v : this.default;
	};
	CBIOption.prototype.formvalue = function (sid) {
		return Object.prototype.hasOwnProperty.call(this._formValues, sid) ? this._formValues[sid] : this.cfgvalue(sid);
	};
	CBIOption.prototype.write = function (sid, val) {
		uciMod.set(this.uciconfig || this.map.config, this.ucisection || sid, this.ucioption || this.option, val);
	};
	CBIOption.prototype.remove = function (sid) {
		uciMod.unset(this.uciconfig || this.map.config, this.ucisection || sid, this.ucioption || this.option);
	};

	function CBISection(map, kind, a, b, c) {
		this.map = map; this.kind = kind;
		if (kind === 'named') { this.section = a; this.sectiontype = b; this.title = c || ''; }
		else { this.sectiontype = a; this.title = b || ''; }
		this.children = [];
	}
	CBISection.prototype.option = function (Cls, name, title, desc) {
		var o = new CBIOption(this.map, this, name, title, desc);
		this.children.push(o);
		return o;
	};
	CBISection.prototype.cfgsections = function () {
		if (this.kind === 'named') return uciMod.get(this.map.config, this.section) ? [this.section] : [];
		return uciMod.sections(this.map.config, this.sectiontype).map(function (s) { return s['.name']; });
	};
	CBISection.prototype.formvalue = function (sid, optName) {
		for (var i = 0; i < this.children.length; i++)
			if (this.children[i].option === optName) return this.children[i].formvalue(sid);
		return null;
	};
	CBISection.prototype.render = function () {
		var self = this;
		var sids = this.cfgsections();
		var secEl = E('div', { 'class': 'cbi-section' }, [
			this.title ? E('h3', {}, [this.title]) : '',
			sids.length ? E('div', { 'class': 'cbi-section-node' }, sids.map(function (sid) {
				return E('div', { 'data-sid': sid }, self.children.map(function (o) {
					if (o.datatype) validatorFactory.compile(o.datatype);
					var val = o.cfgvalue(sid);
					if (typeof o.validate === 'function') o.validate(sid, Array.isArray(val) ? val[0] : (val || ''));
					return E('div', { 'class': 'cbi-value', 'data-opt': o.option }, [
						E('label', { 'class': 'cbi-value-title' }, [o.title]),
						E('div', { 'class': 'cbi-value-field' }, [Array.isArray(val) ? val.join(' ') : (val == null ? '' : String(val))])
					]);
				}));
			})) : E('div', { 'class': 'cbi-section-empty' }, ['empty'])
		]);
		return secEl;
	};

	function CBIMap(config, title, desc) {
		this.config = config; this.title = title; this.description = desc;
		this.sections = [];
		CBIMap._instances.push(this);
	}
	CBIMap._instances = [];
	CBIMap.prototype.section = function (Cls, a, b, c) {
		var s = new CBISection(this, Cls._kind, a, b, c);
		this.sections.push(s);
		return s;
	};
	CBIMap.prototype.render = function () {
		var root = E('div', { 'class': 'cbi-map' }, [
			this.title ? E('h2', {}, [this.title]) : '',
			this.sections.map(function (s) { return s.render(); })
		]);
		return Promise.resolve(root);
	};

	var formMod = {
		Map: CBIMap,
		NamedSection: { _kind: 'named' },
		TypedSection: { _kind: 'typed' },
		GridSection: { _kind: 'grid' },
		Value: CBIOption,
		ListValue: CBIOption,
		Flag: CBIOption,
		DynamicList: CBIOption
	};

	var uiMod = {
		showModal: function (title, children) { return E('div', { 'class': 'modal' }, [E('h4', {}, [title]), children]); },
		hideModal: function () {},
		addTimeLimitedNotification: function () {},
		createHandlerFn: function (ctx, fn) { return typeof fn === 'function' ? fn.bind(ctx) : ctx[fn].bind(ctx); },
		changes: { apply: function () { return Promise.resolve(); } },
		menu: {
			load: function () {
				return Promise.resolve({
					children: {
						wundr: { name: 'wundr', title: 'Wundr', satisfied: true, children: { dashboard: { name: 'dashboard', title: 'Dashboard', satisfied: true, action: { type: 'view' } } } },
						admin: { name: 'admin', title: 'Administration', satisfied: true, children: { status: { name: 'status', title: 'Status', satisfied: true, children: { overview: { name: 'overview', title: 'Overview', satisfied: true, action: { type: 'view' } } } } } }
					}
				});
			},
			getChildren: function (node) {
				if (!node || !node.children) return [];
				return Object.keys(node.children).map(function (k) {
					var c = node.children[k]; c.name = k; return c;
				});
			}
		}
	};

	var rpcMod = {
		declare: function (opts) {
			return function () {
				if (opts.object === 'system' && opts.method === 'board')
					return Promise.resolve({ hostname: 'OpenWrt25', model: 'Generic Filogic', kernel: '6.6.80', release: { distribution: 'OpenWrt', version: '25.12.0', description: 'OpenWrt 25.12.0' } });
				if (opts.object === 'system' && opts.method === 'info')
					return Promise.resolve({ uptime: 123456, localtime: 1760000000, load: [16384, 8192, 4096], memory: { total: 1073741824, available: 671088640, free: 536870912 } });
				if (opts.object === 'luci-rpc' && opts.method === 'getDHCPLeases')
					return Promise.resolve({ dhcp_leases: [{ macaddr: 'AA:BB:CC:DD:EE:01', ipaddr: '192.168.1.101', hostname: 'Ava-iPad', interface: 'lan', expires: 3600 }] });
				if (opts.object === 'luci-rpc' && opts.method === 'getHostHints')
					return Promise.resolve({ 'AA:BB:CC:DD:EE:01': { name: 'Ava-iPad' } });
				if (opts.object === 'luci' && opts.method === 'getRealtimeStats')
					return Promise.resolve([[100, 1000, 10, 500, 5], [101, 3000, 20, 1500, 10]]);
				if (opts.object === 'luci' && opts.method === 'getTimezones')
					return Promise.resolve({ 'America/New_York': { tzstring: 'EST5EDT,M3.2.0,M11.1.0', abbr: 'EDT' } });
				if (opts.object === 'rc' && opts.method === 'list')
					return Promise.resolve({ sqm: { enabled: true, start: 50 }, AdGuardHome: { enabled: false, start: 95 }, firewall: { enabled: true, start: 19 } });
				if (opts.object === 'log' && opts.method === 'read')
					return Promise.resolve({ log: [{ timestamp: 1760000000, hostname: 'OpenWrt25', logtag: 'daemon.err:', message: 'sample error test' }] });
				if (opts.object === 'network.device' && opts.method === 'status')
					return Promise.resolve({ carrier: true, speed: 1000, duplex: 'full' });
				if (opts.object === 'network.interface' && opts.method === 'dump')
					return Promise.resolve([{ interface: 'wan', up: true, route: [{ target: '0.0.0.0', mask: 0 }], 'ipv4-address': [{ address: '203.0.113.42' }] }]);
				if (opts.object === 'wundr' && opts.method === 'diagnostic')
					return Promise.resolve({ ok: 1, exitCode: 0, output: '64 bytes from 1.1.1.1' });
				return Promise.resolve({});
			};
		}
	};

	var pollMod = { add: function () {} };
	var baseclassMod = { extend: function (p) { return p; } };
	var viewMod = { extend: function (p) { return Object.assign({ handleSave: function () {}, handleSaveApply: function () {}, handleReset: function () {} }, p); } };
	var widgetsMod = { NetworkSelect: CBIOption };

	var storage = {};
	var win = {
		document: doc,
		localStorage: {
			getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
			setItem: function (k, v) { storage[k] = String(v); }
		},
		matchMedia: function () { return { matches: false, addEventListener: function () {} }; },
		getComputedStyle: function () { return { getPropertyValue: function () { return '#f48120'; } }; },
		CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
		devicePixelRatio: 1,
		addEventListener: function () {},
		setTimeout: setTimeout,
		clearTimeout: clearTimeout,
		setInterval: function () { return 0; }
	};
	win.window = win;

	var modules = {
		baseclass: baseclassMod, view: viewMod, dom: domMod, uci: uciMod,
		network: networkMod, firewall: firewallMod, form: formMod,
		ui: uiMod, rpc: rpcMod, poll: pollMod, 'tools.widgets': widgetsMod
	};

	var L = {
		env: { dispatchpath: ['admin', 'network', 'firewall', 'zones'], requestpath: ['admin', 'network', 'firewall', 'zones'], sessionid: 'abcd' },
		url: function () { return '/cgi-bin/luci/' + Array.prototype.slice.call(arguments).join('/'); },
		resolveDefault: function (p, def) { return Promise.resolve(p).then(function (v) { return v == null ? def : v; }, function () { return def; }); },
		toArray: function (v) { if (v == null || v === '') return []; return Array.isArray(v) ? v : String(v).trim().split(/\s+/); },
		naturalCompare: function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); },
		require: function (name) { return Promise.resolve(modules[name]); }
	};
	win.L = L;
	win.E = E;
	win._ = function (s) { return String(s); };

	var ctx = vm.createContext({
		document: doc, localStorage: win.localStorage,
		matchMedia: win.matchMedia, getComputedStyle: win.getComputedStyle,
		CustomEvent: win.CustomEvent, devicePixelRatio: 1,
		addEventListener: win.addEventListener,
		L: L, E: E, _: win._,
		setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: win.setInterval
	});
	ctx.window = ctx;
	ctx.globalThis = ctx;
	vm.runInContext(
		'String.prototype.format = function() { var a = Array.prototype.slice.call(arguments); return this.replace(/%[sdfux%]/g, function(m) { return m === "%%" ? "%" : String(a.shift()); }); };',
		ctx
	);

	function loadLuciModule(filePath) {
		var code = fs.readFileSync(filePath, 'utf8');
		var reqs = [];
		var body = code.replace(/^\s*'use strict';\s*/m, '').replace(/^\s*'require\s+([^']+)';\s*$/gm, function (_, spec) {
			var parts = spec.trim().split(/\s+as\s+/);
			var modName = parts[0].trim();
			var varName = (parts[1] || modName.split('.').pop()).trim();
			reqs.push({ modName: modName, varName: varName });
			return '';
		});
		var argNames = reqs.map(function (r) { return r.varName; });
		var argVals = reqs.map(function (r) {
			if (!modules[r.modName]) throw new Error('Unknown required LuCI module: ' + r.modName);
			return modules[r.modName];
		});
		var fn = vm.runInContext('(function(' + argNames.join(',') + '){\n"use strict";\n' + body + '\n})', ctx);
		return fn.apply({}, argVals);
	}

	/* Load theme globals in exact header.ut/footer.ut order */
	['palette-boot.js', 'icons.js', 'charts.js', 'qr.js', 'map-graph.js', 'shell.js'].forEach(function (f) {
		vm.runInContext(fs.readFileSync(path.join(THEME, 'htdocs', 'luci-static', 'wundr', f), 'utf8'), ctx);
	});
	modules['wundr.ui'] = loadLuciModule(path.join(APP, 'htdocs', 'luci-static', 'resources', 'wundr', 'ui.js'));

	return { ctx: ctx, doc: doc, uci: uciMod, CBIMap: CBIMap, loadLuciModule: loadLuciModule };
}

(async function runRuntimeSuite() {
	var env = createLuciSandbox();

	/* 5a. Verify shell.js palette popover renders all 8 palettes (incl. Graphite/Uber) */
	var popItems = env.doc.getElementById('wb-palette-popover').querySelectorAll('.wb-palette-item');
	assert(popItems.length === 8, 'shell.js: renders all 8 palettes in popover (got ' + popItems.length + ')');

	/* 5b. Verify palette-boot.js and shell.js apply identical tokens for every palette x mode */
	function sortedProps(obj) {
		var out = {};
		Object.keys(obj).sort().forEach(function (k) { out[k] = obj[k]; });
		return JSON.stringify(out);
	}
	['light', 'dark'].forEach(function (mode) {
		env.doc.documentElement.setAttribute('data-theme', mode);
		['Splunk', 'Aurora', 'Robinhood', 'UniFi', 'FT', 'Honey', 'Nord', 'Uber'].forEach(function (id) {
			env.doc.documentElement.style._props = {};
			env.ctx.window.wbPaletteBoot.apply(id);
			var bootSnap = sortedProps(env.doc.documentElement.style._props);

			env.doc.documentElement.style._props = {};
			env.ctx.window.WB.applyPalette(id);
			var shellSnap = sortedProps(env.doc.documentElement.style._props);
			assert(bootSnap === shellSnap, 'palette parity (' + id + '/' + mode + '): palette-boot.js == shell.js');
		});
	});

	/* 5c. Execute menu-wundr.js */
	var menuInst = env.loadLuciModule(path.join(THEME, 'htdocs', 'luci-static', 'resources', 'menu-wundr.js'));
	menuInst.__init__();
	await Promise.resolve();
	await Promise.resolve();
	assert(env.doc.getElementById('wb-pro-drawer-menu').children.length === 1, 'menu-wundr.js: populates Advanced LuCI drawer while skipping wundr tree');

	/* 5d. Execute load() + render() across all 15 views */
	for (var i = 0; i < viewFiles.length; i++) {
		var vf = viewFiles[i];
		var vname = path.basename(vf);
		env.CBIMap._instances = [];
		try {
			var v = env.loadLuciModule(vf);
			var state = v.load ? await v.load() : undefined;
			var domNode = await v.render(state);
			assert(!!domNode && !!domNode.nodeType, vname + ': load()+render() returns valid DOM Node');
			var text = domNode.textContent || '';
			assert(text.indexOf('[object Object]') < 0, vname + ': rendered output free of "[object Object]"');
			assert(text.indexOf('NaN') < 0, vname + ': rendered output free of "NaN"');

			/* Behavioral checks on key OpenWrt 24+/25+ views */
			if (vname === 'lan-config.js') {
				var netMap = env.CBIMap._instances[0], dhcpMap = env.CBIMap._instances[1];
				var lanSec = netMap.sections[0];
				var ipOpt = lanSec.children[0], maskOpt = lanSec.children[1];
				assert(ipOpt.cfgvalue('lan') === '192.168.1.1', 'lan-config.js: strips CIDR /24 from OpenWrt 24+/25+ list ipaddr');
				assert(maskOpt.cfgvalue('lan') === '255.255.255.0', 'lan-config.js: derives 255.255.255.0 from CIDR /24 when netmask unset');
				ipOpt._formValues['lan'] = '192.168.50.1';
				maskOpt._formValues['lan'] = '255.255.255.0';
				ipOpt.write('lan', '192.168.50.1');
				assert(JSON.stringify(env.uci.get('network', 'lan', 'ipaddr')) === '["192.168.50.1/24"]', 'lan-config.js: preserves OpenWrt 24+/25+ CIDR list ipaddr on write');

				var dnsSec = dhcpMap.sections[1];
				var pDns = dnsSec.children[0], sDns = dnsSec.children[1];
				assert(pDns.cfgvalue('lan') === '1.1.1.1' && sDns.cfgvalue('lan') === '8.8.8.8', 'lan-config.js: reads primary+secondary DNS from list dhcp_option');
				sDns._formValues['lan'] = '9.9.9.9';
				sDns.write('lan', '9.9.9.9');
				assert(JSON.stringify(env.uci.get('dhcp', 'lan', 'dhcp_option')) === '["3,192.168.1.1","6,1.1.1.1,9.9.9.9"]', 'lan-config.js: editing secondary DNS alone updates option 6 and preserves option 3');
			}
			if (vname === 'system.js') {
				assert(typeof v.handleSaveApply === 'function', 'system.js: exposes handleSaveApply for Save & Apply footer');
				var sysSec = env.CBIMap._instances[0].sections[0];
				assert(JSON.stringify(sysSec.cfgsections()) === '["cfg01e48a"]', 'system.js: binds to anonymous @system[0] (cfg01e48a) on OpenWrt 24+/25+');
				var ntpOpt = sysSec.children[2];
				ntpOpt.write('cfg01e48a', '0');
				
			if (vname === 'map.js') {
				assert(text.indexOf('Zones config') >= 0 && text.indexOf('Rules') >= 0, 'map.js: renders hero action buttons');
				var devBtns = domNode.querySelectorAll('.map-device');
				assert(devBtns.length >= 1, 'map.js: renders zone client buttons');
				if (devBtns[0]) {
					devBtns[0].dispatchEvent({ type: 'click' });
					ok('map.js: clicking .map-device opens client inspector modal without throwing');
				}
			}assert(env.uci.get('system', 'ntp', 'enabled') === '0', 'system.js: writes NTP state to system.ntp.enabled');
			}
			if (vname === 'devices.js') {
				var ths = domNode.querySelectorAll('th').map(function (t) { return t.textContent; });
				assert(ths.indexOf('Actions') >= 0, 'devices.js: renders "Actions" table header');
			}
		} catch (e) {
			fail(vname + ': runtime failure during load()/render(): ' + (e && e.stack ? e.stack.split('\n')[0] : e));
		}
	}

	if (failures.length) {
		console.error('OPENWRT 24+/25+ COMPAT: FAIL (' + failures.length + ' of ' + checks + ' checks failed)');
		failures.forEach(function (f) { console.error('  - ' + f); });
		process.exit(1);
	}
	console.log('OPENWRT 24+/25+ COMPAT: PASS (' + checks + ' checks across ucode, Makefiles, ACLs, validators, CSS, and 15 live-simulated views)');
})();
