include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-wundr
PKG_VERSION:=0.3.1
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Wundr contributors
LUCI_PKGARCH:=all

# csstidy is a CSS2-era minifier that mangles modern CSS (color-mix(),
# backdrop-filter, :has(), multi-stop gradients). Disable it via both the
# official luci.mk knobs and CONFIG_* so committed CSS/JS ships byte-for-byte.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0
CONFIG_LUCI_CSSTIDY:=
CONFIG_LUCI_JSMIN:=

LUCI_TITLE:=Wundr LuCI theme (Nordic, Kyoto, Classic)
LUCI_DEPENDS:=+luci-base

define Package/luci-theme-wundr/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0

# Register the theme so it appears in LuCI's Appearance theme switcher and as a
# runtime fallback candidate (luci.themes.<Name>), matching official themes.
CHANGED=0
CUR_T="$$(uci -q get luci.themes.Wundr)"
if [ -z "$$CUR_T" ]; then
	uci set luci.themes.Wundr=/luci-static/wundr
	CHANGED=1
fi

# Activate on a fresh install only (when Wundr was not previously registered and
# PKG_UPGRADE!=1), never stomping an admin's chosen theme during an upgrade.
CUR="$$(uci -q get luci.main.mediaurlbase)"
if [ "$${PKG_UPGRADE:-}" != 1 ] && [ -z "$$CUR_T" ] && { [ -z "$$CUR" ] || [ "$$CUR" = "/luci-static/bootstrap" ]; }; then
	printf '%s\n' "$$CUR" > /etc/wundr-theme.previous
	uci set luci.main.mediaurlbase=/luci-static/wundr
	CHANGED=1
fi

[ "$$CHANGED" = 1 ] && uci commit luci
rm -f /tmp/luci-indexcache.* /tmp/luci-modulecache/* 2>/dev/null || true
/etc/init.d/rpcd reload 2>/dev/null || true
exit 0
endef

define Package/luci-theme-wundr/prerm
#!/bin/sh
case "$$1" in *upgrade*) exit 0 ;; esac
[ "$${PKG_UPGRADE:-}" = 1 ] && exit 0
[ -n "$$IPKG_INSTROOT" ] && exit 0

uci -q delete luci.themes.Wundr

if [ "$$(uci -q get luci.main.mediaurlbase)" = "/luci-static/wundr" ]; then
	PREVIOUS="$$(cat /etc/wundr-theme.previous 2>/dev/null)"
	if [ -z "$$PREVIOUS" ] || [ ! -d "/www$$PREVIOUS" ]; then
		if [ -d /www/luci-static/bootstrap ] && [ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ]; then
			PREVIOUS=/luci-static/bootstrap
		else
			PREVIOUS=""
		fi
	fi
	[ -n "$$PREVIOUS" ] && uci set luci.main.mediaurlbase="$$PREVIOUS"
fi
uci commit luci
rm -f /etc/wundr-theme.previous /tmp/luci-indexcache.* /tmp/luci-modulecache/* 2>/dev/null || true
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
