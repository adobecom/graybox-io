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

const { getAioLogger, toUTCStr } = require('../utils');
const AppConfig = require('../appConfig');
const Sharepoint = require('../sharepoint');
const initFilesWrapper = require('./filesWrapper');

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Promote Content Action triggered');

    const appConfig = new AppConfig(params);
    const { gbRootFolder, experienceName, projectExcelPath } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;
    let promotes = [];
    const failedPromotes = [];

    logger.info('In Promote Content Worker, Processing Promote Content');

    // Read the Batch Status in the current project's "batch_status.json" file
    const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);

    const promotedPathsJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/promoted_paths.json`) || {};

    const promoteErrorsJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/promote_errors.json`);

    const project = params.project || '';
    const batchName = params.batchName || '';

    // Combined existing If any promotes already exist in promoted_paths.json for the current batch either from Copy action or Promote Action
    if (promotedPathsJson[batchName]) {
        promotes = promotes.concat(promotedPathsJson[batchName]);
    }

    const promoteBatchesJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/promote_batches.json`);
    logger.info(`In Promote-sched Promote Batches Json: ${JSON.stringify(promoteBatchesJson)}`);

    const promoteFilePaths = promoteBatchesJson[batchName].files || [];

    logger.info(`In Promote Content Worker, promoteFilePaths: ${JSON.stringify(promoteFilePaths)}`);
    // Process the Promote Content
    // Collect all promises from the forEach loop
    const promotePromises = promoteFilePaths.map(async (promoteFilePath) => {
        const promoteDocx = await filesWrapper.readFileIntoBuffer(`graybox_promote${gbRootFolder}/${experienceName}/docx${promoteFilePath}`);
        if (promoteDocx) {
            const saveStatus = await sharepoint.saveFileSimple(promoteDocx, promoteFilePath);
            logger.info(`In Promote Content Worker, Save Status of ${promoteFilePath}: ${JSON.stringify(saveStatus)}`);

            if (saveStatus?.success) {
                promotes.push(promoteFilePath);
            } else if (saveStatus?.errorMsg?.includes('File is locked')) {
                failedPromotes.push(`${promoteFilePath} (locked file)`);
            } else {
                failedPromotes.push(promoteFilePath);
            }
        }
    });

    // Wait for all the promises to resolve
    await Promise.all(promotePromises);

    // Update the Promoted Paths in the current project's "promoted_paths.json" file
    if (promotes.length > 0) {
        promotedPathsJson[batchName] = promotes;
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promoted_paths.json`, promotedPathsJson);
    }

    if (failedPromotes.length > 0) {
        await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promote_errors.json`, promoteErrorsJson.concat(failedPromotes));
    }

    // Update the Batch Status in the current project's "batch_status.json" file
    if (batchStatusJson && batchStatusJson[batchName] && (promotes.length > 0 || failedPromotes.length > 0)) {
        batchStatusJson[batchName] = 'promoted';
    }

    // Write the updated batch_status.json file
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`, batchStatusJson);

    // Update the Promote Batch Status in the current project's "promote_batches.json" file
    promoteBatchesJson[batchName].status = 'promoted';
    // Write the promote batches JSON file
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promote_batches.json`, promoteBatchesJson);

    // Update the Project Excel with the Promote Status
    try {
        const sFailedPromoteStatuses = failedPromotes.length > 0 ? `Failed Promotes: \n${failedPromotes.join('\n')}` : '';
        const promoteExcelValues = [[`Step 3 of 5: Promote Docx completed for Batch ${batchName}`, toUTCStr(new Date()), sFailedPromoteStatuses]];
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteExcelValues);
    } catch (err) {
        logger.error(`Error Occured while updating Excel during Graybox Promote: ${err}`);
    }

    // Update the Project Status in JSON files
    updateProjectStatus(gbRootFolder, experienceName, filesWrapper);

    logger.info(`In Promote Content Worker, Promotes: ${JSON.stringify(promotes)}`);
    logger.info(`In Promote Content Worker, Failed Promotes: ${JSON.stringify(failedPromotes)}`);

    responsePayload = 'Promote Content Worker finished promoting content';
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
}

/**
 * Update the Project Status in the current project's "status.json" file & the parent "project_queue.json" file
 * @param {*} gbRootFolder graybox root folder
 * @param {*} experienceName graybox experience name
 * @param {*} filesWrapper filesWrapper object
 * @returns updated project status
 */
async function updateProjectStatus(gbRootFolder, experienceName, filesWrapper) {
    const projectQueue = await filesWrapper.readFileIntoObject('graybox_promote/project_queue.json');
    const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);

    // Update the Project Status in the current project's "status.json" file
    projectStatusJson.status = 'promoted';
    logger.info(`In Promote-content-worker After Processing Promote, Project Status Json: ${JSON.stringify(projectStatusJson)}`);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "project_queue.json" file
    const index = projectQueue.findIndex((obj) => obj.projectPath === `${gbRootFolder}/${experienceName}`);
    if (index !== -1) {
        // Replace the object at the found index
        projectQueue[index].status = 'promoted';
    }
    logger.info(`In Promote-content-worker After Processing Promote, Project Queue Json: ${JSON.stringify(projectQueue)}`);
    await filesWrapper.writeFile('graybox_promote/project_queue.json', projectQueue);
}

function exitAction(resp) {
    return resp;
}

exports.main = main;
