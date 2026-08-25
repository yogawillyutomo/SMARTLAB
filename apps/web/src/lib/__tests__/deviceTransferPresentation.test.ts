import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import {
  deviceTransferPresentationIssue,
  matchesTransferReconciliation,
  normalizeTransferReason,
  validateTransferForm,
} from '@/lib/deviceTransferPresentation';
import type { DeviceTransferDto } from '@/services/deviceTransferApi';

const transfer: DeviceTransferDto = {
  id: '01m0r8nsw938c2zcv44zyge824',
  deviceId: '01m0r8nsw938c2zcv44zyge820',
  deviceCode: 'DEV-0001',
  sourceLaboratory: { id: '01m0r8nsw938c2zcv44zyge821', code: 'LAB-A', name: 'Source Lab' },
  destinationLaboratory: { id: '01m0r8nsw938c2zcv44zyge822', code: 'LAB-B', name: 'Destination Lab' },
  reason: 'Move',
  actor: { id: '01m0r8nsw938c2zcv44zyge823', name: 'Operator' },
  deviceVersionBefore: 3,
  deviceVersionAfter: 4,
  createdAt: '2026-08-24T01:00:00.000Z',
};

describe('Device Transfer presentation and reconciliation', () => {
  it('normalizes and validates the constrained form', () => {
    expect(normalizeTransferReason('   ')).toBeNull();
    expect(validateTransferForm('', 'x')).toMatchObject({ destinationLaboratoryId: expect.any(String) });
    expect(validateTransferForm('01m0r8nsw938c2zcv44zyge822', 'x'.repeat(501))).toMatchObject({ reason: expect.any(String) });
  });

  it('matches only the submitted device/version/source/destination evidence', () => {
    expect(matchesTransferReconciliation(transfer, {
      deviceId: transfer.deviceId,
      submittedVersion: 3,
      sourceLaboratoryId: transfer.sourceLaboratory.id,
      destinationLaboratoryId: transfer.destinationLaboratory.id,
      reason: 'Move',
    })).toBe(true);
    expect(matchesTransferReconciliation(transfer, {
      deviceId: transfer.deviceId,
      submittedVersion: 2,
      sourceLaboratoryId: transfer.sourceLaboratory.id,
      destinationLaboratoryId: transfer.destinationLaboratory.id,
      reason: 'Move',
    })).toBe(false);
  });

  it('maps 412 without permitting automatic resubmission and marks network mutation ambiguous', () => {
    expect(deviceTransferPresentationIssue(new ApiClientError('stale', { kind: 'api', status: 412, code: 'DEVICE_VERSION_CONFLICT' }))).toMatchObject({ versionConflict: true, retryable: false });
    expect(deviceTransferPresentationIssue(new ApiClientError('offline', { kind: 'network' }))).toMatchObject({ ambiguous: true, retryable: false });
    expect(deviceTransferPresentationIssue(new ApiClientError('offline', { kind: 'network' }), 'history')).toMatchObject({ ambiguous: false, retryable: true });
  });

  it('maps the locked domain errors to controlled Indonesian presentation', () => {
    expect(deviceTransferPresentationIssue(new ApiClientError('same', { kind: 'api', status: 409, code: 'TRANSFER_SAME_LABORATORY' })).message).toContain('berbeda');
    expect(deviceTransferPresentationIssue(new ApiClientError('forbidden', { kind: 'api', status: 403, code: 'FORBIDDEN' })).retryable).toBe(false);
  });
});
