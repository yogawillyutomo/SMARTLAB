<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CreateIncidentRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const SUBMISSION_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';

    private const BUSINESS_FIELDS = [
        'laboratoryId', 'deviceId', 'category', 'priority', 'title', 'description',
        'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt',
    ];

    private const FIELDS = ['submissionId', ...self::BUSINESS_FIELDS];

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'submissionId' => ['bail', 'required', 'string', 'regex:'.self::SUBMISSION_PATTERN],
            'laboratoryId' => ['required'],
            'deviceId' => ['sometimes', 'nullable'],
            'category' => ['required'],
            'priority' => ['sometimes'],
            'title' => ['required'],
            'description' => ['required'],
            'impact' => ['sometimes', 'nullable'],
            'blocksLaboratoryOperation' => ['sometimes'],
            'stepsTaken' => ['sometimes', 'nullable'],
            'occurredAt' => ['required'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
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
        return array_intersect_key($this->validationData(), array_flip(self::BUSINESS_FIELDS));
    }
}
