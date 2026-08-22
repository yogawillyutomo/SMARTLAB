<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateLaboratoryRequest extends FormRequest
{
    private const MUTABLE_FIELDS = ['code', 'name', 'location', 'capacity', 'status'];

    private const RECOGNIZED_FIELDS = [
        'id',
        'school_id',
        'schoolId',
        'created_at',
        'createdAt',
        'updated_at',
        'updatedAt',
        ...self::MUTABLE_FIELDS,
    ];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'id' => ['prohibited'],
            'school_id' => ['prohibited'],
            'schoolId' => ['prohibited'],
            'created_at' => ['prohibited'],
            'createdAt' => ['prohibited'],
            'updated_at' => ['prohibited'],
            'updatedAt' => ['prohibited'],
            'code' => [
                'sometimes',
                'string',
                'max:50',
                Rule::unique('laboratories', 'code')
                    ->where(fn ($query) => $query->where('school_id', $this->schoolId()))
                    ->ignore((string) $this->route('laboratoryId')),
            ],
            'name' => ['sometimes', 'string', 'max:255'],
            'location' => ['sometimes', 'string', 'max:255'],
            'capacity' => ['sometimes', 'integer', 'min:1'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::RECOGNIZED_FIELDS) as $field) {
                $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
            }

            if (array_intersect(array_keys($this->all()), self::MUTABLE_FIELDS) === []) {
                $validator->errors()->add('request', 'At least one mutable laboratory field is required.');
            }
        });
    }

    private function schoolId(): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $this->attributes->get(CurrentMembershipContext::class);

        return $context->membership->school_id;
    }
}
