<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceCatalog;
use App\Http\Requests\Concerns\ValidatesClosedDevicePayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateDeviceRequest extends FormRequest
{
    use ValidatesClosedDevicePayload;

    private const MUTABLE_FIELDS = [
        'deviceCode', 'deviceType', 'homeLaboratoryId', 'lifecycleStatus',
        'serialNumber', 'hostname', 'brand', 'model', 'technicalProfile',
    ];

    private const PROHIBITED_FIELDS = [
        'id', 'school_id', 'schoolId', 'qr_public_id', 'qrPublicId',
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
        if (is_string($this->input('deviceCode'))) {
            $this->merge(['deviceCode' => strtoupper(trim((string) $this->input('deviceCode')))]);
        }
        $this->normalizeNullableStrings();
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'deviceCode' => [
                'required', 'string', 'regex:/^[A-Z0-9][A-Z0-9-]{2,31}$/',
                Rule::unique('devices', 'device_code')->where(fn ($query) => $query->where('school_id', $this->schoolId())),
            ],
            'deviceType' => ['required', Rule::in(DeviceCatalog::TYPES)],
            'homeLaboratoryId' => [
                'sometimes', 'nullable', 'ulid',
                Rule::exists('laboratories', 'id')->where(fn ($query) => $query
                    ->where('school_id', $this->schoolId())->where('status', 'active')),
            ],
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
            if (is_string($this->input('deviceType')) && in_array($this->input('deviceType'), DeviceCatalog::TYPES, true)) {
                $this->validateTechnicalProfile($validator, (string) $this->input('deviceType'));
            }
        });
    }

    public function messages(): array
    {
        return ['homeLaboratoryId.exists' => 'The selected home laboratory is invalid.'];
    }

    private function schoolId(): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $this->attributes->get(CurrentMembershipContext::class);

        return $context->membership->school_id;
    }
}
