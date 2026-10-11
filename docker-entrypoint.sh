#!/bin/sh
set -e

# The database holds the media server's tokens and the API keys: only Curatorr's user may read it.
umask 077
chmod 600 "$CONFIG_DIR"/curatorr*.db* 2>/dev/null || true

# Like the linuxserver.io images: start as root, make /config writable for
# PUID:PGID, then drop privileges and run Curatorr as that user.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$CONFIG_DIR"
  # Only what isn't theirs yet, so a start doesn't rewrite every file in the folder.
  find "$CONFIG_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null \
    || echo "warning: could not chown $CONFIG_DIR to $PUID:$PGID"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
