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

const initFilesWrapper = require('./filesWrapper');
const {
    getAioLogger, isFilePatternMatched, toUTCStr
} = require('../utils');
const AppConfig = require('../appConfig');
const Sharepoint = require('../sharepoint');

const logger = getAioLogger();
const MAX_CHILDREN = 1000;
const BATCH_REQUEST_PREVIEW = 200;
// const BATCH_REQUEST_PREVIEW = 1; // TODO remove this line and uncomment the above line after testing

/**
 *  - Bulk Preview docx files
 *  - GET markdown files using preview-url.md
 *  - Process markdown - process MDAST by cleaning it up
 *  - Generate updated Docx file using md2docx lib
 *  - copy updated docx file to the default content tree
 *  - run the bulk preview action on the list of files that were copied to default content tree
 *  - update the project excel file as and when necessary to update the status of the promote action
 */
async function main(params) {
    logger.info('Graybox Promote Worker invoked');

    const appConfig = new AppConfig(params);
    const {
        spToken, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath, draftsOnly
    } = appConfig.getPayload();

    const filesWrapper = await initFilesWrapper(logger);
    const sharepoint = new Sharepoint(appConfig);

    // Update Promote Status
    const promoteTriggeredExcelValues = [['Promote triggered', toUTCStr(new Date()), '']];
    await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', promoteTriggeredExcelValues);

    logger.info(`GB ROOT FOLDER ::: ${gbRootFolder}`);
    logger.info(`GB EXP NAME ::: ${experienceName}`);

    // Get all files in the graybox folder for the specific experience name
    // NOTE: This does not capture content inside the locale/expName folders yet
    const gbFiles = await findAllFiles(experienceName, appConfig, sharepoint);

    // Create Batch Status JSON
    const batchStatusJson = '{"batch_1":"initiated"}';
    const batchStatusJsonObject = JSON.parse(batchStatusJson);

    // Create Project Preview Status JSON
    const previewStatusJson = [];

    // Create GBFiles Batches JSON
    const gbFileBatchesJson = {};

    // Preview Errors JSON
    const projectPreviewErrorsJson = [];

    // Promoted Paths JSON
    const promotedPathsJson = {};

    // Promote Errors JSON
    const promoteErrorsJson = [];

    // create batches to process the data
    const gbFilesBatchArray = [];
    const writeBatchJsonPromises = [];
    for (let i = 0; i < gbFiles.length; i += BATCH_REQUEST_PREVIEW) {
        const arrayChunk = gbFiles.slice(i, i + BATCH_REQUEST_PREVIEW);
        gbFilesBatchArray.push(arrayChunk);
        const batchName = `batch_${i + 1}`;
        batchStatusJsonObject[`${batchName}`] = 'initiated';

        // Each Files Batch is written to a batch_n.json file
        writeBatchJsonPromises.push(filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/batches/${batchName}.json`, arrayChunk));

        // Write the GBFile Batches to the gbfile_batches.json file
        gbFileBatchesJson[batchName] = arrayChunk;
    }

    await Promise.all(writeBatchJsonPromises);

    const inputParams = {};
    inputParams.rootFolder = rootFolder;
    inputParams.gbRootFolder = gbRootFolder;
    inputParams.projectExcelPath = projectExcelPath;
    inputParams.experienceName = experienceName;
    inputParams.spToken = spToken;
    inputParams.adminPageUri = adminPageUri;
    inputParams.draftsOnly = draftsOnly;
    inputParams.promoteIgnorePaths = promoteIgnorePaths;

    // convert the ignoreUserCheck boolean to string, so the string processing in the appConfig -> ignoreUserCheck works
    inputParams.ignoreUserCheck = `${appConfig.ignoreUserCheck()}`;

    // Create Ongoing Projects JSON
    const ongoingProjectsJson = `[{"project_path":"${gbRootFolder}/${experienceName}","status":"initiated"}]`;

    // Create Project Status JSON
    const projectStatusJson = `{"status":"initiated", "params": ${JSON.stringify(inputParams)}}`;
    const projectStatusJsonObject = JSON.parse(projectStatusJson);

    logger.info(`projectStatusJson: ${projectStatusJson}`);

    // write to JSONs to AIO Files for Ongoing Projects and Project Status
    await filesWrapper.writeFile('graybox_promote/ongoing_projects.json', ongoingProjectsJson);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/status.json`, projectStatusJsonObject);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/gbfile_batches.json`, gbFileBatchesJson);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`, batchStatusJsonObject);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_status.json`, previewStatusJson);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/preview_errors.json`, projectPreviewErrorsJson);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promoted_paths.json`, promotedPathsJson);
    await filesWrapper.writeFile(`graybox_promote${gbRootFolder}/${experienceName}/promote_errors.json`, promoteErrorsJson);

    // read Graybox Project Json from AIO Files
    const json = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');
    logger.info(`Ongoing Projects Json: ${JSON.stringify(json)}`);
    const statusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/status.json`);
    logger.info(`Project Status Json: ${JSON.stringify(statusJson)}`);
    const projectBatchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${gbRootFolder}/${experienceName}/batch_status.json`);
    logger.info(`Project Batch Status Json: ${JSON.stringify(projectBatchStatusJson)}`);

    // process data in batches
    let responsePayload;
    responsePayload = 'Graybox Promote Worker action completed.';
    logger.info(responsePayload);
    return {
        body: responsePayload,
    };
}

/**
 * Find all files in the Graybox tree to promote.
 */
async function findAllFiles(experienceName, appConfig, sharepoint) {
    const sp = await appConfig.getSpConfig();
    const options = await sharepoint.getAuthorizedRequestOption({ method: 'GET' });
    const promoteIgnoreList = appConfig.getPromoteIgnorePaths();
    logger.info(`Promote ignore list: ${promoteIgnoreList}`);

    return findAllGrayboxFiles({
        baseURI: sp.api.file.get.gbBaseURI,
        options,
        gbFolders: appConfig.isDraftOnly() ? [`/${experienceName}/drafts`] : [''],
        promoteIgnoreList,
        downloadBaseURI: sp.api.file.download.baseURI,
        experienceName,
        sharepoint
    });
}

/**
 * Iteratively finds all files under a specified root folder.
 */
async function findAllGrayboxFiles({
    baseURI, options, gbFolders, promoteIgnoreList, downloadBaseURI, experienceName, sharepoint
}) {
    const gbRoot = baseURI.split(':').pop();
    // Regular expression to select the gbRoot and anything before it
    // Eg: the regex selects "https://<sharepoint-site>:/<app>-graybox"
    const pPathRegExp = new RegExp(`.*:${gbRoot}`);
    // Regular expression to select paths that has the experienceName at first or second level
    const pathsToSelectRegExp = new RegExp(`^/([^/]+/)?${experienceName}(/.*)?$`);
    const gbFiles = [];
    while (gbFolders.length !== 0) {
        const uri = `${baseURI}${gbFolders.shift()}:/children?$top=${MAX_CHILDREN}`;
        // eslint-disable-next-line no-await-in-loop
        const res = await sharepoint.fetchWithRetry(uri, options);
        logger.info(`Find all Graybox files URI: ${uri} \nResponse: ${res.ok}`);
        if (res.ok) {
            // eslint-disable-next-line no-await-in-loop
            const json = await res.json();
            // eslint-disable-next-line no-await-in-loop
            const driveItems = json.value;
            for (let di = 0; di < driveItems?.length; di += 1) {
                const item = driveItems[di];
                const itemPath = `${item.parentReference.path.replace(pPathRegExp, '')}/${item.name}`;
                logger.info(`${itemPath} ::: ${pathsToSelectRegExp.test(itemPath)}`);
                if (!isFilePatternMatched(itemPath, promoteIgnoreList)) {
                    if (item.folder) {
                        // it is a folder
                        gbFolders.push(itemPath);
                    } else if (pathsToSelectRegExp.test(itemPath)) {
                        // const downloadUrl = `${downloadBaseURI}/${item.id}/content`;
                        // eslint-disable-next-line no-await-in-loop
                        // gbFiles.push({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                        gbFiles.push(itemPath);
                    }
                } else {
                    logger.info(`Ignored from promote: ${itemPath}`);
                }
            }
        }
    }
    return gbFiles;
}

exports.main = main;
