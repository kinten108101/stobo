import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import extendBuilder from "../lib/builder.js";
import ProfileBarBlueprint from "./profileBar.blp" with { type: "uri" };
import { syncCreate } from "../lib/functional.js";

const ProfileBar = () => {
	const builder = extendBuilder(Gtk.Builder.new_from_resource(ProfileBarBlueprint.substring(11)));

	const bar = builder.get_object("bar", Adw.Clamp);
	const arrow = builder.get_object("arrow", Gtk.Image);
	const primaryButton = builder.get_object("primary_button", Gtk.ToggleButton);
	const label = builder.get_object("label", Gtk.Label);
	const labelStack = builder.get_object("label_stack", Gtk.Stack);

	primaryButton.connect("notify::active", syncCreate(() => {
		if (primaryButton.active) {
			bar.add_css_class("active");
		} else {
			bar.remove_css_class("active");
		}
	}));

	/**
	 * @type {GLib.Source=}
	 */
	let useLabelTimeout = undefined;

	/**
	 * @param {string} _val
	 */
	const toast = (_val) => {
		if (useLabelTimeout !== undefined) useLabelTimeout.destroy();
		labelStack.set_visible_child_name("2");
		// @ts-expect-error
		useLabelTimeout = setTimeout(() => {
			labelStack.set_visible_child_name("1");
		}, 1000);
	};

	return {
		/**
		 * @param {boolean} val
		 */
		set hasArrow(val) {
			arrow.set_visible(val);
		},
		toast,
		label,
		primaryButton,
		widget: bar
	};
};

export default ProfileBar;
