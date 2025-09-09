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

import fetch from 'node-fetch';
import AppConfig from '../appConfig.js';
import Sharepoint from '../sharepoint.js';
import { getAioLogger, toUTCStr } from '../utils.js';
import initFilesWrapper from './filesWrapper.js';
import HelixUtils from '../helixUtils.js';
import { writeProjectStatus } from './statusUtils.js';

const logger = getAioLogger();
const BATCH_REQUEST_BULK_COPY = 200;

async function main(params) {
    logger.info('Graybox Bulk Copy Worker triggered');
    
    // Debug: Log what parameters the worker received
    logger.info(`Bulk Copy Worker received params: ${JSON.stringify(Object.keys(params))}`);
    logger.info(`Worker received - adminPageUri: ${params.adminPageUri || 'MISSING'}, spToken: ${params.spToken ? 'PRESENT' : 'MISSING'}, driveId: ${params.driveId || 'MISSING'}`);
    
    const appConfig = new AppConfig(params);
    const {
        driveId, adminPageUri, rootFolder, gbRootFolder, promoteIgnorePaths, experienceName, projectExcelPath
    } = appConfig.getPayload();

    const sharepoint = new Sharepoint(appConfig);
    const helixUtils = new HelixUtils(appConfig);
    const filesWrapper = await initFilesWrapper(logger);
    /* const {
        gbRootFolder, experienceName, projectExcelPath
    } = appConfig.getPayload(); */
    
            // Extract sourcePaths directly from params
    const { sourcePaths } = params;
    
    // Validate sourcePaths
    if (!sourcePaths) {
        throw new Error('sourcePaths parameter is missing');
    }
    
    if (!Array.isArray(sourcePaths) && typeof sourcePaths !== 'string') {
        throw new Error(`sourcePaths must be an array or string, got: ${typeof sourcePaths}`);
    }
    
    // Convert to array if it's a string
    const sourcePathsArray = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
    
    logger.info(`Received sourcePaths: ${JSON.stringify(sourcePathsArray)}`);
    logger.info(`First item type: ${typeof sourcePathsArray[0]}`);
    logger.info(`First item: ${JSON.stringify(sourcePathsArray[0])}`);
    
    const project = `${gbRootFolder}/${experienceName}`;
    
    try {
        logger.info('Starting bulk copy worker with fragment discovery');

        // Initialize bulk copy status
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, {
            status: 'initiated',
            timestamp: toUTCStr(new Date()),
            statuses: []
        });

        // Create inputParams exactly like initiate-promote-worker.js does
        const inputParams = {};
        inputParams.driveId = driveId;
        inputParams.rootFolder = rootFolder;
        inputParams.gbRootFolder = gbRootFolder;
        inputParams.projectExcelPath = projectExcelPath;
        inputParams.experienceName = experienceName;
        inputParams.adminPageUri = adminPageUri;
        inputParams.promoteIgnorePaths = promoteIgnorePaths;
        
        // CRITICAL: Include spToken from the original params - this was missing!
        inputParams.spToken = params.spToken;
        
        // Also include other important params that might be needed
        inputParams.draftsOnly = params.draftsOnly;
        inputParams.ignoreUserCheck = `${appConfig.ignoreUserCheck()}`;

        // Create Project Status JSON exactly like initiate-promote-worker.js
        const projectStatusJson = {
            status: 'initiated',
            params: inputParams,
            statuses: [
                {
                    stepName: 'initiated',
                    step: 'Bulk copy fragment discovery initiated',
                    timestamp: toUTCStr(new Date()),
                    files: []
                }
            ]
        };
        
        // Debug: Log what we're writing to the status file
        logger.info(`Writing project status file with params: ${JSON.stringify(Object.keys(projectStatusJson.params))}`);
        logger.info(`Status file will contain - adminPageUri: ${projectStatusJson.params.adminPageUri || 'MISSING'}, spToken: ${projectStatusJson.params.spToken ? 'PRESENT' : 'MISSING'}, driveId: ${projectStatusJson.params.driveId || 'MISSING'}`);
        
        await filesWrapper.writeFile(`graybox_promote${project}/status.json`, projectStatusJson);

        // Initialize empty error files to prevent file not found errors
        await filesWrapper.writeFile(`graybox_promote${project}/copy_errors.json`, []);
        await filesWrapper.writeFile(`graybox_promote${project}/copied_paths.json`, {});

        // Note: Project queue entry is now created in bulk-copy.js before invoking this worker
        logger.info('Project queue entry should already exist from bulk-copy.js invocation');

        // Helper function to get mdPath for pages from originalUrl
        const getPageMdPath = (pathInfo) => {
            // Use originalUrl to construct mdPath by appending .md
            if (pathInfo && pathInfo.originalUrl) {
                return `${pathInfo.originalUrl}.md`;
            }
            return null;
        };

        // Process source paths to discover fragments
        const processedPaths = await processSourcePaths(sourcePathsArray, helixUtils, experienceName, appConfig, getPageMdPath);
        
        // Separate files with and without fragments
        const filesWithFragments = processedPaths.filter(path => path.hasFragments);
        const filesWithoutFragments = processedPaths.filter(path => !path.hasFragments);

        // Also categorize individual fragments based on whether they have nested fragments
        const fragmentsWithNestedFragments = [];
        const fragmentsWithoutNestedFragments = [];
        
        // Process all fragments from all pages
        for (const page of processedPaths) {
            if (page.fragments && page.fragments.length > 0) {
                for (const fragment of page.fragments) {
                    if (fragment.nestedFragments && fragment.nestedFragments.length > 0) {
                        // This fragment has nested fragments
                        const fragmentSourcePath = convertFragmentUrlToSharePointPath(fragment.fragmentPath);
                        fragmentsWithNestedFragments.push({
                            fragmentPath: fragment.fragmentPath,
                            sourcePath: fragmentSourcePath,
                            nestedFragmentCount: fragment.nestedFragments.length,
                            nestedFragments: fragment.nestedFragments,
                            sourcePage: page.sourcePath,
                            type: 'fragment_with_nested',
                            mdPath: `${fragment.fragmentPath}.md`
                        });
                        
                        // Also analyze each nested fragment to see if it has its own nested fragments
                        for (const nestedFragment of fragment.nestedFragments) {
                            // Check if this nested fragment itself contains fragments
                            const nestedFragmentContent = await fetchPageContent(nestedFragment.fragmentPath, helixUtils);
                            if (nestedFragmentContent) {
                                const nestedFragmentMatches = nestedFragmentContent.match(/<https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*>/g) || [];
                                
                                if (nestedFragmentMatches.length > 0) {
                                    // This nested fragment has its own nested fragments
                                    const nestedFragmentSourcePath = convertFragmentUrlToSharePointPath(nestedFragment.fragmentPath);
                                    fragmentsWithNestedFragments.push({
                                        fragmentPath: nestedFragment.fragmentPath,
                                        sourcePath: nestedFragmentSourcePath,
                                        nestedFragmentCount: nestedFragmentMatches.length,
                                        nestedFragments: nestedFragmentMatches.map(match => ({
                                            fragmentPath: match.slice(1, -1),
                                            status: 200,
                                            availability: 'Available'
                                        })),
                                        sourcePage: page.sourcePath,
                                        type: 'nested_fragment_with_nested',
                                        mdPath: `${nestedFragment.fragmentPath}.md`
                                    });
                                } else {
                                    // This nested fragment has no nested fragments
                                    const nestedFragmentSourcePath = convertFragmentUrlToSharePointPath(nestedFragment.fragmentPath);
                                    fragmentsWithoutNestedFragments.push({
                                        fragmentPath: nestedFragment.fragmentPath,
                                        sourcePath: nestedFragmentSourcePath,
                                        nestedFragmentCount: 0,
                                        nestedFragments: [],
                                        sourcePage: page.sourcePath,
                                        type: 'nested_fragment_no_nested',
                                        mdPath: `${nestedFragment.fragmentPath}.md`
                                    });
                                }
                            } else {
                                // Could not fetch content, assume no nested fragments
                                const nestedFragmentSourcePath = convertFragmentUrlToSharePointPath(nestedFragment.fragmentPath);
                                fragmentsWithoutNestedFragments.push({
                                    fragmentPath: nestedFragment.fragmentPath,
                                    sourcePath: nestedFragmentSourcePath,
                                    nestedFragmentCount: 0,
                                    nestedFragments: [],
                                    sourcePage: page.sourcePath,
                                    type: 'nested_fragment_no_nested',
                                    mdPath: `${nestedFragment.fragmentPath}.md`
                                });
                            }
                        }
                    } else {
                        // This fragment has no nested fragments
                        const fragmentSourcePath = convertFragmentUrlToSharePointPath(fragment.fragmentPath);
                        fragmentsWithoutNestedFragments.push({
                            fragmentPath: fragment.fragmentPath,
                            sourcePath: fragmentSourcePath,
                            nestedFragmentCount: 0,
                            nestedFragments: [],
                            sourcePage: page.sourcePath,
                            type: 'fragment_no_nested',
                            mdPath: `${fragment.fragmentPath}.md`
                        });
                    }
                }
            }
        }

        // Create consolidated fragment categorization file with flags
        const consolidatedFragmentData = {
            summary: {
                totalFiles: processedPaths.length,
                filesWithFragments: filesWithFragments.length,
                filesWithoutFragments: filesWithoutFragments.length,
                totalFragments: fragmentsWithNestedFragments.length + fragmentsWithoutNestedFragments.length,
                fragmentsWithNested: fragmentsWithNestedFragments.length,
                fragmentsWithoutNested: fragmentsWithoutNestedFragments.length,
                batchesCreated: 0, // Will be updated below
                timestamp: toUTCStr(new Date())
            },
            pages: {
                withFragments: filesWithFragments.map(file => ({
                    ...file,
                    category: 'page_with_fragments',
                    processingPriority: 'high'
                })),
                withoutFragments: filesWithoutFragments.map(file => ({
                    ...file,
                    category: 'page_no_fragments',
                    processingPriority: 'low'
                }))
            },
            fragments: {
                withNested: fragmentsWithNestedFragments.map(fragment => ({
                    ...fragment,
                    category: 'fragment_with_nested',
                    processingPriority: 'high',
                    requiresRecursiveProcessing: true
                })),
                withoutNested: fragmentsWithoutNestedFragments.map(fragment => ({
                    ...fragment,
                    category: 'fragment_no_nested',
                    processingPriority: 'medium',
                    requiresRecursiveProcessing: false
                }))
            }
        };

        // Create the consolidated file
        await filesWrapper.writeFile(`graybox_promote${project}/consolidated-fragment-data.json`, consolidatedFragmentData);

        // Create two sets of batches based on processing requirements
        const batchStatusJson = {};
        const bulkCopyBatchesJson = {};
        
        // Create bulk-copy-batches folder for all batch-related files
        const bulkCopyBatchesFolder = `graybox_promote${project}/bulk-copy-batches`;
        
        // Separate files into two categories for different processing approaches
        const filesNeedingProcessing = [
            ...filesWithFragments,  // Pages with fragments
            ...fragmentsWithNestedFragments  // Fragments with nested fragments
        ];
        
        const filesNotNeedingProcessing = [
            ...filesWithoutFragments,  // Pages without fragments
            ...fragmentsWithoutNestedFragments  // Fragments without nested fragments
        ];
        
        // Create batches for files that NEED processing (high priority)
        const processingBatchesArray = [];
        const processingWritePromises = [];
        
        for (let i = 0, batchCounter = 1; i < filesNeedingProcessing.length; i += BATCH_REQUEST_BULK_COPY, batchCounter += 1) {
            const arrayChunk = filesNeedingProcessing.slice(i, i + BATCH_REQUEST_BULK_COPY);
            processingBatchesArray.push(arrayChunk);
            const batchName = `processing_batch_${batchCounter}`;
            batchStatusJson[`${batchName}`] = 'initiated';

            // Write processing batch files
            processingWritePromises.push(filesWrapper.writeFile(`${bulkCopyBatchesFolder}/${batchName}.json`, arrayChunk));
            bulkCopyBatchesJson[batchName] = arrayChunk;
        }
        
        // Create batches for files that DON'T need processing (low priority)
        const nonProcessingBatchesArray = [];
        const nonProcessingWritePromises = [];
        
        for (let i = 0, batchCounter = 1; i < filesNotNeedingProcessing.length; i += BATCH_REQUEST_BULK_COPY, batchCounter += 1) {
            const arrayChunk = filesNotNeedingProcessing.slice(i, i + BATCH_REQUEST_BULK_COPY);
            nonProcessingBatchesArray.push(arrayChunk);
            const batchName = `non_processing_batch_${batchCounter}`;
            batchStatusJson[`${batchName}`] = 'initiated';

            // Write non-processing batch files
            nonProcessingWritePromises.push(filesWrapper.writeFile(`${bulkCopyBatchesFolder}/${batchName}.json`, arrayChunk));
            bulkCopyBatchesJson[batchName] = arrayChunk;
        }
        
        // Combine all write promises
        const writeBatchJsonPromises = [...processingWritePromises, ...nonProcessingWritePromises];
        
        // Total batches created
        const totalBatches = processingBatchesArray.length + nonProcessingBatchesArray.length;

        await Promise.all(writeBatchJsonPromises);

        // Update consolidated data with batch information
        consolidatedFragmentData.summary.batchesCreated = totalBatches;
        consolidatedFragmentData.batches = {
            batchStatus: batchStatusJson,
            batchFiles: bulkCopyBatchesJson,
            batchCount: totalBatches,
            batchFolder: bulkCopyBatchesFolder,
            processingBatches: {
                count: processingBatchesArray.length,
                batchNames: processingBatchesArray.map((_, index) => `processing_batch_${index + 1}.json`),
                description: 'Files/pages/fragments that NEED processing (have fragments or nested fragments)',
                priority: 'high'
            },
            nonProcessingBatches: {
                count: nonProcessingBatchesArray.length,
                batchNames: nonProcessingBatchesArray.map((_, index) => `non_processing_batch_${index + 1}.json`),
                description: 'Files/pages/fragments that DON\'T need processing (no fragments or nested fragments)',
                priority: 'low'
            }
        };

        // Update status files
        const finalStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
        finalStatus.status = 'fragment_discovery_completed';
        finalStatus.statuses.push({
            status: 'fragment_discovery_completed',
            timestamp: toUTCStr(new Date()),
            totalFiles: processedPaths.length,
            filesWithFragments: filesWithFragments.length,
            filesWithoutFragments: filesWithoutFragments.length,
            batchesCreated: totalBatches,
            processingBatches: processingBatchesArray.length,
            nonProcessingBatches: nonProcessingBatchesArray.length
        });
        
        await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, finalStatus);

        // Also update the main project status.json file to reflect completion
        const mainProjectStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/status.json`);
        mainProjectStatus.status = 'fragment_discovery_completed';
        mainProjectStatus.statuses.push({
            stepName: 'fragment_discovery_completed',
            step: 'Fragment discovery completed successfully',
            timestamp: toUTCStr(new Date()),
            files: processedPaths.map(p => p.sourcePath),
            totalFiles: processedPaths.length,
            filesWithFragments: filesWithFragments.length,
            filesWithoutFragments: filesWithoutFragments.length,
            batchesCreated: totalBatches
        });
        
        await filesWrapper.writeFile(`graybox_promote${project}/status.json`, mainProjectStatus);

        // Update project status in bulk copy project queue
        const bulkCopyProjectQueuePath2 = 'graybox_promote/bulk_copy_project_queue.json';
        const bulkCopyProjectQueue2 = await filesWrapper.readFileIntoObject(bulkCopyProjectQueuePath2);
        const projectIndex = bulkCopyProjectQueue2.findIndex(p => p.projectPath === project);
        if (projectIndex !== -1) {
            bulkCopyProjectQueue2[projectIndex].status = 'fragment_discovery_completed';
            await filesWrapper.writeFile(bulkCopyProjectQueuePath2, bulkCopyProjectQueue2);
        }
        await filesWrapper.writeFile(`${bulkCopyBatchesFolder}/bulk_copy_batches.json`, bulkCopyBatchesJson);
        await filesWrapper.writeFile(`${bulkCopyBatchesFolder}/batch_status.json`, batchStatusJson);
        
        // Update the consolidated file with final data
        await filesWrapper.writeFile(`graybox_promote${project}/consolidated-fragment-data.json`, consolidatedFragmentData);

        // Update Excel with summary
        const excelUpdates = [
            ['Bulk Copy Fragment Discovery Completed', toUTCStr(new Date()), '', ''],
            [`Total files processed: ${processedPaths.length}`, toUTCStr(new Date()), '', ''],
            [`Files with fragments: ${filesWithFragments.length}`, toUTCStr(new Date()), '', ''],
            [`Files without fragments: ${filesWithoutFragments.length}`, toUTCStr(new Date()), '', ''],
            [`Total fragments discovered: ${fragmentsWithNestedFragments.length + fragmentsWithoutNestedFragments.length}`, toUTCStr(new Date()), '', ''],
            [`Fragments with nested fragments: ${fragmentsWithNestedFragments.length}`, toUTCStr(new Date()), '', ''],
            [`Fragments without nested fragments: ${fragmentsWithoutNestedFragments.length}`, toUTCStr(new Date()), '', ''],
            [`Total batches created: ${totalBatches}`, toUTCStr(new Date()), '', ''],
            [`Processing batches (high priority): ${processingBatchesArray.length}`, toUTCStr(new Date()), '', ''],
            [`Non-processing batches (low priority): ${nonProcessingBatchesArray.length}`, toUTCStr(new Date()), '', '']
        ];
        
        await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelUpdates);

        logger.info(`Bulk copy fragment discovery completed. Total: ${processedPaths.length}, With fragments: ${filesWithFragments.length}, Without fragments: ${filesWithoutFragments.length}`);
        logger.info(`Fragment categorization: ${fragmentsWithNestedFragments.length} with nested, ${fragmentsWithoutNestedFragments.length} without nested`);
        logger.info(`Enhanced analysis: Now analyzing nested fragments for their own fragment content`);
        logger.info(`Consolidated data written to: consolidated-fragment-data.json`);
        logger.info(`Batch organization: ${processingBatchesArray.length} processing batches (high priority), ${nonProcessingBatchesArray.length} non-processing batches (low priority)`);

        return {
            code: 200,
            body: {
                message: 'Bulk copy fragment discovery completed',
                totalFiles: processedPaths.length,
                filesWithFragments: filesWithFragments.length,
                filesWithoutFragments: filesWithoutFragments.length,
                totalBatches: totalBatches,
                processingBatches: processingBatchesArray.length,
                nonProcessingBatches: nonProcessingBatchesArray.length
            }
        };

    } catch (error) {
        logger.error(`Error in bulk copy worker: ${error.message}`);

        try {
            const errorStatus = await filesWrapper.readFileIntoObject(`graybox_promote${project}/bulk-copy-status.json`);
            errorStatus.status = 'error';
            errorStatus.statuses.push({
                timestamp: toUTCStr(new Date()),
                status: 'error',
                error: error.message
            });
            await filesWrapper.writeFile(`graybox_promote${project}/bulk-copy-status.json`, errorStatus);

            const excelUpdates = [['Bulk Copy Fragment Discovery Failed', toUTCStr(new Date()), error.message, '']];
            await sharepoint.updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelUpdates);
        } catch (statusError) {
            logger.error(`Failed to update status file: ${statusError.message}`);
        }

        return {
            code: 500,
            body: {
                error: 'Fragment discovery failed',
                message: error.message
            }
        };
    }
}

/**
 * Convert AEM fragment URL to SharePoint path
 * Similar to the logic in bulk-copy.js
 */
function convertFragmentUrlToSharePointPath(fragmentUrl) {
    if (!fragmentUrl || !fragmentUrl.includes('aem.page')) {
        return null;
    }
    
    const regex = /aem\.page(\/.*?)(?:$|\s)|aem\.page\/(.*?)(?:\/[^/]+(?:\.\w+)?)?$/g;
    const matches = [...fragmentUrl.matchAll(regex)];
    if (matches.length > 0) {
        const fullPath = matches[0][1] || matches[0][2];
        if (fullPath) {
            if (!fullPath.includes('.')) {
                return `${fullPath}.docx`;
            }
            return fullPath;
        }
    }
    
    return null;
}

/**
 * Process source paths to discover fragments and nested fragments
 */
async function processSourcePaths(sourcePaths, helixUtils, experienceName, appConfig, getPageMdPath) {
    const processedPaths = [];
    const processedUrls = new Set();

    for (const pathInfo of sourcePaths) {
        const sourcePath = typeof pathInfo === 'string' ? pathInfo : pathInfo.sourcePath;
        const originalUrl = pathInfo.originalUrl || sourcePath; // Use originalUrl if available, fallback to sourcePath
        
        if (processedUrls.has(sourcePath)) {
            continue;
        }
        processedUrls.add(sourcePath);

        try {
            logger.info(`Processing source path: ${sourcePath}`);
            logger.info(`Original URL for fragment discovery: ${originalUrl}`);
            
            // Check if it's an AEM page URL using the original URL
            if (originalUrl.includes('aem.page')) {
                logger.info(`🔍 Starting fragment discovery for AEM page: ${originalUrl}`);
                const fragments = await discoverFragments(originalUrl, helixUtils);
                logger.info(`🎯 Fragment discovery completed. Found ${fragments.length} fragments`);
                
                processedPaths.push({
                    sourcePath,
                    destinationPath: pathInfo.destinationPath || `/${experienceName}${sourcePath}`,
                    hasFragments: fragments.length > 0,
                    fragments: fragments,
                    fragmentCount: fragments.length,
                    type: 'page',
                    mdPath: getPageMdPath(pathInfo)
                });
            } else {
                // Non-AEM page, no fragments to discover
                processedPaths.push({
                    sourcePath,
                    destinationPath: pathInfo.destinationPath || `/${experienceName}${sourcePath}`,
                    hasFragments: false,
                    fragments: [],
                    fragmentCount: 0,
                    type: 'file',
                    mdPath: getPageMdPath(pathInfo)
                });
            }
        } catch (error) {
            logger.error(`Error processing path ${sourcePath}: ${error.message}`);
            processedPaths.push({
                sourcePath,
                destinationPath: pathInfo.destinationPath || `/${experienceName}${sourcePath}`,
                hasFragments: false,
                fragments: [],
                fragmentCount: 0,
                type: 'error',
                error: error.message,
                mdPath: getPageMdPath(pathInfo)
            });
        }
    }

    return processedPaths;
}

/**
 * Discover fragments and nested fragments for a given AEM page URL
 * Using the same logic as find-fragments.js
 */
async function discoverFragments(pageUrl, helixUtils) {
    const fragments = [];
    const discoveredFragments = new Set();
    
    try {
        // Get the page content
        const pageContent = await fetchPageContent(pageUrl, helixUtils);
        if (!pageContent) {
            return fragments;
        }

        // Find fragment links in content using angle bracket format
        // Pattern matches: <https://...aem.page/.../fragments/...>
        const fragmentMatches = pageContent.match(/<https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*>/g) || [];
        const pathFragmentLinks = [];

        logger.info(`Found ${fragmentMatches.length} fragment links in ${pageUrl}`);

        // Process each fragment match
        for (const match of fragmentMatches) {
            const cleanUrl = match.slice(1, -1);
            
            if (discoveredFragments.has(cleanUrl)) {
                continue;
            }
            discoveredFragments.add(cleanUrl);

            try {
                // Check if fragment exists
                const fragmentContent = await fetchPageContent(cleanUrl, helixUtils);
                const fragmentStatus = fragmentContent ? 200 : 404;
                
                // Discover nested fragments if this fragment exists
                let nestedFragments = [];
                if (fragmentStatus === 200) {
                    nestedFragments = await discoverNestedFragments(fragmentContent, discoveredFragments, helixUtils);
                }
                
                fragments.push({
                    fragmentPath: cleanUrl,
                    status: fragmentStatus,
                    availability: fragmentStatus === 200 ? 'Available' : 'Missing',
                    nestedFragments: nestedFragments,
                    nestedFragmentCount: nestedFragments.length
                });
            } catch (error) {
                logger.error(`Error processing fragment ${cleanUrl}: ${error.message}`);
                fragments.push({
                    fragmentPath: cleanUrl,
                    status: 500,
                    availability: 'Server Error',
                    nestedFragments: [],
                    nestedFragmentCount: 0,
                    error: error.message
                });
            }
        }
    } catch (error) {
        logger.error(`Error discovering fragments for ${pageUrl}: ${error.message}`);
    }

    return fragments;
}

/**
 * Discover nested fragments within a fragment's content
 */
async function discoverNestedFragments(content, discoveredFragments, helixUtils) {
    if (!content) {
        return [];
    }

    const nestedFragments = [];
    const fragmentMatches = content.match(/<https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*>/g) || [];
    
    for (const match of fragmentMatches) {
        const cleanUrl = match.slice(1, -1);
        
        if (discoveredFragments.has(cleanUrl)) {
            continue;
        }
        discoveredFragments.add(cleanUrl);

        try {
            const fragmentContent = await fetchPageContent(cleanUrl, helixUtils);
            nestedFragments.push({
                fragmentPath: cleanUrl,
                status: fragmentContent ? 200 : 404,
                availability: fragmentContent ? 'Available' : 'Missing'
            });
        } catch (error) {
            logger.error(`Error processing nested fragment ${cleanUrl}: ${error.message}`);
            nestedFragments.push({
                fragmentPath: cleanUrl,
                status: 500,
                availability: 'Server Error',
                error: error.message
            });
        }
    }

    return nestedFragments;
}

/**
 * Fetch content from a URL
 */
async function fetchPageContent(url, helixUtils) {
    try {
        const options = {};
        // Add authentication if needed
        const adminApiKey = helixUtils.getAdminApiKey(false);
        if (adminApiKey) {
            options.headers = new fetch.Headers();
            options.headers.append('Authorization', `token ${adminApiKey}`);
        }

        let urlToFetch = url;
        if (!urlToFetch.endsWith('.md')) {
            urlToFetch = urlToFetch + '.md';
        }

        logger.info(`📥 Fetching content from: ${urlToFetch}`);
        const response = await fetch(urlToFetch, options);
        logger.info(`📡 Response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
            const content = await response.text();
            logger.info(`📄 Content length: ${content.length} characters`);
            logger.info(`📄 Content preview: ${content.substring(0, 200)}...`);
            return content;
        } else {
            logger.error(`❌ Failed to fetch content. Status: ${response.status} ${response.statusText}`);
            return null;
        }
    } catch (error) {
        logger.error(`❌ Error fetching content from ${url}: ${error.message}`);
        return null;
    }
}

export { main };
