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

import { jest } from '@jest/globals';

// Mock the modules before importing
jest.unstable_mockModule('openwhisk', () => ({
    default: jest.fn()
}));

jest.unstable_mockModule('../actions/utils.js', () => ({
    getAioLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

jest.unstable_mockModule('../actions/graybox/filesWrapper.js', () => ({
    default: jest.fn()
}));

jest.unstable_mockModule('../actions/appConfig.js', () => ({
    default: jest.fn()
}));

jest.unstable_mockModule('../actions/sharepoint.js', () => ({
    default: jest.fn()
}));

jest.unstable_mockModule('../actions/graybox/statusUtils.js', () => ({
    writeProjectStatus: jest.fn()
}));

describe('Bulk Copy Scheduler System', () => {
    let mockFilesWrapper;
    let mockOpenwhisk;
    let mockAppConfig;
    let mockSharepoint;
    let mockStatusUtils;

    beforeEach(async () => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Setup mock filesWrapper
        mockFilesWrapper = {
            readFileIntoObject: jest.fn(),
            writeFile: jest.fn()
        };
        
        // Setup mock openwhisk
        mockOpenwhisk = {
            actions: {
                invoke: jest.fn()
            }
        };
        
        // Setup mock appConfig
        mockAppConfig = {
            getPayload: jest.fn(() => ({
                gbRootFolder: '/test',
                experienceName: 'test-exp',
                projectExcelPath: '/test/excel.xlsx'
            }))
        };
        
        // Setup mock sharepoint
        mockSharepoint = {
            getFileData: jest.fn(),
            getFileUsingDownloadUrl: jest.fn(),
            saveFileSimple: jest.fn(),
            updateExcelTable: jest.fn()
        };
        
        // Setup mock statusUtils
        mockStatusUtils = {
            writeProjectStatus: jest.fn()
        };
        
        // Configure the mocked modules
        const filesWrapperModule = await import('../actions/graybox/filesWrapper.js');
        const openwhiskModule = await import('openwhisk');
        const appConfigModule = await import('../actions/appConfig.js');
        const sharepointModule = await import('../actions/sharepoint.js');
        const statusUtilsModule = await import('../actions/graybox/statusUtils.js');
        
        filesWrapperModule.default.mockResolvedValue(mockFilesWrapper);
        openwhiskModule.default.mockReturnValue(mockOpenwhisk);
        appConfigModule.default.mockImplementation(() => mockAppConfig);
        sharepointModule.default.mockImplementation(() => mockSharepoint);
        statusUtilsModule.writeProjectStatus = mockStatusUtils.writeProjectStatus;
    });

    describe('Bulk Copy Scheduler', () => {
        test('should process projects with fragment_discovery_completed status', async () => {
            // Import the scheduler after mocking
            const { default: bulkCopySched } = await import('../actions/graybox/bulk-copy-sched.js');
            
            // Mock data
            const mockProjectQueue = [
                {
                    projectPath: '/test/project1',
                    status: 'fragment_discovery_completed',
                    createdTime: Date.now() - 1000
                },
                {
                    projectPath: '/test/project2',
                    status: 'fragment_discovery_completed',
                    createdTime: Date.now()
                }
            ];

            const mockBatchStatus = {
                'non_processing_batch_1': 'initiated',
                'non_processing_batch_2': 'initiated'
            };

            const mockProjectStatus = {
                params: { testParam: 'value' }
            };

            // Setup mocks
            mockFilesWrapper.readFileIntoObject
                .mockResolvedValueOnce(mockProjectQueue) // bulk_copy_project_queue.json
                .mockResolvedValueOnce(mockProjectStatus) // project status
                .mockResolvedValueOnce(mockBatchStatus); // batch status

            mockOpenwhisk.actions.invoke.mockResolvedValue({});

            // Execute
            const result = await bulkCopySched({});

            // Verify
            expect(result.code).toBe(200);
            expect(result.payload).toContain('Triggered Bulk Copy Non-Processing Worker Actions for 1 projects');
            expect(mockOpenwhisk.actions.invoke).toHaveBeenCalledWith({
                name: 'graybox/bulk-copy-non-processing-worker',
                blocking: false,
                result: false,
                params: expect.objectContaining({
                    project: '/test/project1',
                    batchName: 'non_processing_batch_1'
                })
            });
        });

        test('should skip projects with actions in progress', async () => {
            // Import the scheduler after mocking
            const { default: bulkCopySched } = await import('../actions/graybox/bulk-copy-sched.js');
            
            // Mock data
            const mockProjectQueue = [
                {
                    projectPath: '/test/project1',
                    status: 'fragment_discovery_completed',
                    createdTime: Date.now()
                }
            ];

            const mockBatchStatus = {
                'non_processing_batch_1': 'copy_in_progress'
            };

            const mockProjectStatus = {
                params: { testParam: 'value' }
            };

            // Setup mocks
            mockFilesWrapper.readFileIntoObject
                .mockResolvedValueOnce(mockProjectQueue)
                .mockResolvedValueOnce(mockProjectStatus)
                .mockResolvedValueOnce(mockBatchStatus);

            // Execute
            const result = await bulkCopySched({});

            // Verify
            expect(result.code).toBe(200);
            expect(result.payload).toContain('No projects were processed');
            expect(mockOpenwhisk.actions.invoke).not.toHaveBeenCalled();
        });

        test('should handle errors gracefully', async () => {
            // Import the scheduler after mocking
            const { default: bulkCopySched } = await import('../actions/graybox/bulk-copy-sched.js');
            
            // Mock error
            mockFilesWrapper.readFileIntoObject.mockRejectedValue(new Error('File read error'));

            // Execute
            const result = await bulkCopySched({});

            // Verify
            expect(result.code).toBe(200);
            expect(result.payload).toContain('Unknown error occurred');
        });
    });

    describe('Bulk Copy Non-Processing Worker', () => {
        test('should process batch files successfully', async () => {
            // Import the worker after mocking
            const { default: bulkCopyNonProcessingWorker } = await import('../actions/graybox/bulk-copy-non-processing-worker.js');
            
            // Mock data
            const mockBatchStatus = {
                'non_processing_batch_1': 'initiated'
            };

            const mockBatchFile = [
                '/source/file1.md',
                '/source/file2.md'
            ];

            const mockFileData = { fileDownloadUrl: 'http://example.com/file' };
            const mockFile = { name: 'test.md', content: 'test content' };
            const mockSaveStatus = { success: true };

            // Setup mocks
            mockFilesWrapper.readFileIntoObject
                .mockResolvedValueOnce(mockBatchStatus)
                .mockResolvedValueOnce(mockBatchFile);

            mockSharepoint.getFileData.mockResolvedValue(mockFileData);
            mockSharepoint.getFileUsingDownloadUrl.mockResolvedValue(mockFile);
            mockSharepoint.saveFileSimple.mockResolvedValue(mockSaveStatus);
            mockSharepoint.updateExcelTable.mockResolvedValue({});

            // Execute
            const result = await bulkCopyNonProcessingWorker({
                project: '/test/test-exp',
                batchName: 'non_processing_batch_1'
            });

            // Verify
            expect(result.body).toContain('Bulk Copy Non-Processing Worker finished copying content');
            expect(result.statusCode).toBe(200);
            expect(mockSharepoint.getFileData).toHaveBeenCalledTimes(2);
            expect(mockSharepoint.saveFileSimple).toHaveBeenCalledTimes(2);
        });

        test('should handle file copy failures', async () => {
            // Import the worker after mocking
            const { default: bulkCopyNonProcessingWorker } = await import('../actions/graybox/bulk-copy-non-processing-worker.js');
            
            // Mock data
            const mockBatchStatus = {
                'non_processing_batch_1': 'initiated'
            };

            const mockBatchFile = [
                '/source/file1.md'
            ];

            const mockFileData = { fileDownloadUrl: 'http://example.com/file' };
            const mockFile = { name: 'test.md', content: 'test content' };
            const mockSaveStatus = { success: false, errorMsg: 'File not found' };

            // Setup mocks
            mockFilesWrapper.readFileIntoObject
                .mockResolvedValueOnce(mockBatchStatus)
                .mockResolvedValueOnce(mockBatchFile);

            mockSharepoint.getFileData.mockResolvedValue(mockFileData);
            mockSharepoint.getFileUsingDownloadUrl.mockResolvedValue(mockFile);
            mockSharepoint.saveFileSimple.mockResolvedValue(mockSaveStatus);

            // Execute
            const result = await bulkCopyNonProcessingWorker({
                project: '/test/test-exp',
                batchName: 'non_processing_batch_1'
            });

            // Verify
            expect(result.body).toContain('Bulk Copy Non-Processing Worker finished copying content');
            expect(result.statusCode).toBe(200);
            expect(mockSharepoint.saveFileSimple).toHaveBeenCalledTimes(1);
        });
    });
});
