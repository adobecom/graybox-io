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
    let responsePayload = 'Graybox Process Docx Scheduler invoked';
    logger.info(responsePayload);

    const filesWrapper = await initFilesWrapper(logger);

    try {
        const projects = await filesWrapper.readFileIntoObject('graybox_promote/ongoing_projects.json');
        logger.info(`In Process-docx-sched Ongoing Projects Json: ${JSON.stringify(projects)}`);

        // iterate the JSON array projects and extract the project_path where status is 'initial_preview_done'
        const ongoingPreviewedProjects = [];
        projects.forEach((project) => {
            if (project.status === 'initial_preview_done') {
                ongoingPreviewedProjects.push(project.project_path);
            }
        });

        ongoingPreviewedProjects.forEach(async (project) => {
            logger.info(`Project Path: ${project}`);
            const projectStatusJson = await filesWrapper.readFileIntoObject(`graybox_promote${project}/status.json`);
            logger.info(`In Process-docx-sched Projects Json: ${JSON.stringify(projectStatusJson)}`);

            // copy all params from json into the params object
            const inputParams = projectStatusJson?.params;
            Object.keys(inputParams).forEach((key) => {
                params[key] = inputParams[key];
            });

            try {
                const appConfig = new AppConfig(params);
                const grpIds = appConfig.getConfig().grayboxUserGroups;
                const vActData = await validateAction(params, grpIds, params.ignoreUserCheck);
                if (vActData && vActData.code !== 200) {
                    logger.info(`Validation failed: ${JSON.stringify(vActData)}`);
                    return vActData;
                }

                return ow.actions.invoke({
                    name: 'graybox/process-docx-worker',
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
                    responsePayload = 'Failed to invoke graybox process docx action';
                    logger.error(`${responsePayload}: ${err}`);
                    return {
                        code: 500,
                        payload: responsePayload
                    };
                });
            } catch (err) {
                responsePayload = 'Unknown error occurred';
                logger.error(`${responsePayload}: ${err}`);
                responsePayload = err;
            }

            return {
                code: 500,
                payload: responsePayload,
            };
        });
    } catch (err) {
        responsePayload = 'Unknown error occurred';
        logger.error(`${responsePayload}: ${err}`);
        responsePayload = err;
    }

    return {
        code: 500,
        payload: responsePayload,
    };
}

exports.main = main;
