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
 * Debug test for bulk copy worker
 * This helps troubleshoot the "sourcePaths is not iterable" error
 */

// Test the parameter extraction logic
function testParameterExtraction() {
    console.log('Testing parameter extraction logic...\n');
    
    // Simulate what the main bulk-copy.js sends
    const testParams = {
        sourcePaths: [
            {
                sourcePath: 'https://example.aem.page/path/to/page1',
                destinationPath: '/experienceName/https://example.aem.page/path/to/page1'
            },
            {
                sourcePath: 'https://example.aem.page/path/to/page2',
                destinationPath: '/experienceName/https://example.aem.page/path/to/page2'
            }
        ],
        driveId: 'test-drive',
        gbRootFolder: 'test-graybox',
        rootFolder: 'test-root',
        experienceName: 'test-experience',
        projectExcelPath: 'test-excel-path',
        adminPageUri: 'test-admin-uri',
        spToken: 'test-token'
    };
    
    console.log('Test params:', JSON.stringify(testParams, null, 2));
    console.log('');
    
    // Simulate the extraction logic from the worker
    const { sourcePaths } = testParams;
    
    console.log('Extracted sourcePaths:', sourcePaths);
    console.log('Type of sourcePaths:', typeof sourcePaths);
    console.log('Is Array:', Array.isArray(sourcePaths));
    console.log('Length:', sourcePaths ? sourcePaths.length : 'undefined');
    console.log('');
    
    if (!sourcePaths) {
        console.log('ERROR: sourcePaths parameter is missing');
        return false;
    }
    
    if (!Array.isArray(sourcePaths) && typeof sourcePaths !== 'string') {
        console.log(`ERROR: sourcePaths must be an array or string, got: ${typeof sourcePaths}`);
        return false;
    }
    
    // Convert to array if it's a string
    const sourcePathsArray = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
    
    console.log('Processed sourcePathsArray:', sourcePathsArray);
    console.log('First item type:', typeof sourcePathsArray[0]);
    console.log('First item:', JSON.stringify(sourcePathsArray[0], null, 2));
    console.log('');
    
    // Test the processSourcePaths logic
    console.log('Testing processSourcePaths logic...');
    
    const processedPaths = [];
    const processedUrls = new Set();
    
    for (const pathInfo of sourcePathsArray) {
        const sourcePath = typeof pathInfo === 'string' ? pathInfo : pathInfo.sourcePath;
        
        if (processedUrls.has(sourcePath)) {
            continue;
        }
        processedUrls.add(sourcePath);
        
        console.log(`Processing: ${sourcePath}`);
        console.log(`PathInfo:`, JSON.stringify(pathInfo, null, 2));
        
        // Simulate fragment discovery
        const hasFragments = sourcePath.includes('fragment');
        const fragments = hasFragments ? ['mock-fragment'] : [];
        
        processedPaths.push({
            sourcePath,
            destinationPath: pathInfo.destinationPath || `/experienceName${sourcePath}`,
            hasFragments,
            fragments,
            fragmentCount: fragments.length,
            type: 'page'
        });
    }
    
    console.log('');
    console.log('Final processed paths:', JSON.stringify(processedPaths, null, 2));
    
    return true;
}

// Test with different input formats
function testDifferentFormats() {
    console.log('\n=== Testing Different Input Formats ===\n');
    
    const testCases = [
        {
            name: 'Array of objects with sourcePath and destinationPath',
            sourcePaths: [
                { sourcePath: 'https://example.aem.page/page1', destinationPath: '/dest1' },
                { sourcePath: 'https://example.aem.page/page2', destinationPath: '/dest2' }
            ]
        },
        {
            name: 'Array of strings',
            sourcePaths: [
                'https://example.aem.page/page1',
                'https://example.aem.page/page2'
            ]
        },
        {
            name: 'Single string',
            sourcePaths: 'https://example.aem.page/page1'
        },
        {
            name: 'Empty array',
            sourcePaths: []
        },
        {
            name: 'Undefined',
            sourcePaths: undefined
        },
        {
            name: 'Null',
            sourcePaths: null
        }
    ];
    
    testCases.forEach((testCase, index) => {
        console.log(`Test Case ${index + 1}: ${testCase.name}`);
        console.log('Input:', JSON.stringify(testCase.sourcePaths, null, 2));
        
        try {
            if (!testCase.sourcePaths) {
                console.log('Result: ERROR - sourcePaths is missing');
            } else if (!Array.isArray(testCase.sourcePaths) && typeof testCase.sourcePaths !== 'string') {
                console.log(`Result: ERROR - Invalid type: ${typeof testCase.sourcePaths}`);
            } else {
                const sourcePathsArray = Array.isArray(testCase.sourcePaths) ? testCase.sourcePaths : [testCase.sourcePaths];
                console.log(`Result: SUCCESS - Processed ${sourcePathsArray.length} items`);
            }
        } catch (error) {
            console.log(`Result: ERROR - ${error.message}`);
        }
        
        console.log('');
    });
}

// Run tests
console.log('Bulk Copy Worker Debug Tests');
console.log('=============================\n');

const success = testParameterExtraction();
testDifferentFormats();

console.log(`\nMain test ${success ? 'PASSED' : 'FAILED'}`);
console.log('\nIf the main test passed, the worker should now work correctly.');
console.log('If it failed, check the error messages above for clues.');
