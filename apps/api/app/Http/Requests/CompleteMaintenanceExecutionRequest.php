<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CompleteMaintenanceExecutionRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['findings', 'actionTaken'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && $field === 'findings' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        return [
            'checklistResults' => ['required', 'array', 'min:1', 'max:50'],
            'checklistResults.*' => ['required', 'boolean'],
            'findings' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'actionTaken' => ['required', 'string', 'min:3', 'max:5000'],
            'conditionAfter' => ['required', Rule::in(AssetCatalog::CONDITIONS)],
            'inventoryIssues' => ['sometimes', 'array', 'max:20'],
            'inventoryIssues.*' => ['required', 'array'],
            'inventoryIssues.*.inventoryItemId' => ['required', 'ulid', 'distinct'],
            'inventoryIssues.*.clientMutationId' => ['required', 'uuid', 'distinct'],
            'inventoryIssues.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999999.999'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, [
                'checklistResults', 'findings', 'actionTaken', 'conditionAfter', 'inventoryIssues',
            ]);
            $this->rejectUnknownQueryFields($validator, []);

            $issues = $this->input('inventoryIssues');
            if (! is_array($issues)) {
                return;
            }

            foreach ($issues as $index => $issue) {
                if (! is_array($issue)) {
                    continue;
                }
                foreach (array_diff(array_keys($issue), ['inventoryItemId', 'clientMutationId', 'quantity']) as $field) {
                    $validator->errors()->add("inventoryIssues.{$index}.{$field}", "The inventoryIssues.{$index}.{$field} field is prohibited.");
                }
            }
        });
    }
}
