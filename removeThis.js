/**
 * @param {number} charcode
 * @param {string} name
 */
function caseX2Camel(charcode, name) {
	const charArray = Array.from(name);

	/**
	 * @type number[]
	 */
	const u8Array = [];

	for (const key in charArray) {
		const i = Number(key);
		const x = charArray[i];
		if (x === undefined) continue;

		const code = x.charCodeAt(0);

		if (i === 0) {
			if (!(code >= 97 && code <= 122)) {
				console.log(`caseSnake2Camel: refused to converted text \"${name}\" because first character is not lowercase`);
				return null;
			}
		}

		if (code !== charcode && (code < 97 || code > 122)) {
			console.log(`caseSnake2Camel: refused to converted text \"${name}\" because a character is not in the alphabet`);
			return null;
		}

		u8Array.push(code);
	}

	/**
	 * @type number[]
	 */
	const newU8Array = [];

	let i = 0;
	while (i < u8Array.length) {
		const x = u8Array[i];

		const step = (() => {
			if (x === undefined) return 1;

			if (i === u8Array.length - 1) {
				newU8Array.push(x);
				return 1;
			}

			const nextX = u8Array[i + 1];

			if (nextX === undefined) return 1;

			if (x === charcode && nextX >= 97 && nextX <= 122) {
				newU8Array.push(nextX - 32);
				return 2;
			}

			newU8Array.push(x);
			return 1;
		})();

		i+=step;
	}

	return newU8Array.map(x => String.fromCharCode(x)).reduce((acc, x) => acc.concat(x), "");
}

console.log(caseX2Camel(45, "case-x-camel"));
