<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceCatalog;
use App\Http\Requests\Concerns\ValidatesClosedDevicePayload;
use App\Models\Device;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateDeviceRequest extends FormRequest
{
    use ValidatesClosedDevicePayload;

    public const MUTABLE_FIELDS = [
        'homeLaboratoryId', 'lifecycleStatus', 'serialNumber', 'hostname',
        'brand', 'model', 'technicalProfile',
    ];

    private const PROHIBITED_FIELDS = [
        'id', 'school_id', 'schoolId', 'qr_public_id', 'qrPublicId',
        'device_code', 'deviceCode', 'device_type', 'deviceType',
        'technical_profile_version', 'technicalProfileVersion', 'version',
        'created_at', 'createdAt', 'updated_at', 'updatedAt',
        'assetId', 'assetCode', 'laboratoryId', 'layoutId', 'position',
        'ipAddress', 'macAddress', 'status', 'currentLocation', 'telemetry', 'agentId',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalizeNullableStrings();
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'homeLaboratoryId' => ['sometimes', 'nullable', 'ulid'],
            'lifecycleStatus' => ['sometimes', Rule::in(DeviceCatalog::MUTABLE_LIFECYCLE_STATUSES)],
            'serialNumber' => ['sometimes', 'nullable', 'string', 'max:255'],
            'hostname' => ['sometimes', 'nullable', 'string', 'max:255'],
            'brand' => ['sometimes', 'nullable', 'string', 'max:255'],
            'model' => ['sometimes', 'nullable', 'string', 'max:255'],
            'technicalProfile' => ['sometimes', 'array'],
        ];
        foreach (self::PROHIBITED_FIELDS as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownFields($validator, [...self::MUTABLE_FIELDS, ...self::PROHIBITED_FIELDS]);
            if (array_intersect(array_keys($this->all()), self::MUTABLE_FIELDS) === []) {
                $validator->errors()->add('request', 'At least one mutable Device field is required.');
            }
            $device = Device::query()
                ->where('school_id', $this->schoolId())
                ->whereKey((string) $this->route('deviceId'))
                ->first();
            if ($device !== null) {
                $this->validateTechnicalProfile($validator, $device->device_type);
            }
        });
    }

    private function schoolId(): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $this->attributes->get(CurrentMembershipContext::class);

        return $context->membership->school_id;
    }
}
