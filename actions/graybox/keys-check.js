const jwt = require('jsonwebtoken');
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
        // Keys to check (typically JWT or certificate keys)
        const keysToCheck = {};

        // Extract helixAdminApiKeys directly from params
        let helixKeys = {};
        if (params.helixAdminApiKeys) {
            try {
                // Parse the helixAdminApiKeys JSON string from params
                helixKeys = JSON.parse(params.helixAdminApiKeys);
                // Add each key to the keysToCheck object
                Object.keys(helixKeys).forEach(keyName => {
                    keysToCheck[`HELIX_ADMIN_API_KEYS.${keyName}`] = helixKeys[keyName];
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

        // Check expiration for each key
        const results = {};
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const oneMonthInSeconds = 30 * 24 * 60 * 60; // 30 days in seconds

        for (const [keyName, keyValue] of Object.entries(keysToCheck)) {
            try {
                // Try to decode as JWT
                const decoded = jwt.decode(keyValue, { complete: true });

                if (decoded && decoded.payload && decoded.payload.exp) {
                    const expirationTime = decoded.payload.exp;
                    const timeRemaining = expirationTime - now;

                    if (timeRemaining <= 0) {
                        results[keyName] = {
                            status: 'expired',
                            expiresIn: 'already expired',
                            subject: decoded.payload.sub || 'unknown'
                        };
                    } else if (timeRemaining <= oneMonthInSeconds) {
                        const daysRemaining = Math.floor(timeRemaining / (24 * 60 * 60));
                        results[keyName] = {
                            status: 'expiring_soon',
                            expiresIn: `${daysRemaining} days`,
                            subject: decoded.payload.sub || 'unknown'
                        };
                    } else {
                        const daysRemaining = Math.floor(timeRemaining / (24 * 60 * 60));
                        results[keyName] = {
                            status: 'valid',
                            expiresIn: `${daysRemaining} days`,
                            subject: decoded.payload.sub || 'unknown'
                        };
                    }
                } else {
                    // If not a JWT, check if it's a certificate
                    if (keyValue.includes('-----BEGIN') && keyValue.includes('-----END')) {
                        results[keyName] = {
                            status: 'unknown',
                            message: 'Certificate format detected but expiration cannot be determined automatically'
                        };
                    } else {
                        results[keyName] = {
                            status: 'unknown',
                            message: 'Not a JWT token or recognized certificate format'
                        };
                    }
                }
            } catch (error) {
                results[keyName] = {
                    status: 'error',
                    message: `Error checking key: ${error.message}`
                };
            }
        }

        // Summarize results
        const expired = Object.values(results).filter(r => r.status === 'expired').length;
        const expiringSoon = Object.values(results).filter(r => r.status === 'expiring_soon').length;
        const valid = Object.values(results).filter(r => r.status === 'valid').length;
        const unknown = Object.values(results).filter(r => r.status === 'unknown').length;

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
