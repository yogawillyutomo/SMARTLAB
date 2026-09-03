<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Domain\Academic\AcademicMasterNormalizer;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateAcademicClassRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['code', 'name', 'gradeLevel', 'academicUnitId', 'homeroomTeacherId', 'studentCount', 'status'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
        if (is_string($this->input('code'))) {
            $normalized['code'] = AcademicMasterNormalizer::code((string) $this->input('code'));
        }
        if (is_string($this->input('name'))) {
            $normalized['name'] = AcademicMasterNormalizer::text((string) $this->input('name'));
        }
        if (is_string($this->input('status'))) {
            $normalized['status'] = mb_strtolower(trim((string) $this->input('status')));
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:64', 'regex:'.AcademicMasterCatalog::CODE_PATTERN],
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'gradeLevel' => ['required', 'integer', 'min:1', 'max:20'],
            'academicUnitId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'homeroomTeacherId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'studentCount' => ['sometimes', 'integer', 'min:0'],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
