<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CompleteWorkOrderRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        foreach (['diagnosis', 'actionTaken', 'testResult'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && $field === 'testResult' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        return [
            'diagnosis' => ['required', 'string', 'min:3', 'max:2000'],
            'actionTaken' => ['required', 'string', 'min:3', 'max:2000'],
            'conditionAfter' => ['required', Rule::in(AssetCatalog::CONDITIONS)],
            'testResult' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['diagnosis', 'actionTaken', 'conditionAfter', 'testResult']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
