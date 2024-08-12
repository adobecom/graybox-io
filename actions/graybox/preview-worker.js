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
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    // Batch Name to Array of Batch Preview Statuses mapping
    const previewStatuses = {};
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;

    // Read the Project Status in the current project's "status.json" file
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);

    if (helixUtils.canBulkPreview(true) && (projectStatusJson.status === 'initiated' || projectStatusJson.status === 'promoted')) {
        logger.info('In Preview Worker, Bulk Previewing Graybox files');

        const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);

        logger.info(`In Preview-Worker, batchStatusJson: ${JSON.stringify(batchStatusJson)}`);

        const noofbatches = batchStatusJson !== undefined ? Object.keys(batchStatusJson).length : 0;
        // iterate over batch_status.json file and process each batch
        if (projectStatusJson.status === 'initiated') {
            const batchResults = {};
            // Read the Batch JSON file into an array
            const i = 0; // Start with counter as 0
            await iterateAndPreviewBatchJson(i, batchResults, noofbatches, batchStatusJson, true);
        } else if (projectStatusJson.status === 'promoted') {
            const promotedPathsJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/promoted_paths.json`);
            const i = 0; // Start with counter as 0
            await iterateAndPreviewBatchJson(i, promotedPathsJson, noofbatches, batchStatusJson, false);
        }

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
        if (previewStatusJson) {
            Object.entries(previewStatusJson).forEach(([batchName, batchPreviewStatuses]) => {
                if (previewStatuses[batchName]) {
                    previewStatuses[batchName] = previewStatuses[batchName].concat(batchPreviewStatuses);
                } else {
                    previewStatuses[batchName] = batchPreviewStatuses;
                }
            });
        }

        // Write the updated preview_errors.json file
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`, previewStatuses);

        // Write the updated preview_errors.json file
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_errors.json`, previewErrorsJson.concat(failedPreviews));

        // Update the Project Status in the current project's "status.json" file & the parent "ongoing_projects.json" file
        await updateProjectStatus(gbRootFolder, experienceName, filesWrapper);

        try {
            logger.info('Updating project excel file with status');
            const sFailedPreviews = failedPreviews.length > 0 ? `Failed Previews(Promote won't happen for these): \n${failedPreviews.join('\n')}` : '';
            let excelValues = '';
            if (projectStatusJson.status === 'initiated') {
                excelValues = [['Step 1 of 5: Initial Preview of Graybox completed', toUTCStr(new Date()), sFailedPreviews]];
            } else if (projectStatusJson.status === 'promoted') {
                excelValues = [['Step 5 of 5: Final Preview of Graybox completed', toUTCStr(new Date()), sFailedPreviews]];
            }
            // Update Preview Status
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues);
        } catch (err) {
            logger.error(`Error Occured while updating Excel during Graybox Initial Preview: ${err}`);
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
    async function iterateAndPreviewBatchJson(i, batchResults, noofbatches, batchStatusJson, isGraybox) {
        const batchName = `batch_${i + 1}`;
        if (i < noofbatches) {
            if (batchStatusJson[batchName] === 'initiated' || batchStatusJson[batchName] === 'promoted') {
                // Only for initial preview read the files from /batches/ folder,
                // Otherwise for final preview use the list passed as-is from copy-worker or promote-worker
                if (batchStatusJson[batchName] === 'initiated') {
                    // Read the Batch JSON file into an batchResults JSON object
                    const batchJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batches/${batchName}.json`);
                    batchResults[`${batchName}`] = batchJson;
                }
                // Perform Bulk Preview of a Batch of Graybox files
                await previewBatch(batchName, batchResults, batchStatusJson, isGraybox);
            }

            // Recursively call the function to process the next batch
            await iterateAndPreviewBatchJson(i + 1, batchResults, noofbatches, batchStatusJson, isGraybox);
        }
    }

    /**
     * Perform a Bulk Preview on a Batch of Graybox files
     * @param {*} batchName batchName
     * @param {*} previewStatuses returned preview statuses
     * @param {*} helixUtils helixUtils object
     * @param {*} experienceName graybox experience name
     */
    async function previewBatch(batchName, batchResults, batchStatusJson, isGraybox = true) {
        const batchJson = batchResults[batchName];
        const paths = [];
        batchJson.forEach((gbFile) => paths.push(handleExtension(gbFile)));

        // Perform Bulk Preview of a Batch of Graybox files
        if (isGraybox) {
            previewStatuses[batchName] = await helixUtils.bulkPreview(paths, helixUtils.getOperations().PREVIEW, experienceName, isGraybox);
        } else {
            // Don't pass experienceName for final preview
            previewStatuses[batchName] = await helixUtils.bulkPreview(paths, helixUtils.getOperations().PREVIEW);
        }
        if (isGraybox) {
            batchStatusJson[batchName] = 'initial_preview_done';
        } else {
            batchStatusJson[batchName] = 'final_preview_done';
        }
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
    // If the project status is 'initiated', set it to 'initial_preview_done', else if project status is 'promoted' set it to 'final_preview_done'
    const toBeStatus = projectStatusJson.status === 'initiated' ? 'initial_preview_done' : 'final_preview_done';
    projectStatusJson.status = toBeStatus;
    logger.info(`In Preview-sched After Processing Preview, Project Status Json: ${JSON.stringify(projectStatusJson)}`);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "ongoing_projects.json" file
    projects.find((p) => p.project_path === `${gbRootFolder}/${experienceName}`).status = toBeStatus;
    logger.info(`In Preview-sched After Processing Preview, OnProjects Json: ${JSON.stringify(projects)}`);
    await filesWrapper.writeFile('graybox_promote/ongoing_projects.json', projects);
}

function exitAction(resp) {
    return resp;
}

exports.main = main;
