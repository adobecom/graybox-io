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

import fetch from 'node-fetch';
import { Readable } from 'stream';
import { getAioLogger, toUTCStr } from '../utils.js';
import AppConfig from '../appConfig.js';
import HelixUtils from '../helixUtils.js';
import Sharepoint from '../sharepoint.js';
import { updateDocument } from '../docxUpdater.js';
import { updateExcel, convertJsonToExcel } from '../excelHandler.js';
import initFilesWrapper from './filesWrapper.js';

// const gbStyleExpressions = ['gb-', 'graybox']; // graybox style expressions
const gbStyleExpression = 'gb-'; // graybox style expressions
const gbBlockName = 'graybox'; // graybox block name
const gbDomainSuffix = '-graybox';

const BATCH_REQUEST_PROMOTE = 200;

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Process Content Action triggered');

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);
    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;

    // Get the Helix Admin API Key for the Graybox content tree, needed for accessing (with auth) Images in graybox tree
    const helixAdminApiKey = helixUtils.getAdminApiKey(true);

    const previewStatuses = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`);

    if (!previewStatuses) {
        responsePayload = 'No preview statuses found';
        logger.info(responsePayload);
        return exitAction({
            body: responsePayload,
            statusCode: 200
        });
    }
    logger.info(`In Process-doc-worker, previewStatuses: ${JSON.stringify(previewStatuses)}`);
    const processFilesParams = {
        previewStatuses,
        experienceName,
        helixAdminApiKey,
        sharepoint,
        helixUtils,
        appConfig,
        filesWrapper,
        gbRootFolder,
        projectExcelPath
    };
    // Promote Graybox files to the default content tree
    await processFiles(processFilesParams);

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
    previewStatuses, experienceName, helixAdminApiKey, sharepoint, helixUtils, filesWrapper, gbRootFolder, projectExcelPath
}) {
    const options = {};
    // Passing isGraybox param true to fetch graybox Hlx Admin API Key
    const grayboxHlxAdminApiKey = helixUtils.getAdminApiKey(true);
    if (grayboxHlxAdminApiKey) {
        options.headers = new fetch.Headers();
        options.headers.append('Authorization', `token ${grayboxHlxAdminApiKey}`);
    }

    const project = `${gbRootFolder}/${experienceName}`;
    // Read the Project Status in the current project's "status.json" file
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/status.json`);

    const toBeStatus = 'process_content_in_progress';
    // Update the In Progress Status in the current project's "status.json" file
    projectStatusJson.status = toBeStatus;
    await filesWrapper.writeFile(`graybox_promote${project}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "project_queue.json" file
    await changeProjectStatusInQueue(filesWrapper, gbRootFolder, experienceName, toBeStatus);

    // Read the Batch Status in the current project's "batch_status.json" file
    const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/batch_status.json`);

    logger.info(`In Process-doc-worker, for project: ${project} batchStatusJson: ${JSON.stringify(batchStatusJson)}`);
    const promoteBatchesJson = {};
    const copyBatchesJson = {};
    let promoteBatchCount = 0;
    let copyBatchCount = 0;
    const processDocxErrors = [];
    const processedFiles = []; // Track all processed files

    // iterate through preview statuses, generate docx files and create promote & copy batches
    const batchNames = Object.keys(previewStatuses).flat();
    const allProcessingPromises = batchNames.map(async (batchName) => {
        const batchPreviewStatuses = previewStatuses[batchName];

        // Check if Step 2 finished, do the Step 3, if the batch status is 'initial_preview_done' then process the batch
        if (batchStatusJson[batchName] === 'initial_preview_done') {
            for (let prevIndex = 0; prevIndex < batchPreviewStatuses.length; prevIndex += 1) {
                const status = batchPreviewStatuses[prevIndex];
                if (status.success && status.mdPath) { // If the file is successfully initial previewed and has a mdPath then process the file
                    // Check if the file is a docx file
                    const isDocxFile = status.fileName.toLowerCase().endsWith('.docx');
                    // Check if the file is an Excel file
                    const isExcelFile = status.fileName.toLowerCase().endsWith('.xlsx') ||
                        status.fileName.toLowerCase().endsWith('.xls');

                    if (isDocxFile) {
                        // eslint-disable-next-line no-await-in-loop
                        const response = await sharepoint.fetchWithRetry(`${status.mdPath}`, options);
                        // eslint-disable-next-line no-await-in-loop
                        const content = await response.text();
                        let docx;
                        if (content.includes(experienceName) || content.includes(gbStyleExpression) || content.includes(gbDomainSuffix) || content.includes(gbBlockName)) {
                            // Process the Graybox Styles and Links with Mdast to Docx conversion
                            // eslint-disable-next-line no-await-in-loop
                            docx = await updateDocument(content, experienceName, helixAdminApiKey);
                            if (docx) {
                                const destinationFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1).replace('/'.concat(experienceName), '')}${status.fileName}`;
                                const docxFileStream = Readable.from(docx);

                                // Write the processed documents to the AIO folder for docx files
                                // eslint-disable-next-line no-await-in-loop
                                await filesWrapper.writeFileFromStream(`graybox_promote${project}/docx${destinationFilePath}`, docxFileStream);

                                // Add to processed files list
                                processedFiles.push({
                                    fileName: status.fileName,
                                    destinationPath: destinationFilePath,
                                    fileType: 'docx',
                                    batchName,
                                    processType: 'promote'
                                });

                                let promoteBatchJson = promoteBatchesJson[batchName];
                                if (!promoteBatchJson) {
                                    promoteBatchJson = { status: 'processed', files: [destinationFilePath] };
                                } else if (promoteBatchJson.files) {
                                    promoteBatchJson.files.push(destinationFilePath);
                                } else {
                                    promoteBatchJson.files = [destinationFilePath];
                                }
                                promoteBatchesJson[batchName] = promoteBatchJson;

                                logger.info(`In Process-doc-worker, for project: ${project} Promote Batch JSON after push: ${JSON.stringify(promoteBatchesJson)}`);

                                // If the promote batch count reaches the limit, increment the promote batch count
                                if (promoteBatchCount === BATCH_REQUEST_PROMOTE) { // TODO remove this code if promoteBatchCount is not needed, and instead initial preview batch count is used
                                    promoteBatchCount += 1;
                                }

                                // Write the promote batches JSON file
                                // eslint-disable-next-line no-await-in-loop
                                await filesWrapper.writeFile(`graybox_promote${project}/promote_batches.json`, promoteBatchesJson);
                            } else {
                                processDocxErrors.push(`Error processing docx for ${status.fileName}`);
                            }
                        } else {
                            // Copy Source full path with file name and extension
                            const copySourceFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1)}${status.fileName}`;
                            // Copy Destination folder path, no file name
                            const copyDestinationFolder = `${status.path.substring(0, status.path.lastIndexOf('/')).replace('/'.concat(experienceName), '')}`;
                            const copyDestFilePath = `${copyDestinationFolder}/${status.fileName}`;

                            // Add to processed files list
                            processedFiles.push({
                                fileName: status.fileName,
                                sourcePath: copySourceFilePath,
                                destinationPath: copyDestFilePath,
                                fileType: 'docx',
                                batchName,
                                processType: 'copy'
                            });

                            // Don't create new batch names, use the same batch names created in the start before initial preview
                            let copyBatchJson = copyBatchesJson[batchName];
                            if (!copyBatchJson) {
                                copyBatchJson = { status: 'processed', files: [{ copySourceFilePath, copyDestFilePath }] };
                            } else if (!copyBatchJson.files) {
                                copyBatchJson.files = [];
                            }
                            copyBatchJson.files.push({ copySourceFilePath, copyDestFilePath });
                            copyBatchesJson[batchName] = copyBatchJson;

                            // If the copy batch count reaches the limit, increment the copy batch count
                            if (copyBatchCount === BATCH_REQUEST_PROMOTE) { // TODO remove this code if copyBatchCount is not needed, and instead initial preview batch count is used
                                copyBatchCount += 1; // Increment the copy batch count
                            }
                            logger.info(`In Process-doc-worker, for project: ${project} Copy Batch JSON after push: ${JSON.stringify(copyBatchesJson)}`);
                            // eslint-disable-next-line no-await-in-loop
                            await filesWrapper.writeFile(`graybox_promote${project}/copy_batches.json`, copyBatchesJson);
                        }
                    } else if (isExcelFile) {
                        // For Excel files, transform URLs from graybox to non-graybox format
                        // eslint-disable-next-line no-await-in-loop
                        const response = await sharepoint.fetchWithRetry(`${status.mdPath}`, options);
                        // eslint-disable-next-line no-await-in-loop
                        const content = await response.text();
                        // Check if we need to convert the transformed Excel content to an actual Excel file
                        // Transform graybox URLs to non-graybox URLs
                        if (content.includes(experienceName) || content.includes(gbDomainSuffix)) {
                            const transformedExcelContent = await updateExcel(content, experienceName);
                            const excelBuffer = convertJsonToExcel(transformedExcelContent);
                            // Write the transformed content back
                            const destinationFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1).replace('/'.concat(experienceName), '')}${status.fileName}`;

                            // eslint-disable-next-line no-await-in-loop
                            await filesWrapper.writeFile(`graybox_promote${project}/excel${destinationFilePath}`, excelBuffer);

                            // Add to processed files list
                            processedFiles.push({
                                fileName: status.fileName,
                                destinationPath: destinationFilePath,
                                fileType: 'excel',
                                batchName,
                                processType: 'promote'
                            });

                            let promoteBatchJson = promoteBatchesJson[batchName];
                            if (!promoteBatchJson) {
                                promoteBatchJson = { status: 'processed', files: [destinationFilePath] };
                            } else if (promoteBatchJson.files) {
                                promoteBatchJson.files.push(destinationFilePath);
                            } else {
                                promoteBatchJson.files = [destinationFilePath];
                            }
                            promoteBatchesJson[batchName] = promoteBatchJson;

                            logger.info(`In Process-doc-worker, for project: ${project} Promote Batch JSON after push: ${JSON.stringify(promoteBatchesJson)}`);
                            // eslint-disable-next-line no-await-in-loop
                            await filesWrapper.writeFile(`graybox_promote${project}/promote_batches.json`, promoteBatchesJson);
                        } else {
                            // If no graybox URLs found, just copy the file
                            const copySourceFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1)}${status.fileName}`;
                            const copyDestinationFolder = `${status.path.substring(0, status.path.lastIndexOf('/')).replace('/'.concat(experienceName), '')}`;
                            const copyDestFilePath = `${copyDestinationFolder}/${status.fileName}`;

                            // Add to processed files list
                            processedFiles.push({
                                fileName: status.fileName,
                                sourcePath: copySourceFilePath,
                                destinationPath: copyDestFilePath,
                                fileType: 'excel',
                                batchName,
                                processType: 'copy'
                            });

                            let copyBatchJson = copyBatchesJson[batchName];
                            if (!copyBatchJson) {
                                copyBatchJson = { status: 'processed', files: [{ copySourceFilePath, copyDestFilePath }] };
                            } else if (!copyBatchJson.files) {
                                copyBatchJson.files = [];
                            }
                            copyBatchJson.files.push({ copySourceFilePath, copyDestFilePath });
                            copyBatchesJson[batchName] = copyBatchJson;

                            if (copyBatchCount === BATCH_REQUEST_PROMOTE) {
                                copyBatchCount += 1;
                            }
                            logger.info(`In Process-doc-worker, for project: ${project} Copy Batch JSON after push: ${JSON.stringify(copyBatchesJson)}`);
                            // eslint-disable-next-line no-await-in-loop
                            await filesWrapper.writeFile(`graybox_promote${project}/copy_batches.json`, copyBatchesJson);
                        }
                    } else {
                        // For non-docx files, just add to copy batches
                        const copySourceFilePath = `${status.path.substring(0, status.path.lastIndexOf('/') + 1)}${status.fileName}`;
                        const copyDestinationFolder = `${status.path.substring(0, status.path.lastIndexOf('/')).replace('/'.concat(experienceName), '')}`;
                        const copyDestFilePath = `${copyDestinationFolder}/${status.fileName}`;

                        // Add to processed files list
                        processedFiles.push({
                            fileName: status.fileName,
                            sourcePath: copySourceFilePath,
                            destinationPath: copyDestFilePath,
                            fileType: 'other',
                            batchName,
                            processType: 'copy'
                        });

                        let copyBatchJson = copyBatchesJson[batchName];
                        if (!copyBatchJson) {
                            copyBatchJson = { status: 'processed', files: [{ copySourceFilePath, copyDestFilePath }] };
                        } else if (!copyBatchJson.files) {
                            copyBatchJson.files = [];
                        }
                        copyBatchJson.files.push({ copySourceFilePath, copyDestFilePath });
                        copyBatchesJson[batchName] = copyBatchJson;

                        if (copyBatchCount === BATCH_REQUEST_PROMOTE) {
                            copyBatchCount += 1;
                        }
                        logger.info(`In Process-doc-worker, for project: ${project} Copy Batch JSON after push: ${JSON.stringify(copyBatchesJson)}`);
                        // eslint-disable-next-line no-await-in-loop
                        await filesWrapper.writeFile(`graybox_promote${project}/copy_batches.json`, copyBatchesJson);
                    }

                    // Update each Batch Status in the current project's "batch_status.json" file
                    batchStatusJson[batchName] = 'processed';

                    // Update the Project Status & Batch Status in the current project's "status.json" & updated batch_status.json file respectively
                    // eslint-disable-next-line no-await-in-loop
                    await filesWrapper.writeFile(`graybox_promote${project}/batch_status.json`, batchStatusJson);
                }
            }
        }
    });

    await Promise.all(allProcessingPromises); // await all async functions in the array are executed

    // Write the processed files list to a JSON file
    await filesWrapper.writeFile(`graybox_promote${project}/processed_files.json`, processedFiles);

    await updateStatuses(promoteBatchesJson, copyBatchesJson, project, filesWrapper, processDocxErrors, sharepoint, projectExcelPath, processedFiles);
}

async function updateStatuses(promoteBatchesJson, copyBatchesJson, project, filesWrapper, processContentErrors, sharepoint, projectExcelPath, processedFiles) {
    // Write the copy batches JSON file
    await filesWrapper.writeFile(`graybox_promote${project}/copy_batches.json`, copyBatchesJson);
    await filesWrapper.writeFile(`graybox_promote${project}/promote_batches.json`, promoteBatchesJson);
    // Update the Project Status in JSON files
    updateProjectStatus(project, filesWrapper);

    // Write the processDocxErrors to the AIO Files
    if (processContentErrors.length > 0) {
        await filesWrapper.writeFile(`graybox_promote${project}/process_content_errors.json`, processContentErrors);
    }

    // Update the Project Excel with the Promote Status
    try {
        const promoteExcelValues = [['Step 2 of 5: Processing files for Graybox blocks, styles and links completed', toUTCStr(new Date()), '', '']];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteExcelValues);

        // Add processed files summary to Excel
        const docxCount = processedFiles.filter((file) => file.fileType === 'docx').length;
        const excelCount = processedFiles.filter((file) => file.fileType === 'excel').length;
        const otherCount = processedFiles.filter((file) => file.fileType === 'other').length;

        const filesSummaryValues = [[
            `Processed Files Summary: ${processedFiles.length} total files (${docxCount} DOCX, ${excelCount} Excel, ${otherCount} Other)`,
            toUTCStr(new Date()),
            '',
            ''
        ]];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', filesSummaryValues);
    } catch (err) {
        logger.error(`Error Occured while updating Excel during Graybox Process Content Step: ${err}`);
    }
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "project_queue.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @returns updated project status
 */
async function updateProjectStatus(project, filesWrapper) {
    // Update the Project Status in the current project's "status.json" file
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/status.json`);
    const toBeStatus = 'processed';
    projectStatusJson.status = toBeStatus;
    await filesWrapper.writeFile(`graybox_promote${project}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "project_queue.json" file
    const projectQueue = await changeProjectStatusInQueue(filesWrapper, project, toBeStatus);
    logger.info(`In process-content-worker, for project: ${project} After Processing Docx, Project Queue Json: ${JSON.stringify(projectQueue)}`);
}

async function changeProjectStatusInQueue(filesWrapper, project, toBeStatus) {
    const projectQueue = await filesWrapper.readFileIntoObject('graybox_promote/project_queue.json');
    const index = projectQueue.findIndex((obj) => obj.projectPath === `${project}`);
    if (index !== -1) {
        // Replace the object at the found index
        projectQueue[index].status = toBeStatus;
        await filesWrapper.writeFile('graybox_promote/project_queue.json', projectQueue);
    }
    return projectQueue;
}

function exitAction(resp) {
    return resp;
}

export { main };
