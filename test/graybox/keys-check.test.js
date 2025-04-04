/* ************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2025 Adobe
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

/* eslint-disable max-len */
const { main } = require('../../actions/graybox/keys-check');

jest.mock('../../actions/utils', () => ({
    getAioLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn()
    })
}));

describe('keys-check action', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return message when no keys are provided', async () => {
        const params = {};
        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.message).toBe('No keys found to check');
    });

    test('should handle error when parsing invalid JSON', async () => {
        const params = {
            helixAdminApiKeys: 'invalid-json'
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.message).toBe('No keys found to check');
    });

    test('should correctly identify valid keys', async () => {
        const nowMock = jest.spyOn(Date, 'now').mockReturnValue(1700000000000); // ~Nov 2023

        const params = {
            helixAdminApiKeys: JSON.stringify({
                'test-key': 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ijdzb2k4N3pkb3NJRnc4b19fbVR5a082QlVRNEZBVGhjaHlyNGZqY1dSbWcifQ.eyJlbWFpbCI6ImhlbGl4QGFkb2JlLmNvbSIsIm5hbWUiOiJIZWxpeCBBZG1pbiIsInJvbGVzIjpbInB1Ymxpc2giXSwiaWF0IjoxNzQzNjYyNjM4LCJpc3MiOiJodHRwczovL2FkbWluLmhseC5wYWdlLyIsImF1ZCI6IjgzYTM2MzU1LWFkMTctNGVkMC04NzAxLWU5OWEzMDIwZjg2YSIsInN1YiI6ImFkb2JlY29tL2ZlZGVyYWwtZ3JheWJveCIsImV4cCI6MTc3NTE5ODYzOCwianRpIjoiYjNITVdYN1ZKR1Nid2VVbVZwclJsSExycTZjcWw3YTFtRXlObVZPd3E0R1oifQ.yb8x6Dd_ttdv11FN9sCL44ksLTQlxebywr8drB0Y-edKDlK2bdUwsR0FTEQbLjmQNLwi86YMYMnxQWye-lElaUcxDu1PmFi1zhH0RhlilOs0u3TZev6saS4WDQ0Fm5UHhYEvecqOEKfGCxNXpXA91t5C4xAODpUo2C2QXDCZX9sGvQg971gwgtfwEJ-XselKc1apF7lUxQA2mwWgwiyi-nAMAm7wSqHqtdYgIjylOQVshUKzA1_YqThxjEK65SKRebi1djeW5dNaTwIuMZdwQQ8W0Ske2DfgySkSRGXw_CUNSe-HTyYskQFLwo42sjnFaNQ9M37eSPb6i6mpqq3akg'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.summary.total).toBe(1);
        expect(result.body.summary.valid).toBe(1);
        expect(result.body.details['test-key'].status).toBe('valid');
        expect(result.body.details['test-key'].subject).toBe('adobecom/federal-graybox');

        nowMock.mockRestore();
    });

    test('should correctly identify expiring soon keys', async () => {
        const nowMock = jest.spyOn(Date, 'now').mockReturnValue(1774000000000); // ~May 2026

        const params = {
            helixAdminApiKeys: JSON.stringify({
                'expiring-key': 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ijdzb2k4N3pkb3NJRnc4b19fbVR5a082QlVRNEZBVGhjaHlyNGZqY1dSbWcifQ.eyJlbWFpbCI6ImhlbGl4QGFkb2JlLmNvbSIsIm5hbWUiOiJIZWxpeCBBZG1pbiIsInJvbGVzIjpbInB1Ymxpc2giXSwiaWF0IjoxNzQzNjYyNjM4LCJpc3MiOiJodHRwczovL2FkbWluLmhseC5wYWdlLyIsImF1ZCI6IjgzYTM2MzU1LWFkMTctNGVkMC04NzAxLWU5OWEzMDIwZjg2YSIsInN1YiI6ImFkb2JlY29tL2ZlZGVyYWwtZ3JheWJveCIsImV4cCI6MTc3NTE5ODYzOCwianRpIjoiYjNITVdYN1ZKR1Nid2VVbVZwclJsSExycTZjcWw3YTFtRXlObVZPd3E0R1oifQ.yb8x6Dd_ttdv11FN9sCL44ksLTQlxebywr8drB0Y-edKDlK2bdUwsR0FTEQbLjmQNLwi86YMYMnxQWye-lElaUcxDu1PmFi1zhH0RhlilOs0u3TZev6saS4WDQ0Fm5UHhYEvecqOEKfGCxNXpXA91t5C4xAODpUo2C2QXDCZX9sGvQg971gwgtfwEJ-XselKc1apF7lUxQA2mwWgwiyi-nAMAm7wSqHqtdYgIjylOQVshUKzA1_YqThxjEK65SKRebi1djeW5dNaTwIuMZdwQQ8W0Ske2DfgySkSRGXw_CUNSe-HTyYskQFLwo42sjnFaNQ9M37eSPb6i6mpqq3akg'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.summary.expiringSoon).toBe(1);
        expect(result.body.details['expiring-key'].status).toBe('expiring_soon');

        nowMock.mockRestore();
    });

    test('should correctly identify expired keys', async () => {
        const nowMock = jest.spyOn(Date, 'now').mockReturnValue(1780000000000); // ~May 2026

        const params = {
            helixAdminApiKeys: JSON.stringify({
                'expired-key': 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ijdzb2k4N3pkb3NJRnc4b19fbVR5a082QlVRNEZBVGhjaHlyNGZqY1dSbWcifQ.eyJlbWFpbCI6ImhlbGl4QGFkb2JlLmNvbSIsIm5hbWUiOiJIZWxpeCBBZG1pbiIsInJvbGVzIjpbInB1Ymxpc2giXSwiaWF0IjoxNzQzNjYyNjM4LCJpc3MiOiJodHRwczovL2FkbWluLmhseC5wYWdlLyIsImF1ZCI6IjgzYTM2MzU1LWFkMTctNGVkMC04NzAxLWU5OWEzMDIwZjg2YSIsInN1YiI6ImFkb2JlY29tL2ZlZGVyYWwtZ3JheWJveCIsImV4cCI6MTc3NTE5ODYzOCwianRpIjoiYjNITVdYN1ZKR1Nid2VVbVZwclJsSExycTZjcWw3YTFtRXlObVZPd3E0R1oifQ.yb8x6Dd_ttdv11FN9sCL44ksLTQlxebywr8drB0Y-edKDlK2bdUwsR0FTEQbLjmQNLwi86YMYMnxQWye-lElaUcxDu1PmFi1zhH0RhlilOs0u3TZev6saS4WDQ0Fm5UHhYEvecqOEKfGCxNXpXA91t5C4xAODpUo2C2QXDCZX9sGvQg971gwgtfwEJ-XselKc1apF7lUxQA2mwWgwiyi-nAMAm7wSqHqtdYgIjylOQVshUKzA1_YqThxjEK65SKRebi1djeW5dNaTwIuMZdwQQ8W0Ske2DfgySkSRGXw_CUNSe-HTyYskQFLwo42sjnFaNQ9M37eSPb6i6mpqq3akg'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.summary.expired).toBe(1);
        expect(result.body.details['expired-key'].status).toBe('expired');
        expect(result.body.details['expired-key'].expiresIn).toBe('already expired');

        nowMock.mockRestore();
    });

    test('should handle invalid JWT format', async () => {
        const params = {
            helixAdminApiKeys: JSON.stringify({
                'invalid-key': 'not-a-valid-jwt'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.summary.unknown).toBe(1);
        expect(result.body.details['invalid-key'].status).toBe('unknown');
        expect(result.body.details['invalid-key'].message).toBe('Not a valid JWT format');
    });

    test('should handle multiple keys with different statuses', async () => {
        const nowMock = jest.spyOn(Date, 'now').mockReturnValue(1774000000000); // ~May 2026

        const params = {
            helixAdminApiKeys: JSON.stringify({
                'valid-key': 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ijdzb2k4N3pkb3NJRnc4b19fbVR5a082QlVRNEZBVGhjaHlyNGZqY1dSbWcifQ.eyJlbWFpbCI6ImhlbGl4QGFkb2JlLmNvbSIsIm5hbWUiOiJIZWxpeCBBZG1pbiIsInJvbGVzIjpbInB1Ymxpc2giXSwiaWF0IjoxNzQzNjYyNjM4LCJpc3MiOiJodHRwczovL2FkbWluLmhseC5wYWdlLyIsImF1ZCI6IjgzYTM2MzU1LWFkMTctNGVkMC04NzAxLWU5OWEzMDIwZjg2YSIsInN1YiI6ImFkb2JlY29tL2ZlZGVyYWwtZ3JheWJveCIsImV4cCI6MTc3NTE5ODYzOCwianRpIjoiYjNITVdYN1ZKR1Nid2VVbVZwclJsSExycTZjcWw3YTFtRXlObVZPd3E0R1oifQ.yb8x6Dd_ttdv11FN9sCL44ksLTQlxebywr8drB0Y-edKDlK2bdUwsR0FTEQbLjmQNLwi86YMYMnxQWye-lElaUcxDu1PmFi1zhH0RhlilOs0u3TZev6saS4WDQ0Fm5UHhYEvecqOEKfGCxNXpXA91t5C4xAODpUo2C2QXDCZX9sGvQg971gwgtfwEJ-XselKc1apF7lUxQA2mwWgwiyi-nAMAm7wSqHqtdYgIjylOQVshUKzA1_YqThxjEK65SKRebi1djeW5dNaTwIuMZdwQQ8W0Ske2DfgySkSRGXw_CUNSe-HTyYskQFLwo42sjnFaNQ9M37eSPb6i6mpqq3akg',
                'invalid-key': 'not-a-valid-jwt'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(200);
        expect(result.body.summary.total).toBe(2);
        expect(result.body.summary.expiringSoon).toBe(1);
        expect(result.body.summary.unknown).toBe(1);

        nowMock.mockRestore();
    });

    test('should handle unexpected errors', async () => {
        const nowMock = jest.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('Unexpected error');
        });

        const params = {
            helixAdminApiKeys: JSON.stringify({
                'test-key': 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ijdzb2k4N3pkb3NJRnc4b19fbVR5a082QlVRNEZBVGhjaHlyNGZqY1dSbWcifQ.eyJlbWFpbCI6ImhlbGl4QGFkb2JlLmNvbSIsIm5hbWUiOiJIZWxpeCBBZG1pbiIsInJvbGVzIjpbInB1Ymxpc2giXSwiaWF0IjoxNzQzNjYyNjM4LCJpc3MiOiJodHRwczovL2FkbWluLmhseC5wYWdlLyIsImF1ZCI6IjgzYTM2MzU1LWFkMTctNGVkMC04NzAxLWU5OWEzMDIwZjg2YSIsInN1YiI6ImFkb2JlY29tL2ZlZGVyYWwtZ3JheWJveCIsImV4cCI6MTc3NTE5ODYzOCwianRpIjoiYjNITVdYN1ZKR1Nid2VVbVZwclJsSExycTZjcWw3YTFtRXlObVZPd3E0R1oifQ.yb8x6Dd_ttdv11FN9sCL44ksLTQlxebywr8drB0Y-edKDlK2bdUwsR0FTEQbLjmQNLwi86YMYMnxQWye-lElaUcxDu1PmFi1zhH0RhlilOs0u3TZev6saS4WDQ0Fm5UHhYEvecqOEKfGCxNXpXA91t5C4xAODpUo2C2QXDCZX9sGvQg971gwgtfwEJ-XselKc1apF7lUxQA2mwWgwiyi-nAMAm7wSqHqtdYgIjylOQVshUKzA1_YqThxjEK65SKRebi1djeW5dNaTwIuMZdwQQ8W0Ske2DfgySkSRGXw_CUNSe-HTyYskQFLwo42sjnFaNQ9M37eSPb6i6mpqq3akg'
            })
        };

        const result = await main(params);

        expect(result.statusCode).toBe(500);
        expect(result.body.error).toBe('An error occurred while checking keys');
        expect(result.body.message).toBe('Unexpected error');

        nowMock.mockRestore();
    });
});
