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
const { mdast2docx } = require('../node_modules/milo-md2docx/lib/index');
const { getAioLogger } = require('./utils');
const { fetchWithRetry } = require('./sharepoint');

const gbStyleExpression = 'gb-'
const emptyString = '';
const grayboxStylesRegex = new RegExp('gb-[a-zA-Z0-9._-]*');
const logger = getAioLogger();


/**
 * Updates a document based on the provided Markdown file path, experience name, and options.
 * @param {string} mdPath - The path to the Markdown file.
 * @param {string} experienceName - The name of the experience.
 * @param {object} options - The options for fetching the Markdown file.
 * @returns {Promise} - A promise that resolves to the generated Docx file.
 */
async function updateDocument(mdPath, experienceName, options) {
    logger.info(`Fetching md file ${mdPath}`);
    const response = await fetchWithRetry(mdPath, options);
    if (response.status) {
        const content = await response.text();
        logger.info(`Content of the md file ${content}`);
        if (content.includes(experienceName) || content.includes(gbStyleExpression)) {
            logger.info('Content contains experience name or graybox styles');
            const state = { content: { data: content }, log: '' };
            await parseMarkdown(state);
            const { mdast } = state.content;
            replaceAllGrayboxReferences(mdast.children, experienceName, grayboxStylesRegex);
            logger.info('All links replaced');
            return await generateDocxFromMdast(mdast);
        }
    }
}

/**
 * Replace all graybox references in the given mdast with the provided experience name and graybox style pattern.
 * @param {Array} mdast - The mdast to be updated.
 * @param {string} expName - The name of the experience.
 * @param {RegExp} grayboxStylePattern - The pattern to match graybox styles.
 */
function replaceAllGrayboxReferences(mdast, expName, grayboxStylePattern) {
    if (mdast) {
        logger.info('Replacing all graybox references');
        mdast.forEach((child) => {
                //remove experience name from links on the document
                if (child.type === 'link' && child.url && child.url.includes(expName)) {
                    logger.info(`Replacing experience name from link ${child.url}`);
                    child.url = child.url.replaceAll(expName, emptyString);
                    logger.info(`Link after replacement ${child.url}`);
                }
                //replace all graybox styles from blocks and text
                if (child.type === 'text' && child.value && child.value.includes(gbStyleExpression)) {
                    child.value = child.value.replace(grayboxStylesRegex, emptyString)
                        .replace('()', emptyString).replace(', )', ')');
                }
                if (child.children) {
                    replaceAllGrayboxReferences(child.children, expName, grayboxStylePattern);
                }
            }
        );
    }
}

/**
 * Generate a Docx file from the given mdast.
 * @param {Object} mdast - The mdast representing the document.
 * @returns {Promise} A promise that resolves to the generated Docx file.
 */
async function generateDocxFromMdast(mdast) {
    logger.info('Docx file Docx file generation from mdast started...');
    return await mdast2docx(mdast);   
}

module.exports = updateDocument;
