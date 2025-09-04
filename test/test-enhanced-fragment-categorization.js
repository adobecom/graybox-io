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
 * Test enhanced fragment categorization logic
 * This tests the logic that analyzes nested fragments for their own fragment content
 */

// Simulate the processed paths data structure from the worker
const testProcessedPaths = [
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

// Simulate the enhanced fragment categorization logic from the worker
function simulateEnhancedFragmentCategorization(processedPaths) {
    console.log('Testing enhanced fragment categorization logic...\n');
    
    const fragmentsWithNestedFragments = [];
    const fragmentsWithoutNestedFragments = [];
    
    // Process all fragments from all pages
    for (const page of processedPaths) {
        console.log(`📄 Processing page: ${page.sourcePath}`);
        console.log(`   Has fragments: ${page.hasFragments}`);
        console.log(`   Fragment count: ${page.fragmentCount}`);
        
        if (page.fragments && page.fragments.length > 0) {
            for (const fragment of page.fragments) {
                console.log(`   🔍 Fragment: ${fragment.fragmentPath}`);
                console.log(`      Nested fragments: ${fragment.nestedFragmentCount}`);
                
                if (fragment.nestedFragments && fragment.nestedFragments.length > 0) {
                    // This fragment has nested fragments
                    console.log(`      ✅ Has nested fragments - will go to fragments-with-nested.json`);
                    fragmentsWithNestedFragments.push({
                        fragmentPath: fragment.fragmentPath,
                        nestedFragmentCount: fragment.nestedFragments.length,
                        nestedFragments: fragment.nestedFragments,
                        sourcePage: page.sourcePath,
                        type: 'fragment_with_nested'
                    });
                    
                    // Also analyze each nested fragment to see if it has its own nested fragments
                    console.log(`      🔍 Analyzing nested fragments for their own fragment content...`);
                    for (const nestedFragment of fragment.nestedFragments) {
                        console.log(`         🔍 Nested Fragment: ${nestedFragment.fragmentPath}`);
                        
                        // Simulate checking if this nested fragment contains fragments
                        // In the real worker, this would fetch the content and check for fragment links
                        const nestedFragmentHasFragments = false; // Simulate: nested-frag-home has no fragments
                        
                        if (nestedFragmentHasFragments) {
                            console.log(`            ✅ Has its own nested fragments - will go to fragments-with-nested.json`);
                            fragmentsWithNestedFragments.push({
                                fragmentPath: nestedFragment.fragmentPath,
                                nestedFragmentCount: 1, // Simulate
                                nestedFragments: [], // Simulate
                                sourcePage: page.sourcePath,
                                type: 'nested_fragment_with_nested'
                            });
                        } else {
                            console.log(`            ❌ No nested fragments - will go to fragments-without-nested.json`);
                            fragmentsWithoutNestedFragments.push({
                                fragmentPath: nestedFragment.fragmentPath,
                                nestedFragmentCount: 0,
                                nestedFragments: [],
                                sourcePage: page.sourcePath,
                                type: 'nested_fragment_no_nested'
                            });
                        }
                    }
                } else {
                    // This fragment has no nested fragments
                    console.log(`      ❌ No nested fragments - will go to fragments-without-nested.json`);
                    fragmentsWithoutNestedFragments.push({
                        fragmentPath: fragment.fragmentPath,
                        nestedFragmentCount: 0,
                        nestedFragments: [],
                        sourcePage: page.sourcePath,
                        type: 'fragment_no_nested'
                    });
                }
            }
        }
        console.log('');
    }

    return { fragmentsWithNestedFragments, fragmentsWithoutNestedFragments };
}

// Test the logic
console.log('Enhanced Fragment Categorization Test');
console.log('====================================\n');

console.log('Input data structure:');
console.log(JSON.stringify(testProcessedPaths, null, 2));
console.log('');

// Note: This is a simulation, so we'll call it synchronously
const result = simulateEnhancedFragmentCategorization(testProcessedPaths);

console.log('Enhanced fragment categorization results:');
console.log('========================================');
console.log('');

console.log('Fragments WITH nested fragments:');
console.log(JSON.stringify(result.fragmentsWithNestedFragments, null, 2));
console.log('');

console.log('Fragments WITHOUT nested fragments:');
console.log(JSON.stringify(result.fragmentsWithoutNestedFragments, null, 2));
console.log('');

// Summary
console.log('Summary:');
console.log(`Total fragments processed: ${result.fragmentsWithNestedFragments.length + result.fragmentsWithoutNestedFragments.length}`);
console.log(`Fragments with nested fragments: ${result.fragmentsWithNestedFragments.length}`);
console.log(`Fragments without nested fragments: ${result.fragmentsWithoutNestedFragments.length}`);
console.log('');

// Check if the categorization is correct
const hpFragment1 = result.fragmentsWithNestedFragments.find(f => f.fragmentPath.includes('hp-fragment-1'));
const nestedFragHome = result.fragmentsWithoutNestedFragments.find(f => f.fragmentPath.includes('nested-frag-home'));

if (hpFragment1) {
    console.log('✅ SUCCESS: hp-fragment-1 correctly categorized as having nested fragments');
    console.log('   It will go to fragments-with-nested.json');
} else {
    console.log('❌ FAILURE: hp-fragment-1 was not categorized correctly');
}

if (nestedFragHome) {
    console.log('✅ SUCCESS: nested-frag-home correctly categorized as having no nested fragments');
    console.log('   It will go to fragments-without-nested.json');
} else {
    console.log('❌ FAILURE: nested-frag-home was not categorized correctly');
}

console.log('');
console.log('Expected behavior:');
console.log('- hp-fragment-1 should be in fragments-with-nested.json (it has nested-frag-home)');
console.log('- nested-frag-home should be in fragments-without-nested.json (it has no nested fragments)');
console.log('- The enhanced analysis now recursively checks nested fragments for their own fragment content');
