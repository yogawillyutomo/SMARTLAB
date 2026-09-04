<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListScheduleOccurrencesRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'from',
        'to',
        'laboratoryId',
        'teacherId',
        'academicClassId',
        'subjectId',
        'activityType',
        'page',
        'perPage',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'laboratoryId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'teacherId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'academicClassId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'subjectId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'activityType' => ['sometimes', 'string', Rule::in(['practical', 'theory', 'exam', 'other'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:1000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownQueryFields($validator, self::FIELDS);

            if ($validator->errors()->has('from') || $validator->errors()->has('to')) {
                return;
            }

            $from = CarbonImmutable::createFromFormat('!Y-m-d', (string) $this->input('from'));
            $to = CarbonImmutable::createFromFormat('!Y-m-d', (string) $this->input('to'));

            if ($from === false || $to === false) {
                return;
            }

            if ($from->diffInDays($to) > 13) {
                $validator->errors()->add('to', 'The occurrence date range may not exceed 14 calendar days.');
            }
        });
    }
}
