<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListAcademicUnitsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['parentId', 'type', 'status', 'search', 'page', 'perPage'];

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
        foreach (['type', 'status'] as $field) {
            if (is_string($this->query($field))) {
                $normalized[$field] = mb_strtolower(trim((string) $this->query($field)));
            }
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'parentId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'type' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::ACADEMIC_UNIT_TYPES)],
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
