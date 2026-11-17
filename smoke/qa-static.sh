#!/bin/sh
# WunderbaRT static QA gate — syntax + budget checks (run in CI and locally).
# Usage: smoke/qa-static.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

say() { printf '%s\n' "$*"; }

# 1. JS syntax (node --check)
if command -v node >/dev/null; then
	find "$ROOT/luci-theme-wundr" "$ROOT/luci-app-wundr" -name '*.js' | while read -r f; do
		node --check "$f" && say "  ok  js  $f" || { say "  FAIL js  $f"; exit 1; }
	done || FAIL=1
else
	say "  warn: node not found — skipping js check"
fi

# 2. JSON validity
for j in "$ROOT"/luci-app-wundr/root/usr/share/luci/menu.d/*.json \
         "$ROOT"/luci-app-wundr/root/usr/share/rpcd/acl.d/*.json; do
	[ -f "$j" ] || continue
	if command -v python >/dev/null 2>&1; then
		python -m json.tool "$j" >/dev/null && say "  ok  json $j" || { say "  FAIL json $j"; FAIL=1; }
	fi
done

# 2b. Menu actions must resolve to shipped views or menu aliases.
MENU="$ROOT/luci-app-wundr/root/usr/share/luci/menu.d/luci-app-wundr.json"
if command -v python >/dev/null 2>&1 && [ -f "$MENU" ]; then
	python - "$MENU" <<'PY' || FAIL=1
import json
import os
import sys

menu_path = sys.argv[1]
with open(menu_path, encoding='utf-8') as handle:
	menu = json.load(handle)

package_dir = os.path.abspath(os.path.join(os.path.dirname(menu_path), '..', '..', '..', '..', '..'))

for route, spec in menu.items():
	action = spec.get('action', {})
	action_type = action.get('type')
	if action_type == 'view':
		view = action.get('path', '')
		view_file = os.path.join(package_dir, 'htdocs', 'luci-static', 'resources', 'view', view + '.js')
		if not os.path.isfile(view_file):
			raise SystemExit('missing view for %s: %s' % (route, view_file))
	elif action_type == 'alias':
		target = action.get('path')
		if target not in menu:
			raise SystemExit('missing alias target for %s: %s' % (route, target))

print('  ok  menu view/alias targets')
PY
fi

# 3. Shell syntax
for s in "$ROOT"/luci-app-wundr/root/usr/libexec/rpcd/wundr \
         "$ROOT"/luci-app-wundr/root/etc/uci-defaults/97_wundr; do
	[ -f "$s" ] || continue
	sh -n "$s" && say "  ok  sh  $s" || { say "  FAIL sh  $s"; FAIL=1; }
done

# 3b. rpcd exec-plugin contract: list must advertise the diagnostic method
#     and call must read args from stdin. The custom backend is intentionally
#     limited to the validated diagnostic probe — every config write in Wundr
#     goes through native LuCI UCI + apply, not through this plugin.
RPC="$ROOT/luci-app-wundr/root/usr/libexec/rpcd/wundr"
if [ -x "$RPC" ] || [ -f "$RPC" ]; then
        if sh "$RPC" list | grep -q '"diagnostic"' && grep -q 'ARGS=$(cat)' "$RPC"; then
		say "  ok  rpcd exec list/call contract"
	else
		say "  FAIL rpcd exec list/call contract"
		FAIL=1
	fi
fi

# 3b2. ubus object names must match plugin filenames. rpcd exec.c registers an
#      exec plugin under the ubus object name == the file basename, so every
#      object referenced by the views (rpc.declare) and the ACL must have a
#      matching executable in /usr/libexec/rpcd/. Catches the filename/object
#      mismatch that 404s every call.
LIBEXEC="$ROOT/luci-app-wundr/root/usr/libexec/rpcd"
if command -v python >/dev/null 2>&1 && [ -d "$LIBEXEC" ]; then
	python - "$ROOT" <<'PY' || FAIL=1
import json
import os
import re
import sys

root = sys.argv[1]
libexec = os.path.join(root, 'luci-app-wundr', 'root', 'usr', 'libexec', 'rpcd')
plugins = {os.path.basename(f) for f in os.listdir(libexec)
           if os.path.isfile(os.path.join(libexec, f))}
# strip any .json — exec plugins are plain executables, not .json
plugins = {p for p in plugins if not p.endswith('.json')}
# Native ubus objects provided by the system/LuCI itself — not ours to ship.

views = os.path.join(root, 'luci-app-wundr', 'htdocs', 'luci-static',
                     'resources', 'view')
used = set()
for dirpath, _dirs, files in os.walk(views):
    for f in files:
        if not f.endswith('.js'):
            continue
        with open(os.path.join(dirpath, f), encoding='utf-8') as fh:
            used |= set(re.findall(r"object\s*:\s*['\"]([^'\"]+)['\"]", fh.read()))

acl = os.path.join(root, 'luci-app-wundr', 'root', 'usr', 'share',
                   'rpcd', 'acl.d')
for f in os.listdir(acl):
    if not f.endswith('.json'):
        continue
    with open(os.path.join(acl, f), encoding='utf-8') as fh:
        tree = json.load(fh)
    for _grp, spec in tree.items():
        for _kind in ('read', 'write'):
            for obj in (spec.get(_kind) or {}).get('ubus', {}):
                used.add(obj)

# Native ubus objects provided by the system/LuCI itself — not ours to ship.
NATIVE = {'system', 'iwinfo', 'luci-rpc', 'network.device', 'network.interface',
          'network.wireless', 'network', 'file', 'rc', 'session', 'uci', 'service', 'luci', 'log'}
used -= NATIVE
missing = sorted(used - plugins)
if missing:
    sys.exit('ubus object(s) with no matching plugin file in /usr/libexec/rpcd: %s '
             '(rpcd uses the filename as the object name)' % ', '.join(missing))
print('  ok  ubus object names match plugin filenames (%s)' %
      ', '.join(sorted(used)))
PY
fi

# 3c. No passive external HTTP probe or unrelated DHCP mutation in the backend.
if grep -q 'http://\|add_list dhcp' "$RPC"; then
	say "  FAIL unsafe backend side effect"
	FAIL=1
else
	say "  ok  backend has no passive HTTP/DHCP side effect"
fi

# 4. Size budget: shell payload (cascade+app+shell+icons+charts+qr+map-graph + Studio Triad, gz estimate)
if command -v gzip >/dev/null; then
	BYTES=$(cat "$ROOT"/luci-theme-wundr/htdocs/luci-static/wundr/*.css \
	             "$ROOT"/luci-theme-wundr/htdocs/luci-static/wundr/*.js 2>/dev/null | gzip -c | wc -c)
	say "  shell gzip ≈ ${BYTES}B (budget 44000)"
	[ "$BYTES" -lt 44000 ] || { say "  FAIL budget"; FAIL=1; }
fi

# 5. OpenWrt 24+/25+ compatibility, contrast, palette-boot, QR & map-graph harnesses
if command -v node >/dev/null; then
	for suite in contrast-check.js palette-boot-check.js qr-roundtrip.js map-graph-check.js openwrt-24-25-check.js; do
		if [ -f "$ROOT/smoke/$suite" ]; then
			command node "$ROOT/smoke/$suite" >/dev/null && say "  ok  smoke $suite" || { say "  FAIL smoke $suite"; FAIL=1; }
		fi
	done
fi

say ""
[ "$FAIL" -eq 0 ] && say "QA: PASS" || { say "QA: FAIL"; exit 1; }
