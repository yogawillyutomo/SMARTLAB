<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateSessionIssueObservationRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['subjectType', 'referenceId', 'summary', 'severity', 'observedAt'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'subjectType' => ['required', Rule::in(['device', 'asset', 'facility', 'other'])],
            'referenceId' => ['sometimes', 'nullable', 'string', 'max:128'],
            'summary' => ['required', 'string', 'max:4000'],
            'severity' => ['required', Rule::in(['low', 'medium', 'high', 'critical'])],
            'observedAt' => ['required', 'date'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $this->rejectUnknownQueryFields($validator, []);

            $subjectType = $this->input('subjectType');
            $referenceId = $this->input('referenceId');

            if ($subjectType === 'device' && (! is_string($referenceId) || trim($referenceId) === '')) {
                $validator->errors()->add('referenceId', 'A canonical Device reference is required for device observations.');
            }

            if ($subjectType !== 'device' && $referenceId !== null && $referenceId !== '') {
                $validator->errors()->add(
                    'referenceId',
                    $subjectType === 'asset'
                        ? 'Asset canonical references are not available until the S4 Asset domain is authoritative.'
                        : 'referenceId is only supported for canonical Device observations in S3.5.',
                );
            }
        });
    }
}
