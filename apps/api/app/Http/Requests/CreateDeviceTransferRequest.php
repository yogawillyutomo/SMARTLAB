<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesClosedDevicePayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CreateDeviceTransferRequest extends FormRequest
{
    use ValidatesClosedDevicePayload;

    private const FIELDS = ['destinationLaboratoryId', 'reason'];

    private const PROHIBITED_FIELDS = [
        'id', 'schoolId', 'deviceId', 'deviceCode', 'sourceLaboratoryId',
        'sourceLaboratory', 'destinationLaboratory', 'actor', 'actorUserId',
        'deviceVersionBefore', 'deviceVersionAfter', 'createdAt', 'status',
        'version', 'device_id', 'school_id', 'source_laboratory_id', 'destination_laboratory_id',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('reason'))) {
            $reason = trim((string) $this->input('reason'));
            $this->merge(['reason' => $reason === '' ? null : $reason]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'destinationLaboratoryId' => ['required', 'string', 'ulid'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
        foreach (self::PROHIBITED_FIELDS as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownFields($validator, [...self::FIELDS, ...self::PROHIBITED_FIELDS]);
        });
    }
}
