<?php

namespace App\Http\Requests;

use App\Domain\Inventory\InventoryCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateInventoryTransactionRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['inventoryItemId', 'clientMutationId', 'kind', 'quantity', 'reason'];

    private const PROHIBITED = [
        'id', 'schoolId', 'school_id', 'signedDelta', 'balanceBefore', 'balanceAfter',
        'itemVersionAfter', 'sourceType', 'sourceId', 'actorUserId', 'actorMembershipId',
        'actorNameSnapshot', 'occurredAt', 'createdAt', 'requestSha256',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('reason'))) {
            $this->merge(['reason' => trim((string) $this->input('reason'))]);
        }
    }

    public function rules(): array
    {
        $rules = [
            'inventoryItemId' => ['required', 'ulid'],
            'clientMutationId' => ['required', 'uuid'],
            'kind' => ['required', Rule::in(InventoryCatalog::TRANSACTION_KINDS)],
            'quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999999.999'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
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
}
