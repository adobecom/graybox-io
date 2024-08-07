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

const {
    getAioLogger, handleExtension, toUTCStr
} = require('../utils');
const AppConfig = require('../appConfig');
const HelixUtils = require('../helixUtils');
const Sharepoint = require('../sharepoint');
const initFilesWrapper = require('./filesWrapper');

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Preview Action triggered');

    const appConfig = new AppConfig(params);
    const {
        spToken, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath, draftsOnly
    } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    // Batch Name to Array of Batch Preview Statuses mapping
    const previewStatuses = {};
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;
    if (helixUtils.canBulkPreview(true)) {
        logger.info('In Preview Worker, Bulk Previewing Graybox files');

        const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);

        logger.info(`In Preview-Worker, batchStatusJson: ${JSON.stringify(batchStatusJson)}`);

        const noofbatches = batchStatusJson !== undefined ? Object.keys(batchStatusJson).length : 0;
        // iterate over batch_status.json file and process each batch
        const batchResults = {};

        // Read the Batch JSON file into an array
        const i = 0; // Start with counter as 0
        await iterateAndReadBatchJson(i, batchResults, noofbatches, batchStatusJson);

        // Write the updated batch_status.json file
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`, batchStatusJson);
        logger.info(`Updated Batch Status Json: ${JSON.stringify(batchStatusJson)}`);

        // PreviewStatuses is an object with keys(batchNames) mapping to arrays(previewStauses)
        const failedPreviews = Object.keys(previewStatuses).reduce((acc, key) => {
            const filteredStatuses = previewStatuses[key]
                .filter((status) => !status.success) // Filter out failed statuses
                .map((status) => status.path); // Map to get the path of the failed status
            return acc.concat(filteredStatuses); // Concatenate to the accumulator
        }, []);
        // Now failedPreviews contains all the paths from the filtered and mapped arrays

        const previewStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`);
        const previewErrorsJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_errors.json`);

        // Combine the Preview Statuses for each batch read from AIO Json with the Preview Statuses
        previewStatusJson.forEach((batchName) => {
            const batchPreviewStatuses = previewStatuses[batchName];
            if (batchPreviewStatuses) {
                previewStatuses[batchName] = batchPreviewStatuses.concat(previewStatusJson[batchName]);
            }
        });

        // Write the updated preview_errors.json file
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`, previewStatuses);

        // Write the updated preview_errors.json file
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_errors.json`, previewErrorsJson.concat(failedPreviews));

        const updatedBatchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);
        logger.info(`Updated Project Batch Status Json: ${JSON.stringify(updatedBatchStatusJson)}`);

        const updatedPreviewStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`);
        logger.info(`Updated Project Preview Status Json: ${JSON.stringify(updatedPreviewStatusJson)}`);

        const updatedPreviewErrorsJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/preview_errors.json`);
        logger.info(`Updated Project Preview Errors Json: ${JSON.stringify(updatedPreviewErrorsJson)}`);

        // Update the Project Status in the current project's "status.json" file & the parent "ongoing_projects.json" file
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper);

        try {
            logger.info('Updating project excel file with status');
            const sFailedPreviews = failedPreviews.length > 0 ? `Failed Previews(Promote won't happen for these): \n${failedPreviews.join('\n')}` : '';
            const excelValues = [['Step 1 of 4: Initial Preview of Graybox completed', toUTCStr(new Date()), sFailedPreviews]];
            // Update Preview Status
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues);
        } catch (err) {
            logger.error('Error Occured while updating Excel during Graybox Initial Preview');
        }

        responsePayload = 'Graybox Preview Worker action completed.';
    } else {
        responsePayload = 'Bulk Preview not enabled for Graybox Content Tree';
    }
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });

    /**
     * Iterate over the Batch JSON files, read those into an array and perform Bulk Preview
     * @param {*} i counter
     * @param {*} batchResults batchResults array
     * @param {*} noofbatches total no of batches
     * @param {*} filesWrapper filesWrapper object
     * @param {*} gbRootFolder graybox root folder
     * @param {*} experienceName graybox experience name
     */
    async function iterateAndReadBatchJson(i, batchResults, noofbatches, batchStatusJson) {
        const batchName = `batch_${i + 1}`;

        if (i < noofbatches && batchStatusJson[batchName] === 'initiated') {
            // Read the Batch JSON file into an batchResults JSON object
            const batchJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batches/${batchName}.json`);
            batchResults[`${batchName}`] = batchJson;

            // Perform Bulk Preview of a Batch of Graybox files
            await previewBatch(batchName, batchResults, batchStatusJson);

            if (i + 1 < noofbatches) { // Recrusive call next batch only if batch exists
                // Recursively call the function to process the next batch
                await iterateAndReadBatchJson(i + 1, batchResults, noofbatches, batchStatusJson);
            }
        }
    }

    /**
     * Perform a Bulk Preview on a Batch of Graybox files
     * @param {*} batchName batchResults array
     * @param {*} previewStatuses returned preview statuses
     * @param {*} helixUtils helixUtils object
     * @param {*} experienceName graybox experience name
     */
    async function previewBatch(batchName, batchResults, batchStatusJson) {
        const batchJson = batchResults[batchName];
        const paths = [];
        batchJson.forEach((gbFile) => paths.push(handleExtension(gbFile.filePath)));
        // Perform Bulk Preview of a Batch of Graybox files
        previewStatuses[batchName] = await helixUtils.bulkPreview(paths, helixUtils.getOperations().PREVIEW, experienceName, true);
        batchStatusJson[batchName] = 'initial_preview_done';
    }
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "ongoing_projects.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @returns updated project status
 */
async function updateProjectStatus(gbRootFolder, experienceName, filesWrapper) {
    const projects = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);

    // Update the Project Status in the current project's "status.json" file
    projectStatusJson.status = 'initial_preview_done';
    logger.info(`In Preview-sched After Processing Preview, Project Status Json: ${JSON.stringify(projectStatusJson)}`);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "ongoing_projects.json" file
    projects.find((p) => p.project_path === `${gbRootFolder}/${experienceName}`).status = 'initial_preview_done';
    logger.info(`In Preview-sched After Processing Preview, OnProjects Json: ${JSON.stringify(projects)}`);
    await filesWrapper.writeFile('graybox_promote/ongoing_projects.json', projects);
}

function exitAction(resp) {
    return resp;
}

exports.main = main;
