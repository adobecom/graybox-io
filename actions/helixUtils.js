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

import fetch from 'node-fetch';
import { getAioLogger, delay } from './utils.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 5;
const JOB_STATUS_CODES = [200, 304];
const AUTH_ERRORS = [401, 403];
const PREVIEW = 'preview';
const PUBLISH = 'publish';
const LIVE = 'live';
const GRAYBOX_REPO_POSTFIX = '-graybox';

const logger = getAioLogger();

class HelixUtils {
    constructor(appConfig) {
        this.appConfig = appConfig;
    }

    getOperations() {
        return { PREVIEW, LIVE };
    }

    getRepo(isGraybox = false) {
        const urlInfo = this.appConfig.getUrlInfo();
        return isGraybox ? `${urlInfo.getRepo()}${GRAYBOX_REPO_POSTFIX}` : urlInfo.getRepo();
    }

    getAdminApiKey(isGraybox = false) {
        const repo = this.getRepo(isGraybox);
        const { helixAdminApiKeys = {} } = this.appConfig.getConfig();
        return helixAdminApiKeys[repo];
    }

    /**
     * Checks if the preview is enabled for the main or graybox site
     * @param {*} isGraybox isGraybox flag
     * @returns true if preview is enabled
     */
    canBulkPreview(isGraybox = false) {
        const repo = this.getRepo(isGraybox);
        const { enablePreview } = this.appConfig.getConfig();
        const repoRegexArr = enablePreview.map((ps) => new RegExp(`^${ps}$`));
        return true && repoRegexArr.find((rx) => rx.test(repo));
    }

    /**
     * Trigger a preview of the files using the franklin bulk api. Franklin bulk api returns a job id/name which is used to
     * check back the completion of the preview.
     * @param {*} paths Paths of the files that needs to be previewed.
     * @param {*} operation Preivew
     * @param {*} grayboxExperienceName Graybox Experience Name
     * @param {*} isGraybox isGraybox flag
     * @param {*} retryAttempt Iteration number of the retry attempt (Default = 1)
     * @returns List of path with preview/pubish status e.g. [{path:'/draft/file1', success: true}..]
     */
    async bulkPreview(paths, operation, grayboxExperienceName, isGraybox = false, retryAttempt = 1) {
        let prevStatuses = paths.filter((p) => p).map((path) => (
            {
                success: false, path, fileName: '', resourcePath: '', responseCode: ''
            }
        ));
        if (!prevStatuses.length) {
            return prevStatuses;
        }
        try {
            const repo = this.getRepo(isGraybox);
            const urlInfo = this.appConfig.getUrlInfo();
            let experienceName = grayboxExperienceName || '';
            experienceName = isGraybox ? `${experienceName}/` : '';

            const bulkUrl = `https://admin.hlx.page/${operation}/${urlInfo.getOwner()}/${repo}/${urlInfo.getBranch()}/${experienceName}*`;
            const options = {
                method: 'POST',
                body: JSON.stringify({ forceUpdate: true, paths }),
                headers: new fetch.Headers([['Accept', 'application/json'], ['Content-Type', 'application/json']])
            };

            const helixAdminApiKey = this.getAdminApiKey(isGraybox);
            if (helixAdminApiKey) {
                options.headers.append('Authorization', `token ${helixAdminApiKey}`);
            }

            const response = await fetch(bulkUrl, options);
            logger.info(`${operation} call response ${response.status} for ${bulkUrl}`);
            if (!response.ok && !AUTH_ERRORS.includes(response.status) && retryAttempt <= MAX_RETRIES) {
                await delay(RETRY_DELAY * 1000);
                prevStatuses = await this.bulkPreview(paths, operation, grayboxExperienceName, isGraybox, retryAttempt + 1);
            } else if (response.ok) {
                // Get job details
                const jobResp = await response.json();
                const jobName = jobResp.job?.name;
                if (jobName) {
                    const jobStatus = await this.bulkJobStatus(jobName, operation, repo);
                    prevStatuses.forEach((e) => {
                        logger.info(`Job details : ${jobName} / ${jobResp.messageId} / ${jobResp.job?.state}`);
                        if (jobStatus[e.path]?.success) {
                            e.success = true;
                            e.fileName = jobStatus[e.path]?.fileName;
                            e.resourcePath = jobStatus[e.path]?.resourcePath;

                            e.mdPath = `https://${urlInfo.getBranch()}--${this.getRepo(isGraybox)}--${urlInfo.getOwner()}.aem.page${e.resourcePath}`;
                        }
                        e.responseCode = jobStatus[e.path]?.responseCode;
                    });
                }
            }
        } catch (error) {
            logger.info(`Error in bulk ${operation} status: ${error.message}`);
            prevStatuses.forEach((e) => {
                e.success = false;
            });
        }
        return prevStatuses;
    }

    /**
     * Checks the preview/publish job status and returns the file statuses
     * @param {*} jobName Bulk job to be checked
     * @param {*} operation Job Type (preview/publish)
     * @param {*} repo Repo for which the job was triggered
     * @param {*} bulkPreviewStatus Accumulated status of the files (default is empty)
     * @param {*} retryAttempt Iteration number of the retry attempt (Default = 1)
     * @returns List of path with preview/pubish status e.g. ['/draft/file1': {success: true}..]
     */
    async bulkJobStatus(jobName, operation, repo, bulkPreviewStatus = {}, retryAttempt = 1) {
        try {
            const { helixAdminApiKeys } = this.appConfig.getConfig();
            const options = {};
            if (helixAdminApiKeys && helixAdminApiKeys[repo]) {
                options.headers = new fetch.Headers();
                options.headers.append('Authorization', `token ${helixAdminApiKeys[repo]}`);
            }
            const bulkOperation = operation === LIVE ? PUBLISH : operation;
            const urlInfo = this.appConfig.getUrlInfo();
            const statusUrl = `https://admin.hlx.page/job/${urlInfo.getOwner()}/${repo}/${urlInfo.getBranch()}/${bulkOperation}/${jobName}/details`;
            const response = await fetch(statusUrl, options);
            if (!response.ok && retryAttempt <= this.appConfig.getConfig().maxBulkPreviewChecks) {
                await delay(this.appConfig.getConfig().bulkPreviewCheckInterval * 1000);
                await this.bulkJobStatus(jobName, operation, repo, bulkPreviewStatus, retryAttempt + 1);
            } else if (response.ok) {
                const jobStatusJson = await response.json();
                jobStatusJson.data?.resources?.forEach((rs) => {
                    bulkPreviewStatus[rs.path] = {
                        success: JOB_STATUS_CODES.includes(rs.status), fileName: rs?.source?.name, resourcePath: rs?.resourcePath, responseCode: rs.status
                    };
                });
                if (jobStatusJson.state !== 'stopped' && !jobStatusJson.cancelled &&
                    retryAttempt <= this.appConfig.getConfig().maxBulkPreviewChecks) {
                    await delay(this.appConfig.getConfig().bulkPreviewCheckInterval * 1000);
                    await this.bulkJobStatus(jobName, operation, repo, bulkPreviewStatus, retryAttempt + 1);
                }
            }
        } catch (error) {
            logger.info(`Error in checking status: ${error.message}`);
        }
        return bulkPreviewStatus;
    }
}

export default HelixUtils;
