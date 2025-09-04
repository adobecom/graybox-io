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
 * Test dual batch system
 * This demonstrates the new approach with separate batches for processing vs non-processing files
 */

// Simulate the data structures that would be processed
const testFilesWithFragments = [
    {
        sourcePath: '/homepage/drafts/sabya/page-with-fragments.docx',
        destinationPath: '/sabya-bulk-copy-homepage-drill/homepage/drafts/sabya/page-with-fragments.docx',
        hasFragments: true,
        fragments: [
            {
                fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/frag-1',
                status: 200,
                availability: 'Available',
                nestedFragments: [
                    {
                        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-1',
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
        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/frag-with-nested',
        nestedFragmentCount: 1,
        nestedFragments: [
            {
                fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/nested-frag-2',
                status: 200,
                availability: 'Available'
            }
        ],
        sourcePage: '/homepage/drafts/sabya/page-with-fragments.docx',
        type: 'fragment_with_nested'
    }
];

const testFragmentsWithoutNested = [
    {
        fragmentPath: 'https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/fragments/simple-frag',
        nestedFragmentCount: 0,
        nestedFragments: [],
        sourcePage: '/homepage/drafts/sabya/page-with-fragments.docx',
        type: 'fragment_no_nested'
    }
];

// Simulate the dual batch system
function createDualBatchSystem(filesWithFragments, filesWithoutFragments, fragmentsWithNestedFragments, fragmentsWithoutNestedFragments) {
    console.log('Creating Dual Batch System...\n');
    
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
    const batchSize = 10;
    
    for (let i = 0, batchCounter = 1; i < filesNeedingProcessing.length; i += batchSize, batchCounter += 1) {
        const arrayChunk = filesNeedingProcessing.slice(i, i + batchSize);
        processingBatchesArray.push(arrayChunk);
    }
    
    // Create batches for files that DON'T need processing (low priority)
    const nonProcessingBatchesArray = [];
    
    for (let i = 0, batchCounter = 1; i < filesNotNeedingProcessing.length; i += batchSize, batchCounter += 1) {
        const arrayChunk = filesNotNeedingProcessing.slice(i, i + batchSize);
        nonProcessingBatchesArray.push(arrayChunk);
    }
    
    // Create batch status and summary
    const batchStatusJson = {};
    const bulkCopyBatchesJson = {};
    
    // Add processing batches
    processingBatchesArray.forEach((batch, index) => {
        const batchName = `processing_batch_${index + 1}`;
        batchStatusJson[batchName] = 'initiated';
        bulkCopyBatchesJson[batchName] = batch;
    });
    
    // Add non-processing batches
    nonProcessingBatchesArray.forEach((batch, index) => {
        const batchName = `non_processing_batch_${index + 1}`;
        batchStatusJson[batchName] = 'initiated';
        bulkCopyBatchesJson[batchName] = batch;
    });
    
    const totalBatches = processingBatchesArray.length + nonProcessingBatchesArray.length;
    
    return {
        processingBatches: processingBatchesArray,
        nonProcessingBatches: nonProcessingBatchesArray,
        totalBatches,
        batchStatus: batchStatusJson,
        batchFiles: bulkCopyBatchesJson
    };
}

// Test the dual batch system
console.log('Dual Batch System Test');
console.log('======================\n');

const batchSystem = createDualBatchSystem(
    testFilesWithFragments,
    testFilesWithoutFragments,
    testFragmentsWithNested,
    testFragmentsWithoutNested
);

console.log('Batch Organization Results:');
console.log('==========================\n');

console.log(`📊 Total Batches Created: ${batchSystem.totalBatches}`);
console.log(`🔴 Processing Batches (High Priority): ${batchSystem.processingBatches.length}`);
console.log(`🟢 Non-Processing Batches (Low Priority): ${batchSystem.nonProcessingBatches.length}`);
console.log('');

console.log('Processing Batches (High Priority):');
console.log('==================================');
console.log('These contain files/pages/fragments that NEED processing:');
console.log('- Pages with fragments (require fragment discovery and copying)');
console.log('- Fragments with nested fragments (require recursive processing)');
console.log('');

batchSystem.processingBatches.forEach((batch, index) => {
    console.log(`  processing_batch_${index + 1}.json: ${batch.length} items`);
    batch.forEach(item => {
        if (item.type === 'page') {
            console.log(`    📄 ${item.sourcePath} (${item.fragmentCount} fragments)`);
        } else {
            console.log(`    🔍 ${item.fragmentPath} (${item.nestedFragmentCount} nested)`);
        }
    });
    console.log('');
});

console.log('Non-Processing Batches (Low Priority):');
console.log('======================================');
console.log('These contain files/pages/fragments that DON\'T need processing:');
console.log('- Pages without fragments (simple copy operation)');
console.log('- Fragments without nested fragments (simple copy operation)');
console.log('');

batchSystem.nonProcessingBatches.forEach((batch, index) => {
    console.log(`  non_processing_batch_${index + 1}.json: ${batch.length} items`);
    batch.forEach(item => {
        if (item.type === 'page') {
            console.log(`    📄 ${item.sourcePath} (no fragments)`);
        } else {
            console.log(`    🔍 ${item.fragmentPath} (no nested fragments)`);
        }
    });
    console.log('');
});

console.log('Batch Status Summary:');
console.log('=====================');
Object.entries(batchSystem.batchStatus).forEach(([batchName, status]) => {
    const priority = batchName.startsWith('processing_') ? '🔴 HIGH' : '🟢 LOW';
    console.log(`  ${batchName}: ${status} (${priority} priority)`);
});
console.log('');

console.log('Benefits of Dual Batch System:');
console.log('==============================');
console.log('✅ Clear separation of processing requirements');
console.log('✅ High priority batches can be processed first');
console.log('✅ Low priority batches can be processed in parallel or later');
console.log('✅ Better resource allocation and scheduling');
console.log('✅ Easier to track progress and prioritize work');
console.log('✅ Logical grouping based on complexity');
console.log('✅ Optimized for different processing workflows');
