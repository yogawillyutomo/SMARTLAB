<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ScheduleMaintenanceExecutionRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'scheduledFor' => ['required', 'date'],
            'technicianReference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'technicianName' => ['required', 'string', 'min:2', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['scheduledFor', 'technicianReference', 'technicianName']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
