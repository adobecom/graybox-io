/* ************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2025 Adobe
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
import { updateBulkCopyStepStatus } from './bulkCopyStatusUtils.js';

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Bulk Copy Promote Worker triggered');

    logger.info(`Parameters received: ${JSON.stringify(params, null, 2)}`);

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);
    const filesWrapper = await initFilesWrapper(logger);

    const project = params.project || '';
    const filesToPromote = params.filesToPromote || [];

    logger.info(`In Bulk Copy Promote Worker, Promoting ${filesToPromote.length} files for project: ${project}`);

    // Update step 4 status (promotion started)
    await updateBulkCopyStepStatus(filesWrapper, project, 'step4_promotion', {
        status: 'in_progress',
        startTime: toUTCStr(new Date()),
        progress: {
            total: filesToPromote.length
        }
    });

    // Debug SharePoint configuration
    logger.info('In Bulk Copy Promote Worker, SharePoint configuration:');
    logger.info(`- driveId: ${params.driveId || 'MISSING'}`);
    logger.info(`- spToken: ${params.spToken ? 'PRESENT' : 'MISSING'}`);
    logger.info(`- spSite: ${params.spSite || 'MISSING'}`);
    logger.info(`- spClientId: ${params.spClientId || 'MISSING'}`);

    if (filesToPromote.length === 0) {
        logger.info('No files to promote');
        return exitAction({
            body: 'No files to promote',
            statusCode: 200
        });
    }

    // Update project status to promoting
    const toBeStatus = 'promoting_in_progress';
    const statusEntry = {
        step: 'Uploading processed files to SharePoint',
        stepName: toBeStatus,
        files: filesToPromote.map((f) => f.sourcePath)
    };
    await writeProjectStatus(filesWrapper, `graybox_promote${project}/status.json`, statusEntry, toBeStatus);

    // Update the Project Status in the parent "bulk_copy_project_queue.json" file
    await changeProjectStatusInQueue(filesWrapper, project, toBeStatus);

    const promotes = [];
    const failedPromotes = [];

    // Process files sequentially to avoid overwhelming the SharePoint API
    // eslint-disable-next-line no-restricted-syntax
    for (const fileToPromote of filesToPromote) {
        const {
            sourcePath, destinationPath
        } = fileToPromote;

        try {
            // Read the processed file from AIO storage
            const aioFilePath = `graybox_promote${project}/docx_bulk_copy/${experienceName}${sourcePath}`;
            logger.info(`In BulkCopyPromote-worker, reading processed file from AIO: ${aioFilePath}`);
            // eslint-disable-next-line no-await-in-loop
            const processedFile = await filesWrapper.readFileIntoBuffer(aioFilePath);

            if (processedFile) {
                logger.info(`In BulkCopyPromote-worker, processedFile before save: ${sourcePath}, size: ${processedFile.length} bytes`);

                // Save the processed file to SharePoint
                logger.info(`In BulkCopyPromote-worker, saving to SharePoint: ${destinationPath}`);
                logger.info(`In BulkCopyPromote-worker, file size: ${processedFile.length} bytes`);
                logger.info(`In BulkCopyPromote-worker, file type: ${typeof processedFile}`);

                try {
                    // eslint-disable-next-line no-await-in-loop
                    const saveStatus = await sharepoint.saveFileSimple(processedFile, destinationPath, true);
                    logger.info(`In BulkCopyPromote-worker, SharePoint save result: ${JSON.stringify(saveStatus)}`);

                    if (saveStatus?.success) {
                        promotes.push(destinationPath);
                        logger.info(`Successfully promoted: ${sourcePath} -> ${destinationPath}`);
                    } else if (saveStatus?.errorMsg?.includes('File is locked')) {
                        failedPromotes.push(`${destinationPath} (locked file)`);
                        logger.warn(`File locked: ${destinationPath}`);
                    } else {
                        failedPromotes.push(`${destinationPath} (failed with reason: ${saveStatus?.errorMsg})`);
                        logger.error(`Failed to promote: ${sourcePath} -> ${destinationPath}, Error: ${saveStatus?.errorMsg || 'Unknown error'}`);
                        logger.error(`Full saveStatus object: ${JSON.stringify(saveStatus)}`);
                    }
                } catch (saveError) {
                    const errorMsg = `SharePoint save error: ${saveError.message}`;
                    logger.error(`In BulkCopyPromote-worker, ${errorMsg}`);
                    logger.error(`In BulkCopyPromote-worker, saveError stack: ${saveError.stack}`);
                    failedPromotes.push(`${destinationPath} (${errorMsg})`);
                }
            } else {
                failedPromotes.push(`${destinationPath} (processed file not found)`);
                logger.error(`Processed file not found: ${sourcePath}`);
            }
        } catch (err) {
            const errorMsg = `Error promoting file ${sourcePath}: ${err.message}`;
            logger.error(errorMsg);
            failedPromotes.push(errorMsg);
        }
    }

    logger.info(`In Bulk Copy Promote Worker, Promotion completed: ${promotes.length} successful, ${failedPromotes.length} failed`);

    // Update step 4 status (promotion completed)
    await updateBulkCopyStepStatus(filesWrapper, project, 'step4_promotion', {
        status: 'completed',
        endTime: toUTCStr(new Date()),
        progress: {
            completed: promotes.length,
            failed: failedPromotes.length
        },
        details: {
            promotedFiles: promotes,
            failedFiles: failedPromotes
        },
        errors: failedPromotes
    });

    // Update the Promoted Files tracking for preview
    if (promotes.length > 0) {
        await updatePromotedFilesTracking(project, promotes, filesWrapper);
    }

    // Update the Project Excel with the Promote Status
    try {
        const sFailedPromotes = failedPromotes.length > 0 ? `Failed Promotes: \n${failedPromotes.join('\n')}` : '';

        const promoteExcelValues = [[
            `Step 4 of 5: Bulk Copy Promote completed for project ${project}`,
            toUTCStr(new Date()),
            sFailedPromotes,
            JSON.stringify({
                promoted: promotes.length,
                failed: failedPromotes.length,
                promotedFiles: promotes,
                failedPromotes
            })
        ]];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteExcelValues);

        // Write status to status.json
        const statusJsonPath = `graybox_promote${project}/status.json`;
        const finalStatusEntry = {
            stepName: 'bulk_copy_promote_completed',
            step: `Step 4 of 5: Bulk Copy Promote completed for project ${project}`,
            failures: sFailedPromotes,
            promotion: {
                successful: promotes.length,
                failed: failedPromotes.length,
                promotedFiles: promotes,
                failedPromotes
            }
        };
        await writeProjectStatus(filesWrapper, statusJsonPath, finalStatusEntry);
    } catch (err) {
        logger.error(`Error occurred while updating Excel during Graybox Bulk Copy Promote: ${err}`);
    }

    // Update project status based on results
    if (failedPromotes.length === 0) {
        // All files promoted successfully
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper, 'promoted');
    } else if (promotes.length > 0) {
        // Some files promoted, some failed
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper, 'partially_promoted');
    } else {
        // All files failed to promote
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper, 'promote_failed');
    }

    const responsePayload = `Bulk Copy Promote Worker finished for project ${project}. Promoted: ${promotes.length}, Failed: ${failedPromotes.length}`;
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
}

/**
 * Update the Promoted Files tracking for preview
 * @param {*} project project path
 * @param {*} promotedFiles array of promoted file paths
 * @param {*} filesWrapper filesWrapper object
 */
async function updatePromotedFilesTracking(project, promotedFiles, filesWrapper) {
    try {
        // Read existing promoted files tracking
        const promotedFilesPath = `graybox_promote${project}/promoted_files_for_preview.json`;
        let promotedFilesJson = [];
        try {
            const existingData = await filesWrapper.readFileIntoObject(promotedFilesPath);
            if (Array.isArray(existingData)) {
                promotedFilesJson = existingData;
            }
        } catch (err) {
            // File doesn't exist yet, start with empty array
            logger.info('Promoted files tracking file doesn\'t exist yet, creating new one');
        }

        // Add new promoted files with timestamp
        const timestamp = toUTCStr(new Date());
        promotedFiles.forEach((filePath) => {
            promotedFilesJson.push({
                filePath,
                promotedAt: timestamp,
                previewStatus: 'pending',
                fileType: 'promoted'
            });
        });

        // Write updated promoted files tracking
        await filesWrapper.writeFile(promotedFilesPath, promotedFilesJson);
        logger.info(`Updated promoted files tracking with ${promotedFiles.length} new files`);
    } catch (err) {
        logger.error(`Error updating promoted files tracking: ${err.message}`);
    }
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "bulk_copy_project_queue.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @param {*} status status to set
 * @returns updated project status
 */
async function updateProjectStatus(gbRootFolder, experienceName, filesWrapper, status) {
    const project = `${gbRootFolder}/${experienceName}`;
    // Update the Project Status in the current project's "status.json" file
    const statusEntry = {
        step: `Bulk Copy Promote completed with status: ${status}`,
        stepName: status,
        files: []
    };
    await writeProjectStatus(filesWrapper, `graybox_promote${project}/status.json`, statusEntry, status);

    // Update the Project Status in the parent "bulk_copy_project_queue.json" file
    const projectQueueBulkCopy = await changeProjectStatusInQueue(filesWrapper, project, status);
    logger.info(`In promote-worker, for project: ${project} After Promotion, Project Queue Json: ${JSON.stringify(projectQueueBulkCopy)}`);
}

async function changeProjectStatusInQueue(filesWrapper, project, toBeStatus) {
    const projectQueueBulkCopy = await filesWrapper.readFileIntoObject('graybox_promote/bulk_copy_project_queue.json');
    const index = projectQueueBulkCopy.findIndex((obj) => obj.projectPath === `${project}`);
    if (index !== -1) {
        // Replace the object at the found index
        projectQueueBulkCopy[index].status = toBeStatus;
        await filesWrapper.writeFile('graybox_promote/bulk_copy_project_queue.json', projectQueueBulkCopy);
    }
    return projectQueueBulkCopy;
}

function exitAction(resp) {
    return resp;
}

export { main };
