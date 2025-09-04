# Graybox Bulk Copy Scheduler System

## Overview

The Graybox Bulk Copy Scheduler System is designed to handle non-processing batches from bulk copy operations. It works in conjunction with the existing bulk copy system to automatically copy files from source to destination using SharePoint API.

## Components

### 1. bulk-copy-sched.js (Scheduler)
- **Purpose**: Monitors the bulk copy project queue and triggers workers for non-processing batches
- **Function**: 
  - Reads `bulk_copy_project_queue.json` to find projects with status `fragment_discovery_completed`
  - Checks batch status to find non-processing batches with status `initiated`
  - Invokes `bulk-copy-non-processing-worker` for each available batch
  - Ensures only one batch is processed at a time per project

### 2. bulk-copy-non-processing-worker.js (Worker)
- **Purpose**: Executes the actual file copying operations for non-processing batches
- **Function**:
  - Reads batch files from `bulk-copy-batches/` directory
  - Downloads source files using SharePoint API
  - Saves files to destination locations
  - Updates batch status and project status
  - Tracks successful copies and failures

### 3. bulk_copy_project_queue.json (Central Queue)
- **Purpose**: Centralized queue for all bulk copy requests
- **Location**: `graybox_promote/bulk_copy_project_queue.json`
- **Status Flow**:
  - `initiated` → Initial status when bulk copy request is created
  - `fragment_discovery_completed` → After fragment discovery and batch creation
  - `non_processing_batches_copied` → After all non-processing batches are copied

## How It Works

### 1. Initial Request
When a bulk copy request is initiated:
1. `bulk-copy-worker.js` creates the project entry in `bulk_copy_project_queue.json`
2. Status is set to `initiated`
3. Fragment discovery process begins

### 2. Fragment Discovery Completion
After fragment discovery:
1. Status is updated to `fragment_discovery_completed`
2. Non-processing batches are created in `bulk-copy-batches/` directory
3. Batch status is set to `initiated`

### 3. Scheduler Processing
Every minute, `bulk-copy-sched.js`:
1. Scans the project queue for projects with `fragment_discovery_completed` status
2. Finds non-processing batches with `initiated` status
3. Triggers workers for available batches
4. Updates batch status to `copy_in_progress`

### 4. Worker Execution
`bulk-copy-non-processing-worker.js`:
1. Downloads source files using SharePoint API
2. Saves files to destination locations
3. Updates batch status to `copied`
4. Tracks successful copies and failures
5. Updates project status when all non-processing batches are complete

## File Structure

```
graybox_promote/
├── bulk_copy_project_queue.json          # Central queue for all bulk copy requests
└── {project_path}/
    ├── bulk-copy-batches/                # Batch files and status
    │   ├── non_processing_batch_1.json  # Files that don't need processing
    │   ├── non_processing_batch_2.json
    │   ├── processing_batch_1.json      # Files that need processing (handled separately)
    │   ├── bulk_copy_batches.json       # Summary of all batches
    │   └── batch_status.json            # Status of each batch
    ├── copied_paths.json                # Successfully copied files by batch
    ├── copy_errors.json                 # Failed copy operations
    └── status.json                      # Overall project status
```

## Configuration

### App Configuration
The new actions are configured in `app.config.yaml`:

```yaml
bulk-copy-sched:
  function: actions/graybox/bulk-copy-sched.js
  web: 'no'
  runtime: 'nodejs:18'
  inputs:
    LOG_LEVEL: debug
  limits:
    timeout: 900000
    memorySize: 2048
  annotations:
    require-adobe-auth: false
    final: true

bulk-copy-non-processing-worker:
  function: actions/graybox/bulk-copy-non-processing-worker.js
  web: 'no'
  runtime: 'nodejs:18'
  inputs:
    LOG_LEVEL: debug
  limits:
    timeout: 3600000
    memorySize: 2048
```

### Scheduling
The scheduler runs every minute via the `everyMin` trigger:

```yaml
everyMinBulkCopyRule:
  trigger: everyMin
  action: bulk-copy-sched
```

## Status Tracking

### Batch Statuses
- `initiated` → Batch is ready for processing
- `copy_in_progress` → Batch is currently being processed
- `copied` → Batch has been successfully processed

### Project Statuses
- `initiated` → Bulk copy request received
- `fragment_discovery_completed` → Fragment discovery and batch creation complete
- `non_processing_batches_copied` → All non-processing batches have been copied

## Error Handling

### Copy Failures
- Failed copy operations are logged in `copy_errors.json`
- Individual file failures don't stop the batch processing
- Batch status is updated even if some files fail

### System Errors
- Errors are logged with detailed information
- Failed operations are tracked in project status
- Excel updates include failure information

## Monitoring and Logging

### Log Messages
- All operations are logged with appropriate log levels
- Batch processing progress is tracked
- File copy success/failure is logged

### Excel Updates
- Copy status is updated in the project Excel file
- Failed operations are documented
- Progress tracking for each batch

## Testing

A comprehensive test suite is available in `test/test-bulk-copy-scheduler.js`:

- **Scheduler Tests**: Verify queue processing and worker invocation
- **Worker Tests**: Verify file copying operations and error handling
- **Mock Dependencies**: SharePoint API and file system operations are mocked

## Future Enhancements

### Processing Batch Scheduler
- A separate scheduler will be created for processing batches
- Will handle files that require fragment analysis and recursive processing
- Will integrate with the existing promote system

### Enhanced Monitoring
- Real-time status updates
- Performance metrics
- Failure rate tracking

## Integration Points

### With Existing Systems
- **SharePoint API**: For file operations
- **Excel Integration**: For status tracking
- **File System**: For batch and status management
- **Promote System**: For project lifecycle management

### Dependencies
- `filesWrapper.js`: File system operations
- `sharepoint.js`: SharePoint API operations
- `statusUtils.js`: Status management utilities
- `appConfig.js`: Configuration management

## Troubleshooting

### Common Issues
1. **Batch Stuck in Progress**: Check if worker is running and has proper permissions
2. **File Copy Failures**: Verify SharePoint permissions and file accessibility
3. **Queue Processing Delays**: Check scheduler logs and ensure it's running every minute

### Debug Information
- Enable debug logging via `LOG_LEVEL: debug`
- Check batch status files for current state
- Monitor Excel updates for progress tracking
- Review copy error logs for failure details
