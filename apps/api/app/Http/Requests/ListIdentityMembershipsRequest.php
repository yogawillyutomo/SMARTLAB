<?php

namespace App\Http\Requests;

use App\Domain\Identity\IdentityCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListIdentityMembershipsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['search', 'status', 'roleKey', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];

        if (is_string($this->query('search'))) {
            $normalized['search'] = trim((string) $this->query('search'));
        }
        if (is_string($this->query('status'))) {
            $normalized['status'] = trim((string) $this->query('status'));
        }
        if (is_string($this->query('roleKey'))) {
            $normalized['roleKey'] = mb_strtolower(trim((string) $this->query('roleKey')));
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'string', 'min:1', 'max:100'],
            'status' => ['sometimes', 'string', Rule::in(IdentityCatalog::STATUSES)],
            'roleKey' => ['sometimes', 'string', Rule::in(IdentityCatalog::roleKeys())],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
