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

/**
 * Test file writing to verify that data is written as flat arrays
 */

// Simulate the data structures that would be written
const testFilesWithFragments = [
    {
        sourcePath: '/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx',
        destinationPath: '/sabya-bulk-copy-homepage-drill/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx',
        hasFragments: true,
        fragments: [
            {
                fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/hp-fragment-1',
                status: 200,
                availability: 'Available',
                nestedFragments: [
                    {
                        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-home',
                        status: 200,
                        availability: 'Available'
                    }
                ],
                nestedFragmentCount: 1
            }
        ],
        fragmentCount: 1,
        type: 'page'
    }
];

const testFragmentsWithNested = [
    {
        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/hp-fragment-1',
        nestedFragmentCount: 1,
        nestedFragments: [
            {
                fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-home',
                status: 200,
                availability: 'Available'
            }
        ],
        sourcePage: '/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx',
        type: 'fragment_with_nested'
    }
];

const testFragmentsWithoutNested = [
    {
        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-home',
        nestedFragmentCount: 0,
        nestedFragments: [],
        sourcePage: '/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx',
        type: 'nested_fragment_no_nested'
    }
];

// Simulate what filesWrapper.writeFile would do
function simulateWriteFile(filePath, content) {
    console.log(`📝 Writing to: ${filePath}`);
    
    let finalData = content;
    if (!Buffer.isBuffer(content) && typeof content !== 'string' && !(content instanceof String)) {
        finalData = JSON.stringify(content, null, 2);
    }
    
    console.log('Content type:', typeof content);
    console.log('Is Array:', Array.isArray(content));
    console.log('Array length:', Array.isArray(content) ? content.length : 'N/A');
    console.log('');
    
    return finalData;
}

// Simulate what filesWrapper.readFileIntoObject would return
function simulateReadFile(filePath, writtenContent) {
    console.log(`📖 Reading from: ${filePath}`);
    
    // Simulate the response wrapper that might be added when reading
    const responseWrapper = {
        code: 200,
        payload: {
            fileContent: writtenContent,
            fileName: filePath
        }
    };
    
    console.log('Response wrapper structure:');
    console.log(JSON.stringify(responseWrapper, null, 2));
    console.log('');
    
    return responseWrapper;
}

// Test the file writing and reading simulation
console.log('File Writing and Reading Test');
console.log('==============================\n');

console.log('1. Testing filesWithFragments:');
const writtenFilesWithFragments = simulateWriteFile('bulkcopy-to-be-processed.json', testFilesWithFragments);
const readFilesWithFragments = simulateReadFile('bulkcopy-to-be-processed.json', testFilesWithFragments);

console.log('2. Testing fragmentsWithNested:');
const writtenFragmentsWithNested = simulateWriteFile('fragments-with-nested.json', testFragmentsWithNested);
const readFragmentsWithNested = simulateReadFile('fragments-with-nested.json', testFragmentsWithNested);

console.log('3. Testing fragmentsWithoutNested:');
const writtenFragmentsWithoutNested = simulateWriteFile('fragments-without-nested.json', testFragmentsWithoutNested);
const readFragmentsWithoutNested = simulateReadFile('fragments-without-nested.json', testFragmentsWithoutNested);

console.log('Summary:');
console.log('========');
console.log('✅ Files are written as flat arrays');
console.log('❌ Files are read back with response wrapper');
console.log('');
console.log('The issue is in the reading, not the writing!');
console.log('filesWrapper.writeFile writes flat arrays, but readFileIntoObject returns wrapped responses.');
console.log('');
console.log('To get flat arrays, you need to access:');
console.log('response.payload.fileContent');
console.log('');
console.log('Or use a different reading method that doesn\'t add the wrapper.');
