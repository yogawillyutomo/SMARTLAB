<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListTeachersRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['academicUnitId', 'membershipId', 'status', 'search', 'page', 'perPage'];

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
            $normalized['status'] = mb_strtolower(trim((string) $this->query('status')));
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'academicUnitId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'membershipId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
            'search' => ['sometimes', 'string', 'min:1', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
