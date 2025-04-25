/**
 * Project Status Constants
 * This file contains all possible project statuses that can be used in the application.
 * These statuses are used for tracking the state of projects and managing status transitions.
 */

export const PROJECT_STATUS = {
    // Initial States
    INITIATED: 'initiated', // Project is in initial state
    DRAFT: 'DRAFT', // Project is in draft state
    PENDING_REVIEW: 'PENDING_REVIEW', // Project is waiting for initial review
    
    // Processing States
    PROCESS_CONTENT_IN_PROGRESS: 'process_content_in_progress', // Project is being processed
    IN_PROGRESS: 'IN_PROGRESS', // Project is actively being worked on
    ON_HOLD: 'ON_HOLD', // Project is temporarily paused
    IN_REVIEW: 'IN_REVIEW', // Project is under review
    
    // Preview States
    INITIAL_PREVIEW_DONE: 'initial_preview_done', // Initial preview has been completed
    
    // Completion States
    COMPLETED: 'COMPLETED', // Project has been successfully completed
    APPROVED: 'APPROVED', // Project has been approved by stakeholders
    PROMOTED: 'promoted', // Project has been successfully promoted
    
    // Cancellation States
    CANCELLED: 'CANCELLED', // Project has been cancelled
    ARCHIVED: 'ARCHIVED', // Project has been archived
    
    // Special States
    BLOCKED: 'BLOCKED', // Project is blocked by dependencies
    NEEDS_REVISION: 'NEEDS_REVISION', // Project needs revisions after review
    SCHEDULED: 'SCHEDULED' // Project is scheduled for future work
};

/**
 * Batch Status Constants
 * These statuses are used for tracking the state of individual batches within a project
 */
export const BATCH_STATUS = {
    PROCESSED: 'processed', // Batch has been processed
    COPY_IN_PROGRESS: 'copy_in_progress', // Batch is currently being copied
    PROMOTE_IN_PROGRESS: 'promote_in_progress', // Batch is currently being promoted
    PROMOTED: 'promoted' // Batch has been successfully promoted
};

/**
 * Helper function to get all available project statuses
 * @returns {string[]} Array of all project statuses
 */
export const getAllProjectStatuses = () => Object.values(PROJECT_STATUS);

/**
 * Helper function to get all available batch statuses
 * @returns {string[]} Array of all batch statuses
 */
export const getAllBatchStatuses = () => Object.values(BATCH_STATUS);

/**
 * Helper function to check if a status is valid
 * @param {string} status - The status to validate
 * @returns {boolean} True if the status is valid, false otherwise
 */
export const isValidProjectStatus = (status) => Object.values(PROJECT_STATUS).includes(status);

/**
 * Helper function to check if a batch status is valid
 * @param {string} status - The status to validate
 * @returns {boolean} True if the status is valid, false otherwise
 */
export const isValidBatchStatus = (status) => Object.values(BATCH_STATUS).includes(status);
