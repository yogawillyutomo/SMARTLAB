<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateLaboratoryRequest extends FormRequest
{
    private const RECOGNIZED_FIELDS = [
        'id',
        'school_id',
        'schoolId',
        'created_at',
        'createdAt',
        'updated_at',
        'updatedAt',
        'code',
        'name',
        'location',
        'capacity',
        'status',
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
                'required',
                'string',
                'max:50',
                Rule::unique('laboratories', 'code')->where(
                    fn ($query) => $query->where('school_id', $this->schoolId()),
                ),
            ],
            'name' => ['required', 'string', 'max:255'],
            'location' => ['required', 'string', 'max:255'],
            'capacity' => ['required', 'integer', 'min:1'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::RECOGNIZED_FIELDS) as $field) {
                $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
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
