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
    getAioLogger, handleExtension, toUTCStr
} = require('../utils');
const AppConfig = require('../appConfig');
const HelixUtils = require('../helixUtils');
const Sharepoint = require('../sharepoint');
const updateDocument = require('../docxUpdater');
const initFilesWrapper = require('./filesWrapper');

const gbStyleExpression = 'gb-'; // graybox style expression. need to revisit if there are any more styles to be considered.
const gbDomainSuffix = '-graybox';

const BATCH_REQUEST_PROMOTE = 200;

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Process Docx Action triggered');

    const appConfig = new AppConfig(params);
    const {
        spToken, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath, draftsOnly
    } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);
    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;

    // Get the Helix Admin API Key for the Graybox content tree, needed for accessing (with auth) Images in graybox tree
    const helixAdminApiKey = helixUtils.getAdminApiKey(true);

    const previewStatuses = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`);

    logger.info(`In Process-doc-worker, previewStatuses: ${JSON.stringify(previewStatuses)}`);
    if (!previewStatuses) {
        responsePayload = 'No preview statuses found';
        logger.info(responsePayload);
        return exitAction({
            body: responsePayload,
            statusCode: 200
        });
    }
    const processFilesParams = {
        previewStatuses,
        experienceName,
        helixAdminApiKey,
        sharepoint,
        helixUtils,
        appConfig,
        filesWrapper,
        gbRootFolder
    };
    // Promote Graybox files to the default content tree
    const { promotes, failedPromotes } = await processFiles(processFilesParams);

    // Update Promote Status
    const sFailedPromoteStatuses = failedPromotes.length > 0 ? `Failed Promotes: \n${failedPromotes.join('\n')}` : '';
    const promoteExcelValues = [['Promote completed', toUTCStr(new Date()), sFailedPromoteStatuses]];
    await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteExcelValues);

    responsePayload = 'Processing of Graybox Content Tree completed';
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
}

/**
* Process files to clean up GB Styles and Link
* @returns
*/
async function processFiles({
    previewStatuses, experienceName, helixAdminApiKey, sharepoint, helixUtils, appConfig, filesWrapper, gbRootFolder
}) {
    const promotes = [];
    const failedPromotes = [];
    const options = {};
    // Passing isGraybox param true to fetch graybox Hlx Admin API Key
    const grayboxHlxAdminApiKey = helixUtils.getAdminApiKey(true);
    if (grayboxHlxAdminApiKey) {
        options.headers = new fetch.Headers();
        options.headers.append('Authorization', `token ${grayboxHlxAdminApiKey}`);
    }

    // Read the Ongoing Projects JSON file
    const projects = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');

    // Read the Project Status in the current project's "status.json" file
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);

    // Read the Batch Status in the current project's "batch_status.json" file
    const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);

    logger.info(`In Process-doc-worker, batchStatusJson: ${JSON.stringify(batchStatusJson)}`);
    const promoteBatchesJson = {};
    const copyBatchesJson = {};
    let promoteBatchCount = 0;
    let copyBatchCount = 0;

    // iterate through preview statuses, generate docx files and create promote & copy batches
    Object.keys(previewStatuses).forEach(async (batchName) => {
        logger.info(`In Process-doc-worker Processing batch ${batchName}`);
        const batchPreviewStatuses = previewStatuses[batchName];
        logger.info(`In Process-doc-worker previewStatuses[batchName] ${JSON.stringify(previewStatuses[batchName])} batch ${batchName} with ${batchPreviewStatuses.length} files`);
        logger.info(`In Process-doc-worker batchStatusJson[batchName] ${batchStatusJson[batchName]}`);
        logger.info(`In Process-doc-worker batchStatusJson[batchName] === 'initial_preview_done' ${batchStatusJson[batchName] === 'initial_preview_done'}`);

        // Check if Step 2 finished, do the Step 3, if the batch status is 'initial_preview_done' then process the batch
        if (batchStatusJson[batchName] === 'initial_preview_done') {
            logger.info(`In Process-doc-worker batchStatusJson[batchName] ${batchStatusJson[batchName]}`);

            const allPromises = batchPreviewStatuses.map(async (status) => {
                if (status.success && status.mdPath) { // If the file is successfully initial previewed and has a mdPath then process the file
                    const response = await sharepoint.fetchWithRetry(`${status.mdPath}`, options);
                    const content = await response.text();
                    let docx;
                    const sp = await appConfig.getSpConfig();

                    if (content.includes(experienceName) || content.includes(gbStyleExpression) || content.includes(gbDomainSuffix)) {
                        // Process the Graybox Styles and Links with Mdast to Docx conversion
                        docx = await updateDocument(content, experienceName, helixAdminApiKey);
                        if (docx) {
                            const destinationFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1).replace('/'.concat(experienceName), '')}${status.fileName}`;
                            // Write the processed documents to the AIO folder for docx files
                            await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/docx${destinationFilePath}`, docx);
                            // Create Promote Batches
                            const promoteBatchName = `batch_${promoteBatchCount + 1}`;
                            logger.info(`In Process-doc-worker Promote Batch Name: ${promoteBatchName}`);
                            const promoteBatchJson = promoteBatchesJson[promoteBatchName];
                            logger.info(`In Process-doc-worker Promote Batch JSON: ${JSON.stringify(promoteBatchJson)}`);
                            if (!promoteBatchJson) {
                                promoteBatchesJson[promoteBatchName] = [];
                            }
                            promoteBatchesJson[promoteBatchName].push(destinationFilePath);
                            logger.info(`In Process-doc-worker Promote Batch JSON after push: ${JSON.stringify(promoteBatchesJson)}`);

                            // If the promote batch count reaches the limit, increment the promote batch count
                            if (promoteBatchCount === BATCH_REQUEST_PROMOTE) {
                                promoteBatchCount += 1;
                            }
                            // Write the promote batches JSON file
                            await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promote_batches.json`, promoteBatchesJson);
                            batchStatusJson[batchName] = 'processed';
                        }
                    } else {
                        // Copy Source full path with file name and extension
                        const copySourceFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1)}${status.fileName}`;
                        // Copy Destination folder path, no file name
                        const copyDestinationFolder = `${status.path.substring(0, status.path.lastIndexOf('/')).replace('/'.concat(experienceName), '')}`;
                        const copyDestFilePath = `${copyDestinationFolder}/${status.fileName}`;

                        // Create Copy Batches
                        const copyBatchName = `batch_${copyBatchCount + 1}`;
                        let copyBatchJson = copyBatchesJson[copyBatchName];
                        if (!copyBatchJson) {
                            copyBatchJson = {};
                        }
                        copyBatchJson[copySourceFilePath] = copyDestFilePath;
                        copyBatchesJson[copyBatchName] = copyBatchJson;

                        // If the copy batch count reaches the limit, increment the copy batch count
                        if (copyBatchCount === BATCH_REQUEST_PROMOTE) {
                            copyBatchCount += 1; // Increment the copy batch count
                        }
                        logger.info(`In Process-doc-worker Copy Batch JSON after push: ${JSON.stringify(copyBatchesJson)}`);
                        // Write the copy batches JSON file
                        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/copy_batches.json`, copyBatchesJson);

                        batchStatusJson[batchName] = 'processed';
                    }
                }
            });
            await Promise.all(allPromises); // await all async functions in the array are executed, before updating the status in the graybox project excel

            // Update each Batch Status in the current project's "batch_status.json" file
            batchStatusJson[batchName] = 'processed';
        }
    });

    // Update the Project Status in the current project's "status.json" file & the parent "ongoing_projects.json" file
    updateProjectStatus(batchStatusJson, projectStatusJson, gbRootFolder, experienceName, filesWrapper);
    return { promotes, failedPromotes };
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "ongoing_projects.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @returns updated project status
 */
async function updateProjectStatus(batchStatusJson, projectStatusJson, gbRootFolder, experienceName, filesWrapper) {
    const projects = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');
    // Write the Project Status in the current project's "status.json" file
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);
    // Update the Project Status & Batch Status in the current project's "status.json" & updated batch_status.json file respectively
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`, batchStatusJson);

    // Update the Project Status in the parent "ongoing_projects.json" file
    projects.find((p) => p.project_path === `${gbRootFolder}/${experienceName}`).status = 'processed';
    logger.info(`In Process-docx-worker After Processing Docx, OnProjects Json: ${JSON.stringify(projects)}`);
    await filesWrapper.writeFile('graybox_promote/ongoing_projects.json', projects);
}

function exitAction(resp) {
    return resp;
}

exports.main = main;
