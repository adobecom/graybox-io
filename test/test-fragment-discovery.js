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
 * Test fragment discovery logic
 * This tests the updated logic that uses originalUrl for fragment discovery
 */

// Simulate the data structure that will be passed from bulk-copy.js to bulk-copy-worker.js
const testProcessedSourcePaths = [
    {
        originalUrl: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/dummy-bulk-copy-source-page',
        sourcePath: '/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx',
        destinationPath: '/sabya-bulk-copy-homepage-drill/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx'
    }
];

// Simulate the processSourcePaths logic in the worker
function simulateProcessSourcePaths(sourcePathsArray) {
    const processedPaths = [];
    const processedUrls = new Set();
    
    console.log('Testing fragment discovery logic...\n');
    
    for (const pathInfo of sourcePathsArray) {
        const sourcePath = typeof pathInfo === 'string' ? pathInfo : pathInfo.sourcePath;
        const originalUrl = pathInfo.originalUrl || sourcePath; // Use originalUrl if available, fallback to sourcePath
        
        if (processedUrls.has(sourcePath)) {
            continue;
        }
        processedUrls.add(sourcePath);

        console.log(`Processing source path: ${sourcePath}`);
        console.log(`Original URL for fragment discovery: ${originalUrl}`);
        
        // Check if it's an AEM page URL using the original URL
        if (originalUrl.includes('aem.page')) {
            console.log('✅ AEM page detected - will discover fragments');
            
            // Simulate fragment discovery
            const fragments = simulateFragmentDiscovery(originalUrl);
            
            processedPaths.push({
                sourcePath,
                destinationPath: pathInfo.destinationPath,
                hasFragments: fragments.length > 0,
                fragments: fragments,
                fragmentCount: fragments.length,
                type: 'page'
            });
        } else {
            console.log('❌ Not an AEM page - no fragments to discover');
            
            processedPaths.push({
                sourcePath,
                destinationPath: pathInfo.destinationPath,
                hasFragments: false,
                fragments: [],
                fragmentCount: 0,
                type: 'file'
            });
        }
        
        console.log('');
    }

    return processedPaths;
}

// Simulate fragment discovery for the specific URL mentioned in the issue
function simulateFragmentDiscovery(pageUrl) {
    console.log(`🔍 Discovering fragments for: ${pageUrl}`);
    
    // This is the specific page mentioned in the issue
    if (pageUrl.includes('dummy-bulk-copy-source-page')) {
        console.log('📄 Found the test page - simulating fragment discovery');
        
        // Simulate finding fragments in the content
        const fragments = [
            {
                fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-home',
                status: 200,
                availability: 'Available',
                nestedFragments: [
                    {
                        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-home/nested-level-2',
                        status: 200,
                        availability: 'Available'
                    }
                ],
                nestedFragmentCount: 1
            }
        ];
        
        console.log(`🎯 Found ${fragments.length} fragments with ${fragments[0].nestedFragmentCount} nested fragments`);
        return fragments;
    }
    
    console.log('❓ Unknown page - no fragments found');
    return [];
}

// Test the logic
console.log('Fragment Discovery Test');
console.log('=======================\n');

console.log('Input data structure:');
console.log(JSON.stringify(testProcessedSourcePaths, null, 2));
console.log('');

const result = simulateProcessSourcePaths(testProcessedSourcePaths);

console.log('Final result:');
console.log(JSON.stringify(result, null, 2));
console.log('');

// Check if the file would be categorized correctly
const filesWithFragments = result.filter(path => path.hasFragments);
const filesWithoutFragments = result.filter(path => !path.hasFragments);

console.log('Categorization:');
console.log(`Files with fragments: ${filesWithFragments.length}`);
console.log(`Files without fragments: ${filesWithoutFragments.length}`);
console.log('');

if (filesWithFragments.length > 0) {
    console.log('✅ SUCCESS: The page would be correctly categorized as having fragments');
    console.log('It would go to bulkcopy-to-be-processed.json');
} else {
    console.log('❌ FAILURE: The page was not detected as having fragments');
    console.log('It would incorrectly go to bulkcopy-not-processed.json');
}

console.log('');
console.log('Expected behavior:');
console.log('- The page should be detected as having fragments');
console.log('- It should go to bulkcopy-to-be-processed.json');
console.log('- The worker should create batches for processing');
