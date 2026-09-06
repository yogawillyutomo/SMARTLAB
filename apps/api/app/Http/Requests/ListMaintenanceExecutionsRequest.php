<?php

namespace App\Http\Requests;

use App\Domain\Maintenance\MaintenanceCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListMaintenanceExecutionsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['status', 'assetId', 'maintenancePlanId', 'from', 'to', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', Rule::in(MaintenanceCatalog::EXECUTION_STATUSES)],
            'assetId' => ['sometimes', 'ulid'],
            'maintenancePlanId' => ['sometimes', 'ulid'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
