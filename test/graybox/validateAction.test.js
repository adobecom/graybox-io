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

import validateAction from '../../actions/graybox/validateAction.js';
import GrayboxUser from '../../actions/grayboxUser.js';

const mockValidParams = {
    rootFolder: '/app',
    gbRootFolder: '/app-graybox',
    projectExcelPath: '/path/to/excel.xlsx',
    experienceName: '/max',
    spToken: 'abcde',
    adminPageUri: 'https://a.com/path?ref=branch&repo=app&owner=org',
    draftsOnly: true,
    promoteIgnorePaths: '/path1'
};

// Mock GrayboxUser class and its methods
jest.mock('../../actions/grayboxUser', () => jest.fn().mockImplementation(() => ({
    isInGroups: jest.fn().mockResolvedValue(true)
})));

describe('validateAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return 400 if required params are missing', async () => {
        const params = {
            // Missing some required parameters
        };
        const grpIds = [];
        const result = await validateAction(params, grpIds);
        expect(result.code).toBe(400);
    });

    test('should return 401 if user is not authorized', async () => {
        const params = mockValidParams;
        const grpIds = [];

        // Mocking user not authorized
        GrayboxUser.mockImplementation(() => ({
            isInGroups: jest.fn().mockResolvedValue(false)
        }));
        const result = await validateAction(params, grpIds);
        expect(result.code).toBe(401);
    });

    test('should return 200 if user is authorized and all required params are present', async () => {
        const params = mockValidParams;
        const grpIds = [];

        // Mocking user authorized
        GrayboxUser.mockImplementation(() => ({
            isInGroups: jest.fn().mockResolvedValue(true)
        }));
        const result = await validateAction(params, grpIds);
        expect(result.code).toBe(200);
    });

    test('should return 200 if ignoreUserCheck is true', async () => {
        const params = mockValidParams;
        const grpIds = [];
        const result = await validateAction(params, grpIds, true);
        expect(result.code).toBe(200);
        // GrayboxUser constructor should not get called
        expect(GrayboxUser).not.toHaveBeenCalled();
    });
});
