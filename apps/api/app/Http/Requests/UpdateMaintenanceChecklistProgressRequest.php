<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateMaintenanceChecklistProgressRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'checklistResults' => ['required', 'array', 'min:1', 'max:50'],
            'checklistResults.*' => ['required', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['checklistResults']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
