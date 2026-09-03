/* Wundr icons.js — thin-stroke inline SVG set (~1.5px, currentColor).
   Usage: wbIcon('wifi') → SVG element string. No fonts, no CDN. */

'use strict';

var P = {
	dashboard: '<circle cx="12" cy="12" r="3.2"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M6.3 17.7l1.4-1.4"/>',
	internet: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12h17"/>',
	wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/>',
	devices: '<rect x="2.5" y="4.5" width="19" height="12" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
	families: '<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14.5 19c0-2.3 1.4-4 3.5-4s3.2 1.2 3.2 3.2"/>',
	shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 7.7-7.5 9.5-4.3-1.8-7.5-5-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
	qos: '<path d="M3 20.5h18M6 20.5v-7M12 20.5V6M18 20.5v-10"/>',
	apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
	system: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
	search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
	pause: '<path d="M9 5.5v13M15 5.5v13"/>',
	play: '<path d="M7.5 5.2v13.6L19 12z"/>',
	block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
	moon: '<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5z"/>',
	refresh: '<path d="M20 12a8 8 0 1 1-2.5-5.8M20 3.5V8h-4.5"/>',
	undo: '<path d="M4 9h9.5a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4"/>',
	guest: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c0-3 2.4-5.2 5.5-5.2s5.5 2.2 5.5 5.2M16 8.5h5M18.5 6v5"/>',
	heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z"/>',
	port: '<path d="M5 21V9l7-6 7 6v12M9.5 21v-6h5v6"/>',
	map: '<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20"/>',
	portal: '<path d="M4 6.5h16v11H4zM7.5 10h9M7.5 13h6"/><path d="M9 20.5h6"/>',
	edit: '<path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3zM14.5 8.5l3 3"/>',
	qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM15 15h2v2h-2zM19 15h1v1h-1zM15 19h1v1h-1zM18 18h2v2h-2z"/>',
	calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7 3.5v3M17 3.5v3M3.5 9h17"/>',
	trash: '<path d="M5 7h14M10 11v5M14 11v5M7 7l1 13h8l1-13M9 4h6l1 3H8z"/>',
	speed: '<path d="M4 17a8.5 8.5 0 1 1 16 0"/><path d="M12 17l4-6"/>',
	toggleOn: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="3" fill="currentColor" stroke="none"/>',
	console: '<path d="M4 6.5l5 5.5-5 5.5M12 18h8"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	download: '<path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5M4 18.5h16"/>',
	bolt: '<path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z"/>',
	warn: '<path d="M12 4L21 19.5H3zM12 10v4.5"/><circle cx="12" cy="17.2" r=".4" fill="currentColor" stroke="none"/>',
	clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
	check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
	close: '<path d="M6 6l12 12M18 6L6 18"/>',
	sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
	power: '<path d="M12 3.5v8M6.8 6.8a7.5 7.5 0 1 0 10.4 0"/>',
	book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21zM4 18.5V5.5M20 18.5H6.5"/>'
};

function wbIcon(name, size) {
	var body = P[name] || P.system;
	var s = size || 20;
	return '<svg class="wb-ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
		'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

if (typeof window !== 'undefined') window.wbIcon = wbIcon;
if (typeof module !== 'undefined') module.exports = { wbIcon: wbIcon, paths: P };
