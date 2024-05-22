import Gtk from "gi://Gtk";

import ProfilePopover from "./profilePopover.blp" with { type: "uri" };
import ExtendedBuilder from "../lib/builder.js";

/**
 * @param {ReturnType<typeof import("./profileBar.js").default>} profileBar
 */
const StoboProfile = (profileBar) => {
	const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(ProfilePopover.substring(11)));
	const popover = builder.get_object("root", Gtk.Popover);
	popover.set_parent(profileBar.primaryButton);

	/**
	 * @type {(() => void)[]}
	 */
	const callbacksPopoverClosed = [];

	popover.connect("notify::visible", () => {
		if (!popover.visible) callbacksPopoverClosed.forEach(x => x());
	});

	return {
		/**
		 * @param {boolean} val
		 */
		set_reveal(val) {
			if (val) {
				profileBar.primaryButton.set_active(true);
				popover.set_visible(true);
			} else {
				profileBar.primaryButton.set_active(false);
				popover.set_visible(false);
			}
		},
		/**
		 * @param {() => void} callback
		 */
		onPopoverClosed(callback) {
			callbacksPopoverClosed.push(callback);
		},
		/**
		 * @param {string} title
		 * @param {number} totalAddons
		 */
		configure(title, totalAddons) {
			builder.get_object("title", Gtk.Label).set_label(title);
			builder.get_object("total_addons", Gtk.Label).set_label(String(totalAddons));
		}
	}
};

export default StoboProfile;
