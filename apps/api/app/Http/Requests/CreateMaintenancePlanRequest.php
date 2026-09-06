<?php

namespace App\Http\Requests;

use App\Domain\Maintenance\MaintenanceCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateMaintenancePlanRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'assetId', 'name', 'frequencyKind', 'intervalDays', 'checklistTemplate',
        'assignedTechnicianReference', 'assignedTechnicianName', 'nextDueDate',
    ];

    private const PROHIBITED = ['id', 'schoolId', 'planCode', 'status', 'version', 'assetCode', 'assetName'];

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
            'assetId' => ['required', 'ulid'],
            'name' => ['required', 'string', 'min:3', 'max:255'],
            'frequencyKind' => ['required', Rule::in(MaintenanceCatalog::FREQUENCY_KINDS)],
            'intervalDays' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:3650'],
            'checklistTemplate' => ['required', 'array', 'min:1', 'max:50'],
            'checklistTemplate.*' => ['required', 'string', 'min:1', 'max:255', 'distinct'],
            'assignedTechnicianReference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'assignedTechnicianName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'nextDueDate' => ['required', 'date'],
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
            $custom = $this->input('frequencyKind') === 'custom_interval';
            if ($custom && ! $this->filled('intervalDays')) {
                $validator->errors()->add('intervalDays', 'The intervalDays field is required for custom_interval.');
            }
            if (! $custom && $this->exists('intervalDays') && $this->input('intervalDays') !== null) {
                $validator->errors()->add('intervalDays', 'The intervalDays field is only valid for custom_interval.');
            }
        });
    }
}
