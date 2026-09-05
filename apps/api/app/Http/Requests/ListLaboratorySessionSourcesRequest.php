<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListLaboratorySessionSourcesRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['from', 'to', 'laboratoryId', 'scope'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'laboratoryId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'scope' => ['sometimes', Rule::in(['mine', 'all'])],
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

            if ($from && $to && $from->diffInDays($to) > 13) {
                $validator->errors()->add('to', 'Laboratory Session source range may not exceed 14 calendar days.');
            }
        });
    }
}
