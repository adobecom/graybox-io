const {
    getAioLogger
} = require('../utils');

/**
 * Checks the expiration status of keys stored in .env file
 *
 * @param {object} params - Parameters passed to the action
 * @returns {object} Response containing the status of each key
 */
async function main(params) {
    const logger = getAioLogger();
    try {
        const keysToCheck = {};

        let helixKeys = {};
        if (params.helixAdminApiKeys) {
            try {
                helixKeys = JSON.parse(params.helixAdminApiKeys);
                Object.keys(helixKeys).forEach((keyName) => {
                    keysToCheck[`${keyName}`] = helixKeys[keyName];
                });
            } catch (error) {
                logger.error(`Error parsing HELIX_ADMIN_API_KEYS from params: ${error.message}`);
            }
        }

        if (Object.keys(keysToCheck).length === 0) {
            return {
                statusCode: 200,
                body: {
                    message: 'No keys found to check'
                }
            };
        }

        const results = {};
        const now = Math.floor(Date.now() / 1000);
        const oneMonthInSeconds = 30 * 24 * 60 * 60;

        Object.entries(keysToCheck).forEach(([keyName, keyValue]) => {
            try {
                const parts = keyValue.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    if (payload && payload.exp) {
                        const expirationTime = payload.exp;
                        const timeRemaining = expirationTime - now;

                        if (timeRemaining <= 0) {
                            results[keyName] = {
                                status: 'expired',
                                expiresIn: 'already expired',
                                subject: payload.sub || 'unknown'
                            };
                        } else if (timeRemaining <= oneMonthInSeconds) {
                            const daysRemaining = Math.floor(timeRemaining / (24 * 60 * 60));
                            results[keyName] = {
                                status: 'expiring_soon',
                                expiresIn: `${daysRemaining} days`,
                                subject: payload.sub || 'unknown'
                            };
                        } else {
                            const daysRemaining = Math.floor(timeRemaining / (24 * 60 * 60));
                            results[keyName] = {
                                status: 'valid',
                                expiresIn: `${daysRemaining} days`,
                                subject: payload.sub || 'unknown'
                            };
                        }
                    }
                } else {
                    results[keyName] = {
                        status: 'unknown',
                        message: 'Not a valid JWT format'
                    };
                }
            } catch (error) {
                results[keyName] = {
                    status: 'error',
                    message: `Error checking key: ${error.message}`
                };
            }
        });

        const expired = Object.values(results).filter((r) => r.status === 'expired').length;
        const expiringSoon = Object.values(results).filter((r) => r.status === 'expiring_soon').length;
        const valid = Object.values(results).filter((r) => r.status === 'valid').length;
        const unknown = Object.values(results).filter((r) => r.status === 'unknown').length;

        return {
            statusCode: 200,
            body: {
                summary: {
                    total: Object.keys(results).length,
                    expired,
                    expiringSoon,
                    valid,
                    unknown
                },
                details: results
            }
        };
    } catch (error) {
        logger.error(error);
        return {
            statusCode: 500,
            body: {
                error: 'An error occurred while checking keys',
                message: error.message
            }
        };
    }
}

module.exports = { main };
