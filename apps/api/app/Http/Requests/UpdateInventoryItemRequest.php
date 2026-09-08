<?php

namespace App\Http\Requests;

use App\Domain\Inventory\InventoryCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateInventoryItemRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'name', 'category', 'unit', 'minimumStock',
        'storageLocation', 'supplierName', 'unitPriceSnapshot',
    ];

    private const PROHIBITED = [
        'id', 'schoolId', 'school_id', 'itemCode', 'onHandQuantity', 'quantity',
        'version', 'createdAt', 'updatedAt', 'created_at', 'updated_at',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['name', 'category', 'unit'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $this->merge([$field => trim((string) $this->input($field))]);
            }
        }

        foreach (['storageLocation', 'supplierName'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        $rules = [
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'category' => ['sometimes', 'string', 'min:1', 'max:120'],
            'unit' => ['sometimes', Rule::in(InventoryCatalog::UNITS)],
            'minimumStock' => ['sometimes', 'integer', 'min:0', 'max:999999999999'],
            'storageLocation' => ['sometimes', 'nullable', 'string', 'max:255'],
            'supplierName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'unitPriceSnapshot' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:9999999999999'],
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
            if (array_intersect(array_keys($this->all()), self::FIELDS) === []) {
                $validator->errors()->add('payload', 'At least one InventoryItem field must be provided.');
            }
        });
    }
}
