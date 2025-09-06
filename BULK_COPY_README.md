# Graybox Bulk Copy System

## Overview

The Graybox Bulk Copy System has been enhanced to automatically discover fragments and nested fragments when processing AEM page URLs. It creates batches similar to the promote functionality and categorizes files based on whether they contain fragments.

## Components

### 1. bulk-copy.js (Main Entry Point)
- Validates user permissions using `validateAction`
- Processes source paths and invokes the bulk copy worker directly
- Returns standardized response format with `code` and `payload`

### 2. bulk-copy-worker.js (Enhanced Worker)
- Discovers fragments and nested fragments for AEM page URLs
- Creates batches similar to the promote functionality
- Separates files into two categories:
  - `bulkcopy-to-be-processed.json`: Files that contain fragments
  - `bulkcopy-not-processed.json`: Files without fragments

## How It Works

### Fragment Discovery Process

1. **Input Processing**: Takes a list of URLs (pages and fragments)
2. **URL Preservation**: Preserves original AEM page URLs for fragment discovery while creating file paths for copy operations
3. **Content Fetching**: For each AEM page URL, fetches the markdown content
4. **Fragment Detection**: Uses regex to find fragment links in angle bracket format: `<https://...aem.page/.../fragments/...>`
5. **Nested Fragment Discovery**: Recursively discovers nested fragments within fragments
6. **Categorization**: Separates files based on fragment presence

### Batching System

- Creates batches of up to 200 files (configurable via `BATCH_REQUEST_BULK_COPY`)
- Each batch is saved as `batch_n.json` in the `graybox_promote${project}/batches/` directory
- Batch status is tracked in `batch_status.json`
- All batches are summarized in `bulk_copy_batches.json`

### Key Fix for Fragment Discovery

The system now correctly handles the difference between:
- **`originalUrl`**: The original AEM page URL used for fragment discovery (e.g., `https://main--homepage--adobecom.aem.page/homepage/drafts/sabya/dummy-bulk-copy-source-page`)
- **`sourcePath`**: The file path used for the actual copy operation (e.g., `/homepage/drafts/sabya/dummy-bulk-copy-source-page.docx`)

This ensures that fragment discovery works correctly even when the main system converts AEM URLs to file paths for processing.

### Fragment Categorization

The system now provides comprehensive categorization at multiple levels:

1. **Page Level**: Pages are categorized based on whether they contain fragments
2. **Fragment Level**: Individual fragments are categorized based on whether they contain nested fragments
3. **Nested Fragment Level**: Nested fragments are analyzed to see if they contain their own nested fragments

This gives you a complete view of your content hierarchy and helps identify which fragments need further processing at each level.

### Consolidated Fragment Data Structure

The system now generates a single `consolidated-fragment-data.json` file that contains all fragment information with clear categorization and flags:

```json
{
  "summary": {
    "totalFiles": 2,
    "filesWithFragments": 1,
    "filesWithoutFragments": 1,
    "totalFragments": 2,
    "fragmentsWithNested": 1,
    "fragmentsWithoutNested": 1,
    "batchesCreated": 2,
    "timestamp": "2025-09-03T20:48:42.349Z"
  },
  "pages": {
    "withFragments": [
      {
        "sourcePath": "/path/to/page.docx",
        "category": "page_with_fragments",
        "processingPriority": "high"
      }
    ],
    "withoutFragments": [
      {
        "sourcePath": "/path/to/simple-page.docx",
        "category": "page_no_fragments",
        "processingPriority": "low"
      }
    ]
  },
  "fragments": {
    "withNested": [
      {
        "fragmentPath": "https://.../fragment1",
        "category": "fragment_with_nested",
        "processingPriority": "high",
        "requiresRecursiveProcessing": true
      }
    ],
    "withoutNested": [
      {
        "fragmentPath": "https://.../fragment2",
        "category": "fragment_no_nested",
        "processingPriority": "medium",
        "requiresRecursiveProcessing": false
      }
    ]
  },
  "batches": {
    "batchStatus": {"batch_1": "initiated"},
    "batchFiles": {"batch_1": [...]},
    "batchCount": 1
  }
}
```

#### Key Benefits:
- **Single Source of Truth**: All fragment data in one file
- **Clear Categorization**: Easy to filter by category, priority, or processing requirements
- **Processing Priorities**: High/medium/low priority flags for workflow optimization
- **Recursive Processing Flags**: Clear indication of which fragments need deeper analysis
- **Comprehensive Summary**: Quick overview of all counts and statistics
- **Batch Integration**: Batch information included for processing coordination

### File Organization

```
graybox_promote${project}/
├── consolidated-fragment-data.json   # ALL fragment data with categorization and flags
├── bulk-copy-batches/                # All batch-related files
│   ├── processing_batch_1.json       # High priority: files that NEED processing
│   ├── processing_batch_2.json
│   ├── ...
│   ├── non_processing_batch_1.json  # Low priority: files that DON'T need processing
│   ├── non_processing_batch_2.json
│   ├── ...
│   ├── bulk_copy_batches.json       # All batches summary
│   └── batch_status.json             # Status of each batch
└── bulk-copy-status.json             # Overall operation status
```

**Note**: The system now creates two distinct sets of batch files based on processing requirements:
- **Processing Batches** (High Priority): Files/pages/fragments that require fragment discovery, nested fragment analysis, or recursive processing
- **Non-Processing Batches** (Low Priority): Files/pages/fragments that can be copied directly without additional processing

**Note**: The old separate files (`bulkcopy-to-be-processed.json`, `bulkcopy-not-processed.json`, `fragments-with-nested.json`, `fragments-without-nested.json`) have been consolidated into a single `consolidated-fragment-data.json` file for easier management and processing.

### Dual Batch System

The bulk copy system now intelligently separates files into two distinct batch categories based on their processing requirements:

#### **Processing Batches (High Priority)**
- **Contents**: Files/pages/fragments that require additional processing
- **Examples**:
  - Pages with fragments (require fragment discovery and copying)
  - Fragments with nested fragments (require recursive processing)
- **Processing**: Complex operations requiring fragment analysis, nested fragment discovery, and recursive copying
- **Priority**: High - should be processed first due to complexity

#### **Non-Processing Batches (Low Priority)**
- **Contents**: Files/pages/fragments that can be copied directly
- **Examples**:
  - Pages without fragments (simple copy operation)
  - Fragments without nested fragments (simple copy operation)
- **Processing**: Direct copy operations without additional analysis
- **Priority**: Low - can be processed in parallel or after processing batches

## Usage

### Invoking the Action

```javascript
const params = {
    sourcePaths: [
        'https://example.aem.page/path/to/page1',
        'https://example.aem.page/path/to/page2'
    ],
    driveId: 'your-drive-id',
    gbRootFolder: 'your-graybox-root',
    rootFolder: 'your-root-folder',
    experienceName: 'your-experience-name',
    projectExcelPath: 'your-excel-path',
    adminPageUri: 'your-admin-uri',
    spToken: 'your-sharepoint-token'
};

// Invoke the main bulk copy action
const result = await ow.actions.invoke({
    name: 'graybox/bulk-copy',
    blocking: false,
    result: false,
    params
});
```

### Response Format

```javascript
{
    code: 200,
    payload: 'Graybox Bulk Copy action invoked'
}
```

## Fragment Detection

The system detects fragments using the following regex pattern:
```regex
<https:\/\/[^>]*aem\.page[^>]*\/fragments\/[^>]*>
```

This matches URLs in the format:
- `<https://example.aem.page/path/fragments/fragment1>`
- `<https://another.aem.page/other/fragments/nested-fragment>`

## Excel Integration

The system automatically updates the project Excel file with:
- Fragment discovery completion status
- Total files processed
- Count of files with/without fragments
- Number of batches created
- Any errors encountered

## Error Handling

- Graceful handling of network errors during content fetching
- Detailed logging of all operations
- Status tracking for each step of the process
- Excel updates for monitoring and debugging

## Configuration

- `BATCH_REQUEST_BULK_COPY`: Number of files per batch (default: 200)
- Batch size can be adjusted based on system performance requirements
