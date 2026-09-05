<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateActivityReportRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'reportType', 'presentCount', 'absentCount', 'attendanceNotes',
        'externalAttendanceSystem', 'externalAttendanceReferenceId', 'commonContent', 'typeSpecificContent',
    ];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'reportType' => ['sometimes', Rule::in(['practicum', 'exam', 'workshop', 'general'])],
            'presentCount' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:65535'],
            'absentCount' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:65535'],
            'attendanceNotes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'externalAttendanceSystem' => ['sometimes', 'nullable', 'string', 'max:128'],
            'externalAttendanceReferenceId' => ['sometimes', 'nullable', 'string', 'max:255'],
            'commonContent' => ['sometimes', 'array'],
            'commonContent.*' => ['nullable', 'string', 'max:8000'],
            'typeSpecificContent' => ['sometimes', 'array'],
            'typeSpecificContent.*' => ['nullable', 'string', 'max:8000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            if ($this->all() === []) {
                $validator->errors()->add('_request', 'At least one Activity Report field must be supplied.');
            }
        });
    }
}
