<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class PromoteSessionIssueObservationRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'category', 'priority', 'title', 'description', 'impact',
        'blocksLaboratoryOperation', 'stepsTaken',
    ];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'category' => ['required', Rule::in(['hardware', 'software', 'network', 'electrical', 'peripheral', 'facility', 'cleanliness', 'security', 'other'])],
            'priority' => ['required', Rule::in(['low', 'normal', 'high', 'critical'])],
            'title' => ['required', 'string', 'max:200'],
            'description' => ['required', 'string', 'max:4000'],
            'impact' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'blocksLaboratoryOperation' => ['required', 'boolean'],
            'stepsTaken' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
