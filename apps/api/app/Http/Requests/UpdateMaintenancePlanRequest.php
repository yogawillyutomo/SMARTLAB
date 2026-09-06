<?php

namespace App\Http\Requests;

use App\Domain\Maintenance\MaintenanceCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateMaintenancePlanRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'name', 'frequencyKind', 'intervalDays', 'checklistTemplate',
        'assignedTechnicianReference', 'assignedTechnicianName', 'nextDueDate',
    ];

    private const PROHIBITED = ['id', 'schoolId', 'planCode', 'assetId', 'status', 'version', 'assetCode', 'assetName'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['name', 'assignedTechnicianReference', 'assignedTechnicianName'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && $field !== 'name' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        $rules = [
            'name' => ['sometimes', 'string', 'min:3', 'max:255'],
            'frequencyKind' => ['sometimes', Rule::in(MaintenanceCatalog::FREQUENCY_KINDS)],
            'intervalDays' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:3650'],
            'checklistTemplate' => ['sometimes', 'array', 'min:1', 'max:50'],
            'checklistTemplate.*' => ['required', 'string', 'min:1', 'max:255', 'distinct'],
            'assignedTechnicianReference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'assignedTechnicianName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'nextDueDate' => ['sometimes', 'date'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, [...self::FIELDS, ...self::PROHIBITED]);

            if (! collect(self::FIELDS)->contains(fn (string $field): bool => $this->exists($field))) {
                $validator->errors()->add('body', 'At least one mutable MaintenancePlan field is required.');
            }
        });
    }
}
