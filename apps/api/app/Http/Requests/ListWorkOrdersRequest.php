<?php

namespace App\Http\Requests;

use App\Domain\WorkOrder\WorkOrderCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListWorkOrdersRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['status', 'assetId', 'incidentId', 'laboratoryId', 'assigneeMembershipId', 'search', 'page', 'perPage'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', Rule::in(WorkOrderCatalog::STATUSES)],
            'assetId' => ['sometimes', 'ulid'],
            'incidentId' => ['sometimes', 'ulid'],
            'laboratoryId' => ['sometimes', 'ulid'],
            'assigneeMembershipId' => ['sometimes', 'ulid'],
            'search' => ['sometimes', 'string', 'min:1', 'max:255'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
