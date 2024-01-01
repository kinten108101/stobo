import Adw from "gi://Adw";
import Window from "./window.js";

const application = new Adw.Application({
	application_id: pkg.name,
	// Defaults to /com/github/kinten108101/Stobo/Devel
	// if pkg.name is com.github.kinten108101.Stobo.Devel
	resource_base_path: globalThis.resource_prefix,
});

application.connect("activate", () => {
	const window = Window(application);
	window.present();
});

export default application;
