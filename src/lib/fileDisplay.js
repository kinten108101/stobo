/**
 * @param {number} bytes
 * @returns {string}
 */
export function bytes2humanreadable(bytes) {
	const precision = 3;
	const kbs = bytes / 1000;
	if (bytes < 1000)
		return `${bytes} B`;

	const mbs = kbs / 1000;
	if (kbs < 1000)
		return `${kbs.toPrecision(precision)} KB`;

	const gbs = mbs / 1000;
	if (mbs < 1000)
		return `${mbs.toPrecision(precision)} MB`;

	return `${gbs.toPrecision(precision)} GB`;
}
