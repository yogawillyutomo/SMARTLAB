<?php

namespace App\Http\Requests;

use App\Domain\Inventory\InventoryCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListInventoryTransactionsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['inventoryItemId', 'kind', 'from', 'to', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'inventoryItemId' => ['sometimes', 'ulid'],
            'kind' => ['sometimes', Rule::in(InventoryCatalog::TRANSACTION_KINDS)],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
