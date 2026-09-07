<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UseWorkOrderPartRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['inventoryItemId', 'clientMutationId', 'quantity'];

    private const PROHIBITED = [
        'id', 'schoolId', 'workOrderId', 'inventoryTransactionId',
        'sourceType', 'sourceId', 'kind', 'reason', 'balanceAfter',
        'actorUserId', 'actorMembershipId', 'usedAt', 'createdAt',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $rules = [
            'inventoryItemId' => ['required', 'ulid'],
            'clientMutationId' => ['required', 'uuid'],
            'quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0', 'max:999999999999.999'],
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
