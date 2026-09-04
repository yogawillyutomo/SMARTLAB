<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Domain\Academic\AcademicMasterNormalizer;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateTeacherRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['code', 'personnelNumber', 'name', 'email', 'phone', 'academicUnitId', 'membershipId', 'status'];

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
        if (array_key_exists('personnelNumber', $this->all()) && (is_string($this->input('personnelNumber')) || $this->input('personnelNumber') === null)) {
            $normalized['personnelNumber'] = AcademicMasterNormalizer::nullableCode($this->input('personnelNumber'));
        }
        if (is_string($this->input('name'))) {
            $normalized['name'] = AcademicMasterNormalizer::text((string) $this->input('name'));
        }
        if (array_key_exists('email', $this->all()) && (is_string($this->input('email')) || $this->input('email') === null)) {
            $normalized['email'] = AcademicMasterNormalizer::nullableEmail($this->input('email'));
        }
        if (array_key_exists('phone', $this->all()) && (is_string($this->input('phone')) || $this->input('phone') === null)) {
            $normalized['phone'] = AcademicMasterNormalizer::nullableText($this->input('phone'));
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
            'personnelNumber' => ['sometimes', 'nullable', 'string', 'max:64', 'regex:'.AcademicMasterCatalog::CODE_PATTERN],
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:64'],
            'academicUnitId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'membershipId' => ['sometimes', 'nullable', 'string', 'ulid'],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
