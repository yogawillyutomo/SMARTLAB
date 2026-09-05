<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\ActivityReport\ActivityReportAttachmentService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireActivityReportVersionPrecondition;
use App\Http\Requests\UploadActivityReportAttachmentRequest;
use App\Http\Resources\ActivityReportAttachmentResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ActivityReportAttachmentController extends Controller
{
    public function index(Request $request, string $reportId, ActivityReportAttachmentService $service): JsonResponse
    {
        $items = $service->list($this->context($request), $reportId);

        return response()->json([
            'data' => ActivityReportAttachmentResource::collection($items)->resolve($request),
        ]);
    }

    public function store(
        UploadActivityReportAttachmentRequest $request,
        string $reportId,
        ActivityReportAttachmentService $service,
    ): JsonResponse {
        $result = $service->upload(
            $this->context($request),
            $this->actor($request),
            $reportId,
            (int) $request->attributes->get(RequireActivityReportVersionPrecondition::ATTRIBUTE),
            $request->file('file'),
        );

        return response()->json([
            'data' => (new ActivityReportAttachmentResource($result['attachment']))->resolve($request),
            'reportVersion' => (int) $result['report']->version,
        ], 201)->header('ETag', '"'.$result['report']->version.'"');
    }

    public function download(
        Request $request,
        string $reportId,
        string $attachmentId,
        ActivityReportAttachmentService $service,
    ): StreamedResponse {
        $attachment = $service->download($this->context($request), $reportId, $attachmentId);

        return Storage::disk((string) $attachment->storage_provider)->download(
            (string) $attachment->storage_key,
            (string) $attachment->file_name,
            [
                'Content-Type' => (string) $attachment->media_type,
                'X-Content-Type-Options' => 'nosniff',
                'Content-Security-Policy' => "default-src 'none'; sandbox",
                'Cache-Control' => 'private, no-store',
            ],
        );
    }

    private function context(Request $request): CurrentMembershipContext
    {
        return $request->attributes->get(CurrentMembershipContext::class);
    }

    private function actor(Request $request): User
    {
        return $request->user();
    }
}
