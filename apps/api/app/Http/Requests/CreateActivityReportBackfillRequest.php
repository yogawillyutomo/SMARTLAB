<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateActivityReportBackfillRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'reportType', 'laboratoryId', 'occurredOn', 'manualBackfillReason', 'responsibleName',
        'activityDescription', 'plannedParticipantCount', 'presentCount', 'absentCount',
        'attendanceNotes', 'externalAttendanceSystem', 'externalAttendanceReferenceId',
        'commonContent', 'typeSpecificContent',
    ];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'reportType' => ['required', Rule::in(['practicum', 'exam', 'workshop', 'general'])],
            'laboratoryId' => ['required', 'string', 'min:1', 'max:128'],
            'occurredOn' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'manualBackfillReason' => ['required', 'string', 'min:1', 'max:2000'],
            'responsibleName' => ['required', 'string', 'min:1', 'max:255'],
            'activityDescription' => ['required', 'string', 'min:1', 'max:4000'],
            'plannedParticipantCount' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'presentCount' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'absentCount' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'attendanceNotes' => ['nullable', 'string', 'max:4000'],
            'externalAttendanceSystem' => ['nullable', 'string', 'max:128'],
            'externalAttendanceReferenceId' => ['nullable', 'string', 'max:255'],
            'commonContent' => ['sometimes', 'array'],
            'commonContent.*' => ['nullable', 'string', 'max:8000'],
            'typeSpecificContent' => ['sometimes', 'array'],
            'typeSpecificContent.*' => ['nullable', 'string', 'max:8000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
