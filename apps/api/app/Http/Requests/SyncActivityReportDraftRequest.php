<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class SyncActivityReportDraftRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const ROOT_FIELDS = ['clientMutationId', 'baseVersion', 'patch'];

    private const PATCH_FIELDS = [
        'reportType', 'presentCount', 'absentCount', 'attendanceNotes',
        'externalAttendanceSystem', 'externalAttendanceReferenceId', 'commonContent', 'typeSpecificContent',
    ];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'clientMutationId' => ['required', 'uuid'],
            'baseVersion' => ['required', 'integer', 'min:1'],
            'patch' => ['required', 'array', 'min:1'],
            'patch.reportType' => ['sometimes', Rule::in(['practicum', 'exam', 'workshop', 'general'])],
            'patch.presentCount' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:32767'],
            'patch.absentCount' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:32767'],
            'patch.attendanceNotes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'patch.externalAttendanceSystem' => ['sometimes', 'nullable', 'string', 'max:128'],
            'patch.externalAttendanceReferenceId' => ['sometimes', 'nullable', 'string', 'max:255'],
            'patch.commonContent' => ['sometimes', 'array'],
            'patch.commonContent.*' => ['nullable', 'string', 'max:8000'],
            'patch.typeSpecificContent' => ['sometimes', 'array'],
            'patch.typeSpecificContent.*' => ['nullable', 'string', 'max:8000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::ROOT_FIELDS);
            $this->rejectUnknownQueryFields($validator, []);

            $patch = $this->input('patch');
            if (! is_array($patch)) {
                return;
            }

            foreach (array_diff(array_keys($patch), self::PATCH_FIELDS) as $field) {
                $validator->errors()->add('patch.'.(string) $field, "The patch.{$field} field is prohibited.");
            }
        });
    }
}
