<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use Normalizer;

class AssignIncidentRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['assigneeMembershipId', 'reason'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('assigneeMembershipId'))) {
            $this->merge([
                'assigneeMembershipId' => strtolower(trim((string) $this->input('assigneeMembershipId'))),
            ]);
        }
        if (is_string($this->input('reason'))) {
            $reason = trim((string) $this->input('reason'));
            $normalized = Normalizer::normalize($reason, Normalizer::FORM_C);
            $reason = $normalized === false ? $reason : $normalized;
            $this->merge(['reason' => $reason === '' ? null : $reason]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'assigneeMembershipId' => ['required', 'string', 'ulid'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }

    /** @return array<string, mixed> */
    public function validationData(): array
    {
        return $this->isJson() ? $this->json()->all() : $this->request->all();
    }

    /** @return array{assigneeMembershipId: string, reason?: ?string} */
    public function businessPayload(): array
    {
        return array_intersect_key($this->validated(), array_flip(self::FIELDS));
    }
}
