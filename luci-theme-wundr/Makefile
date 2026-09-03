include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-wundr
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Wundr team
LUCI_PKGARCH:=all

# csstidy is a CSS2-era minifier that mangles modern CSS (color-mix(),
# backdrop-filter, multi-stop gradients). Disable it so our committed,
# hand-tuned CSS reaches the device byte-for-byte. Same for jsmin, which
# predates optional chaining and template literals.
CONFIG_LUCI_CSSTIDY:=
CONFIG_LUCI_JSMIN:=

LUCI_TITLE:=Wundr theme — elegant, dual-mode LuCI skin
LUCI_DEPENDS:=+luci-base

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-theme-wundr/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0

CUR="$$(uci -q get luci.main.mediaurlbase)"
if [ -z "$$CUR" ] || [ "$$CUR" = "/luci-static/bootstrap" ]; then

printf '%s\n' "$$CUR" > /etc/wundr-theme.previous
	uci set luci.main.mediaurlbase=/luci-static/wundr
	uci commit luci
fi

# Register the theme so it appears in LuCI's Appearance theme switcher and as a
# runtime fallback candidate (luci.themes.<Name>), matching official themes.
CUR_T="$$(uci -q get luci.themes.Wundr)"
if [ -z "$$CUR_T" ]; then
	uci set luci.themes.Wundr=/luci-static/wundr
	uci commit luci
fi
exit 0
endef

define Package/luci-theme-wundr/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0

uci -q delete luci.themes.Wundr
uci commit luci

if [ "$$(uci -q get luci.main.mediaurlbase)" = "/luci-static/wundr" ]; then
	PREVIOUS="$$(cat /etc/wundr-theme.previous 2>/dev/null)"
	[ -n "$$PREVIOUS" ] || PREVIOUS=/luci-static/bootstrap
	uci set luci.main.mediaurlbase="$$PREVIOUS"
	uci commit luci
fi
rm -f /etc/wundr-theme.previous
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
