'use strict';
'require baseclass';
'require ui';

/* Wundr Menu integration for LuCI OpenWrt 24.x/25.x.
 * Dynamically builds the sidebar navigation, active highlighting,
 * breadcrumbs, tab menus, and Pro Mode full LuCI trees.
 */

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		this.renderStandaloneNav(tree);
		this.renderTabMenu(tree);
		this.renderDrawerMenu(tree);
	},

	/* When luci-theme-wundr is installed standalone without luci-app-wundr,
	 * populate the left sidebar directly from LuCI's native `admin` menu tree
	 * so every stock OpenWrt page is navigable out of the box. */
	renderStandaloneNav(tree) {
		const nav = document.querySelector('.wb-nav');
		if (!nav || nav.children.length > 0) return;

		const admin = tree && tree.children && tree.children.admin;
		if (!admin) return;

		const iconMap = {
			status: 'dashboard',
			system: 'system',
			services: 'apps',
			network: 'port',
			vpn: 'shield',
			nas: 'download',
			docker: 'apps'
		};
		const req = (L.env.dispatchpath && L.env.dispatchpath.length ? L.env.dispatchpath : L.env.requestpath) || [];
		const here = req.join('/');

		ui.menu.getChildren(admin).forEach((section, idx) => {
			if (section.name === 'logout' || section.name === 'uci' || section.name === 'ubus' || section.name === 'menu') return;
			const baseUrl = 'admin/' + section.name;
			const subs = ui.menu.getChildren(section);
			const icoSpan = E('span', { 'class': 'wb-nav-ico' });
			if (window.wbIcon) icoSpan.innerHTML = window.wbIcon(iconMap[section.name] || 'sliders', 18);

			if (!subs.length) {
				const a = E('a', { 'href': L.url(baseUrl) }, [ icoSpan, E('span', {}, [ _(section.title) ]) ]);
				if (here === baseUrl || here.indexOf(baseUrl + '/') === 0) a.classList.add('active');
				nav.appendChild(E('li', {}, [ a ]));
				return;
			}

			let hasActive = false;
			const subUl = E('ul', { 'class': 'wb-nav-sub' });
			subs.forEach(sub => {
				const subPath = baseUrl + '/' + sub.name;
				const active = (here === subPath || here.indexOf(subPath + '/') === 0);
				if (active) hasActive = true;
				const a = E('a', { 'href': L.url(subPath), 'class': active ? 'active' : '' }, [ E('span', {}, [ _(sub.title) ]) ]);
				subUl.appendChild(E('li', {}, [ a ]));
			});

			const open = hasActive || idx === 0;
			const li = E('li', { 'class': 'wb-nav-group' + (open ? ' is-open' : '') });
			const toggle = E('button', {
				'class': 'wb-nav-group-toggle',
				'type': 'button',
				'aria-expanded': String(open),
				'click': () => {
					const next = !li.classList.contains('is-open');
					li.classList.toggle('is-open', next);
					toggle.setAttribute('aria-expanded', String(next));
				}
			}, [ icoSpan, E('span', {}, [ _(section.title) ]), E('span', { 'class': 'wb-nav-chevron', 'aria-hidden': 'true' }) ]);

			li.appendChild(toggle);
			li.appendChild(subUl);
			nav.appendChild(li);
		});

		const proWrap = document.querySelector('.wb-pro');
		if (proWrap && nav.children.length > 0) proWrap.style.display = 'none';
	},

	renderTabMenu(tree) {
		const container = document.querySelector('#tabmenu');
		if (!container) return;

		let node = tree;
		let url = '';

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.populateTabs(container, node, url, 0);
		}
	},

	populateTabs(container, tree, url, level) {
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			const activeClass = isActive ? ' active' : '';
			const className = 'tabmenu-item-%s%s'.format(child.name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return;

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.populateTabs(container, activeNode, url + '/' + activeNode.name, (level || 0) + 1);
	},

	renderDrawerMenu(tree) {
		const container = document.querySelector('#wb-pro-drawer-menu');
		if (!container) return;

		const children = ui.menu.getChildren(tree);
		children.forEach(child => {
			if (child.name === 'wundr') return; // Skip wundr root in pro tree

			const section = E('div', { 'class': 'wb-pro-section' }, [
				E('h4', {}, [ _(child.title) ]),
				this.renderSubMenu(child, child.name)
			]);
			container.appendChild(section);
		});
	},

	renderSubMenu(node, url) {
		const children = ui.menu.getChildren(node);
		if (!children.length) return E('');

		const ul = E('ul', { 'class': 'wb-pro-links' });
		children.forEach(child => {
			const linkUrl = L.url(url, child.name);
			const hasSub = ui.menu.getChildren(child).length > 0;
			ul.appendChild(E('li', {}, [
				E('a', { 'href': linkUrl }, [ _(child.title) ]),
				hasSub ? this.renderSubMenu(child, url + '/' + child.name) : E('')
			]));
		});
		return ul;
	}
});
