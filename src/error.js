import GLib from 'gi://GLib';

export const db_service_error_quark = () => {
	return GLib.quark_from_string('db-service-error-quark');
};

export const DbServiceErrorEnum = {
	/**
	 * Wrong URL format, ID parameter not found
	 */
	IdNotFound: 1,
	/**
	 * Wrong URL format, ID parameter is not in decimal
	 */
	IdNotDecimal: 2,
	/**
	 * Generic error from Steamwork server
	 */
	RequestNotSuccessful: 3,
	/**
	 * Generic not-found
	 */
	NotFound: 4,
};

