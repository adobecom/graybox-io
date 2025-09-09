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

import { getAioLogger, handleExtension, toUTCStr } from '../utils.js';
import AppConfig from '../appConfig.js';
import HelixUtils from '../helixUtils.js';
import Sharepoint from '../sharepoint.js';
import initFilesWrapper from './filesWrapper.js';
import { writeProjectStatus } from './statusUtils.js';
import { updateBulkCopyStepStatus } from './bulkCopyStatusUtils.js';

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Promoted Preview Worker triggered');

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);
    const helixUtils = new HelixUtils(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;

    const project = params.project || `${gbRootFolder}/${experienceName}`;

    if (helixUtils.canBulkPreview(false)) {
        logger.info('In Promoted Preview Worker, Bulk Previewing promoted and copied files');

        try {
            const excelValues = [[`Promoted and Copied Files Preview started for '${experienceName}' experience`, toUTCStr(new Date()), '', '']];
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues);
        } catch (err) {
            logger.error(`Error occurred while updating Excel before starting Promoted Preview: ${err}`);
        }

        const promotedFilesPath = `graybox_promote${project}/promoted_files_for_preview.json`;
        const copiedFilesPath = `graybox_promote${project}/copied_files_for_preview.json`;
        let allFilesToPreview = [];

        try {
            const promotedFilesData = await filesWrapper.readFileIntoObject(promotedFilesPath);
            if (Array.isArray(promotedFilesData)) {
                const pendingPromotedFiles = promotedFilesData.filter(file => file.previewStatus === 'pending');
                allFilesToPreview = allFilesToPreview.concat(pendingPromotedFiles);
                logger.info(`Found ${pendingPromotedFiles.length} promoted files pending preview`);
            }
        } catch (err) {
            if (err.message.includes('ERROR_FILE_NOT_EXISTS')) {
                logger.info(`Promoted files tracking file does not exist yet at ${promotedFilesPath} - no promoted files to preview`);
            } else {
                logger.warn(`Could not read promoted files for preview: ${err.message}`);
            }
        }

        try {
            const copiedFilesData = await filesWrapper.readFileIntoObject(copiedFilesPath);
            if (Array.isArray(copiedFilesData)) {
                const pendingCopiedFiles = copiedFilesData.filter((file) => file.previewStatus === 'pending');
                allFilesToPreview = allFilesToPreview.concat(pendingCopiedFiles);
                logger.info(`Found ${pendingCopiedFiles.length} copied files pending preview`);
            }
        } catch (err) {
            if (err.message.includes('ERROR_FILE_NOT_EXISTS')) {
                logger.info(`Copied files tracking file does not exist yet at ${copiedFilesPath} - no copied files to preview`);
            } else {
                logger.warn(`Could not read copied files for preview: ${err.message}`);
            }
        }

        if (allFilesToPreview.length === 0) {
            responsePayload = 'No promoted or copied files pending preview';
            logger.info(responsePayload);
            return exitAction({
                body: responsePayload,
                statusCode: 200
            });
        }

        logger.info(`In Promoted Preview Worker, Found ${allFilesToPreview.length} total files to preview (promoted + copied)`);

        await updateBulkCopyStepStatus(filesWrapper, project, 'step5_preview', {
            status: 'in_progress',
            startTime: toUTCStr(new Date()),
            progress: {
                total: allFilesToPreview.length
            }
        });

        const statusEntry = {
            step: 'Promoted and Copied Files Preview started',
            stepName: 'promoted_preview_in_progress',
            files: []
        };
        await writeProjectStatus(filesWrapper, `graybox_promote${project}/status.json`, statusEntry, 'promoted_preview_in_progress');

        const paths = allFilesToPreview.map(file => handleExtension(file.filePath));
        const previewStatuses = await helixUtils.bulkPreview(paths, helixUtils.getOperations().PREVIEW, experienceName, true);
        logger.info(`In Promoted Preview Worker, Preview completed for ${previewStatuses.length} files`);

        await updateFilesPreviewStatus(promotedFilesPath, copiedFilesPath, allFilesToPreview, previewStatuses, filesWrapper);

        const failedPreviews = previewStatuses.filter(status => !status.success);
        if (failedPreviews.length > 0) {
            logger.info(`Retrying ${failedPreviews.length} failed previews`);
            const retryPaths = failedPreviews.map(status => status.path);
            const retryStatuses = await helixUtils.bulkPreview(retryPaths, helixUtils.getOperations().PREVIEW, experienceName, true);
            await updateFilesPreviewStatus(promotedFilesPath, copiedFilesPath, allFilesToPreview, retryStatuses, filesWrapper);
        }

        const finalFailedPreviews = previewStatuses.filter((status) => !status.success);
        await updateBulkCopyStepStatus(filesWrapper, project, 'step5_preview', {
            status: 'completed',
            endTime: toUTCStr(new Date()),
            progress: {
                completed: previewStatuses.filter((s) => s.success).length,
                failed: finalFailedPreviews.length
            },
            details: {
                previewedFiles: previewStatuses.filter((s) => s.success).map((s) => s.path),
                failedFiles: finalFailedPreviews.map((s) => s.path)
            },
            errors: finalFailedPreviews.map((s) => s.errorMsg || 'Preview failed')
        });

        await updateProjectStatus(project, filesWrapper, previewStatuses);

        try {
            const finalFailedPreviews = previewStatuses.filter((status) => !status.success);
            const sFailedPreviews = finalFailedPreviews.length > 0 ? 
                `Failed Previews: \n${finalFailedPreviews.map((f) => f.path).join('\n')}` : '';
            
            const excelValues = [[
                `Promoted and Copied Files Preview completed for '${experienceName}' experience`,
                toUTCStr(new Date()),
                sFailedPreviews,
                JSON.stringify({
                    total: previewStatuses.length,
                    successful: previewStatuses.filter((s) => s.success).length,
                    failed: finalFailedPreviews.length
                })
            ]];
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues);
        } catch (err) {
            logger.error(`Error occurred while updating Excel during Promoted Preview: ${err}`);
        }
        // eslint-disable-next-line max-len
        responsePayload = `Promoted Preview Worker completed. Total: ${previewStatuses.length}, Successful: ${previewStatuses.filter(s => s.success).length}, Failed: ${previewStatuses.filter(s => !s.success).length}`;
    } else {
        responsePayload = 'Bulk Preview not enabled for Main Content Tree';
        logger.error(responsePayload);
    }

    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
}

/**
 * Update files tracking with preview results
 * @param {*} promotedFilesPath path to promoted files tracking file
 * @param {*} copiedFilesPath path to copied files tracking file
 * @param {*} allFilesToPreview array of all files to preview
 * @param {*} previewStatuses array of preview statuses
 * @param {*} filesWrapper filesWrapper object
 */
async function updateFilesPreviewStatus(promotedFilesPath, copiedFilesPath, allFilesToPreview, previewStatuses, filesWrapper) {
    try {
        try {
            const allPromotedFiles = await filesWrapper.readFileIntoObject(promotedFilesPath);
            if (Array.isArray(allPromotedFiles)) {
                previewStatuses.forEach((previewStatus) => {
                    const promotedFile = allPromotedFiles.find((file) => 
                        file.filePath === previewStatus.path && file.fileType === 'promoted'
                    );
                    if (promotedFile) {
                        promotedFile.previewStatus = previewStatus.success ? 'completed' : 'failed';
                        promotedFile.previewedAt = toUTCStr(new Date());
                        promotedFile.previewResult = {
                            success: previewStatus.success,
                            responseCode: previewStatus.responseCode,
                            errorMsg: previewStatus.errorMsg
                        };
                    }
                });
                await filesWrapper.writeFile(promotedFilesPath, allPromotedFiles);
                logger.info('Updated promoted files preview status');
            }
        } catch (err) {
            logger.warn(`Could not update promoted files preview status: ${err.message}`);
        }

        try {
            const allCopiedFiles = await filesWrapper.readFileIntoObject(copiedFilesPath);
            if (Array.isArray(allCopiedFiles)) {
                previewStatuses.forEach((previewStatus) => {
                    const copiedFile = allCopiedFiles.find((file) => 
                        handleExtension(file.filePath) === previewStatus.path && file.fileType === 'non_processing'
                    );
                    if (copiedFile) {
                        copiedFile.previewStatus = previewStatus.success ? 'completed' : 'failed';
                        copiedFile.previewedAt = toUTCStr(new Date());
                        copiedFile.previewResult = {
                            success: previewStatus.success,
                            responseCode: previewStatus.responseCode,
                            errorMsg: previewStatus.errorMsg
                        };
                    }
                });
                await filesWrapper.writeFile(copiedFilesPath, allCopiedFiles);
                logger.info('Updated copied files preview status');
            }
        } catch (err) {
            logger.warn(`Could not update copied files preview status: ${err.message}`);
        }

        logger.info(`Updated files preview status for ${previewStatuses.length} files`);
    } catch (err) {
        logger.error(`Error updating files preview status: ${err.message}`);
    }
}

/**
 * Update the Project Status in the current project's "status.json" file
 * @param {*} project project path
 * @param {*} filesWrapper filesWrapper object
 * @param {*} previewStatuses array of preview statuses
 */
async function updateProjectStatus(project, filesWrapper, previewStatuses) {
    const failedPreviews = previewStatuses.filter((status) => !status.success);
    const statusEntry = {
        step: 'Promoted and Copied Files Preview Completed',
        stepName: 'promoted_preview_completed',
        files: previewStatuses.map((s) => s.path),
        failures: failedPreviews.length > 0 ? `Failed Previews: \n${failedPreviews.map((f) => f.path).join('\n')}` : '',
        summary: {
            total: previewStatuses.length,
            successful: previewStatuses.filter((s) => s.success).length,
            failed: failedPreviews.length
        }
    };
    await writeProjectStatus(filesWrapper, `graybox_promote${project}/status.json`, statusEntry, 'promoted_preview_completed');
    logger.info('Updated project status to promoted_preview_completed');
}

function exitAction(resp) {
    return resp;
}

export { main };
