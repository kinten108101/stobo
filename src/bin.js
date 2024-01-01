#!@gjs@ -m

import { exit, programArgs } from "system";
import GLib from "gi://GLib";
// @ts-expect-error
import { setConsoleLogDomain } from "console";

// eslint-disable-next-line no-restricted-globals
imports.package.init({
	name: "@app_id@",
	version: "@version@",
	prefix: "@prefix@",
	libdir: "@libdir@",
	// @ts-expect-error
	datadir: "@datadir@",
});
setConsoleLogDomain(pkg.name);
GLib.set_application_name("Stobo");

globalThis.__DEV__ = pkg.name?.endsWith(".Devel") || false;

if (globalThis.__DEV__) {
	GLib.log_set_debug_enabled(true);
}

globalThis.resource_prefix = "@resource_prefix@";

const module = await import("resource:///com/github/kinten108101/Stobo/main.js");
const exit_code = await module.main(programArgs);
exit(exit_code);
