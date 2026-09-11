<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ListAssetQrLabelCandidatesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
        foreach (['search', 'category'] as $field) {
            if (is_string($this->input($field))) {
                $normalized[$field] = trim((string) $this->input($field));
            }
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'string', 'max:255'],
            'laboratoryId' => ['sometimes', 'nullable', 'ulid'],
            'category' => ['sometimes', 'string', 'max:100'],
            'condition' => ['sometimes', Rule::in(AssetCatalog::CONDITIONS)],
            'lifecycleStatus' => ['sometimes', Rule::in(AssetCatalog::LIFECYCLE_STATUSES)],
            'linkStatus' => ['sometimes', Rule::in(['linked', 'unlinked'])],
            'qrStatus' => ['sometimes', Rule::in(['active', 'missing'])],
            'printedStatus' => ['sometimes', Rule::in(['printed', 'unprinted'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }
}
