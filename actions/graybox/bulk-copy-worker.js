/* ***********************************************************************
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

import AppConfig from '../appConfig.js';
import Sharepoint from '../sharepoint.js';
import { delay, getAioLogger } from '../utils.js';
import initFilesWrapper from './filesWrapper.js';
import { toUTCStr } from '../utils.js';

const logger = getAioLogger();
async function main(params) {
    logger.info('Graybox Bulk Copy Worker triggered');
    const appConfig = new AppConfig(params);
    const sharepoint = new Sharepoint(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    const {
        gbRootFolder, experienceName, projectExcelPath
    } = appConfig.getPayload();

    const project = `${gbRootFolder}/${experienceName}`;
    // Array to track failed files
    const failedFiles = [];

    try {
        logger.info('Starting bulk copy worker');

        // Initialize status file with empty object
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, {
            statuses: []
        });

        const { sourcePaths, destinationPath } = params;
        const results = {
            successful: [],
            failed: []
        };

        // Create initial status object
        const bulkCopyStatus = {
            status: 'started',
            sourcePaths,
            experienceName,
            destinationFolder: gbRootFolder,
            timestamp: new Date().toISOString(),
            statuses: []
        };

        // Add to status file
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, bulkCopyStatus);

        // Add processing status
        const processingStatus = {
            timestamp: new Date().toISOString(),
            status: 'processing'
        };

        // Read current status, add new status, and write back
        let currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
        currentStatus.status = 'processing';
        currentStatus.statuses.push(processingStatus);
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

        // Process each source path
        for (const pathInfo of sourcePaths) {
            try {
                const { sourcePath, destinationPath: fileDestinationPath } = pathInfo;

                // Add file processing status
                currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
                currentStatus.statuses.push({
                    timestamp: new Date().toISOString(),
                    status: 'processing_file',
                    file: sourcePath
                });
                await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

                // Get file data from source
                let sourcePathForFileData = sourcePath;
                if (sourcePath.endsWith('.json')) {
                    sourcePathForFileData = sourcePath.replace(/\.json$/, '.xlsx');
                }
                const { fileDownloadUrl, fileSize } = await sharepoint.getFileData(sourcePathForFileData, false);

                if (!fileDownloadUrl) {
                    const errorMsg = `Failed to get file data for: ${sourcePath}`;
                    failedFiles.push({ path: sourcePath, error: errorMsg });

                    try {
                        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS',
                            [[`Failed to copy file: ${sourcePath}`, toUTCStr(new Date()), errorMsg, '']]);
                    } catch (excelError) {
                        logger.error(`Failed to update Excel for file ${sourcePath}: ${excelError.message}`);
                    }

                    throw new Error(errorMsg);
                }

                // Download the file
                const fileContent = await sharepoint.getFileUsingDownloadUrl(fileDownloadUrl);
                if (!fileContent) {
                    const errorMsg = `Failed to download file: ${sourcePath}`;
                    logger.error(`Failed to download file in bulk copy worker: ${sourcePath}`);
                    failedFiles.push({ path: sourcePath, error: errorMsg });

                    // Write failed file to Excel immediately
                    try {
                        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS',
                            [[`Failed to download file: ${sourcePath}`, toUTCStr(new Date()), errorMsg, '']]);
                    } catch (excelError) {
                        logger.error(`Failed to update Excel for file ${sourcePath}: ${excelError.message}`);
                    }

                    throw new Error(errorMsg);
                }

                const fileName = sourcePath.split('/').pop();

                // Use the provided destination path and handle json/xlsx extension
                let destPath = fileDestinationPath;
                if (destPath.endsWith('.json')) {
                    destPath = destPath.replace(/\.json$/, '.xlsx');
                }

                // Add file saving status
                currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
                currentStatus.statuses.push({
                    timestamp: new Date().toISOString(),
                    status: 'saving_file',
                    sourcePath,
                    destinationPath: destPath
                });
                await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

                // Save the file to destination
                const saveResult = await sharepoint.saveFileSimple(fileContent, destPath, true);
                if (!saveResult.success) {
                    const errorMsg = saveResult.errorMsg || `Failed to save file to: ${destPath}`;
                    failedFiles.push({ path: sourcePath, error: errorMsg });

                    // Write failed file to Excel immediately
                    try {
                        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS',
                            [[`Failed to copy file: ${sourcePath}`, toUTCStr(new Date()), errorMsg, '']]);
                    } catch (excelError) {
                        logger.error(`Failed to update Excel for file ${sourcePath}: ${excelError.message}`);
                    }

                    throw new Error(errorMsg);
                }
                logger.info(`File saved to destination: ${destPath}`);

                results.successful.push({
                    sourcePath,
                    destinationPath: destPath,
                    fileSize
                });

                // Add file success status
                currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
                currentStatus.statuses.push({
                    timestamp: new Date().toISOString(),
                    status: 'file_copied',
                    sourcePath,
                    destinationPath: destPath,
                    fileSize
                });
                await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

                // Add a small delay between operations to prevent overwhelming the system
                await delay(100);
            } catch (error) {
                logger.error(`Error processing ${pathInfo.sourcePath}: ${error.message}`);
                results.failed.push({
                    sourcePath: pathInfo.sourcePath,
                    error: error.message
                });

                // Add file failure status
                currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
                currentStatus.statuses.push({
                    timestamp: new Date().toISOString(),
                    status: 'file_failed',
                    sourcePath: pathInfo.sourcePath,
                    error: error.message
                });
                await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

                // Already added to failedFiles in the specific error cases
                if (!failedFiles.some(f => f.path === pathInfo.sourcePath)) {
                    failedFiles.push({ path: pathInfo.sourcePath, error: error.message });

                    // Write failed file to Excel immediately
                    try {
                        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS',
                            [[`Failed to copy file: ${pathInfo.sourcePath}`, toUTCStr(new Date()), error.message, '']]);
                    } catch (excelError) {
                        logger.error(`Failed to update Excel for file ${pathInfo.sourcePath}: ${excelError.message}`);
                    }
                }

                // Continue with the next file, don't stop the flow
            }
        }

        // Add completed status with results
        currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
        currentStatus.status = 'completed';
        currentStatus.statuses.push({
            status: 'completed',
            timestamp: new Date().toISOString(),
            results: results
        });
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

        // Write bulk copy completion status to Excel
        const bulkCopyCompletedExcelValues = [['Bulk Copy Completed', toUTCStr(new Date()), '', '']];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', bulkCopyCompletedExcelValues);

        // Write summary of failed files to Excel if any
        if (failedFiles.length > 0) {
            const failedSummaryExcelValues = [[`Bulk Copy: ${failedFiles.length} files failed`, toUTCStr(new Date()), 'See individual file errors above', '']];
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', failedSummaryExcelValues);
        }

        return {
            statusCode: 200,
            body: {
                message: 'Bulk copy operation completed',
                results: {
                    total: sourcePaths.length,
                    successful: results.successful.length,
                    failed: results.failed.length,
                    details: results
                }
            }
        };
    } catch (error) {
        logger.error(error);

        // Add error status
        try {
            const project = `${appConfig.getPayload().gbRootFolder}/${appConfig.getPayload().experienceName}`;
            const currentStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
            currentStatus.status = 'error';
            currentStatus.statuses.push({
                timestamp: new Date().toISOString(),
                status: 'error',
                error: error.message
            });
            await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, currentStatus);

            // Write the overall error to Excel
            const errorExcelValues = [['Bulk Copy Failed', toUTCStr(new Date()), error.message, '']];
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', errorExcelValues);
        } catch (statusError) {
            logger.error(`Failed to update status file: ${statusError.message}`);
        }

        return {
            statusCode: 500,
            body: {
                error: 'Internal server error',
                message: error.message
            }
        };
    }
}

export { main };