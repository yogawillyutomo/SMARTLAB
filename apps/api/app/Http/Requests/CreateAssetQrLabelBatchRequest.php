<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateAssetQrLabelBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $selection = $this->input('selection');
        if (! is_array($selection)) {
            return;
        }

        foreach (['search', 'category'] as $field) {
            if (isset($selection[$field]) && is_string($selection[$field])) {
                $selection[$field] = trim($selection[$field]);
            }
        }

        $this->merge(['selection' => $selection]);
    }

    public function rules(): array
    {
        return [
            'templateKey' => ['required', Rule::in(['40x25', '50x30', '70x40'])],
            'assetIds' => ['required', 'array', 'min:1', 'max:500'],
            'assetIds.*' => ['required', 'ulid', 'distinct'],
            'selection' => ['sometimes', 'array'],
            'selection.laboratoryId' => ['sometimes', 'nullable', 'ulid'],
            'selection.category' => ['sometimes', 'string', 'max:100'],
            'selection.condition' => ['sometimes', Rule::in(AssetCatalog::CONDITIONS)],
            'selection.lifecycleStatus' => ['sometimes', Rule::in(AssetCatalog::LIFECYCLE_STATUSES)],
            'selection.linkStatus' => ['sometimes', Rule::in(['linked', 'unlinked'])],
            'selection.qrStatus' => ['sometimes', Rule::in(['active', 'missing'])],
            'selection.printedStatus' => ['sometimes', Rule::in(['printed', 'unprinted'])],
            'selection.search' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $allowedTopLevel = ['templateKey', 'assetIds', 'selection'];
            foreach (array_diff(array_keys($this->all()), $allowedTopLevel) as $field) {
                $validator->errors()->add((string) $field, 'Unknown label batch field.');
            }

            $selection = $this->input('selection', []);
            if (! is_array($selection)) {
                return;
            }

            $allowedSelection = [
                'laboratoryId', 'category', 'condition', 'lifecycleStatus',
                'linkStatus', 'qrStatus', 'printedStatus', 'search',
            ];
            foreach (array_diff(array_keys($selection), $allowedSelection) as $field) {
                $validator->errors()->add('selection.'.(string) $field, 'Unknown label selection field.');
            }
        });
    }
}
