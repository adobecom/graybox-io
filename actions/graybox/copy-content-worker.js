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
const Sharepoint = require('../sharepoint');
const initFilesWrapper = require('./filesWrapper');

const logger = getAioLogger();

async function main(params) {
    logger.info('Graybox Promote Content Action triggered');

    const appConfig = new AppConfig(params);
    const {
        spToken, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath, draftsOnly
    } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;
    const promotes = [];
    const failedPromotes = [];

    logger.info('In Copy Content Worker, Processing Copy Content');

    const project = params.project || '';
    const batchName = params.batchName || '';

    const copyBatchesJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/copy_batches.json`);

    const copyFilePathsJson = copyBatchesJson[batchName] || {};

    logger.info(`In Copy Content Worker, copyFilePaths: ${JSON.stringify(copyFilePathsJson)}`);
    // Process the Copy Content
    Object.entries(copyFilePathsJson).forEach(async ([copySourceFilePath, copyDestFilePath]) => {
        // Download the grayboxed file and save it to default content location
        const { fileDownloadUrl } = await sharepoint.getFileData(copySourceFilePath, true);
        const file = await sharepoint.getFileUsingDownloadUrl(fileDownloadUrl);
        const saveStatus = await sharepoint.saveFileSimple(file, copyDestFilePath);

        if (saveStatus?.success) {
            promotes.push(copyDestFilePath);
        } else if (saveStatus?.errorMsg?.includes('File is locked')) {
            failedPromotes.push(`${copyDestFilePath} (locked file)`);
        } else {
            failedPromotes.push(copyDestFilePath);
        }
    });

    responsePayload = 'Copy Content Worker finished promoting content';
    logger.info(responsePayload);
    return exitAction({
        body: responsePayload,
        statusCode: 200
    });
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
    logger.info(`In Promote-content-worker After Processing Promote, Project Status Json: ${JSON.stringify(projectStatusJson)}`);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJson);

    // Update the Project Status in the parent "ongoing_projects.json" file
    projects.find((p) => p.project_path === `${gbRootFolder}/${experienceName}`).status = 'initial_preview_done';
    logger.info(`In Promote-content-worker After Processing Promote, OnProjects Json: ${JSON.stringify(projects)}`);
    await filesWrapper.writeFile('graybox_promote/ongoing_projects.json', projects);
}

function exitAction(resp) {
    return resp;
}

exports.main = main;
