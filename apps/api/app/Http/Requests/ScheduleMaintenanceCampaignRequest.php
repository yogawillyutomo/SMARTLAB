<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ScheduleMaintenanceCampaignRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['scheduledFor', 'technicianReference', 'technicianName', 'assetIds'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['technicianReference', 'technicianName'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && $field === 'technicianReference' ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        return [
            'scheduledFor' => ['required', 'date'],
            'technicianReference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'technicianName' => ['required', 'string', 'min:2', 'max:255'],
            'assetIds' => ['sometimes', 'array', 'min:1', 'max:200'],
            'assetIds.*' => ['required', 'ulid', 'distinct'],
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
