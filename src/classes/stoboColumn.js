import GObject from "gi://GObject";

export class StoboColumnItem extends GObject.Object {
	static {
		GObject.registerClass({
			GTypeName: "StoboColumnItem",
		}, this);
	}

	/**
	 * @param {{
 	 * 		entryName: string;
	 * }} params
	 */
	constructor({
		entryName
	}) {
		super({});
		this.entryName = entryName;
	}
}
