import Gtk from "gi://Gtk";

import WindowUi from "./window.blp" with { type: "uri" };

/**
 * @param {Gtk.Application} application
 */
const Window = (application) => {
	const builder = Gtk.Builder.new_from_resource(WindowUi.substr(11));
	const window = /** @type {Gtk.ApplicationWindow | null} */ (builder.get_object("window"));
	if (!window) throw new Error;

	window.set_application(application);

	return window;
};

export default Window;
