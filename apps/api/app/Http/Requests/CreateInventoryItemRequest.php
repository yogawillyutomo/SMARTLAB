<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateInventoryItemRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'itemCode', 'name', 'category', 'unit', 'minimumStock',
        'storageLocation', 'supplierName', 'unitPriceSnapshot',
    ];

    private const PROHIBITED = [
        'id', 'schoolId', 'school_id', 'onHandQuantity', 'quantity', 'version',
        'createdAt', 'updatedAt', 'created_at', 'updated_at',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('itemCode'))) {
            $this->merge(['itemCode' => strtoupper(trim((string) $this->input('itemCode')))]);
        }

        foreach (['name', 'category', 'unit'] as $field) {
            if (is_string($this->input($field))) {
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
            'itemCode' => [
                'required', 'string', 'regex:/^[A-Z0-9][A-Z0-9-]{2,31}$/',
                Rule::unique('inventory_items', 'item_code')->where(fn ($query) => $query->where('school_id', $this->schoolId())),
            ],
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'category' => ['required', 'string', 'min:1', 'max:120'],
            'unit' => ['required', 'string', 'min:1', 'max:32'],
            'minimumStock' => ['sometimes', 'numeric', 'decimal:0,3', 'min:0', 'max:999999999999.999'],
            'storageLocation' => ['sometimes', 'nullable', 'string', 'max:255'],
            'supplierName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'unitPriceSnapshot' => ['sometimes', 'nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999999.99'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields(
            $validator,
            [...self::FIELDS, ...self::PROHIBITED],
        ));
    }

    private function schoolId(): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $this->attributes->get(CurrentMembershipContext::class);

        return (string) $context->membership->school_id;
    }
}
