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

import { getAioLogger, toUTCStr } from '../utils.js';
import AppConfig from '../appConfig.js';
import Sharepoint from '../sharepoint.js';
import initFilesWrapper from './filesWrapper.js';
import { writeProjectStatus } from './statusUtils.js';

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Bulk Copy Non-Processing Worker triggered');
    
    // Debug: Log the parameters received
    logger.info(`Worker received params for project ${params.project} for batch ${params.batchName}: ${JSON.stringify(Object.keys(params))}`);
    logger.info(`adminPageUri present for project ${params.project} for batch ${params.batchName}: ${!!params.adminPageUri}`);
    logger.info(`spToken present for project ${params.project} for batch ${params.batchName}: ${!!params.spToken}`);
    logger.info(`driveId present for project ${params.project} for batch ${params.batchName}: ${!!params.driveId}`);

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    // Debug: Check if SharePoint config can be created
    const spConfig = appConfig.getSpConfig();
    if (!spConfig) {
        logger.error('Failed to create SharePoint configuration. Required parameters may be missing.');
        logger.error(`adminPageUri for project ${params.project} for batch ${params.batchName}: ${params.adminPageUri || 'MISSING'}`);
        logger.error(`spToken for project ${params.project} for batch ${params.batchName}: ${params.spToken ? 'PRESENT' : 'MISSING'}`);
        logger.error(`driveId for project ${params.project} for batch ${params.batchName}: ${params.driveId || 'MISSING'}`);
        return {
            statusCode: 500,
            body: {
                error: 'SharePoint configuration failed',
                message: 'Missing required parameters: adminPageUri, spToken, or driveId'
            }
        };
    }
    
    logger.info('SharePoint configuration created successfully');

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;
    const copiedFiles = [];
    const failedCopies = [];

    logger.info('In Bulk Copy Non-Processing Worker, Processing Copy Content');

    const project = params.project || '';
    const batchName = params.batchName || '';

    // Read the Batch Status in the current project's "batch_status.json" file
    let batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-batches/batch_status.json`);

    // Read the specific batch file
    const batchFile = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-batches/${batchName}.json`);
    
    logger.info(`In Bulk Copy Non-Processing Worker, Copy File Paths for project: ${project} for batchname ${batchName} of params: ${JSON.stringify(params)}: ${JSON.stringify(batchFile)}`);

    // Update & Write the Batch Status to in progress "batch_status.json" file
    // So that the scheduler doesn't pick the same batch again
    batchStatusJson[batchName] = 'copy_in_progress';
    await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-batches/batch_status.json`, batchStatusJson);

    // Process the Copy Content
    const copyFilePathsJson = batchFile || [];

    for (let i = 0; i < copyFilePathsJson.length; i += 1) {
        const copyPathsEntry = copyFilePathsJson[i];
        
        try {
            // Determine source and destination paths
            let sourcePath;
            let destinationPath;
            
            if (typeof copyPathsEntry === 'string') {
                // If it's a simple string, assume it's the source path
                sourcePath = copyPathsEntry;
                destinationPath = `/${experienceName}${copyPathsEntry}`;
            } else if (copyPathsEntry.sourcePath && copyPathsEntry.destinationPath) {
                // If it's an object with sourcePath and destinationPath
                sourcePath = copyPathsEntry.sourcePath;
                destinationPath = copyPathsEntry.destinationPath;
            } else if (copyPathsEntry.sourcePath) {
                // If it only has sourcePath, construct destinationPath
                sourcePath = copyPathsEntry.sourcePath;
                destinationPath = `/${experienceName}${copyPathsEntry.sourcePath}`;
            } else if (copyPathsEntry.sourcePage) {
                // Handle fragment metadata format from bulk-copy-worker
                // These entries have both fragmentPath (metadata) and sourcePage (actual file to copy)
                // We only copy the sourcePage, the fragmentPath is just metadata about fragments found in that page
                sourcePath = copyPathsEntry.sourcePage;
                destinationPath = `/${experienceName}${copyPathsEntry.sourcePage}`;
                logger.info(`Processing fragment metadata entry: ${copyPathsEntry.type || 'unknown'} - copying source page: ${sourcePath}`);
                if (copyPathsEntry.fragmentPath) {
                    logger.info(`  Fragment metadata: ${copyPathsEntry.fragmentPath} (not copied, just metadata)`);
                }
            } else if (copyPathsEntry.fragmentPath && !copyPathsEntry.sourcePage) {
                // Handle fragment-only entries (no source page to copy)
                // These are pure fragment entries without an associated source file
                logger.info(`Skipping fragment-only entry: ${copyPathsEntry.type || 'unknown'} - fragment ${copyPathsEntry.fragmentPath} has no source file to copy`);
                continue;
            } else {
                logger.warn(`Invalid file entry format: ${JSON.stringify(copyPathsEntry)}`);
                failedCopies.push(`Invalid format: ${JSON.stringify(copyPathsEntry)}`);
                continue;
            }

            // Ensure sourcePath is properly formatted for SharePoint API
            // SharePoint expects paths relative to the root folder, so ensure it starts with /
            if (sourcePath && !sourcePath.startsWith('/')) {
                sourcePath = `/${sourcePath}`;
                logger.info(`Normalized sourcePath to: ${sourcePath}`);
            }

            logger.info(`Processing file: ${sourcePath} -> ${destinationPath}`);

            // Download the source file and save it to destination location
            // Source files are in the regular SharePoint location, not graybox location
            logger.info(`Getting file data for: ${sourcePath} (isGraybox: false - source files are in regular SharePoint)`);
            
            // Handle .json to .xlsx conversion like the previous working version
            let sourcePathForFileData = sourcePath;
            if (sourcePath.endsWith('.json')) {
                sourcePathForFileData = sourcePath.replace(/\.json$/, '.xlsx');
                logger.info(`Converted .json to .xlsx for file data: ${sourcePathForFileData}`);
            }
            
            const { fileDownloadUrl, fileSize } = await sharepoint.getFileData(sourcePathForFileData, false);
            logger.info(`File download URL: ${fileDownloadUrl ? 'PRESENT' : 'MISSING'}, File size: ${fileSize || 'unknown'}`);
            
            if (!fileDownloadUrl) {
                throw new Error(`No download URL returned for file: ${sourcePathForFileData}`);
            }
            
            logger.info(`Downloading file from URL: ${fileDownloadUrl.substring(0, 100)}...`);
            const file = await sharepoint.getFileUsingDownloadUrl(fileDownloadUrl);
            logger.info(`File downloaded successfully, size: ${file ? file.size || 'unknown' : 'null'}`);
            
            // Handle destination path .json to .xlsx conversion like the previous working version
            let destPath = destinationPath;
            if (destPath.endsWith('.json')) {
                destPath = destPath.replace(/\.json$/, '.xlsx');
                logger.info(`Converted destination .json to .xlsx: ${destPath}`);
            }
            
            // Save to graybox location (isGraybox: true for destination)
            const saveStatus = await sharepoint.saveFileSimple(file, destPath, true);

            if (saveStatus?.success) {
                copiedFiles.push(destPath);
                logger.info(`Successfully copied: ${sourcePath} -> ${destPath}`);
            } else if (saveStatus?.errorMsg?.includes('File is locked')) {
                failedCopies.push(`${destPath} (locked file)`);
                logger.warn(`File locked: ${destPath}`);
            } else {
                failedCopies.push(destPath);
                logger.error(`Failed to copy: ${sourcePath} -> ${destPath}, Error: ${saveStatus?.errorMsg || 'Unknown error'}`);
            }
        } catch (err) {
            const errorMsg = `Error processing file ${JSON.stringify(copyPathsEntry)}: ${err.message}`;
            logger.error(errorMsg);
            failedCopies.push(errorMsg);
        }
    }

    logger.info(`In Bulk Copy Non-Processing Worker, Copied files for project: ${project} for batchname ${batchName} no.of files ${copiedFiles.length}, files list: ${JSON.stringify(copiedFiles)}`);
    
    // Update the Copied Paths in the current project's "copied_paths.json" file
    if (copiedFiles.length > 0) {
        let copiedPathsJson = {};
        const copiedPathsPath = `graybox_promote${project}/copied_paths.json`;
        
        try {
            const pathsData = await filesWrapper.readFileIntoObject(copiedPathsPath);
            // Ensure we have an object, even if the file contains something else
            if (typeof pathsData === 'object' && pathsData !== null && !Array.isArray(pathsData)) {
                copiedPathsJson = pathsData;
                logger.info(`Loaded existing copied paths file with ${Object.keys(copiedPathsJson).length} batch entries`);
            } else {
                logger.warn(`Copied paths file exists but does not contain an object (type: ${typeof pathsData}), starting with empty object`);
                copiedPathsJson = {};
            }
        } catch (err) {
            // File doesn't exist yet, start with empty object
            logger.info(`Copied paths file does not exist yet at ${copiedPathsPath}, will create new one`);
            copiedPathsJson = {};
        }
        
        // Ensure copiedPathsJson is an object before proceeding
        if (typeof copiedPathsJson !== 'object' || copiedPathsJson === null || Array.isArray(copiedPathsJson)) {
            logger.error(`copiedPathsJson is not an object: ${typeof copiedPathsJson}, value: ${JSON.stringify(copiedPathsJson)}`);
            copiedPathsJson = {};
        }
        
        // Combined existing If any copies already exist in copied_paths.json for the current batch
        if (copiedPathsJson[batchName]) {
            const existingFiles = Array.isArray(copiedPathsJson[batchName]) ? copiedPathsJson[batchName] : [];
            copiedFiles = copiedFiles.concat(existingFiles);
            logger.info(`Combined with ${existingFiles.length} existing files for batch ${batchName}`);
        }
        
        copiedPathsJson[batchName] = copiedFiles;
        await filesWrapper.writeFile(copiedPathsPath, copiedPathsJson);
        logger.info(`Successfully wrote ${copiedFiles.length} copied files for batch ${batchName} to ${copiedPathsPath}`);
    }

    // Update the Copy Errors if any
    if (failedCopies.length > 0) {
        let copyErrorsJson = [];
        
        // Check if the copy errors file exists first
        const copyErrorsPath = `graybox_promote${project}/copy_errors.json`;
        try {
            const errorsData = await filesWrapper.readFileIntoObject(copyErrorsPath);
            // Ensure we have an array, even if the file contains something else
            if (Array.isArray(errorsData)) {
                copyErrorsJson = errorsData;
                logger.info(`Loaded existing copy errors file with ${copyErrorsJson.length} entries`);
            } else {
                logger.warn(`Copy errors file exists but does not contain an array (type: ${typeof errorsData}), starting with empty array`);
                copyErrorsJson = [];
            }
        } catch (err) {
            // File doesn't exist yet, start with empty array
            logger.info(`Copy errors file does not exist yet at ${copyErrorsPath}, will create new one`);
            copyErrorsJson = [];
        }
        
        // Ensure copyErrorsJson is an array before proceeding
        if (!Array.isArray(copyErrorsJson)) {
            logger.error(`copyErrorsJson is not an array: ${typeof copyErrorsJson}, value: ${JSON.stringify(copyErrorsJson)}`);
            copyErrorsJson = [];
        }
        
        // Add new failed copies to the array
        const originalLength = copyErrorsJson.length;
        copyErrorsJson.push(...failedCopies);
        logger.info(`Added ${failedCopies.length} new failed copies to error log (total: ${copyErrorsJson.length})`);
        
        // Write the updated errors file
        await filesWrapper.writeFile(copyErrorsPath, copyErrorsJson);
        logger.info(`Successfully wrote ${copyErrorsJson.length} error entries to ${copyErrorsPath}`);
    }

    // Update the Batch Status in the current project's "batch_status.json" file
    batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-batches/batch_status.json`);
    batchStatusJson[batchName] = 'copied';
    // Write the batch status file
    await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-batches/batch_status.json`, batchStatusJson);

    // Check if all non-processing batches are copied
    const allNonProcessingBatchesCopied = Object.keys(batchStatusJson)
        .filter(batchName => batchName.startsWith('non_processing_batch_'))
        .every(batchName => batchStatusJson[batchName] === 'copied');

    if (allNonProcessingBatchesCopied) {
        // Update the Project Status in JSON files
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper);
    }

    // Update the Project Excel with the Copy Status
    try {
        const sFailedCopyStatuses = failedCopies.length > 0 ? `Failed Copies: \n${failedCopies.join('\n')}` : '';
        const copyExcelValues = [[`Step 2 of 5: Bulk Copy Non-Processing completed for Batch ${batchName}`, toUTCStr(new Date()), sFailedCopyStatuses, JSON.stringify(copiedFiles)]];
        await sharepoint.updateExcelTable(projectExcelPath, 'COPY_STATUS', copyExcelValues);

        // Write status to status.json
        const statusJsonPath = `graybox_promote${project}/status.json`;
        const statusEntry = {
            stepName: 'bulk_copy_non_processing_completed',
            step: `Step 2 of 5: Bulk Copy Non-Processing completed for Batch ${batchName}`,
            failures: sFailedCopyStatuses,
            files: copiedFiles
        };
        await writeProjectStatus(filesWrapper, statusJsonPath, statusEntry);
    } catch (err) {
        logger.error(`Error occurred while updating Excel during Graybox Bulk Copy Non-Processing: ${err}`);
    }

    responsePayload = `Bulk Copy Non-Processing Worker finished copying content for batch ${batchName}`;
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "bulk_copy_project_queue.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @returns updated project status
 */
async function updateProjectStatus(gbRootFolder, experienceName, filesWrapper) {
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);

    // Update the Project Status in the current project's "status.json" file
    projectStatusJson.status = 'non_processing_batches_copied';
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "bulk_copy_project_queue.json" file
    try {
        const queueData = await filesWrapper.readFileIntoObject('graybox_promote/bulk_copy_project_queue.json');
        // Ensure we have an array, even if the file contains something else
        if (Array.isArray(queueData)) {
            const bulkCopyProjectQueue = queueData;
            const index = bulkCopyProjectQueue.findIndex((obj) => obj.projectPath === `${gbRootFolder}/${experienceName}`);
            if (index !== -1) {
                // Replace the object at the found index
                bulkCopyProjectQueue[index].status = 'non_processing_batches_copied';
                await filesWrapper.writeFile('graybox_promote/bulk_copy_project_queue.json', bulkCopyProjectQueue);
            }
        } else {
            logger.warn('Bulk copy project queue file exists but does not contain an array, cannot update project status');
        }
    } catch (err) {
        logger.error(`Failed to read bulk copy project queue: ${err.message}`);
    }
}

function exitAction(resp) {
    return resp;
}

export { main };
