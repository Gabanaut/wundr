/* wb-charts.js — tiny canvas sparklines/area/gauges, DPR-aware, token-aware, no deps.
   Exposes window.WBCharts = { spark(el, data, opts), area(el, data, opts), gauge(el, pct, opts) } */

(function (window) {
	'use strict';

	function tok(name, fallback) {
		var v = getComputedStyle(document.documentElement).getPropertyValue(name);
		return v && v.trim() ? v.trim() : fallback;
	}
	function accent() { return tok('--wb-accent', '#5b5fe8'); }
	function textSoft() { return tok('--wb-text-soft', '#8b8b95'); }
	function text() { return tok('--wb-text', '#222'); }

	/* resolve 'var(--x)' or plain color → concrete rgb string (canvas needs real colors) */
	function resolveColor(v) {
		if (typeof v === 'string' && v.indexOf('var(') === 0) {
			var name = v.slice(4, v.indexOf(')')).trim();
			return tok(name, accent());
		}
		return v;
	}

	function setup(canvas, w, h) {
		var dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = w * dpr; canvas.height = h * dpr;
		canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
		var ctx = canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);
		return ctx;
	}

	function path(ctx, pts, w, h, pad) {
		ctx.beginPath();
		pts.forEach(function (p, i) {
			var x = pad + p[0] * (w - pad * 2);
			var y = h - pad - p[1] * (h - pad * 2);
			if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		});
	}

	var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function spark(canvas, data, opts) {
		opts = opts || {};
		var w = opts.width || (canvas.clientWidth || 220);
		var h = opts.height || 28;
		var ctx = setup(canvas, w, h);
		var min = opts.min == null ? Math.min.apply(null, data) : opts.min;
		var max = opts.max == null ? Math.max.apply(null, data) : opts.max;
		var span = (max - min) || 1;
		var pts = data.map(function (v, i) { return [i / Math.max(1, data.length - 1), (v - min) / span]; });
		var pad = 2;

		ctx.strokeStyle = resolveColor(opts.color || accent());
		ctx.lineWidth = opts.lineWidth || 1.5;
		ctx.lineJoin = 'round'; ctx.lineCap = 'round';
		path(ctx, pts, w, h, pad); ctx.stroke();

		if (opts.fill) {
			var c = resolveColor(opts.color || accent());
			ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath();
			ctx.fillStyle = c; ctx.globalAlpha = .10; ctx.fill(); ctx.globalAlpha = 1;
		}
		if (opts.dot && data.length) {
			var last = pts[pts.length - 1];
			ctx.beginPath();
			ctx.arc(pad + last[0] * (w - pad * 2), h - pad - last[1] * (h - pad * 2), 2.5, 0, 7);
			ctx.fillStyle = opts.color || accent(); ctx.fill();
		}
	}

	function area(canvas, data, opts) {
		opts = opts || {};
		var w = opts.width || (canvas.clientWidth || 260);
		var h = opts.height || 64;
		var ctx = setup(canvas, w, h);
		var min = opts.min == null ? 0 : opts.min;
		var max = opts.max == null ? (Math.max.apply(null, data) * 1.2 || 1) : opts.max;
		var span = (max - min) || 1;
		var pts = data.map(function (v, i) { return [i / Math.max(1, data.length - 1), (v - min) / span]; });
		var pad = 3;
		var c = resolveColor(opts.color || accent());

		path(ctx, pts, w, h, pad); ctx.strokeStyle = c; ctx.lineWidth = 1.5;
		ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
		ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath();
		var g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0, c); g.addColorStop(1, 'transparent');
		ctx.fillStyle = g; ctx.globalAlpha = .16; ctx.fill(); ctx.globalAlpha = 1;

		if (opts.grid) {
			ctx.strokeStyle = textSoft(); ctx.globalAlpha = .18; ctx.lineWidth = 1;
			[0.25, 0.5, 0.75].forEach(function (f) {
				ctx.beginPath(); ctx.moveTo(pad, h * f); ctx.lineTo(w - pad, h * f); ctx.stroke();
			});
			ctx.globalAlpha = 1;
		}
	}

	function gauge(canvas, pct, opts) {
		opts = opts || {};
		var size = opts.size || 56;
		var ctx = setup(canvas, size, size);
		var cx = size / 2, r = size / 2 - 4;
		var start = Math.PI * 0.75, end = Math.PI * 2.25;
		ctx.lineWidth = opts.lineWidth || 4; ctx.lineCap = 'round';

		ctx.strokeStyle = textSoft(); ctx.globalAlpha = .22;
		ctx.beginPath(); ctx.arc(cx, cx, r, start, end); ctx.stroke(); ctx.globalAlpha = 1;

		ctx.strokeStyle = resolveColor(accent());
		ctx.beginPath(); ctx.arc(cx, cx, r, start, start + (end - start) * Math.min(1, pct / 100)); ctx.stroke();

		ctx.fillStyle = text(); ctx.font = '700 ' + Math.round(size * .24) + 'px system-ui';
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText(Math.round(pct) + '%', cx, cx + 1);
	}

	function liveArea(canvas, getVal, opts) {
		opts = opts || {};
		var n = opts.window || 60, data = new Array(n).fill(0), i = 0;
		var max = opts.max || 1;
		setInterval(function () {
			data[i % n] = getVal();
			i++;
			var arr = [];
			for (var k = 0; k < n; k++) arr.push(data[(i + k) % n]);
			area(canvas, arr, { max: max, color: opts.color, height: opts.height, width: opts.width });
		}, opts.interval || 1000);
	}

	window.WBCharts = { spark: spark, area: area, gauge: gauge, liveArea: liveArea };
})(window);
