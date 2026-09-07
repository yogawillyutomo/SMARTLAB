<?php

namespace App\Http\Requests;

use App\Domain\WorkOrder\WorkOrderCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateWorkOrderRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['problemSummary', 'priority', 'scheduledFor', 'notes'];

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
        return [
            'problemSummary' => ['sometimes', 'string', 'min:3', 'max:2000'],
            'priority' => ['sometimes', Rule::in(WorkOrderCatalog::PRIORITIES)],
            'scheduledFor' => ['sometimes', 'nullable', 'date'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $this->rejectUnknownQueryFields($validator, []);
            if (array_intersect(self::FIELDS, array_keys($this->all())) === []) {
                $validator->errors()->add('body', 'At least one mutable Work Order field is required.');
            }
        });
    }
}
