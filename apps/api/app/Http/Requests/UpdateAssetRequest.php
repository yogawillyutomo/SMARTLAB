<?php

namespace App\Http\Requests;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetCatalog;
use App\Http\Requests\Concerns\ValidatesClosedAssetPayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateAssetRequest extends FormRequest
{
    use ValidatesClosedAssetPayload;

    private const FIELDS = [
        'name', 'category', 'brand', 'model', 'serialNumber', 'homeLaboratoryId',
        'condition', 'acquisitionDate', 'acquisitionYear', 'fundingSource',
        'purchasePrice', 'supplierName', 'warrantyUntil', 'notes',
    ];

    private const PROHIBITED = [
        'id', 'school_id', 'schoolId', 'assetCode', 'lifecycleStatus', 'linkedDeviceId',
        'version', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
        'laboratoryId', 'position', 'status', 'deviceId',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['name', 'category'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $this->merge([$field => trim((string) $this->input($field))]);
            }
        }
        $this->normalizeNullableAssetStrings([
            'brand', 'model', 'serialNumber', 'fundingSource', 'supplierName', 'notes',
        ]);
    }

    public function rules(): array
    {
        $rules = [
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'category' => ['sometimes', 'string', 'min:1', 'max:120'],
            'brand' => ['sometimes', 'nullable', 'string', 'max:255'],
            'model' => ['sometimes', 'nullable', 'string', 'max:255'],
            'serialNumber' => ['sometimes', 'nullable', 'string', 'max:255'],
            'homeLaboratoryId' => [
                'sometimes', 'nullable', 'ulid',
                Rule::exists('laboratories', 'id')->where(fn ($query) => $query
                    ->where('school_id', $this->schoolId())->where('status', 'active')),
            ],
            'condition' => ['sometimes', Rule::in(AssetCatalog::CONDITIONS)],
            'acquisitionDate' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'acquisitionYear' => ['sometimes', 'nullable', 'integer', 'min:1900', 'max:2100'],
            'fundingSource' => ['sometimes', 'nullable', 'string', 'max:255'],
            'purchasePrice' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            'supplierName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'warrantyUntil' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
        ];
        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownAssetFields($validator, [...self::FIELDS, ...self::PROHIBITED]);
            if (array_intersect(array_keys($this->all()), self::FIELDS) === []) {
                $validator->errors()->add('payload', 'At least one Asset field must be provided.');
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
