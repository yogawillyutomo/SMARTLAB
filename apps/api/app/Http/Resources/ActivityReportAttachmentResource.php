<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class ActivityReportAttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $available = false;
        try {
            $available = Storage::disk((string) $this->storage_provider)->exists((string) $this->storage_key);
        } catch (\Throwable) {
            $available = false;
        }

        return [
            'id' => (string) $this->id,
            'reportId' => (string) $this->report_id,
            'storageProvider' => (string) $this->storage_provider,
            'fileName' => (string) $this->file_name,
            'mediaType' => (string) $this->media_type,
            'sizeBytes' => (int) $this->size_bytes,
            'sha256' => (string) $this->sha256,
            'available' => $available,
            'uploadedBy' => [
                'userId' => (string) $this->uploaded_by_user_id,
                'membershipId' => (string) $this->uploaded_by_membership_id,
                'name' => (string) $this->uploaded_by_name_snapshot,
            ],
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
