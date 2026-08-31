<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateIncidentRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'laboratoryId', 'deviceId', 'category', 'priority', 'title', 'description',
        'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt',
    ];

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return array_fill_keys(self::FIELDS, ['sometimes']);
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $payload = $this->validationData();
            if ($payload === []) {
                $validator->errors()->add('payload', 'At least one Incident correction field is required.');
            }

            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }

    /** @return array<string, mixed> */
    public function validationData(): array
    {
        return $this->isJson() ? $this->json()->all() : $this->request->all();
    }

    /** @return array<string, mixed> */
    public function businessPayload(): array
    {
        return array_intersect_key($this->validationData(), array_flip(self::FIELDS));
    }
}
