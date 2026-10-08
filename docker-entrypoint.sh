#!/bin/sh
set -e

# Like the linuxserver.io images: start as root, make /config writable for
# PUID:PGID, then drop privileges and run Curatorr as that user.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$CONFIG_DIR"
  chown -R "$PUID:$PGID" "$CONFIG_DIR" 2>/dev/null || echo "warning: could not chown $CONFIG_DIR to $PUID:$PGID"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
