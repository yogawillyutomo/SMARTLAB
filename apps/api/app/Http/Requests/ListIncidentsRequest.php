<?php

namespace App\Http\Requests;

use App\Domain\Incident\IncidentCategory;
use App\Domain\Incident\IncidentPriority;
use App\Domain\Incident\IncidentStatus;
use App\Domain\Incident\IncidentTimestamp;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

class ListIncidentsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'status', 'priority', 'category', 'laboratoryId', 'deviceId', 'assigneeMembershipId',
        'reportedFrom', 'reportedTo', 'search', 'page', 'perPage',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['search', 'reportedFrom', 'reportedTo'] as $field) {
            if (is_string($this->query($field))) {
                $this->merge([$field => trim((string) $this->query($field))]);
            }
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $timestamp = function (string $attribute, mixed $value, \Closure $fail): void {
            try {
                IncidentTimestamp::canonicalize((string) $value);
            } catch (InvalidArgumentException) {
                $fail("The {$attribute} field must be a valid RFC3339 date-time.");
            }
        };

        return [
            'status' => ['sometimes', 'string', Rule::in(IncidentStatus::values())],
            'priority' => ['sometimes', 'string', Rule::in(IncidentPriority::values())],
            'category' => ['sometimes', 'string', Rule::in(IncidentCategory::values())],
            'laboratoryId' => ['sometimes', 'string', 'ulid'],
            'deviceId' => ['sometimes', 'string', 'ulid'],
            'assigneeMembershipId' => ['sometimes', 'string', 'ulid'],
            'reportedFrom' => ['sometimes', 'bail', 'string', $timestamp],
            'reportedTo' => ['sometimes', 'bail', 'string', $timestamp],
            'search' => ['sometimes', 'string', 'min:2', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownQueryFields($validator, self::FIELDS);

            if ($validator->errors()->has('reportedFrom')
                || $validator->errors()->has('reportedTo')
                || ! is_string($this->input('reportedFrom'))
                || ! is_string($this->input('reportedTo'))) {
                return;
            }

            if (IncidentTimestamp::canonicalize($this->input('reportedFrom'))
                > IncidentTimestamp::canonicalize($this->input('reportedTo'))) {
                $validator->errors()->add('reportedTo', 'The reportedTo field must be after or equal to reportedFrom.');
            }
        });
    }
}
