<?php

namespace App\Http\Requests;

use App\Domain\Academic\AcademicMasterCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateLessonPeriodRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['sequence', 'startsAt', 'endsAt', 'kind', 'status'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
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
            'sequence' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'startsAt' => ['sometimes', 'date_format:H:i:s'],
            'endsAt' => ['sometimes', 'date_format:H:i:s'],
            'kind' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::LESSON_PERIOD_KINDS)],
            'status' => ['sometimes', 'string', Rule::in(AcademicMasterCatalog::STATUSES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            if (array_intersect(array_keys($this->all()), self::FIELDS) === []) {
                $validator->errors()->add('request', 'At least one Lesson Period field is required.');
            }
        });
    }
}
