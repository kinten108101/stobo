import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import ExtendedBuilder from "../lib/builder.js";

export default GObject.registerClass({
	GTypeName: "Embed",
}, class extends Adw.Bin {
	constructor() {
		super({});
		this.buildable = null;
	}

	/**
	 * @param {string} description
	 * @param {string} init
	 */
	load(description, init) {
		try {
			const current = this.buildable?.get_current_object(Gtk.Widget) || null;
			if (current !== null) {
				current.unparent();
			}
		} catch (error) {

		}
		this.buildable = ExtendedBuilder(Gtk.Builder.new_from_string(description, -1));
		this.buildable.set_current_object(this.buildable.get_object("root", Gtk.Widget));
		this.buildable.get_current_object(Gtk.Widget).set_parent(this);
		Function(init)(this.buildable);
	}
});
