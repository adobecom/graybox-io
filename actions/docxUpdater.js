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
import parseMarkdown from 'milo-parse-markdown';
import { mdast2docx } from 'milo-md2docx';
import { getAioLogger } from './utils.js';
import DEFAULT_STYLES from './defaultstyles.xml.js';

const gbStyleExpression = 'gb-'; // graybox style expression. need to revisit if there are any more styles to be considered.
const emptyString = '';
const grayboxStylesRegex = /gb-[a-zA-Z0-9,._-]*/g;
const gbDomainSuffix = '-graybox';
const logger = getAioLogger();
let firstGtRows = [];

/**
 * Updates a document based on the provided Markdown file path, experience name, and options.
 * @param {string} mdPath - The path to the Markdown file.
 * @param {string} experienceName - The name of the experience.
 * @param {object} options - The options for fetching the Markdown file.
 * @returns {Promise} - A promise that resolves to the generated Docx file.
 */
async function updateDocument(content, expName, hlxAdminApiKey) {
    firstGtRows = [];
    let docx;
    const state = { content: { data: content }, log: '' };
    await parseMarkdown(state);
    const { mdast } = state.content;
    const mdastChildren = mdast.children;

    // Transform Graybox Links
    updateExperienceNameFromLinks(mdastChildren, expName);

    // Remove Graybox Styles
    iterateGtRowsToReplaceStyles();

    // Delete all Graybox Blocks in the document
    iterateGtRowsToDeleteGrayboxBlock(mdastChildren);

    try {
        // generated docx file from updated mdast
        docx = await generateDocxFromMdast(mdast, hlxAdminApiKey);
    } catch (err) {
        // Mostly bad string ignored
        logger.debug(`Error while generating docxfromdast ${err}`);
    }

    return docx;
}

/**
 * Replace all relative link references in the given mdast with the provided experience name and graybox style pattern.
 * @param {Array} mdast - The mdast to be updated.
 * @param {string} expName - The name of the experience.
 * @param {RegExp} grayboxStylePattern - The pattern to match graybox styles.
 */
const updateExperienceNameFromLinks = (mdast, expName) => {
    if (mdast) {
        mdast.forEach((child) => {
            if (child.type === 'gridTable') {
                firstGtRows.push(findFirstGtRowInNode(child));
            }
            // Process link URLs
            if (child.type === 'link' && child.url && (child.url.includes(expName) || child.url.includes(gbDomainSuffix))) {
                child.url = child.url.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
            }

            // Process link text content that contains graybox URLs
            if (child.type === 'link' && child.children) {
                child.children.forEach((textNode) => {
                    if (textNode.type === 'text' && textNode.value &&
                        (textNode.value.includes(gbDomainSuffix) || textNode.value.includes(expName))) {
                        textNode.value = textNode.value.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
                    }
                });
            }

            if (child.children) {
                updateExperienceNameFromLinks(child.children, expName);
            }
        });
    }
};

/**
 * Helper function, iterates through the firstGtRows array and replaces graybox styles for each row.
 */
const iterateGtRowsToReplaceStyles = () => {
    try {
        firstGtRows.forEach((gtRow) => {
            if (gtRow && gtRow.children) {
                replaceGrayboxStyles(gtRow);
            }
        });
    } catch (err) {
        // Mostly bad string ignored
        logger.debug(`Error while iterating GTRows to replaces styles ${err}`);
    }
};

/**
 * Replaces all graybox styles from blocks and text.
 *
 * @param {object} node - The node to process.
 * @returns {void}
 */
const replaceGrayboxStyles = (node) => {
    // replace all graybox styles from blocks and text
    if (node && node.type === 'text' && node.value && node.value.includes(gbStyleExpression)) {
        node.value = node.value.replace(grayboxStylesRegex, emptyString)
            .replace('()', emptyString).replace(', )', ')');
        return;
    }
    if (node.children) {
        node.children.forEach((child) => {
            replaceGrayboxStyles(child);
        });
    }
};

/**
 * Finds the first 'gtRow' node in the given node or its children.
 * @param {Object} node - The node to search in.
 * @returns {Object|undefined} - The first 'gtRow' node found, or undefined if not found.
 */
function findFirstGtRowInNode(node) {
    if (node && node.type === 'gtRow') {
        return node;
    }
    if (node.children) {
        const foundNodes = node.children.map(findFirstGtRowInNode).filter(Boolean);
        return foundNodes.length > 0 ? foundNodes[0] : null;
    }
    return null;
}

/**
 * Check if the content contains any fragment paths
 * @param {string} content - The content to check
 * @returns {boolean} - True if content contains any fragment paths
 */
function hasFragmentPathsInLink(content) {
    // Find fragment links in content - can be in angle bracket format or plain URLs
    // Pattern matches: <https://...aem.page/.../fragments/...> OR https://...aem.page/.../fragments/...
    if (!content) {
        logger.info(`In hasFragmentPathsInLink, content is null/undefined`);
        return false;
    }
    
    // Check for both angle bracket format and plain URL format
    const angleBracketMatches = content.match(/<https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*>/g);
    const plainUrlMatches = content.match(/https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*/g);
    
    const matches = angleBracketMatches || plainUrlMatches;
    logger.info(`In hasFragmentPathsInLink, checking content: ${content}, angle bracket matches: ${angleBracketMatches ? angleBracketMatches.length : 0}, plain URL matches: ${plainUrlMatches ? plainUrlMatches.length : 0}`);
    return matches;
}

const addExperienceNameToFragmentLinks = (mdast, expName, helixUtils) => {
    if (mdast) {
        const mainRepo = helixUtils.getRepo(false);
        const grayboxRepo = helixUtils.getRepo(true);
        
        logger.info(`In addExperienceNameToFragmentLinks, mainRepo: ${mainRepo}, grayboxRepo: ${grayboxRepo}, expName: ${expName}`);
        logger.info(`In addExperienceNameToFragmentLinks, looking for pattern: --${mainRepo}-- to replace with --${grayboxRepo}--`);
        logger.info(`In addExperienceNameToFragmentLinks, looking for pattern: /fragments/ to replace with /${expName}/fragments/`);

        mdast.forEach((child) => {
            if (child.type === 'gridTable') {
                firstGtRows.push(findFirstGtRowInNode(child));
            }
            
            // Process text nodes that might contain fragment URLs
            if (child.type === 'text' && child.value) {
                const fragmentMatches = hasFragmentPathsInLink(child.value);
                if (fragmentMatches) {
                    logger.info(`In addExperienceNameToFragmentLinks, found fragment in text: ${child.value}`);
                    // Transform fragment URLs in text content (both angle bracket and plain URL formats)
                    child.value = child.value.replace(
                        /(<)?https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*(>)?/g,
                        (match) => {
                            // Extract the URL part (remove angle brackets if present)
                            const url = match.replace(/[<>]/g, '');
                            
                            // Extract the path after the domain
                            const urlParts = url.split('.aem.page');
                            if (urlParts.length === 2) {
                                const domain = urlParts[0];
                                const path = urlParts[1];
                                
                                // Transform the URL: replace repo and restructure path
                                const newDomain = domain.replace(`--${mainRepo}--`, `--${grayboxRepo}--`);
                                
                                // Check if the experience name is already in the path to avoid duplication
                                let newPath;
                                if (path.startsWith(`/${expName}/`)) {
                                    // Experience name already exists in path, don't add it again
                                    newPath = path;
                                } else {
                                    // Add experience name to the beginning of the path
                                    newPath = `/${expName}${path}`;
                                }
                                
                                const transformed = `${newDomain}.aem.page${newPath}`;
                                
                                // Restore angle brackets if they were present
                                const result = match.startsWith('<') ? `<${transformed}>` : transformed;
                                logger.info(`In addExperienceNameToFragmentLinks, transformed: ${match} -> ${result}`);
                                return result;
                            } else {
                                // Fallback to original logic if URL structure is unexpected
                                const transformed = match
                                    .replace(`--${mainRepo}--`, `--${grayboxRepo}--`)
                                    .replace(/\/fragments\//, `/${expName}/fragments/`);
                                logger.info(`In addExperienceNameToFragmentLinks, transformed: ${match} -> ${transformed}`);
                                return transformed;
                            }
                        }
                    );
                }
            }
            
            // Process fragment link URLs
            if (child.type === 'link') {
                logger.info(`In addExperienceNameToFragmentLinks, found link with url: ${child.url}`);
                if (child.url && hasFragmentPathsInLink(child.url)) {
                    logger.info(`In addExperienceNameToFragmentLinks, processing fragment link: ${child.url}`);
                    const originalUrl = child.url;
                    // Extract the path after the domain
                    const urlParts = child.url.split('.aem.page');
                    if (urlParts.length === 2) {
                        const domain = urlParts[0];
                        const path = urlParts[1];
                        
                        // Transform the URL: replace repo and restructure path
                        const newDomain = domain.replace(`--${mainRepo}--`, `--${grayboxRepo}--`);
                        
                        // Check if the experience name is already in the path to avoid duplication
                        let newPath;
                        if (path.startsWith(`/${expName}/`)) {
                            // Experience name already exists in path, don't add it again
                            newPath = path;
                            logger.info(`In addExperienceNameToFragmentLinks, experience name already in path, not adding again`);
                        } else {
                            // Add experience name to the beginning of the path
                            newPath = `/${expName}${path}`;
                        }
                        
                        child.url = `${newDomain}.aem.page${newPath}`;
                        logger.info(`In addExperienceNameToFragmentLinks, URL transformation details:`);
                        logger.info(`  Original domain: ${domain}`);
                        logger.info(`  New domain: ${newDomain}`);
                        logger.info(`  Original path: ${path}`);
                        logger.info(`  Experience name: ${expName}`);
                        logger.info(`  New path: ${newPath}`);
                        logger.info(`  Final URL: ${child.url}`);
                    } else {
                        // Fallback to original logic if URL structure is unexpected
                        child.url = child.url
                            .replace(`--${mainRepo}--`, `--${grayboxRepo}--`)
                            .replace(/\/fragments\//, `/${expName}/fragments/`);
                    }
                    logger.info(`In addExperienceNameToFragmentLinks, transformed: ${originalUrl} -> ${child.url}`);
                } else {
                    logger.info(`In addExperienceNameToFragmentLinks, link does not contain fragments: ${child.url}`);
                }
            }

            // Process link text content that contains fragment URLs
            if (child.type === 'link' && child.children) {
                child.children.forEach((textNode) => {
                    if (textNode.type === 'text' && textNode.value) {
                        const fragmentMatches = hasFragmentPathsInLink(textNode.value);
                        if (fragmentMatches) {
                            textNode.value = textNode.value.replace(
                                /(<)?https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*(>)?/g,
                                (match) => {
                                    // Extract the URL part (remove angle brackets if present)
                                    const url = match.replace(/[<>]/g, '');
                                    
                                    // Extract the path after the domain
                                    const urlParts = url.split('.aem.page');
                                    if (urlParts.length === 2) {
                                        const domain = urlParts[0];
                                        const path = urlParts[1];
                                        
                                        // Transform the URL: replace repo and restructure path
                                        const newDomain = domain.replace(`--${mainRepo}--`, `--${grayboxRepo}--`);
                                        
                                        // Check if the experience name is already in the path to avoid duplication
                                        let newPath;
                                        if (path.startsWith(`/${expName}/`)) {
                                            // Experience name already exists in path, don't add it again
                                            newPath = path;
                                        } else {
                                            // Add experience name to the beginning of the path
                                            newPath = `/${expName}${path}`;
                                        }
                                        
                                        const transformed = `${newDomain}.aem.page${newPath}`;
                                        
                                        // Restore angle brackets if they were present
                                        return match.startsWith('<') ? `<${transformed}>` : transformed;
                                    } else {
                                        // Fallback to original logic if URL structure is unexpected
                                        return match
                                            .replace(`--${mainRepo}--`, `--${grayboxRepo}--`)
                                            .replace(/\/fragments\//, `/${expName}/fragments/`);
                                    }
                                }
                            );
                        }
                    }
                });
            }
            
            if (child.children) {
                addExperienceNameToFragmentLinks(child.children, expName, helixUtils);
            }
        });
    }
};

async function updateDocumentForBulkCopy(content, expName, hlxAdminApiKey, helixUtils) {
    firstGtRows = [];
    let docx;
    const state = { content: { data: content }, log: '' };
    await parseMarkdown(state);
    const { mdast } = state.content;
    const mdastChildren = mdast.children;

    logger.info(`In updateDocumentForBulkCopy, mdastChildren: ${JSON.stringify(mdastChildren)}`);
    // Add Experience Name to Graybox Fragment Links
    addExperienceNameToFragmentLinks(mdastChildren, expName, helixUtils);

    try {
        logger.info(`In updateDocumentForBulkCopy, before generating docx: ${JSON.stringify(mdast)}`);
        // generated docx file from updated mdast
        docx = await generateDocxFromMdast(mdast, hlxAdminApiKey);
        logger.info(`Afterwards In generateDocxFromMdast, docx size: ${docx.length || docx.byteLength} bytes`);
    } catch (err) {
        // Mostly bad string ignored
        logger.debug(`Error while generating docxfromdast ${err}`);
    }

    return docx;
}

/**
 * Checks if the given node is a graybox block.
 */
const isGbBlock = (gtRowNode) => {
    if (gtRowNode && gtRowNode.children) {
        // eslint-disable-next-line no-restricted-syntax
        for (const child of gtRowNode.children) {
            if (child.type === 'text' && child.value && child.value.includes('graybox')) {
                return true;
            }
            if (isGbBlock(child)) {
                return true;
            }
        }
    }
    return false;
};

/**
 * Find and delete all graybox blocks from the given mdast.
 */
const iterateGtRowsToDeleteGrayboxBlock = (mdastChildren) => {
    try {
        let blockCtr = -1;
        const gbBlockIndexes = [];
        mdastChildren.forEach((gtRow) => {
            // Increment for each block
            blockCtr += 1;
            const isGrayboxBlock = isGbBlock(gtRow);
            if (isGrayboxBlock) {
                gbBlockIndexes.push(blockCtr);
            }
        });
        let updatedGbIndexCtr = 0;
        gbBlockIndexes.forEach((index) => {
            mdastChildren.splice(index - updatedGbIndexCtr, 1);
            updatedGbIndexCtr += 1;
        });
    } catch (err) {
        logger.error(`Error while iterating GTRows to Delete Graybox Blocks ${err}`);
    }
};

/**
 * Generate a Docx file from the given mdast.
 * @param {Object} mdast - The mdast representing the document.
 * @returns {Promise} A promise that resolves to the generated Docx file.
 */
async function generateDocxFromMdast(mdast, hlxAdminApiKey) {
    const options = {
        stylesXML: DEFAULT_STYLES,
        auth: {
            authorization: `token ${hlxAdminApiKey}`,
        }
    };

    const docx = await mdast2docx(mdast, options);

    return docx;
}

export {
    updateDocument,
    updateDocumentForBulkCopy,
};
