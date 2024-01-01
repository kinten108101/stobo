import "./init.js";
import app from "./app.js";

pkg.initGettext();

import "./style.css";
import "./style-dark.css";

/**
 * @param {string[] | null} argv
 */
export function main(argv) {
	return app.runAsync(argv || undefined);
}
