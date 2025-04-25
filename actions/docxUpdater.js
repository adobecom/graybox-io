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
const parseMarkdown = require('milo-parse-markdown').default;
const util = require('util');
const xlsx = require('xlsx');
const { mdast2docx } = require('../node_modules/milo-md2docx/lib/index');
const { getAioLogger } = require('./utils');
const DEFAULT_STYLES = require('../defaultstyles.xml');

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
export async function updateDocument(content, expName, hlxAdminApiKey) {
    firstGtRows = [];
    let docx;

    const state = { content: { data: content }, log: '' };
    await parseMarkdown(state);
    const { mdast } = state.content;
    const mdastChildren = mdast.children;

    logger.info(`In updateDocument, before links are updated: ${util.inspect(mdast, { depth: null, maxArrayLength: null, colors: false })}`);

    // Transform Graybox Links
    updateExperienceNameFromLinks(mdastChildren, expName);

    logger.info(`In updateDocument, after links are updated: ${util.inspect(mdast, { depth: null, maxArrayLength: null, colors: false })}`);

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

    logger.info('Mdast to Docx file conversion done');
    return docx;
}

export async function updateExcel(content, expName, hlxAdminApiKey) {
    try {
        logger.info(`In updateExcel, content: ${util.inspect(content, { depth: null, maxArrayLength: null, colors: false })}`);
        logger.info(`In updateExcel, expName: ${expName}`);
        // Parse the content as JSON
        const jsonContent = typeof content === 'string' ? JSON.parse(content) : content;
        // Process all columns that might contain URLs
        if (jsonContent && jsonContent.columns) {
            for (let i = 0; i < jsonContent.columns.length; i++) {
                const column = jsonContent.columns[i];
                if (typeof column === 'string' && (column.includes(expName) || column.includes(gbDomainSuffix))) {
                    jsonContent.columns[i] = column.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
                    logger.info(`In updateExcel, column after replacement: ${jsonContent.columns[i]}`);
                }
            }
        }
        // Process all data rows that might contain URLs
        if (jsonContent && jsonContent.data && Array.isArray(jsonContent.data)) {
            jsonContent.data.forEach(row => {
                if (Array.isArray(row)) {
                    for (let i = 0; i < row.length; i++) {
                        const cell = row[i];
                        if (typeof cell === 'string' && (cell.includes(expName) || cell.includes(gbDomainSuffix))) {
                            row[i] = cell.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
                            logger.info(`In updateExcel, cell after replacement: ${row[i]}`);
                        }
                    }
                }
            });
        }
        return JSON.stringify(jsonContent);
    } catch (err) {
        logger.error(`Error while updating Excel content: ${err}`);
        return content; // Return original content if there's an error
    }
}

/**
 * Convert JSON content to Excel format.
 * @param {Object} jsonContent - The JSON content to convert.
 * @returns {Buffer} - The converted Excel content.
 */
export function convertJsonToExcel(jsonContent) {
    try {
        // Parse JSON string if it's a string
        const parsedContent = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
        // Create a workbook
        const workbook = xlsx.utils.book_new();
        // Convert JSON data to worksheet format
        // If the data has columns and data properties, use them to create a worksheet
        let worksheet;
        if (parsedContent.columns && parsedContent.data) {
            // Create worksheet from columns and data arrays
            worksheet = xlsx.utils.aoa_to_sheet([parsedContent.columns, ...parsedContent.data]);
        } else {
            // If the data is an array of objects, convert it directly
            const dataArray = Array.isArray(parsedContent) ? parsedContent : [parsedContent];
            worksheet = xlsx.utils.json_to_sheet(dataArray);
        }
        // Add the worksheet to the workbook
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        // Write to buffer
        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        return excelBuffer;
    } catch (error) {
        logger.error(`Error in convertJsonToExcel: ${error}`);
        // Create a simple empty workbook as fallback
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.aoa_to_sheet([['Error converting JSON to Excel']]);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }
}

/**
 * Replace all relative link references in the given mdast with the provided experience name and graybox style pattern.
 * @param {Array} mdast - The mdast to be updated.
 * @param {string} expName - The name of the experience.
 * @param {RegExp} grayboxStylePattern - The pattern to match graybox styles.
 */
const updateExperienceNameFromLinks = (mdast, expName) => {
    logger.info(`In updateExperienceNameFromLinks, mdast: ${mdast}`);
    logger.info(`In updateExperienceNameFromLinks, expName: ${expName}`); // sabya-gb-1
    if (mdast) {
        mdast.forEach((child) => {
            if (child.type === 'gridTable') {
                firstGtRows.push(findFirstGtRowInNode(child));
            }
            // remove experience name from links on the document
            logger.info(`In updateExperienceNameFromLinks, child: ${child}`);
            logger.info(`In updateExperienceNameFromLinks, child.type: ${child.type}`);
            logger.info(`In updateExperienceNameFromLinks, child.url: ${child.url}`); // https://main--bacom-graybox--adobecom.aem.page/fragments/sabya/gb-frag
            logger.info(`In updateExperienceNameFromLinks, child.children: ${child.children}`);
            logger.info(`In updateExperienceNameFromLinks, gbDomainSuffix: ${gbDomainSuffix}`); // -graybox
            
            // Process link URLs
            if (child.type === 'link' && child.url && (child.url.includes(expName) || child.url.includes(gbDomainSuffix))) {
                child.url = child.url.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
                logger.info(`In updateExperienceNameFromLinks, child.url after replacement: ${child.url}`);
            }
            
            // Process link text content that contains graybox URLs
            if (child.type === 'link' && child.children) {
                child.children.forEach((textNode) => {
                    if (textNode.type === 'text' && textNode.value &&
                        (textNode.value.includes(gbDomainSuffix) || textNode.value.includes(expName))) {
                        textNode.value = textNode.value.replaceAll(`/${expName}/`, '/').replaceAll(gbDomainSuffix, emptyString);
                        logger.info(`In updateExperienceNameFromLinks, textNode.value after replacement: ${textNode.value}`);
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
        logger().debug(`Error while iterating GTRows to replaces styles ${err}`);
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
        for (const child of node.children) {
            return findFirstGtRowInNode(child);
        }
    }
    return null;
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

