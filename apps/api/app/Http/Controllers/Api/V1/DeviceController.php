<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Device\DeviceMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireDeviceVersionPrecondition;
use App\Http\Requests\CreateDeviceRequest;
use App\Http\Requests\ListDevicesRequest;
use App\Http\Requests\UpdateDeviceRequest;
use App\Http\Resources\DeviceResource;
use App\Models\Device;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceController extends Controller
{
    public function index(ListDevicesRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = Device::query()->where('school_id', $this->context($request)->membership->school_id);

        foreach (['homeLaboratoryId' => 'home_laboratory_id', 'deviceType' => 'device_type', 'lifecycleStatus' => 'lifecycle_status'] as $field => $column) {
            if (array_key_exists($field, $validated)) {
                $query->where($column, $validated[$field]);
            }
        }
        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
            $query->where(function (Builder $query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['device_code', 'hostname', 'serial_number', 'brand', 'model'] as $index => $column) {
                    $boolean = $index === 0 ? 'and' : 'or';
                    $wrappedColumn = $grammar->wrap($column);
                    $query->whereRaw("LOWER({$wrappedColumn}) LIKE ? ESCAPE '\\'", [$pattern], $boolean);
                }
            });
        }

        $perPage = (int) ($validated['perPage'] ?? 25);
        $page = (int) ($validated['page'] ?? 1);
        $paginator = $query->orderBy('device_code')->orderBy('id')->paginate($perPage, ['*'], 'page', $page);

        return response()->json([
            'data' => DeviceResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateDeviceRequest $request, DeviceMutationService $service): JsonResponse
    {
        $device = $service->create($this->context($request), $request->validated());

        return $this->deviceResponse($device, $request, 201);
    }

    public function show(Request $request, string $deviceId): JsonResponse
    {
        $device = Device::query()
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($deviceId)
            ->first();
        if ($device === null) {
            throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
        }

        return $this->deviceResponse($device, $request);
    }

    public function update(UpdateDeviceRequest $request, string $deviceId, DeviceMutationService $service): JsonResponse
    {
        $device = $service->update(
            $this->context($request),
            $deviceId,
            (int) $request->attributes->get(RequireDeviceVersionPrecondition::ATTRIBUTE),
            $request->validated(),
        );

        return $this->deviceResponse($device, $request);
    }

    private function deviceResponse(Device $device, Request $request, int $status = 200): JsonResponse
    {
        return (new DeviceResource($device))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$device->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
