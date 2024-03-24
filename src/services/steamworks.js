import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";

import { defaultEncoder, readJsonBytes } from "../lib/fileIO.js";
import { DbServiceErrorEnum, db_service_error_quark } from "../error.js";
import { session } from "../application.js";

const WEBAPI = "6169ADBAC88B2021C279E28693AEF6A9";

const URL_GPFD = GLib.Uri.parse("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", GLib.UriFlags.NONE);

/**
 * @param {string} str
 * @returns {boolean}
 */
const isNumberString = str => {
	if (str.length === 0) return false;
	for (let i = 0; i < str.length; i++) {
		if (str.charCodeAt(i) < 48 || str.charCodeAt(i) > 57) return false;
	}
	return true;
};


/**
 * @param {string} url
 * @returns {string}
 */
const extractWorkshopItemId = (url) => {
    const idxParam = url.indexOf("?id=", 0);
    if (idxParam === undefined) {
      	throw new GLib.Error(
        	db_service_error_quark(),
        	DbServiceErrorEnum.IdNotFound,
        	`Could not extract id parameter from url \"${url}\"`);
    }

    let idxParamEnd = url.indexOf("&", idxParam);
    if (idxParamEnd === -1) idxParamEnd = idxParam + 14;

    const fileId = url.substring(idxParam + 4, idxParamEnd);
    if (!isNumberString(fileId)) {
      	throw new GLib.Error(
        	db_service_error_quark(),
        	DbServiceErrorEnum.IdNotDecimal,
        	`Supposed id parameter in url \"${url}\" is not in decimal format`);
    }
    return fileId;
};

/**
 * @param {any} playerDetails
 * @returns {string}
 */
const extractAuthorName = playerDetails => {
	const personaname = playerDetails["personaname"];
    if (!(typeof personaname !== "string" || personaname === ""))
      	return personaname;

    const profileurl = playerDetails["profileurl"];
    const idIdx = profileurl?.indexOf("/id/") || -1;
    const vanityId = profileurl?.substring(idIdx + 4, profileurl?.length - 1) || "";
    if (!(idIdx === -1 || isNumberString(vanityId))) // not vanityid found
      	return vanityId;

    const realname = playerDetails["realname"];
    if (!(typeof realname !== "string" || realname === ""))
      	return realname;

    throw new GLib.Error(
    	db_service_error_quark(),
        DbServiceErrorEnum.NotFound,
        `Could not extract author name from response`);
};

/**
 * @param {string} url
 * @param {Gio.Cancellable | null} cancellable
 * @returns A JSON response. If fails then NULL.
 */
const fetchItem = async (url, cancellable) => {
	const steam_id = extractWorkshopItemId(url);

	const msg = new Soup.Message({
    	method: "POST",
    	uri: URL_GPFD,
    });
    const requestBody = new GLib.Bytes(defaultEncoder.encode(`itemcount=1&publishedfileids%5B0%5D=${steam_id}`));
    msg.set_request_body_from_bytes(
      	"application/x-www-form-urlencoded",
      	requestBody,
    );
    const gbytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
    if (msg.statusCode !== 200) {
      	throw new GLib.Error(
        	db_service_error_quark(),
        	DbServiceErrorEnum.RequestNotSuccessful,
        	`Request was not successful. Received a response status code of \"${msg.statusCode}\"`);
    }
    const bytes = gbytes.get_data();
    if (bytes === null) throw new Error;
    const response = readJsonBytes(bytes);
    const data = response["response"]?.["publishedfiledetails"]?.[0];
    return data;
};

/**
 * @param {Readonly<string[]>} ids
 * @param {Gio.Cancellable | null} cancellable
 * @returns A JSON response. If fails then NULL.
 */
const d093067 = async (ids, cancellable) => {
	if (ids.length <= 0) return null;

	const msg = new Soup.Message({
    	method: "POST",
    	uri: URL_GPFD,
    });
    const requestBody = new GLib.Bytes(defaultEncoder.encode(`itemcount=${ids.length}${ids.reduce((acc, x, i) => `${acc}&publishedfileids%5B${i}%5D=${x}`, "")}`));
    msg.set_request_body_from_bytes(
      	"application/x-www-form-urlencoded",
      	requestBody,
    );
    const gbytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
    if (msg.statusCode !== 200) {
      	throw new GLib.Error(
        	db_service_error_quark(),
        	DbServiceErrorEnum.RequestNotSuccessful,
        	`Request was not successful. Received a response status code of \"${msg.statusCode}\"`);
    }
    const bytes = gbytes.get_data();
    if (bytes === null) throw new Error;
    const response = readJsonBytes(bytes);
    const data = response["response"]?.["publishedfiledetails"];
    if (!Array.isArray(data)) throw new Error;
    return data;
};

const fetchBatchItems = Object.assign(d093067, {
	/**
	 * @param {Readonly<string[]>} urls
	 * @param {Gio.Cancellable | null} cancellable
	 * @this {typeof d093067}
	 * @returns A JSON response. If fails then NULL.
	 */
	byUrls: async function (urls, cancellable) {
		if (urls.length <= 0) return null;
		const ids = urls.map(x => extractWorkshopItemId(x));
		return this(ids, cancellable);
	}
});

/**
 * @param {string} text
 * @param {5 | 10 | 30} itemsPerPage
 */
function * searchItems(text, itemsPerPage = 10) {
	let cursor = "*";
	while (true) {
		yield (
		/**
		 * @param {Gio.Cancellable?} cancellable
		 */
		async (cancellable) => {
			const uri = GLib.Uri.parse(`https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key=${WEBAPI}&numperpage=${itemsPerPage}&appid=550&search_text=\"${text}\"&cursor=${cursor}`, GLib.UriFlags.NONE);

			const msg = new Soup.Message({
		    	method: "POST",
		    	uri,
		    });

		    const gbytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
		    const bytes = gbytes.get_data();
		    if (msg.statusCode !== 200) {
		      	throw new GLib.Error(
		        	db_service_error_quark(),
		        	DbServiceErrorEnum.RequestNotSuccessful,
		        	`Request was not successful. Received a response status code of \"${msg.statusCode}\"`);
		    }
		    if (bytes === null) throw new Error;
		    const response = readJsonBytes(bytes)["response"];

		    const total = response["total"];
		    if (typeof total !== "number") throw new Error;

		    const items = await (async () => {
		    	if (total <= 0) return undefined;
			    return await (() => {
			    	const files = response["publishedfiledetails"];

			    	if (!Array.isArray(files)) throw new Error;
			    	if (files.length < 1) throw new Error;

			    	const ids = files.filter(
			    		/**
			    		 * @returns {x is { publishedfileid: string }}
			    		 */
			    		x => {
			    			const publishedfileid = x["publishedfileid"];
			    			if (typeof publishedfileid !== "string") return false;
			    			return true;
			    		})
			    		.map(({ publishedfileid: x }) => x);

			    	return fetchBatchItems(ids, cancellable);
			    })() || undefined;
		    })();

		    const nextCursor = response["nextCursor"];
		    cursor = nextCursor;

		    return items;
		});
	}
};

/**
 * @param {string} user_id
 */
const fetchAuthorName = async (user_id) => {
	const uri = GLib.Uri.parse(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${WEBAPI}&steamids=${user_id}`, GLib.UriFlags.NONE);

    const msg = new Soup.Message({
      	method: "GET",
      	uri,
    });

    const gbytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
    const bytes = gbytes.get_data();
    if (msg.statusCode !== 200) {
      	throw new GLib.Error(
        	db_service_error_quark(),
        	DbServiceErrorEnum.RequestNotSuccessful,
        	`Request was not successful. Received a response status code of \"${msg.statusCode}\"`);
    }
    if (bytes === null) throw new Error;
    const response = readJsonBytes(bytes);
    const summary = response["response"]?.["players"]?.[0];
    if (summary === undefined) throw new Error;
    return extractAuthorName(summary);
}

export {
	fetchItem,
	fetchAuthorName,
	searchItems,
};
