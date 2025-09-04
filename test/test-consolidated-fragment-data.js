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
 * Test consolidated fragment data structure
 * This demonstrates the new consolidated approach with flags
 */

// Simulate the data structures that would be processed
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

const testFilesWithoutFragments = [
    {
        sourcePath: '/homepage/drafts/sabya/simple-page.docx',
        destinationPath: '/sabya-bulk-copy-homepage-drill/homepage/drafts/sabya/simple-page.docx',
        hasFragments: false,
        fragments: [],
        fragmentCount: 0,
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

// Simulate the consolidated data structure creation
function createConsolidatedFragmentData(processedPaths, filesWithFragments, filesWithoutFragments, fragmentsWithNestedFragments, fragmentsWithoutNestedFragments) {
    console.log('Creating consolidated fragment data structure...\n');
    
    const consolidatedFragmentData = {
        summary: {
            totalFiles: processedPaths.length,
            filesWithFragments: filesWithFragments.length,
            filesWithoutFragments: filesWithoutFragments.length,
            totalFragments: fragmentsWithNestedFragments.length + fragmentsWithoutNestedFragments.length,
            fragmentsWithNested: fragmentsWithNestedFragments.length,
            fragmentsWithoutNested: fragmentsWithoutNestedFragments.length,
            batchesCreated: 2, // Simulate
            timestamp: new Date().toISOString()
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
        },
        batches: {
            batchStatus: {
                'batch_1': 'initiated',
                'batch_2': 'initiated'
            },
            batchFiles: {
                'batch_1': filesWithFragments.slice(0, 1),
                'batch_2': filesWithFragments.slice(1)
            },
            batchCount: 2
        }
    };
    
    return consolidatedFragmentData;
}

// Test the consolidated structure
console.log('Consolidated Fragment Data Test');
console.log('================================\n');

const consolidatedData = createConsolidatedFragmentData(
    [...testFilesWithFragments, ...testFilesWithoutFragments],
    testFilesWithFragments,
    testFilesWithoutFragments,
    testFragmentsWithNested,
    testFragmentsWithoutNested
);

console.log('Consolidated Fragment Data Structure:');
console.log(JSON.stringify(consolidatedData, null, 2));
console.log('');

// Demonstrate how to access different categories
console.log('Accessing Different Categories:');
console.log('================================');
console.log('');

console.log('1. Summary Information:');
console.log(`   Total Files: ${consolidatedData.summary.totalFiles}`);
console.log(`   Files with Fragments: ${consolidatedData.summary.filesWithFragments}`);
console.log(`   Files without Fragments: ${consolidatedData.summary.filesWithoutFragments}`);
console.log(`   Total Fragments: ${consolidatedData.summary.totalFragments}`);
console.log(`   Fragments with Nested: ${consolidatedData.summary.fragmentsWithNested}`);
console.log(`   Fragments without Nested: ${consolidatedData.summary.fragmentsWithoutNested}`);
console.log(`   Batches Created: ${consolidatedData.summary.batchesCreated}`);
console.log('');

console.log('2. High Priority Pages (with fragments):');
consolidatedData.pages.withFragments.forEach(page => {
    console.log(`   📄 ${page.sourcePath} (Priority: ${page.processingPriority})`);
});
console.log('');

console.log('3. Low Priority Pages (without fragments):');
consolidatedData.pages.withoutFragments.forEach(page => {
    console.log(`   📄 ${page.sourcePath} (Priority: ${page.processingPriority})`);
});
console.log('');

console.log('4. High Priority Fragments (with nested):');
consolidatedData.fragments.withNested.forEach(fragment => {
    console.log(`   🔍 ${fragment.fragmentPath} (Priority: ${fragment.processingPriority}, Recursive: ${fragment.requiresRecursiveProcessing})`);
});
console.log('');

console.log('5. Medium Priority Fragments (without nested):');
consolidatedData.fragments.withoutNested.forEach(fragment => {
    console.log(`   🔍 ${fragment.fragmentPath} (Priority: ${fragment.processingPriority}, Recursive: ${fragment.requiresRecursiveProcessing})`);
});
console.log('');

console.log('6. Batch Information:');
console.log(`   Batch Count: ${consolidatedData.batches.batchCount}`);
console.log(`   Batch Status: ${JSON.stringify(consolidatedData.batches.batchStatus)}`);
console.log('');

console.log('Benefits of Consolidated Structure:');
console.log('==================================');
console.log('✅ Single file to manage instead of 4 separate files');
console.log('✅ Clear categorization with flags and priorities');
console.log('✅ Easy filtering by category, priority, or processing requirements');
console.log('✅ Comprehensive summary information');
console.log('✅ Batch information included');
console.log('✅ Consistent data structure');
console.log('✅ Easy to query and process programmatically');
