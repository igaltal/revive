#!/usr/bin/env bash
# Builds the tmux that ships inside Revive.app: one universal binary (Apple
# silicon and Intel) with libevent, ncurses and utf8proc linked in statically,
# so buyers never need Homebrew. It reads the terminal descriptions macOS
# already ships (/usr/share/terminfo).
#
# Output: resources/bin/tmux (not in git; CI and `npm run dist` build it).
# Sources are pinned by version and SHA-256 and checked before use.
# Skips the work when the output already matches these versions.
set -euo pipefail

TMUX_VERSION=3.7c
LIBEVENT_VERSION=2.1.13-stable
NCURSES_VERSION=6.5
UTF8PROC_VERSION=2.12.0
MACOS_MIN=11.0

SOURCES=(
  "https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz 7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf"
  "https://github.com/libevent/libevent/releases/download/release-${LIBEVENT_VERSION}/libevent-${LIBEVENT_VERSION}.tar.gz f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c"
  "https://ftp.gnu.org/gnu/ncurses/ncurses-${NCURSES_VERSION}.tar.gz 136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6"
  "https://github.com/JuliaStrings/utf8proc/archive/refs/tags/v${UTF8PROC_VERSION}.tar.gz f564011d38b2888d583d510b08e69ffa15aa117155db1b9b49ef1dfe1fa25111"
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/resources/bin/tmux"
STAMP="$ROOT/resources/bin/.tmux-build"
WANT="tmux ${TMUX_VERSION} libevent ${LIBEVENT_VERSION} ncurses ${NCURSES_VERSION} utf8proc ${UTF8PROC_VERSION} macos ${MACOS_MIN}"
if [[ -x "$OUT" && -f "$STAMP" && "$(cat "$STAMP")" == "$WANT" && "${1:-}" != "--force" ]]; then
  echo "tmux: already built ($WANT)"
  exit 0
fi

WORK="$ROOT/.cache/tmux-build"
DL="$WORK/downloads"
mkdir -p "$DL"
JOBS="$(sysctl -n hw.ncpu)"

for entry in "${SOURCES[@]}"; do
  url="${entry% *}"
  sum="${entry##* }"
  file="$DL/$(basename "$url")"
  [[ -f "$file" ]] || curl -fsSL --retry 3 -o "$file" "$url"
  echo "$sum  $file" | shasum -a 256 -c - >/dev/null || { echo "Checksum mismatch: $file" >&2; rm -f "$file"; exit 1; }
done

build_arch() {
  local arch="$1" host="$2"
  local prefix="$WORK/$arch/prefix" src="$WORK/$arch/src"
  rm -rf "$WORK/$arch" && mkdir -p "$prefix" "$src"
  for f in "$DL"/*.tar.gz; do tar -xzf "$f" -C "$src"; done
  export CC="clang -arch $arch"
  export CFLAGS="-O2 -mmacosx-version-min=$MACOS_MIN"
  export LDFLAGS="-arch $arch -mmacosx-version-min=$MACOS_MIN"

  (cd "$src/libevent-${LIBEVENT_VERSION}" &&
    ./configure --host="$host" --prefix="$prefix" --disable-shared --enable-static --disable-openssl \
      --disable-samples --disable-libevent-regress --disable-debug-mode >/dev/null &&
    make -j"$JOBS" >/dev/null && make install >/dev/null)

  (cd "$src/ncurses-${NCURSES_VERSION}" &&
    BUILD_CC=cc BUILD_CFLAGS="" BUILD_LDFLAGS="" ./configure --host="$host" --prefix="$prefix" \
      --without-shared --with-normal --without-debug --without-ada --without-cxx --without-cxx-binding \
      --without-manpages --without-progs --without-tests --disable-db-install \
      --with-default-terminfo-dir=/usr/share/terminfo --with-terminfo-dirs=/usr/share/terminfo >/dev/null &&
    make -j"$JOBS" libs >/dev/null && make install.libs install.includes >/dev/null)

  (cd "$src/utf8proc-${UTF8PROC_VERSION}" &&
    make -j"$JOBS" libutf8proc.a CC="$CC" CFLAGS="$CFLAGS" >/dev/null &&
    cp libutf8proc.a "$prefix/lib/" && cp utf8proc.h "$prefix/include/")

  (cd "$src/tmux-${TMUX_VERSION}" &&
    ./configure --host="$host" --prefix="$prefix" --enable-utf8proc --disable-jemalloc --disable-dependency-tracking \
      CPPFLAGS="-I$prefix/include -I$prefix/include/ncursesw" \
      LIBEVENT_CORE_CFLAGS="-I$prefix/include" LIBEVENT_CORE_LIBS="-L$prefix/lib -levent_core" \
      LIBEVENT_CFLAGS="-I$prefix/include" LIBEVENT_LIBS="-L$prefix/lib -levent" \
      LIBNCURSES_CFLAGS="-I$prefix/include -I$prefix/include/ncursesw" LIBNCURSES_LIBS="-L$prefix/lib -lncursesw" \
      LIBNCURSESW_CFLAGS="-I$prefix/include -I$prefix/include/ncursesw" LIBNCURSESW_LIBS="-L$prefix/lib -lncursesw" \
      LIBUTF8PROC_CFLAGS="-I$prefix/include" LIBUTF8PROC_LIBS="-L$prefix/lib -lutf8proc" \
      PKG_CONFIG=/usr/bin/false >/dev/null &&
    make -j"$JOBS" >/dev/null)
  cp "$src/tmux-${TMUX_VERSION}/tmux" "$WORK/tmux-$arch"
}

echo "tmux: building for arm64"
build_arch arm64 aarch64-apple-darwin
echo "tmux: building for x86_64"
build_arch x86_64 x86_64-apple-darwin

mkdir -p "$(dirname "$OUT")"
lipo -create "$WORK/tmux-arm64" "$WORK/tmux-x86_64" -output "$OUT"
chmod 755 "$OUT"
# Nothing but the system: no Homebrew paths, no dynamic libevent or ncurses.
# (otool prints a header line per architecture; only the indented lines are libraries.)
if otool -L "$OUT" | grep -E '^\s' | grep -v -E '^\s+/usr/lib/libSystem|^\s+/usr/lib/libresolv|^\s+/System/' >/dev/null; then
  echo "tmux links something outside the system:" >&2
  otool -L "$OUT" >&2
  exit 1
fi
echo "$WANT" >"$STAMP"
lipo -info "$OUT"
"$OUT" -V
