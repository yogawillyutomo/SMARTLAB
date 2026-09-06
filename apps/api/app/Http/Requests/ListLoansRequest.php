<?php

namespace App\Http\Requests;

use App\Domain\Loan\LoanCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListLoansRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['status', 'overdue', 'search', 'assetId', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', Rule::in(LoanCatalog::STATUSES)],
            'overdue' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'string', 'min:1', 'max:255'],
            'assetId' => ['sometimes', 'ulid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
