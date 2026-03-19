#!/bin/sh
set -e

# Prevent macOS resource fork / extended attribute files
export COPYFILE_DISABLE=1

PKG=sysmon-server
VER=2.0.0
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build frontend
echo "==> Building frontend..."
( cd "$SCRIPT_DIR/frontend" && npm install --silent && npm run build )

# Prepare package tree
mkdir -p "$WORKDIR/data/usr/share/sysmon/static"
mkdir -p "$WORKDIR/data/etc/init.d"
mkdir -p "$WORKDIR/data/etc/config"
mkdir -p "$WORKDIR/control"

cp "$SCRIPT_DIR/backend/sysmon-server.py"  "$WORKDIR/data/usr/share/sysmon/sysmon-server.py"
cp -r "$SCRIPT_DIR/backend/static/."       "$WORKDIR/data/usr/share/sysmon/static/"
cp "$SCRIPT_DIR/init.d/sysmon"             "$WORKDIR/data/etc/init.d/sysmon"
cp "$SCRIPT_DIR/config/sysmon"             "$WORKDIR/data/etc/config/sysmon"
cp "$SCRIPT_DIR/control/control"           "$WORKDIR/control/control"

chmod 755 "$WORKDIR/data/usr/share/sysmon/sysmon-server.py"
chmod 755 "$WORKDIR/data/etc/init.d/sysmon"

cat > "$WORKDIR/control/postinst" << 'EOF'
#!/bin/sh
/etc/init.d/sysmon enable
/etc/init.d/sysmon start
exit 0
EOF

cat > "$WORKDIR/control/prerm" << 'EOF'
#!/bin/sh
/etc/init.d/sysmon stop
/etc/init.d/sysmon disable
exit 0
EOF

chmod 755 "$WORKDIR/control/postinst" "$WORKDIR/control/prerm"

echo "2.0" > "$WORKDIR/debian-binary"

# Prevent macOS from creating ._ resource fork files
export COPYFILE_DISABLE=1

# Clean any ._ files that may have been copied
find "$WORKDIR" -name '._*' -delete 2>/dev/null || true
find "$WORKDIR" -name '.DS_Store' -delete 2>/dev/null || true

# Use GNU tar to avoid PAX headers (required on macOS)
TAR=$(command -v gtar || command -v gnutar || echo tar)
if ! "$TAR" --version 2>/dev/null | grep -q 'GNU tar'; then
  echo "ERROR: GNU tar (gtar) is required. Install with: brew install gnu-tar" >&2
  exit 1
fi

( cd "$WORKDIR/data"    && "$TAR" --format=gnu --no-xattrs -czf "$WORKDIR/data.tar.gz"    . )
( cd "$WORKDIR/control" && "$TAR" --format=gnu --no-xattrs -czf "$WORKDIR/control.tar.gz" . )
( cd "$WORKDIR"         && "$TAR" --format=gnu --no-xattrs -czf - debian-binary data.tar.gz control.tar.gz ) > "$SCRIPT_DIR/${PKG}_${VER}_x86_64.ipk"

echo "==> Built: ${PKG}_${VER}_x86_64.ipk"
