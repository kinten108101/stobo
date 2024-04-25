import GObject from "gi://GObject";
import Adw from "gi://Adw";

import makeWidgets from "../functionComponents/profileBar.js";
import { syncCreate } from "../lib/functional.js";

export default class ProfileBar extends Adw.Bin {
	static {
		GObject.registerClass({
			GTypeName: this.name,
			Properties: {
				"has-arrow": GObject.ParamSpec.boolean("has-arrow", "", "", GObject.ParamFlags.READWRITE, false),
			}
		}, this);
	}

	/**
	 * @param {{ has_arrow?: boolean } & Adw.Bin.ConstructorProperties} params
	 */
	constructor(params) {
		super(params);
		this.content = makeWidgets();
		this.content.widget.set_parent(this);
		this.connect("notify::has-arrow", syncCreate(
			(self) => {
			this.content.hasArrow = self.has_arrow;
			},
			/**
			 * @type {typeof this & { has_arrow: boolean }}
			 */
			(this)
		));
	}
}


