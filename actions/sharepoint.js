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

const { Headers } = require('node-fetch');
const fetch = require('node-fetch');
const { getConfig } = require('./config');
const { getAioLogger } = require('./utils');
const appConfig = require('./appConfig');
const sharepointAuth = require('./sharepointAuth');

const SP_CONN_ERR_LST = ['ETIMEDOUT', 'ECONNRESET'];
const APP_USER_AGENT = 'ISV|Adobe|MiloFloodgate/0.1.0';
const BATCH_REQUEST_LIMIT = 20;
const BATCH_DELAY_TIME = 200;
const NUM_REQ_THRESHOLD = 5;
const RETRY_ON_CF = 3;
const TOO_MANY_REQUESTS = '429';
// Added for debugging rate limit headers
const LOG_RESP_HEADER = false;
let nextCallAfter = 0;
const itemIdMap = {};

// eslint-disable-next-line default-param-last
async function getAuthorizedRequestOption({ body = null, json = true, method = 'GET' } = {}) {
    const appSpToken = await sharepointAuth.getAccessToken();
    const bearer = `Bearer ${appSpToken}`;

    const headers = new Headers();
    headers.append('Authorization', bearer);
    headers.append('User-Agent', APP_USER_AGENT);
    if (json) {
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
    }

    const options = {
        method,
        headers,
    };

    if (body) {
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    return options;
}

async function executeGQL(url, opts) {
    const options = await getAuthorizedRequestOption(opts);
    const res = await fetchWithRetry(url, options);
    getAioLogger().info(`Executing Excel Update with URL: ${url} \n Response: ${JSON.stringify(res.status)}`);
    if (!res.ok) {
        throw new Error(`Failed to execute ${url}`);
    }
    return res.json();
}

async function getItemId(uri, path) {
    const key = `~${uri}~${path}~`;
    itemIdMap[key] = itemIdMap[key] || await executeGQL(`${uri}${path}?$select=id`);
    return itemIdMap[key]?.id;
}

async function getDriveRoot(accessToken) {
    const logger = getAioLogger();
    try {
        const headers = new Headers();
        headers.append('Authorization', `Bearer ${accessToken}`);
        headers.append('User-Agent', APP_USER_AGENT);
        headers.append('Accept', 'application/json');
        const spSite = appConfig.getSpSite();
        const response = await fetchWithRetry(`${spSite}/drive/root`, { headers });

        if (response?.ok) {
            const driveDtls = await response.json();
            return driveDtls;
        }
        logger.info(`Unable to get User details: ${response?.status}`);
    } catch (error) {
        logger.info('Unable to fetch User Info');
        logger.info(JSON.stringify(error));
    }
    return null;
}

async function getFileData(filePath, isGraybox) {
    const { sp } = await getConfig();
    const options = await getAuthorizedRequestOption();
    const baseURI = isGraybox ? sp.api.directory.create.gbBaseURI : sp.api.directory.create.baseURI;
    const resp = await fetchWithRetry(`${baseURI}${filePath}`, options);
    const json = await resp.json();
    const fileDownloadUrl = json['@microsoft.graph.downloadUrl'];
    const fileSize = json.size;
    return { fileDownloadUrl, fileSize };
}

async function getFilesData(filePaths, isGraybox) {
    const batchArray = [];
    for (let i = 0; i < filePaths.length; i += BATCH_REQUEST_LIMIT) {
        const arrayChunk = filePaths.slice(i, i + BATCH_REQUEST_LIMIT);
        batchArray.push(arrayChunk);
    }
    // process data in batches
    const fileJsonResp = [];
    for (let i = 0; i < batchArray.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        fileJsonResp.push(...await Promise.all(
            batchArray[i].map((file) => getFileData(file, isGraybox)),
        ));
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_TIME));
    }
    return fileJsonResp;
}

async function getFile(doc) {
    if (doc && doc.sp && doc.sp.status === 200) {
        const response = await fetchWithRetry(doc.sp.fileDownloadUrl);
        return response.blob();
    }
    return undefined;
}

async function getFileUsingDownloadUrl(downloadUrl) {
    const options = await getAuthorizedRequestOption({ json: false });
    const response = await fetchWithRetry(downloadUrl, options);
    if (response) {
        return response.blob();
    }
    return undefined;
}

async function createFolder(folder, spConfig, isGraybox) {
    const logger = getAioLogger();
    logger.info(`Creating folder ${folder}`);
    let sp;
    if (spConfig) {
        sp = spConfig;
    } else {
        sp = await getConfig().sp;
    }
    const options = await getAuthorizedRequestOption({ method: sp.api.directory.create.method });
    options.body = JSON.stringify(sp.api.directory.create.payload);

    const baseURI = isGraybox ? sp.api.directory.create.gbBaseURI : sp.api.directory.create.baseURI;
    const res = await fetchWithRetry(`${baseURI}${folder}`, options);
    logger.info(`Created folder ${folder} with status ${res.status}`);
    if (res.ok) {
        return res.json();
    }
    throw new Error(`Could not create folder: ${folder}`);
}

function getFolderFromPath(path) {
    if (path.includes('.')) {
        return path.substring(0, path.lastIndexOf('/'));
    }
    return path;
}

function getFileNameFromPath(path) {
    return path.split('/').pop().split('/').pop();
}

/**
 * Create Upload Session
 * @param {*} sp sharepoint config
 * @param {*} file file object to be uploaded
 * @param {*} dest destination/target file full path with folder and filename with extension
 * @param {*} filename filename with extension
 * @param {*} isGraybox is graybox flag
 * @returns upload session json object
 */
async function createUploadSession(sp, file, dest, filename, isGraybox) {
    const logger = getAioLogger();

    let fileSize = file.size;
    if (Buffer.isBuffer(file)) {
        fileSize = Buffer.byteLength(file);
    }

    const payload = {
        ...sp.api.file.createUploadSession.payload,
        description: 'Preview file',
        fileSize,
        name: filename,
    };

    const options = await getAuthorizedRequestOption({ method: sp.api.file.createUploadSession.method });
    options.body = JSON.stringify(payload);

    const baseURI = isGraybox ? sp.api.file.createUploadSession.gbBaseURI : sp.api.file.createUploadSession.baseURI;

    const createdUploadSession = await fetchWithRetry(`${baseURI}${dest}:/createUploadSession`, options);

    return createdUploadSession.ok ? createdUploadSession.json() : undefined;
}

async function uploadFile(sp, uploadUrl, file) {
    const options = await getAuthorizedRequestOption({
        json: false,
        method: sp.api.file.upload.method,
    });
    let fileSize = file.size;
    if (Buffer.isBuffer(file)) {
        fileSize = Buffer.byteLength(file);
    }
    // TODO API is limited to 60Mb, for more, we need to batch the upload.
    options.headers.append('Content-Length', fileSize);
    options.headers.append('Content-Range', `bytes 0-${fileSize - 1}/${fileSize}`);
    options.headers.append('Prefer', 'bypass-shared-lock');
    options.body = file;
    return fetchWithRetry(`${uploadUrl}`, options);
}

async function deleteFile(sp, filePath) {
    const options = await getAuthorizedRequestOption({
        json: false,
        method: sp.api.file.delete.method,
    });
    options.headers.append('Prefer', 'bypass-shared-lock');
    return fetch(filePath, options);
}

async function renameFile(spFileUrl, filename) {
    const options = await getAuthorizedRequestOption({ method: 'PATCH', body: JSON.stringify({ name: filename }) });
    options.headers.append('Prefer', 'bypass-shared-lock');
    return fetch(spFileUrl, options);
}

async function releaseUploadSession(sp, uploadUrl) {
    await deleteFile(sp, uploadUrl);
}

/**
 * Get Locked File New Name
 * @param {*} filename original file name
 * @returns new locked file name with timestamp
 */
function getLockedFileNewName(filename) {
    const extIndex = filename.indexOf('.');
    const fileNameWithoutExtn = filename.substring(0, extIndex);
    const fileExtn = filename.substring(extIndex);
    return `${fileNameWithoutExtn}-locked-${Date.now()}${fileExtn}`;
}

/**
 * Create session and upload file
 * @param {*} sp sharepoint config
 * @param {*} file file object to be uploaded
 * @param {*} dest destination/target file full path with folder and filename with extension
 * @param {*} filename filename with extension
 * @param {*} isGraybox is graybox flag
 * @returns upload status object
 */
async function createSessionAndUploadFile(sp, file, dest, filename, isGraybox) {
    const logger = getAioLogger();
    logger.info(`Creating session and uploading file ${filename} to ${dest}`);
    const createdUploadSession = await createUploadSession(sp, file, dest, filename, isGraybox);
    const status = {};
    if (createdUploadSession) {
        const uploadSessionUrl = createdUploadSession.uploadUrl;
        if (!uploadSessionUrl) {
            return status;
        }
        status.sessionUrl = uploadSessionUrl;
        const uploadedFile = await uploadFile(sp, uploadSessionUrl, file);
        if (!uploadedFile) {
            return status;
        }
        if (uploadedFile.ok) {
            status.uploadedFile = await uploadedFile.json();
            status.success = true;
        } else if (uploadedFile.status === 423) {
            status.locked = true;
        }
    }
    return status;
}

/**
 * The method gets the list of files, extracts the parent path, extracts uniq paths,
 * filters common parents urls
 * e.g.. [/a/b/one.txt, /a/b/two.txt, /a/c/three.txt, /a/c/d/three.txt]
 * Folders to create would be [/a/b, /a/c/d]
 * This triggers async and waits for batch to complete. These are small batches so should be fast.
 * The $batch can be used in future to submit only one URL
 * @param {*} srcPathList Paths of files for which folder creating is needed
 * @param {*} isGraybox Is graybox flag
 * @returns Create folder status
 */
async function bulkCreateFolders(srcPathList, isGraybox) {
    const logger = getAioLogger();
    const createtFolderStatuses = [];
    const allPaths = srcPathList.map((e) => {
        if (e.length < 2 || !e[1]?.doc) return '';
        return getFolderFromPath(e[1].doc.filePath);
    }).filter((e) => true && e);
    const uniqPathLst = Array.from(new Set(allPaths));
    const leafPathLst = uniqPathLst.filter((e) => uniqPathLst.findIndex((e1) => e1.indexOf(`${e}/`) >= 0) < 0);
    try {
        logger.info('bulkCreateFolders started');
        const promises = leafPathLst.map((folder) => createFolder(folder, isGraybox));
        logger.info('Got createfolder promises and waiting....');
        createtFolderStatuses.push(...await Promise.all(promises));
        logger.info(`bulkCreateFolders completed ${createtFolderStatuses?.length}`);
    } catch (error) {
        logger.info('Error while creating folders');
        logger.info(error?.stack);
    }
    logger.info(`bulkCreateFolders returning ${createtFolderStatuses?.length}`);
    return createtFolderStatuses;
}

/**
 * Copy File
 * @param {*} srcPath source file full path with folder and filename with extension
 * @param {*} destinationFolder destination folder path
 * @param {*} newName new file name
 * @param {*} isGraybox is graybox flag
 * @param {*} isGrayboxLockedFile is graybox locked file flag
 * @param {*} spConfig sharepoint config
 * @returns copy status true/false for the file
 */
async function copyFile(srcPath, destinationFolder, newName, isGraybox, isGrayboxLockedFile, spConfig) {
    const logger = getAioLogger();
    logger.info(`In copy function: ${srcPath} to ${destinationFolder} with ${newName}`);
    let sp;
    if (spConfig) {
        sp = spConfig;
    } else {
        sp = await getConfig().sp;
    }

    const { baseURI, gbBaseURI } = sp.api.file.copy;
    const rootFolder = isGraybox ? gbBaseURI.split('/').pop() : baseURI.split('/').pop();
    logger.info(`Copying file ${srcPath} to ${destinationFolder}`);
    const payload = { ...sp.api.file.copy.payload, parentReference: { path: `${rootFolder}${destinationFolder}` } };
    if (newName) {
        payload.name = newName;
    }
    const options = await getAuthorizedRequestOption({
        method: sp.api.file.copy.method,
        body: JSON.stringify(payload),
    });
    // In case of copy action triggered via saveFile(), locked file copy happens in the graybox content location
    // So baseURI is updated to reflect the destination accordingly
    const contentURI = isGraybox && isGrayboxLockedFile ? gbBaseURI : baseURI;
    // const contentURI = isGraybox ? gbBaseURI : baseURI;

    const copyStatusInfo = await fetchWithRetry(`${contentURI}${srcPath}:/copy?@microsoft.graph.conflictBehavior=replace`, options);
    const statusUrl = copyStatusInfo.headers.get('Location');
    let copySuccess = false;
    let copyStatusJson = {};
    if (!statusUrl) {
        logger.info(`Copy of ${srcPath} returned ${copyStatusInfo?.status} with no followup URL`);
    }
    while (statusUrl && !copySuccess && copyStatusJson.status !== 'failed') {
        // eslint-disable-next-line no-await-in-loop
        const status = await fetchWithRetry(statusUrl);
        if (status.ok) {
            // eslint-disable-next-line no-await-in-loop
            copyStatusJson = await status.json();
            copySuccess = copyStatusJson.status === 'completed';
        }
    }
    return copySuccess;
}

/**
 * Save File
 * Also handles the locked files by renaming the locked file, copying it to a new file called -locked-<timestamp>,
 * then reuploads the original file and then deleting the renamed locked file.
 * @param {*} file file object to be saved
 * @param {*} dest destination file full path with folder and filename with extension
 * @param {*} spConfig sharepoint config
 * @param {*} isGraybox is graybox flag
 * @returns save file status true/false for the file & the path of the file
 */
async function saveFile(file, dest, spConfig, isGraybox) {
    const logger = getAioLogger();

    try {
        const folder = getFolderFromPath(dest);
        const filename = getFileNameFromPath(dest);
        logger.info(`Saving file ${filename} to ${folder}`);
        await createFolder(folder, spConfig);
        let sp;
        if (spConfig) {
            sp = spConfig;
        } else {
            sp = await getConfig().sp;
        }

        let uploadFileStatus = await createSessionAndUploadFile(sp, file, dest, filename, isGraybox);

        if (uploadFileStatus.locked) {
            await releaseUploadSession(sp, uploadFileStatus.sessionUrl);
            const lockedFileNewName = getLockedFileNewName(filename);
            const baseURI = isGraybox ? sp.api.file.get.gbBaseURI : sp.api.file.get.baseURI;
            const spFileUrl = `${baseURI}${dest}`;
            await renameFile(spFileUrl, lockedFileNewName);
            const newLockedFilePath = `${folder}/${lockedFileNewName}`;
            const copyFileStatus = await copyFile(newLockedFilePath, folder, filename, isGraybox, true, sp);

            if (copyFileStatus) {
                uploadFileStatus = await createSessionAndUploadFile(sp, file, dest, filename, isGraybox);
                if (uploadFileStatus.success) {
                    await deleteFile(sp, `${baseURI}${newLockedFilePath}`);
                }
            }
        }
        const uploadedFileJson = uploadFileStatus.uploadedFile;
        if (uploadedFileJson) {
            return { success: true, uploadedFileJson, path: dest };
        }
    } catch (error) {
        return { success: false, path: dest, errorMsg: error.message };
    }
    return { success: false, path: dest };
}

async function saveFileSimple(file, dest, spConfig, isGraybox) {
    const logger = getAioLogger();

    try {
        const folder = getFolderFromPath(dest);
        const filename = getFileNameFromPath(dest);
        logger.info(`Saving file ${filename} to ${folder}`);
        await createFolder(folder, spConfig);
        let sp;
        if (spConfig) {
            sp = spConfig;
        } else {
            sp = await getConfig().sp;
        }

        const uploadFileStatus = await createSessionAndUploadFile(sp, file, dest, filename, isGraybox);
        if (uploadFileStatus.locked) {
            logger.info(`Locked file detected: ${dest}`);
            return { success: false, path: dest, errorMsg: 'File is locked' };
        }
        const uploadedFileJson = uploadFileStatus.uploadedFile;
        if (uploadedFileJson) {
            return { success: true, uploadedFileJson, path: dest };
        }
    } catch (error) {
        logger.info(`Error while saving file: ${dest} ::: ${error.message}`);
        return { success: false, path: dest, errorMsg: error.message };
    }
    return { success: false, path: dest };
}

async function getExcelTable(excelPath, tableName) {
    const { sp } = await getConfig();
    const itemId = await getItemId(sp.api.file.get.baseURI, excelPath);
    if (itemId) {
        const tableJson = await executeGQL(`${sp.api.excel.get.baseItemsURI}/${itemId}/workbook/tables/${tableName}/rows`);
        return !tableJson?.value ? [] :
            tableJson.value
                .filter((e) => e.values?.find((rw) => rw.find((col) => col)))
                .map((e) => e.values);
    }
    return [];
}

async function updateExcelTable(excelPath, tableName, values) {
    const { sp } = await getConfig();
    const itemId = await getItemId(sp.api.file.get.gbBaseURI, excelPath);
    if (itemId) {
        return executeGQL(`${sp.api.excel.update.baseItemsURI}/${itemId}/workbook/tables/${tableName}/rows`, {
            body: JSON.stringify({ values }),
            method: sp.api.excel.update.method,
        });
    }
    return {};
}

// fetch-with-retry added to check for Sharepoint RateLimit headers and 429 errors and to handle them accordingly.
async function fetchWithRetry(apiUrl, options, retryCounts) {
    let retryCount = retryCounts || 0;
    const logger = getAioLogger();
    return new Promise((resolve, reject) => {
        const currentTime = Date.now();
        if (retryCount > NUM_REQ_THRESHOLD) {
            reject();
        } else if (nextCallAfter !== 0 && currentTime < nextCallAfter) {
            setTimeout(() => fetchWithRetry(apiUrl, options, retryCount)
                .then((newResp) => resolve(newResp))
                .catch((err) => reject(err)), nextCallAfter - currentTime);
        } else {
            retryCount += 1;
            fetch(apiUrl, options).then((resp) => {
                logHeaders(resp);
                const retryAfter = resp.headers.get('ratelimit-reset') || resp.headers.get('retry-after') || 0;
                if ((resp.headers.get('test-retry-status') === TOO_MANY_REQUESTS) || (resp.status === TOO_MANY_REQUESTS)) {
                    nextCallAfter = Date.now() + retryAfter * 1000;
                    logger.info(`Retry ${nextCallAfter}`);
                    fetchWithRetry(apiUrl, options, retryCount)
                        .then((newResp) => resolve(newResp))
                        .catch((err) => reject(err));
                } else {
                    nextCallAfter = retryAfter ? Math.max(Date.now() + retryAfter * 1000, nextCallAfter) : nextCallAfter;
                    resolve(resp);
                }
            }).catch((err) => {
                logger.warn(`Connection error ${apiUrl} with ${JSON.stringify(err)}`);
                if (err && SP_CONN_ERR_LST.includes(err.code) && retryCount < NUM_REQ_THRESHOLD) {
                    logger.info(`Retry ${SP_CONN_ERR_LST}`);
                    nextCallAfter = Date.now() + RETRY_ON_CF * 1000;
                    return fetchWithRetry(apiUrl, options, retryCount)
                        .then((newResp) => resolve(newResp))
                        .catch((err2) => reject(err2));
                }
                return reject(err);
            });
        }
    });
}

function getHeadersStr(response) {
    const headers = {};
    response?.headers?.forEach((value, name) => {
        headers[name] = value;
    });
    return JSON.stringify(headers);
}

function logHeaders(response) {
    if (!LOG_RESP_HEADER) return;
    const logger = getAioLogger();
    const hdrStr = getHeadersStr(response);
    const logStr = `Status is ${response.status} with headers ${hdrStr}`;

    if (logStr.toUpperCase().indexOf('RATE') > 0 || logStr.toUpperCase().indexOf('RETRY') > 0) logger.info(logStr);
}

module.exports = {
    getAuthorizedRequestOption,
    executeGQL,
    getDriveRoot,
    getExcelTable,
    getFileData,
    getFilesData,
    getFile,
    getFileUsingDownloadUrl,
    copyFile,
    saveFile,
    saveFileSimple,
    createFolder,
    updateExcelTable,
    fetchWithRetry,
    getFolderFromPath,
    getFileNameFromPath,
    bulkCreateFolders,
};
