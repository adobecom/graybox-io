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

// eslint-disable-next-line import/no-extraneous-dependencies
const openwhisk = require('openwhisk');
const { getAioLogger } = require('../utils');
const { validateAction } = require('./validateAction');
const AppConfig = require('../appConfig');
const initFilesWrapper = require('./filesWrapper');

async function main(params) {
    const logger = getAioLogger();
    const ow = openwhisk();
    let responsePayload = 'Graybox Copy Scheduler invoked';
    logger.info(responsePayload);

    const filesWrapper = await initFilesWrapper(logger);

    try {
        const projects = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');
        logger.info(`From Copy-sched Ongoing Projects Json: ${JSON.stringify(projects)}`);

        // iterate the JSON array projects and extract the project_path where status is 'initiated'
        const ongoingPorcessedProjects = [];
        projects.forEach((project) => {
            if (project.status === 'processed') {
                ongoingPorcessedProjects.push(project.project_path);
            }
        });

        ongoingPorcessedProjects.forEach(async (project) => {
            const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/status.json`);
            logger.info(`In Copy-sched Projects Json: ${JSON.stringify(projectStatusJson)}`);

            // Read the Batch Status in the current project's "batch_status.json" file
            const batchStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/batch_status.json`);

            const copyBatchesJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/copy_batches.json`);
            // copy all params from json into the params object
            const inputParams = projectStatusJson?.params;
            Object.keys(inputParams).forEach((key) => {
                params[key] = inputParams[key];
            });

            Object.entries(copyBatchesJson).forEach(async ([batchName, copyFilePathsJson]) => {
                if (batchStatusJson[batchName] === 'processed') {
                    // Set the Project & Batch Name in params for the Copy Content Worker Action to read and process
                    params.project = project;
                    params.batchName = batchName;

                    try {
                        const appConfig = new AppConfig(params);
                        const grpIds = appConfig.getConfig().grayboxUserGroups;
                        const vActData = await validateAction(params, grpIds, params.ignoreUserCheck);
                        if (vActData && vActData.code !== 200) {
                            logger.info(`Validation failed: ${JSON.stringify(vActData)}`);
                            return vActData;
                        }

                        return ow.actions.invoke({
                            name: 'graybox/copy-worker',
                            blocking: false,
                            result: false,
                            params
                        }).then(async (result) => {
                            logger.info(result);
                            return {
                                code: 200,
                                payload: responsePayload
                            };
                        }).catch(async (err) => {
                            responsePayload = 'Failed to invoke graybox copy action';
                            logger.error(`${responsePayload}: ${err}`);
                            return {
                                code: 500,
                                payload: responsePayload
                            };
                        });
                    } catch (err) {
                        responsePayload = 'Unknown error occurred while invoking Copy Content Worker Action';
                        logger.error(`${responsePayload}: ${err}`);
                        responsePayload = err;
                    }
                }
                responsePayload = 'Triggered multiple Copy Content Worker Actions';
                return {
                    code: 200,
                    payload: responsePayload,
                };
            });
        });
    } catch (err) {
        responsePayload = 'Unknown error occurred while processing the projects for Copy';
        logger.error(`${responsePayload}: ${err}`);
        responsePayload = err;
    }

    // No errors while initiating all the Copy Content Worker Action for all the projects
    return {
        code: 200,
        payload: responsePayload
    };
}

exports.main = main;
