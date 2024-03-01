/* ************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2024 Adobe
* All Rights Reserved.
*
* NOTICE: All information contained herein is, and remains
* the property of Adobe and its suppliers, if any. The intellectual
* and technical concepts contained herein are proprietary to Adobe
* and its suppliers and are protected by all applicable intellectual
* property laws, including trade secret and copyright laws.
* Dissemination of this information or reproduction of this material
* is strictly forbidden unless prior written permission is obtained
* from Adobe.
************************************************************************* */

const AioLogger = require('@adobe/aio-lib-core-logging');

function getAioLogger(loggerName = 'main', logLevel = 'info') {
    return AioLogger(loggerName, { level: logLevel });
}

function strToArray(val) {
    if (val && typeof val === 'string') {
        return val.split(',').map((e) => e.trim()).filter((e) => e);
    }
    return val;
}

module.exports = {
    getAioLogger,
    strToArray
};