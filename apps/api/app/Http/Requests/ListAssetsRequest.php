<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ListAssetsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'string', 'max:255'],
            'homeLaboratoryId' => ['sometimes', 'nullable', 'ulid'],
            'condition' => ['sometimes', Rule::in(AssetCatalog::CONDITIONS)],
            'lifecycleStatus' => ['sometimes', Rule::in(AssetCatalog::LIFECYCLE_STATUSES)],
            'linkedDeviceId' => ['sometimes', 'nullable', 'ulid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }
}
