<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Domain\Academic\AcademicMasterNormalizer;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateLessonPeriodRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['lessonPeriodSetId', 'code', 'sequence', 'startsAt', 'endsAt', 'kind', 'status'];

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
        if (is_string($this->input('kind'))) {
            $normalized['kind'] = mb_strtolower(trim((string) $this->input('kind')));
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
            'lessonPeriodSetId' => ['required', 'string', 'ulid'],
            'code' => ['required', 'string', 'max:64', 'regex:'.AcademicMasterCatalog::CODE_PATTERN],
            'sequence' => ['required', 'integer', 'min:1', 'max:65535'],
            'startsAt' => ['required', 'date_format:H:i:s'],
            'endsAt' => ['required', 'date_format:H:i:s'],
            'kind' => ['required', 'string', Rule::in(AcademicMasterCatalog::LESSON_PERIOD_KINDS)],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
