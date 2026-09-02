<?php

namespace App\Http\Requests;

use App\Domain\Incident\IncidentPriority;
use App\Domain\Incident\IncidentStatus;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Normalizer;

class TransitionIncidentRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'toStatus',
        'triageSummary',
        'priority',
        'impact',
        'blocksLaboratoryOperation',
        'resolutionSummary',
        'verificationNote',
        'reason',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('toStatus'))) {
            $this->merge(['toStatus' => strtolower(trim((string) $this->input('toStatus')))]);
        }
        if (is_string($this->input('priority'))) {
            $this->merge(['priority' => strtolower(trim((string) $this->input('priority')))]);
        }

        foreach (['triageSummary', 'impact', 'resolutionSummary', 'verificationNote', 'reason'] as $field) {
            if (! is_string($this->input($field))) {
                continue;
            }

            $value = trim((string) $this->input($field));
            $normalized = Normalizer::normalize($value, Normalizer::FORM_C);
            $value = $normalized === false ? $value : $normalized;
            $this->merge([$field => $value === '' ? null : $value]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'toStatus' => ['required', 'string', Rule::in(IncidentStatus::values())],
            'triageSummary' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'priority' => ['sometimes', 'string', Rule::in(IncidentPriority::values())],
            'impact' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'blocksLaboratoryOperation' => ['sometimes', 'boolean'],
            'resolutionSummary' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'verificationNote' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
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
        return array_intersect_key($this->validated(), array_flip(self::FIELDS));
    }
}
