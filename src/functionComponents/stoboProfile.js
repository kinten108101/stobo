import Gtk from "gi://Gtk";

import ProfilePopover from "./profilePopover.blp" with { type: "uri" };
import ExtendedBuilder from "../lib/builder.js";
import { bytes2humanreadable } from "../lib/fileDisplay.js";

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
		 * @param {number} bytes
		 */
		configure(title, totalAddons, bytes) {
			builder.get_object("title", Gtk.Label).set_label(title);
			builder.get_object("total_addons", Gtk.Label).set_label(String(totalAddons));
			builder.get_object("disk_usage", Gtk.Label).set_label(bytes2humanreadable(bytes));
		},
		/**
		 * @param {{ lastBuild: Date }?} params
		 */
		updateBuildInfo(params) {
			if (params) {
				const { lastBuild } = params;
				(x => {
					x.set_visible(true);
					x.set_label(lastBuild.toDateString());
				})(builder.get_object("last_build", Gtk.Label));
			} else {
				builder.get_object("last_build", Gtk.Label).set_visible(false);
			}
		}
	}
};

export default StoboProfile;
