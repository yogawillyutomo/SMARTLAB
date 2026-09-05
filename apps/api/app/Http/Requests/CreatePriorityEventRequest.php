<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreatePriorityEventRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'laboratoryId',
        'date',
        'startsAt',
        'endsAt',
        'category',
        'title',
        'participants',
        'description',
        'picName',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'laboratoryId' => ['required', 'string', 'min:1', 'max:128'],
            'date' => ['required', 'date_format:Y-m-d'],
            'startsAt' => ['required', 'date_format:H:i'],
            'endsAt' => ['required', 'date_format:H:i', 'after:startsAt'],
            'category' => ['required', Rule::in(['school_event', 'exam', 'competition', 'official_visit', 'emergency', 'other'])],
            'title' => ['required', 'string', 'min:1', 'max:255'],
            'participants' => ['required', 'integer', 'min:1', 'max:1000'],
            'description' => ['nullable', 'string', 'max:4000'],
            'picName' => ['required', 'string', 'min:1', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
