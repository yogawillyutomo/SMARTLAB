<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListLaboratorySessionsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['from', 'to', 'laboratoryId', 'sourceType', 'status', 'scope', 'page', 'perPage'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'laboratoryId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'sourceType' => ['sometimes', Rule::in(['schedule_occurrence', 'laboratory_reservation', 'priority_event'])],
            'status' => ['sometimes', Rule::in(['prepared', 'in_progress', 'ended', 'cancelled'])],
            'scope' => ['sometimes', Rule::in(['mine', 'all'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:500'],
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

            if ($from && $to && $from->diffInDays($to) > 365) {
                $validator->errors()->add('to', 'Laboratory Session range may not exceed 366 calendar days.');
            }
        });
    }
}
