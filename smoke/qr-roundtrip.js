/* Smoke test: round-trip Wundr's QR encoder through the jsQR decoder.
 * Run:  cd smoke/.cache && npm i jsqr@1 && node ../qr-roundtrip.js */
'use strict';
const path = require('path');
const jsQR = require(path.join(__dirname, '.cache', 'node_modules', 'jsqr'));
const QR = require(path.join(__dirname, '..', 'luci-theme-wundr', 'htdocs', 'luci-static', 'wundr', 'qr.js'));

const cases = [
	'WIFI:T:WPA;S:Home;P:secret123;;',
	'WIFI:T:WPA;S:My Café Wi-Fi 5G;P:p@ss\\;word:with,specials;H:true;;',
	'WIFI:T:nopass;S:Open Guest;;',
	'A'.repeat(100),
	'WIFI:T:WPA;S:' + 'S'.repeat(32) + ';P:' + 'P'.repeat(63) + ';;',
	'x'.repeat(230),
	'short', '1', 'ü'.repeat(60)
];

function rasterize(qr, scale, quiet) {
	const px = (qr.size + quiet * 2) * scale;
	const data = new Uint8ClampedArray(px * px * 4);
	for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
		const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet;
		const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.get(mx, my);
		const v = dark ? 0 : 255, i = (y * px + x) * 4;
		data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
	}
	return { data, px };
}

let fail = 0;
for (const text of cases) {
	const qr = QR.encode(text);
	if (!qr) { console.log('FAIL no encoding for len=' + text.length); fail++; continue; }
	const { data, px } = rasterize(qr, 4, 4);
	const res = jsQR(data, px, px);
	const ok = !!res && res.data === text;
	if (!ok) fail++;
	console.log((ok ? 'ok  ' : 'FAIL') + ' v' + qr.version + ' mask=' + qr.mask + ' len=' + text.length + (ok ? '' : ' decoded=' + (res && JSON.stringify(res.data))));
}

/* Every version 1–9 must decode at least one payload sized to force it. */
for (let v = 1; v <= 9; v++) {
	const cap = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230][v];
	const text = 'v' + v + ':' + 'z'.repeat(cap - 3);
	const qr = QR.encode(text);
	if (!qr || qr.version !== v) { console.log('FAIL version selection for ' + text.length + ' bytes -> ' + (qr && qr.version)); fail++; continue; }
	const { data, px } = rasterize(qr, 3, 4);
	const res = jsQR(data, px, px);
	const ok = !!res && res.data === text;
	if (!ok) fail++;
	console.log((ok ? 'ok  ' : 'FAIL') + ' forced v' + v + ' size=' + qr.size);
}

if (QR.encode('x'.repeat(231)) !== null) { console.log('FAIL 231 bytes should exceed v9-L capacity'); fail++; }
console.log(fail ? fail + ' FAILURE(S)' : 'QR: ALL PASS');
process.exit(fail ? 1 : 0);
