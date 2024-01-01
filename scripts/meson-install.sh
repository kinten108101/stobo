#!/usr/bin/env sh
rm -rf build-meson ||
rmdir build-meson &&
meson setup build-meson &&
meson install -C build-meson &&
com.github.kinten108101.Stobo
