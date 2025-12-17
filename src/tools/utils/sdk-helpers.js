/**
 * SDK Helper Utilities
 * Provides consistent handling of Letta SDK response formats
 */

/**
 * Extract array data from SDK response
 * The Letta SDK returns responses in various formats:
 * - { items: [...], body: [...], options: {...}, response: {...} } (paginated list)
 * - { body: [...] } (some endpoints)
 * - [...] (direct array)
 * - { data: [...] } (some endpoints)
 *
 * This function normalizes all formats to return the array.
 *
 * @param {any} result - The SDK response
 * @param {string[]} [keys=['items', 'body', 'data', 'results', 'passages', 'agents', 'tools', 'blocks', 'sources', 'jobs', 'files', 'folders']] - Keys to check for array data
 * @returns {Array} The extracted array or empty array if not found
 */
export function extractArrayFromSdkResponse(result, keys = null) {
    if (!result) return [];

    // If already an array, return it
    if (Array.isArray(result)) return result;

    // Default keys to check in order of priority
    const defaultKeys = [
        'items', // Primary SDK format for lists
        'body', // Alternative SDK format
        'data', // Common API format
        'results', // Search results
        'passages', // Memory passages
        'agents', // Agent lists
        'tools', // Tool lists
        'blocks', // Memory blocks
        'sources', // Data sources
        'jobs', // Job lists
        'files', // File lists
        'folders', // Folder lists
    ];

    const keysToCheck = keys || defaultKeys;

    // Check each key for an array
    for (const key of keysToCheck) {
        if (Array.isArray(result[key])) {
            return result[key];
        }
    }

    // If the result is an object but not any known format, return empty array
    return [];
}

/**
 * Extract single item from SDK response
 * Some SDK operations return { body: item } instead of item directly
 *
 * @param {any} result - The SDK response
 * @returns {any} The extracted item or the result itself
 */
export function extractItemFromSdkResponse(result) {
    if (!result) return result;

    // If result has a body property and it's not an array, it's the item
    if (result.body && !Array.isArray(result.body)) {
        return result.body;
    }

    return result;
}

/**
 * Check if SDK response indicates success
 * @param {any} result - The SDK response
 * @returns {boolean}
 */
export function isSdkResponseSuccess(result) {
    if (!result) return false;

    // If we got a result without error, it's successful
    if (result.error) return false;

    return true;
}

export default {
    extractArrayFromSdkResponse,
    extractItemFromSdkResponse,
    isSdkResponseSuccess,
};
