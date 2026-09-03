'use strict';
/* Wundr qr.js — dependency-free QR Code encoder (ISO/IEC 18004, byte mode,
 * error-correction level L, versions 1–9, automatic mask selection).
 * Covers Wi-Fi join strings (WIFI:T:WPA;S:…;P:…;;) up to 230 bytes.
 * Exposes window.WBQR = { encode(text) -> {size, get(x,y)}, draw(canvas, text, opts) }. */

(function (window) {
	var TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292];
	var ECC_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30];
	var BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2];
	var ALIGN = [null, null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];
	var MAX_VERSION = 9;

	/* ---- GF(256) arithmetic, primitive polynomial 0x11D ---- */
	var EXP = new Array(512), LOG = new Array(256);
	(function () {
		var x = 1;
		for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
		for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
	})();
	function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

	function rsGenerator(degree) {
		var poly = [1];
		for (var i = 0; i < degree; i++) {
			var next = new Array(poly.length + 1).fill(0);
			for (var j = 0; j < poly.length; j++) {
				next[j] ^= poly[j];
				next[j + 1] ^= gfMul(poly[j], EXP[i]);
			}
			poly = next;
		}
		return poly;
	}

	function rsRemainder(data, gen) {
		var result = new Array(gen.length - 1).fill(0);
		for (var i = 0; i < data.length; i++) {
			var factor = data[i] ^ result.shift();
			result.push(0);
			for (var j = 0; j < result.length; j++) result[j] ^= gfMul(gen[j + 1], factor);
		}
		return result;
	}

	/* ---- data encoding ---- */
	function utf8Bytes(text) {
		var s = unescape(encodeURIComponent(String(text)));
		var out = [];
		for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
		return out;
	}

	function dataCapacity(version) { return TOTAL[version] - ECC_PER_BLOCK[version] * BLOCKS[version]; }

	function chooseVersion(byteLen) {
		for (var v = 1; v <= MAX_VERSION; v++)
			if (dataCapacity(v) * 8 >= 4 + 8 + byteLen * 8) return v;
		return 0;
	}

	function buildCodewords(bytes, version) {
		var bits = [];
		function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
		push(4, 4);
		push(bytes.length, 8);
		bytes.forEach(function (b) { push(b, 8); });
		var capacity = dataCapacity(version) * 8;
		push(0, Math.min(4, capacity - bits.length));
		while (bits.length % 8) bits.push(0);
		for (var pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);

		var data = [];
		for (var i = 0; i < bits.length; i += 8) {
			var byte = 0;
			for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
			data.push(byte);
		}

		var numBlocks = BLOCKS[version], eccLen = ECC_PER_BLOCK[version];
		var blockLen = data.length / numBlocks;
		var gen = rsGenerator(eccLen);
		var blocks = [], eccs = [];
		for (var b = 0; b < numBlocks; b++) {
			var chunk = data.slice(b * blockLen, (b + 1) * blockLen);
			blocks.push(chunk);
			eccs.push(rsRemainder(chunk, gen));
		}
		var out = [];
		for (var i2 = 0; i2 < blockLen; i2++) for (var b2 = 0; b2 < numBlocks; b2++) out.push(blocks[b2][i2]);
		for (var e = 0; e < eccLen; e++) for (var b3 = 0; b3 < numBlocks; b3++) out.push(eccs[b3][e]);
		return out;
	}

	/* ---- matrix ---- */
	function Matrix(size) {
		this.size = size;
		this.modules = [];
		this.isFunction = [];
		for (var y = 0; y < size; y++) {
			this.modules.push(new Array(size).fill(false));
			this.isFunction.push(new Array(size).fill(false));
		}
	}
	Matrix.prototype.setFn = function (x, y, dark) { this.modules[y][x] = dark; this.isFunction[y][x] = true; };

	function drawFinder(m, cx, cy) {
		for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
			var dist = Math.max(Math.abs(dx), Math.abs(dy));
			var x = cx + dx, y = cy + dy;
			if (x >= 0 && x < m.size && y >= 0 && y < m.size) m.setFn(x, y, dist !== 2 && dist !== 4);
		}
	}
	function drawAlignment(m, cx, cy) {
		for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
			m.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
	}

	function drawFormatBits(m, mask) {
		var data = (1 << 3) | mask; /* ECC level L = 01 */
		var rem = data;
		for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		var bits = ((data << 10) | rem) ^ 0x5412;
		function bit(i) { return ((bits >>> i) & 1) === 1; }
		var size = m.size;
		for (var a = 0; a <= 5; a++) m.setFn(8, a, bit(a));
		m.setFn(8, 7, bit(6));
		m.setFn(8, 8, bit(7));
		m.setFn(7, 8, bit(8));
		for (var b = 9; b < 15; b++) m.setFn(14 - b, 8, bit(b));
		for (var c = 0; c < 8; c++) m.setFn(size - 1 - c, 8, bit(c));
		for (var d = 8; d < 15; d++) m.setFn(8, size - 15 + d, bit(d));
		m.setFn(8, size - 8, true);
	}

	function drawVersionBits(m, version) {
		if (version < 7) return;
		var rem = version;
		for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
		var bits = (version << 12) | rem;
		for (var k = 0; k < 18; k++) {
			var dark = ((bits >>> k) & 1) === 1;
			var a = m.size - 11 + (k % 3), b = Math.floor(k / 3);
			m.setFn(a, b, dark);
			m.setFn(b, a, dark);
		}
	}

	function drawFunctionPatterns(m, version) {
		var size = m.size;
		for (var i = 0; i < size; i++) { m.setFn(6, i, i % 2 === 0); m.setFn(i, 6, i % 2 === 0); }
		drawFinder(m, 3, 3); drawFinder(m, size - 4, 3); drawFinder(m, 3, size - 4);
		var pos = ALIGN[version];
		if (pos) {
			var n = pos.length;
			for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
				if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
				drawAlignment(m, pos[a], pos[b]);
			}
		}
		drawFormatBits(m, 0);
		drawVersionBits(m, version);
	}

	function drawCodewords(m, codewords) {
		var size = m.size, i = 0, total = codewords.length * 8;
		for (var right = size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (var vert = 0; vert < size; vert++) {
				for (var j = 0; j < 2; j++) {
					var x = right - j;
					var upward = ((right + 1) & 2) === 0;
					var y = upward ? size - 1 - vert : vert;
					if (!m.isFunction[y][x] && i < total) {
						m.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
						i++;
					}
				}
			}
		}
	}

	function maskBit(mask, x, y) {
		switch (mask) {
			case 0: return (x + y) % 2 === 0;
			case 1: return y % 2 === 0;
			case 2: return x % 3 === 0;
			case 3: return (x + y) % 3 === 0;
			case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
			case 5: return (x * y) % 2 + (x * y) % 3 === 0;
			case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
			default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
		}
	}
	function applyMask(m, mask) {
		for (var y = 0; y < m.size; y++) for (var x = 0; x < m.size; x++)
			if (!m.isFunction[y][x] && maskBit(mask, x, y)) m.modules[y][x] = !m.modules[y][x];
	}

	function finderPenalty(runHistory) {
		var n = runHistory[1];
		var core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
		return ((core && runHistory[0] >= n * 4 && runHistory[6] >= n) ? 1 : 0) + ((core && runHistory[6] >= n * 4 && runHistory[0] >= n) ? 1 : 0);
	}
	/* The quiet zone counts as light border on the first and last run. */
	function addRun(runHistory, len, size) {
		if (runHistory[0] === 0) len += size;
		runHistory.pop(); runHistory.unshift(len);
	}

	function penalty(m) {
		var size = m.size, result = 0, x, y;
		for (y = 0; y < size; y++) {
			var runColor = false, runX = 0, hist = [0, 0, 0, 0, 0, 0, 0];
			for (x = 0; x < size; x++) {
				if (m.modules[y][x] === runColor) {
					runX++;
					if (runX === 5) result += 3; else if (runX > 5) result++;
				} else {
					addRun(hist, runX, size);
					if (!runColor) result += finderPenalty(hist) * 40;
					runColor = m.modules[y][x]; runX = 1;
				}
			}
			if (runColor) { addRun(hist, runX, size); runX = 0; }
			addRun(hist, runX + size, size);
			result += finderPenalty(hist) * 40;
		}
		for (x = 0; x < size; x++) {
			var runColorC = false, runY = 0, histC = [0, 0, 0, 0, 0, 0, 0];
			for (y = 0; y < size; y++) {
				if (m.modules[y][x] === runColorC) {
					runY++;
					if (runY === 5) result += 3; else if (runY > 5) result++;
				} else {
					addRun(histC, runY, size);
					if (!runColorC) result += finderPenalty(histC) * 40;
					runColorC = m.modules[y][x]; runY = 1;
				}
			}
			if (runColorC) { addRun(histC, runY, size); runY = 0; }
			addRun(histC, runY + size, size);
			result += finderPenalty(histC) * 40;
		}
		for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
			var c = m.modules[y][x];
			if (c === m.modules[y][x + 1] && c === m.modules[y + 1][x] && c === m.modules[y + 1][x + 1]) result += 3;
		}
		var dark = 0;
		for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m.modules[y][x]) dark++;
		var total = size * size;
		var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
		result += k * 10;
		return result;
	}

	function encode(text) {
		var bytes = utf8Bytes(text);
		var version = chooseVersion(bytes.length);
		if (!version) return null;
		var codewords = buildCodewords(bytes, version);
		var m = new Matrix(17 + version * 4);
		drawFunctionPatterns(m, version);
		drawCodewords(m, codewords);
		var best = 0, bestScore = Infinity;
		for (var mask = 0; mask < 8; mask++) {
			applyMask(m, mask);
			drawFormatBits(m, mask);
			var score = penalty(m);
			if (score < bestScore) { bestScore = score; best = mask; }
			applyMask(m, mask);
		}
		applyMask(m, best);
		drawFormatBits(m, best);
		return {
			size: m.size,
			version: version,
			mask: best,
			get: function (x, y) { return !!(m.modules[y] && m.modules[y][x]); }
		};
	}

	function draw(canvas, text, opts) {
		opts = opts || {};
		var qr = encode(text);
		if (!qr) return null;
		var scale = opts.scale || Math.max(2, Math.floor((opts.size || 240) / (qr.size + 8)));
		var quiet = opts.quiet == null ? 4 : opts.quiet;
		var px = (qr.size + quiet * 2) * scale;
		var dpr = Math.min(window.devicePixelRatio || 1, 3);
		canvas.width = px * dpr; canvas.height = px * dpr;
		canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
		var ctx = canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.fillStyle = opts.light || '#ffffff';
		ctx.fillRect(0, 0, px, px);
		ctx.fillStyle = opts.dark || '#111111';
		for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++)
			if (qr.get(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
		return qr;
	}

	/* Escapes a value for the WIFI: join-string grammar. */
	function wifiString(ssid, key, type, hidden) {
		var esc = function (s) { return String(s == null ? '' : s).replace(/([\\;,:"])/g, '\\$1'); };
		var t = type === 'nopass' ? 'nopass' : (type === 'WEP' ? 'WEP' : 'WPA');
		return 'WIFI:T:' + t + ';S:' + esc(ssid) + ';' + (t === 'nopass' ? '' : 'P:' + esc(key) + ';') + (hidden ? 'H:true;' : '') + ';';
	}

	var api = { encode: encode, draw: draw, wifiString: wifiString };
	if (typeof window !== 'undefined') window.WBQR = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
