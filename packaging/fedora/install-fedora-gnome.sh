#!/usr/bin/env bash
# Install Prism File Hero for the current Fedora/GNOME user. No root is required.
set -eu

APPIMAGE_FEDORA_NAME="PrismFileHero-Internal-Fedora-x86_64.AppImage"
APP_NAME="Prism File Hero"
APP_ID="prism-file-hero"

warn() {
  printf "%s\n" "Warning: $*" >&2
}

fail() {
  printf "%s\n" "Error: $*" >&2
  exit 1
}

[ -n "${HOME:-}" ] || fail "HOME is not set; cannot perform a user-level installation."
CURRENT_USER=${USER:-current-user}

# Resolve the script path even when it is invoked through a symbolic link.
SOURCE=${BASH_SOURCE[0]}
while [ -h "$SOURCE" ]; do
  SOURCE_DIR=$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)
  SOURCE=$(readlink -- "$SOURCE")
  case "$SOURCE" in
    /*) ;;
    *) SOURCE=$SOURCE_DIR/$SOURCE ;;
  esac
done
SCRIPT_DIR=$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)

SOURCE_APPIMAGE=$SCRIPT_DIR/$APPIMAGE_FEDORA_NAME
[ -f "$SOURCE_APPIMAGE" ] || fail "Could not find $APPIMAGE_FEDORA_NAME. This installer and the exact Fedora-named AppImage must be in the same directory. Directory searched: $SCRIPT_DIR"

INSTALL_DIR=$HOME/.local/opt/prism-file-hero
TARGET_APPIMAGE=$INSTALL_DIR/PrismFileHero-Internal-x86_64.AppImage
APPLICATIONS_DIR=$HOME/.local/share/applications
ICONS_DIR=$HOME/.local/share/icons/hicolor
DESKTOP_FILE=$APPLICATIONS_DIR/$APP_ID.desktop

mkdir -p "$INSTALL_DIR" "$APPLICATIONS_DIR"
TEMP_TARGET=$TARGET_APPIMAGE.tmp.$$
trap 'rm -f -- "$TEMP_TARGET"; [ -n "${EXTRACT_DIR:-}" ] && rm -rf -- "$EXTRACT_DIR"' EXIT HUP INT TERM

# Copy through a temporary file so an interrupted update does not replace a working installation.
install -m 755 -- "$SOURCE_APPIMAGE" "$TEMP_TARGET"
mv -f -- "$TEMP_TARGET" "$TARGET_APPIMAGE"

# Desktop Entry Exec uses a quoted executable argument. Escape characters special inside it.
ESCAPED_EXEC=$(printf "%s" "$TARGET_APPIMAGE" | sed 's/[\\$`"]/\\&/g')
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=$APP_NAME
Comment=PDF tools and AI bank statement extractor
Exec="$ESCAPED_EXEC" %U
Icon=$APP_ID
Terminal=false
Type=Application
Categories=Utility;
StartupWMClass=prism-file-hero
EOF
chmod 644 "$DESKTOP_FILE"

ICON_INSTALLED=false
EXTRACT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/prism-file-hero-icon.XXXXXX") || warn "Could not create a temporary directory; launcher installed without an icon."
if [ -n "${EXTRACT_DIR:-}" ]; then
  if (cd "$EXTRACT_DIR" && "$TARGET_APPIMAGE" --appimage-extract >/dev/null 2>&1); then
    for icon in \
      "$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/prism-file-hero.png" \
      "$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/app.png"; do
      if [ -f "$icon" ]; then
        mkdir -p "$ICONS_DIR/512x512/apps"
        install -m 644 -- "$icon" "$ICONS_DIR/512x512/apps/$APP_ID.png"
        ICON_INSTALLED=true
        break
      fi
    done
    [ "$ICON_INSTALLED" = true ] || warn "No 512x512 icon was found in the AppImage; the launcher will still work."
  else
    warn "Could not extract the AppImage icon; the launcher will still work."
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || warn "Could not refresh the desktop-entry cache."
fi
if [ "$ICON_INSTALLED" = true ] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$ICONS_DIR" >/dev/null 2>&1 || warn "Could not refresh the icon cache."
fi

printf "%s\n" "$APP_NAME installed for $CURRENT_USER."
printf "%s\n" "Source AppImage: $SOURCE_APPIMAGE"
printf "%s\n" "Installed AppImage: $TARGET_APPIMAGE"
printf "%s\n" "Open GNOME Activities and search for ‘$APP_NAME’."
printf "%s\n" "You can also start it with: $TARGET_APPIMAGE"
