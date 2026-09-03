include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wundr
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Wundr team
LUCI_PKGARCH:=all
LUCI_TITLE:=Wundr — consumer-grade router UI (Dashboard, Wi-Fi, Families, Security, …)
LUCI_DEPENDS:=+luci-theme-wundr +luci-base +rpcd +jsonfilter

# Same rationale as the theme: keep committed JS/CSS byte-for-byte.
CONFIG_LUCI_CSSTIDY:=
CONFIG_LUCI_JSMIN:=

include $(TOPDIR)/feeds/luci/luci.mk

# On removal, delete every Wundr-derived firewall rule (device pause / family
# bedtime) so a paused device is never left blocked after the app is gone.
# The rules take effect once the firewall is reloaded by the next service
# start or by the user's own "Save & Apply" in the native pages.
define Package/luci-app-wundr/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
uci -q show firewall >/dev/null 2>&1 || exit 0
CHANGED=0
for sid in $$(uci -q show firewall | sed -n 's/^firewall\.\([^.=]*\)=rule$$/\1/p'); do
	name=$$(uci -q get "firewall.$$sid.name")
	case "$$name" in
		wundr_pause_*|wundr_bedtime_*|wundr_block_*)
			uci -q delete "firewall.$$sid" && CHANGED=1
			;;
	esac
done
[ "$$CHANGED" = 1 ] && uci -q commit firewall
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
