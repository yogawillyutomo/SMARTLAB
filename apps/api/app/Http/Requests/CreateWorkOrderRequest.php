<?php

namespace App\Http\Requests;

use App\Domain\WorkOrder\WorkOrderCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateWorkOrderRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['assetId', 'laboratoryId', 'incidentId', 'problemSummary', 'priority', 'scheduledFor', 'notes'];

    private const PROHIBITED = [
        'id', 'schoolId', 'workOrderNumber', 'status', 'version',
        'assetCode', 'assetCodeSnapshot', 'conditionBefore', 'conditionAfter',
        'assigneeMembershipId', 'technician', 'custodyActive',
    ];

    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        foreach (['problemSummary', 'notes'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && $field === 'notes' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        $rules = [
            'assetId' => ['required', 'ulid'],
            'laboratoryId' => ['required', 'ulid'],
            'incidentId' => ['sometimes', 'nullable', 'ulid'],
            'problemSummary' => ['required', 'string', 'min:3', 'max:2000'],
            'priority' => ['sometimes', Rule::in(WorkOrderCatalog::PRIORITIES)],
            'scheduledFor' => ['sometimes', 'nullable', 'date'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
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
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
