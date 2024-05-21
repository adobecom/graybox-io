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

const fetch = require('node-fetch');
const {
    getAioLogger, handleExtension, isFilePatternMatched, toUTCStr
} = require('../utils');
const AppConfig = require('../appConfig');
const HelixUtils = require('../helixUtils');
const updateDocument = require('../docxUpdater');
const Sharepoint = require('../sharepoint');

const logger = getAioLogger();
const MAX_CHILDREN = 1000;
const BATCH_REQUEST_PREVIEW = 200;

const gbStyleExpression = 'gb-'; // graybox style expression. need to revisit if there are any more styles to be considered.
const gbDomainSuffix = '-graybox';

/**
 *  - Bulk Preview docx files
 *  - GET markdown files using preview-url.md
 *  - Process markdown - process MDAST by cleaning it up
 *  - Generate updated Docx file using md2docx lib
 *  - copy updated docx file to the default content tree
 *  - run the bulk preview action on the list of files that were copied to default content tree
 *  - update the project excel file as and when necessary to update the status of the promote action
 */
async function main(params) {
    logger.info('Graybox Promote Worker invoked');

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName } = appConfig.getPayload();
    const { projectExcelPath } = appConfig.getPayload();
    const sharepoint = new Sharepoint(appConfig);

    // Update Promote Status
    // const promoteTriggeredExcelValues = [['Promote triggered', toUTCStr(new Date()), '']];
    // await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteTriggeredExcelValues, true);

    logger.info(`GB ROOT FOLDER ::: ${gbRootFolder}`);
    logger.info(`GB EXP NAME ::: ${experienceName}`);

    // Get all files in the graybox folder for the specific experience name
    // NOTE: This does not capture content inside the locale/expName folders yet
    const gbFiles = await findAllFiles(experienceName, appConfig, sharepoint);
    logger.info(`Files in graybox folder in ${experienceName}`);
    logger.info(JSON.stringify(gbFiles));

    // create batches to process the data
    const batchArray = [];
    for (let i = 0; i < gbFiles.length; i += BATCH_REQUEST_PREVIEW) {
        const arrayChunk = gbFiles.slice(i, i + BATCH_REQUEST_PREVIEW);
        batchArray.push(arrayChunk);
    }

    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    const previewStatuses = [];
    let failedPreviews = [];
    if (helixUtils.canBulkPreview()) {
        logger.info('Bulk Preview enabled');

        const paths = [];
        batchArray.forEach((batch) => {
            batch.forEach((gbFile) => paths.push(handleExtension(gbFile.filePath)));
        });
        previewStatuses.push(await helixUtils.bulkPreview(paths, helixUtils.getOperations().PREVIEW, experienceName));
        logger.info('Bulk Preview completed');

        failedPreviews = previewStatuses.flatMap((statusArray) => statusArray.filter((status) => !status.success)).map((status) => status.path);

        const helixAdminApiKey = helixUtils.getAdminApiKey();

        // Promote Graybox files to the default content tree
        const { failedPromotes } = await promoteFiles(previewStatuses, experienceName, helixAdminApiKey, sharepoint, helixUtils, appConfig);

        logger.info('Updating project excel file with status');

        // Update Preview Status
        const sFailedPreviews = failedPreviews.length > 0 ? `Failed Previews(Promote won't happen for these): \n${failedPreviews.join('\n')}` : '';
        const excelValues = [['Preview completed', toUTCStr(new Date()), sFailedPreviews]];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues, true);
        logger.info('SUNIL ::: Excel updated with Preview Status');

        // Update Promote Status
        const sFailedPromoteStatuses = failedPromotes.length > 0 ? `Failed Promotes: \n${failedPromotes.join('\n')}` : '';
        const promoteExcelValues = [['Promote completed', toUTCStr(new Date()), sFailedPromoteStatuses]];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteExcelValues, true);
        logger.info('SUNIL ::: Excel updated with Promote Status');
    }

    const responsePayload = 'Graybox Promote Worker action completed.';
    logger.info(responsePayload);
    return {
        body: responsePayload,
    };
}

/**
* Promote Graybox files to the default content tree
 * @param {*} previewStatuses file preview statuses
 * @param {*} experienceName graybox experience name
 * @param {*} helixAdminApiKey helix admin api key for performing Mdast to Docx conversion
 * @returns JSON array of failed promotes
 */
async function promoteFiles(previewStatuses, experienceName, helixAdminApiKey, sharepoint, helixUtils, appConfig) {
    const failedPromotes = [];
    const options = {};
    if (helixUtils.getAdminApiKey()) {
        options.headers = new fetch.Headers();
        options.headers.append('Authorization', `token ${helixUtils.getAdminApiKey()}`);
    }

    // iterate through preview statuses, generate docx files and promote them
    const allPromises = previewStatuses.map(async (status) => {
        // check if status is an array and iterate through the array
        if (Array.isArray(status)) {
            const promises = status.map(async (stat) => {
                if (stat.success && stat.mdPath) {
                    const response = await sharepoint.fetchWithRetry(`${stat.mdPath}`, options);
                    const content = await response.text();
                    let docx;
                    const sp = await appConfig.getSpConfig();

                    if (content.includes(experienceName) || content.includes(gbStyleExpression) || content.includes(gbDomainSuffix)) {
                        // Process the Graybox Styles and Links with Mdast to Docx conversion
                        docx = await updateDocument(content, experienceName, helixAdminApiKey);
                        if (docx) {
                            logger.info(`Docx file generated for ${stat.path}`);
                            // Save file Destination full path with file name and extension
                            const destinationFilePath = `${stat.path.substring(0, stat.path.lastIndexOf('/') + 1).replace('/'.concat(experienceName), '')}${stat.fileName}`;

                            logger.info(`Destination File Path ::: ${destinationFilePath}`);
                            const saveStatus = await sharepoint.saveFile(docx, destinationFilePath);

                            if (!saveStatus || !saveStatus.success) {
                                failedPromotes.push(destinationFilePath);
                            }
                        } else {
                            logger.error(`Error generating docx file for ${stat.path}`);
                        }
                    } else {
                        logger.info(`Using promoteCopy for ${stat.path}`);
                        const copySourceFilePath = `${stat.path.substring(0, stat.path.lastIndexOf('/') + 1)}${stat.fileName}`; // Copy Source full path with file name and extension
                        const copyDestinationFolder = `${stat.path.substring(0, stat.path.lastIndexOf('/')).replace('/'.concat(experienceName), '')}`; // Copy Destination folder path, no file name

                        logger.info(`Promote Copy Source File Path ::: ${copySourceFilePath}`);
                        logger.info(`Promote Copy Destination Folder ::: ${copyDestinationFolder}`);
                        const promoteCopyFileStatus = await sharepoint.promoteCopy(copySourceFilePath, copyDestinationFolder, stat.fileName, sp);

                        if (!promoteCopyFileStatus) {
                            failedPromotes.push(`${copyDestinationFolder}/${stat.fileName}`);
                        }
                    }
                }
            });
            await Promise.all(promises); // await all async functions in the array are executed, before updating the status in the graybox project excel
        }
    });
    await Promise.all(allPromises); // await all async functions in the array are executed, before updating the status in the graybox project excel
    return { failedPromotes };
}

/**
 * Find all files in the Graybox tree to promote.
 */
async function findAllFiles(experienceName, appConfig, sharepoint) {
    const sp = await appConfig.getSpConfig();
    const options = await sharepoint.getAuthorizedRequestOption({ method: 'GET' });
    logger.info(`Options ::: ${JSON.stringify(options)}`);
    const promoteIgnoreList = appConfig.getPromoteIgnorePaths();

    return findAllGrayboxFiles({
        baseURI: sp.api.file.get.gbBaseURI,
        options,
        gbFolders: appConfig.isDraftOnly() ? [`/${experienceName}/drafts`] : [''],
        promoteIgnoreList,
        downloadBaseURI: sp.api.file.download.baseURI,
        experienceName,
        sharepoint
    });
}

/**
 * Iteratively finds all files under a specified root folder.
 */
async function findAllGrayboxFiles({
    baseURI, options, gbFolders, promoteIgnoreList, downloadBaseURI, experienceName, sharepoint
}) {
    logger.info('SUNIL ::: Inside findAllGrayboxFiles');
    logger.info(`GB Folders ::: ${JSON.stringify(gbFolders)}`);

    const gbRoot = baseURI.split(':').pop();
    // Regular expression to select the gbRoot and anything before it
    // Eg: the regex selects "https://<sharepoint-site>:/<app>-graybox"
    const pPathRegExp = new RegExp(`.*:${gbRoot}`);
    // Regular expression to select paths that has the experienceName at first or second level
    const pathsToSelectRegExp = new RegExp(`^/([^/]+/)?${experienceName}(/.*)?$`);
    const gbFiles = [];
    while (gbFolders.length !== 0) {
        const uri = `${baseURI}${gbFolders.shift()}:/children?$top=${MAX_CHILDREN}`;
        logger.info(`URI ::: ${uri}`);
        // eslint-disable-next-line no-await-in-loop
        const res = await sharepoint.fetchWithRetry(uri, options);
        if (res.ok) {
            logger.info(`Response OK for ${uri}`);
            // eslint-disable-next-line no-await-in-loop
            const json = await res.json();
            // eslint-disable-next-line no-await-in-loop
            const driveItems = json.value;
            for (let di = 0; di < driveItems?.length; di += 1) {
                const item = driveItems[di];
                const itemPath = `${item.parentReference.path.replace(pPathRegExp, '')}/${item.name}`;
                logger.info(`${itemPath} ::: ${pathsToSelectRegExp.test(itemPath)}`);
                if (!isFilePatternMatched(itemPath, promoteIgnoreList)) {
                    if (item.folder) {
                        // it is a folder
                        gbFolders.push(itemPath);
                    } else if (pathsToSelectRegExp.test(itemPath)) {
                        const downloadUrl = `${downloadBaseURI}/${item.id}/content`;
                        // eslint-disable-next-line no-await-in-loop
                        gbFiles.push({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                    }
                } else {
                    logger.info(`Ignored from promote: ${itemPath}`);
                }
            }
        } else {
            logger.error(`Failed to fetch children for ${uri} with status ${res.status}`);
        }
    }
    return gbFiles;
}

exports.main = main;
