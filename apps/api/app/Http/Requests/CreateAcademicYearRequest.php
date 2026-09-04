<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Domain\Academic\AcademicMasterNormalizer;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateAcademicYearRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['code', 'name', 'startsOn', 'endsOn', 'status'];

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
            'startsOn' => ['required', 'date_format:Y-m-d'],
            'endsOn' => ['required', 'date_format:Y-m-d'],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
