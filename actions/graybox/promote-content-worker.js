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
    logger.info('Graybox Promote Content Action triggered');

    const appConfig = new AppConfig(params);
    const {
        spToken, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath, draftsOnly
    } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);

    // process data in batches
    const helixUtils = new HelixUtils(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    let responsePayload;
    const promotes = [];
    const failedPromotes = [];

    logger.info('In Promote Content Worker, Processing Promote Content');

    // const promoteFilePaths = params.promoteFilePaths || [];

    const project = params.project || '';
    const batchName = params.batchName || '';

    const promoteBatchesJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/promote_batches.json`);
    logger.info(`In Promote-sched Promote Batches Json: ${JSON.stringify(promoteBatchesJson)}`);

    const promoteFilePaths = promoteBatchesJson[batchName] || [];

    logger.info(`In Promote Content Worker, promoteFilePaths: ${JSON.stringify(promoteFilePaths)}`);
    // Process the Promote Content
    promoteFilePaths.forEach(async (promoteFilePath) => {
        const promoteDocx = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/docx${promoteFilePath}`);
        if (promoteDocx) {
            logger.info('in promoteDocx');
            logger.info(`In Promote Content Worker, Promote Docx: ${JSON.stringify(promoteDocx)}`);
        }
        const saveStatus = await sharepoint.saveFileSimple(promoteDocx, promoteFilePath);
        logger.info(`In Promote Content Worker, Save Status of ${promoteFilePath}: ${JSON.stringify(saveStatus)}`);

        if (saveStatus?.success) {
            promotes.push(promoteFilePath);
        } else if (saveStatus?.errorMsg?.includes('File is locked')) {
            failedPromotes.push(`${promoteFilePath} (locked file)`);
        } else {
            failedPromotes.push(promoteFilePath);
        }
    });

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
