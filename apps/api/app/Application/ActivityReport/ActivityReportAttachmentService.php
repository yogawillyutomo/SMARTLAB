<?php

namespace App\Application\ActivityReport;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\ActivityReport\ActivityReportDomainException;
use App\Models\ActivityReport;
use App\Models\ActivityReportAttachment;
use App\Models\School;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ActivityReportAttachmentService
{
    public function __construct(private readonly ActivityReportEventRecorder $recorder)
    {
    }

    /** @return Collection<int,ActivityReportAttachment> */
    public function list(CurrentMembershipContext $context, string $reportId): Collection
    {
        $report = $this->reportForRead($context, $reportId);

        return ActivityReportAttachment::query()
            ->where('school_id', $context->membership->school_id)
            ->where('report_id', $report->id)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();
    }

    /** @return array{attachment:ActivityReportAttachment,report:ActivityReport} */
    public function upload(
        CurrentMembershipContext $context,
        User $actor,
        string $reportId,
        int $expectedVersion,
        UploadedFile $file,
    ): array {
        $disk = (string) config('activity_reports.attachments.disk', 'local');
        if (! array_key_exists($disk, (array) config('filesystems.disks', []))) {
            throw ActivityReportDomainException::attachmentStorageFailed('Attachment storage disk is not configured.');
        }

        $mediaType = (string) ($file->getMimeType() ?? '');
        $allowed = (array) config('activity_reports.attachments.media_types', []);
        if (! in_array($mediaType, $allowed, true)) {
            throw ActivityReportDomainException::attachmentStorageFailed('Attachment media type is not allowed.', 422);
        }

        $realPath = $file->getRealPath();
        if (! is_string($realPath) || $realPath === '') {
            throw ActivityReportDomainException::attachmentStorageFailed('Uploaded attachment cannot be read.');
        }

        $sha256 = hash_file('sha256', $realPath);
        if (! is_string($sha256) || strlen($sha256) !== 64) {
            throw ActivityReportDomainException::attachmentStorageFailed('Attachment checksum could not be calculated.');
        }

        $extension = match ($mediaType) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'application/pdf' => 'pdf',
            default => 'bin',
        };
        $attachmentId = (string) Str::ulid();
        $stored = false;
        $storageKey = '';

        try {
            return DB::transaction(function () use (
                $context,
                $actor,
                $reportId,
                $expectedVersion,
                $file,
                $disk,
                $mediaType,
                $sha256,
                $extension,
                $attachmentId,
                &$stored,
                &$storageKey,
            ): array {
                $schoolId = (string) $context->membership->school_id;
                School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

                $report = ActivityReport::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($reportId)
                    ->lockForUpdate()
                    ->first();

                if ($report === null) {
                    throw ActivityReportDomainException::notFound();
                }
                $this->assertAccess($context, $report);
                if ($report->version !== $expectedVersion) {
                    throw ActivityReportDomainException::versionConflict();
                }
                if ($report->status !== 'draft') {
                    throw ActivityReportDomainException::stateConflict('Attachments may only be added to an editable draft Activity Report.');
                }

                $storageKey = 'activity-reports/'.$schoolId.'/'.$report->id.'/'.$attachmentId.'.'.$extension;
                $stream = fopen($file->getRealPath(), 'rb');
                if ($stream === false) {
                    throw ActivityReportDomainException::attachmentStorageFailed('Uploaded attachment cannot be opened.');
                }

                try {
                    $stored = Storage::disk($disk)->put($storageKey, $stream);
                } finally {
                    fclose($stream);
                }

                if (! $stored) {
                    throw ActivityReportDomainException::attachmentStorageFailed('Attachment storage write failed.');
                }

                $name = basename(str_replace('\\', '/', (string) $file->getClientOriginalName()));
                $name = trim($name);
                if ($name === '') $name = 'attachment.'.$extension;
                $name = Str::limit($name, 255, '');

                $attachment = new ActivityReportAttachment([
                    'school_id' => $schoolId,
                    'report_id' => $report->id,
                    'storage_provider' => $disk,
                    'storage_key' => $storageKey,
                    'file_name' => $name,
                    'media_type' => $mediaType,
                    'size_bytes' => (int) $file->getSize(),
                    'sha256' => $sha256,
                    'uploaded_by_user_id' => $actor->id,
                    'uploaded_by_membership_id' => $context->membership->id,
                    'uploaded_by_name_snapshot' => $actor->name,
                    'created_at' => now(),
                ]);
                $attachment->id = $attachmentId;
                $attachment->save();

                $before = $report->version;
                $report->version++;
                $report->save();

                $this->recorder->record(
                    $context,
                    $actor,
                    $report,
                    'activity_report.attachment_added',
                    [
                        'attachmentId' => $attachmentId,
                        'fileName' => $name,
                        'mediaType' => $mediaType,
                        'sizeBytes' => (int) $file->getSize(),
                        'sha256' => $sha256,
                    ],
                    $before,
                    $report->version,
                );

                return [
                    'attachment' => $attachment->fresh() ?? $attachment,
                    'report' => $report->fresh() ?? $report,
                ];
            });
        } catch (\Throwable $exception) {
            if ($stored && $storageKey !== '') {
                try {
                    Storage::disk($disk)->delete($storageKey);
                } catch (\Throwable) {
                }
            }
            throw $exception;
        }
    }

    public function download(CurrentMembershipContext $context, string $reportId, string $attachmentId): ActivityReportAttachment
    {
        $report = $this->reportForRead($context, $reportId);

        $attachment = ActivityReportAttachment::query()
            ->where('school_id', $context->membership->school_id)
            ->where('report_id', $report->id)
            ->whereKey($attachmentId)
            ->first();

        if ($attachment === null) {
            throw ActivityReportDomainException::attachmentNotFound();
        }

        try {
            if (! Storage::disk((string) $attachment->storage_provider)->exists((string) $attachment->storage_key)) {
                throw ActivityReportDomainException::attachmentUnavailable();
            }
        } catch (ActivityReportDomainException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw ActivityReportDomainException::attachmentUnavailable();
        }

        return $attachment;
    }

    private function reportForRead(CurrentMembershipContext $context, string $reportId): ActivityReport
    {
        $report = ActivityReport::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($reportId)
            ->first();

        if ($report === null) {
            throw ActivityReportDomainException::notFound();
        }

        $this->assertAccess($context, $report);

        return $report;
    }

    private function assertAccess(CurrentMembershipContext $context, ActivityReport $report): void
    {
        if ($context->permissions->contains('activity-reports.view-all')) {
            return;
        }

        if ($report->owner_membership_id !== $context->membership->id) {
            throw ActivityReportDomainException::notFound();
        }
    }
}
