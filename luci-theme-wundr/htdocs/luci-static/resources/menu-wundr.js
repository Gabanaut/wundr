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
		let node = tree;
		let url = '';

		this.renderTabMenu(tree);
		this.renderDrawerMenu(tree);
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
