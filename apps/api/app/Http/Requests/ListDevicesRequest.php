<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListDevicesRequest extends FormRequest
{
    private const FIELDS = ['homeLaboratoryId', 'deviceType', 'lifecycleStatus', 'search', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->query('search'))) {
            $this->merge(['search' => trim((string) $this->query('search'))]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'homeLaboratoryId' => [
                'sometimes', 'string', 'ulid',
                Rule::exists('laboratories', 'id')->where(fn ($query) => $query->where('school_id', $this->schoolId())),
            ],
            'deviceType' => ['sometimes', 'string', Rule::in(DeviceCatalog::TYPES)],
            'lifecycleStatus' => ['sometimes', 'string', Rule::in(DeviceCatalog::LIFECYCLE_STATUSES)],
            'search' => ['sometimes', 'string', 'min:1', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach (array_diff(array_keys($this->query()), self::FIELDS) as $field) {
                $validator->errors()->add((string) $field, "The {$field} query parameter is prohibited.");
            }
        });
    }

    public function messages(): array
    {
        return ['homeLaboratoryId.exists' => 'The selected home laboratory is invalid.'];
    }

    private function schoolId(): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $this->attributes->get(CurrentMembershipContext::class);

        return $context->membership->school_id;
    }
}
